import asyncio
from datetime import datetime, timezone
import logging
import re

from app.core.config import settings
from app.core.database import db
from app.models.schemas import (
    DeviceStatusRecord,
    ReachabilityStatus,
    StatusSummaryResponse,
)

logger = logging.getLogger(__name__)

_PING_RTT_RE = re.compile(r"time[=<]\s*([0-9]+(?:\.[0-9]+)?)\s*ms", re.I)


def parse_ping_latency_ms(stdout: str) -> float | None:
    """Extract ICMP round-trip time in milliseconds from iputils ping output."""
    if not stdout:
        return None
    match = _PING_RTT_RE.search(stdout)
    if not match:
        return None
    return round(float(match.group(1)), 2)


def compute_next_status(
    prev_status: str | None,
    prev_failures: int,
    reachable: bool,
) -> tuple[ReachabilityStatus, int]:
    """Apply 1-miss flap damping: up -> degraded (1 miss) -> down (2+ misses)."""
    if reachable:
        return "up", 0
    failures = prev_failures + 1
    if failures == 1 and prev_status == "up":
        return "degraded", failures
    return "down", failures


async def probe_icmp(ip: str, timeout_sec: int = 2) -> tuple[bool, float | None]:
    """Run a single non-blocking ICMP echo request using system ping."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ping",
            "-n",
            "-c",
            "1",
            "-W",
            str(max(1, timeout_sec)),
            ip,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_bytes, _ = await asyncio.wait_for(
            proc.communicate(),
            timeout=timeout_sec + 2,
        )
        stdout = stdout_bytes.decode("utf-8", errors="ignore")
        if proc.returncode == 0:
            return True, parse_ping_latency_ms(stdout)
        return False, None
    except asyncio.TimeoutError:
        return False, None
    except OSError as exc:
        logger.debug("ICMP probe failed for %s: %s", ip, exc)
        return False, None


class StatusPoller:
    """Background ICMP reachability & latency poller for discovered devices."""

    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()
        self._poll_lock = asyncio.Lock()
        self._last_cycle_at: datetime | None = None
        self._mock_status: dict[str, DeviceStatusRecord] = {}

    def start(self) -> None:
        if not settings.status_poll_enabled:
            logger.info("Background ICMP status poller disabled (STATUS_POLL_ENABLED=false).")
            return
        if self._task is None or self._task.done():
            self._stop_event = asyncio.Event()
            self._task = asyncio.create_task(self._loop(), name="netatlas-status-poller")
            logger.info(
                "Started ICMP reachability poller (interval=%ss).",
                settings.status_poll_interval_seconds,
            )

    async def stop(self) -> None:
        if self._task is not None:
            self._stop_event.set()
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _loop(self) -> None:
        try:
            await asyncio.wait_for(self._stop_event.wait(), timeout=1.0)
            return
        except asyncio.TimeoutError:
            pass

        while not self._stop_event.is_set():
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("ICMP poll cycle failed: %s", exc)

            try:
                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=max(5, settings.status_poll_interval_seconds),
                )
            except asyncio.TimeoutError:
                continue

    def _ensure_mock_populated(self) -> None:
        if self._mock_status:
            return
        from app.services.mock_data import get_mock_device_summaries

        now = datetime.now(timezone.utc)
        for idx, dev in enumerate(get_mock_device_summaries()):
            rtt = round(0.75 + (idx * 0.37) % 3.2, 2)
            self._mock_status[dev.ip] = DeviceStatusRecord(
                ip=dev.ip,
                status="up",
                latency_ms=rtt,
                consecutive_failures=0,
                last_checked=now,
                last_up=now,
            )
        self._last_cycle_at = now

    async def poll_once(self) -> StatusSummaryResponse:
        """Execute a single ICMP polling sweep across all known local devices."""
        async with self._poll_lock:
            now = datetime.now(timezone.utc)
            if settings.mock_mode:
                from app.services.mock_data import get_mock_device_summaries

                for idx, dev in enumerate(get_mock_device_summaries()):
                    rtt = round(0.7 + ((idx * 0.41) + (now.second % 5) * 0.08), 2)
                    self._mock_status[dev.ip] = DeviceStatusRecord(
                        ip=dev.ip,
                        status="up",
                        latency_ms=rtt,
                        consecutive_failures=0,
                        last_checked=now,
                        last_up=now,
                    )
                self._last_cycle_at = now
                return await self.get_status_summary("local")

            device_rows = await db.fetch_all("SELECT host(ip) AS ip FROM device ORDER BY ip")
            ips = [str(row["ip"]) for row in device_rows if row.get("ip")]
            prev_rows = await db.fetch_all(
                "SELECT ip, status, consecutive_failures FROM netatlas.device_status WHERE site_id = 'local'"
            )
            prev_by_ip = {row["ip"]: row for row in prev_rows}

            if ips:
                sem = asyncio.Semaphore(max(1, settings.status_poll_concurrency))

                async def _probe_one(target_ip: str) -> tuple[str, bool, float | None]:
                    async with sem:
                        ok, rtt = await probe_icmp(
                            target_ip, timeout_sec=settings.status_poll_timeout_seconds
                        )
                        return target_ip, ok, rtt

                results = await asyncio.gather(*(_probe_one(ip) for ip in ips))

                for target_ip, reachable, rtt in results:
                    prev = prev_by_ip.get(target_ip)
                    prev_status = prev.get("status") if prev else None
                    prev_failures = int(prev.get("consecutive_failures") or 0) if prev else 0
                    next_status, next_failures = compute_next_status(
                        prev_status, prev_failures, reachable
                    )
                    await db.execute(
                        """
                        INSERT INTO netatlas.device_status (
                            site_id, ip, status, latency_ms, consecutive_failures,
                            last_checked, last_up, last_change
                        )
                        VALUES (
                            'local', %s, %s, %s, %s, NOW(),
                            CASE WHEN %s = 'up' THEN NOW() ELSE NULL END,
                            NOW()
                        )
                        ON CONFLICT (site_id, ip)
                        DO UPDATE SET
                            status = EXCLUDED.status,
                            latency_ms = EXCLUDED.latency_ms,
                            consecutive_failures = EXCLUDED.consecutive_failures,
                            last_checked = NOW(),
                            last_up = CASE
                                WHEN EXCLUDED.status = 'up' THEN NOW()
                                ELSE netatlas.device_status.last_up
                            END,
                            last_change = CASE
                                WHEN netatlas.device_status.status IS DISTINCT FROM EXCLUDED.status THEN NOW()
                                ELSE netatlas.device_status.last_change
                            END
                        """,
                        (target_ip, next_status, rtt, next_failures, next_status),
                    )

            self._last_cycle_at = now
            return await self.get_status_summary("local")

    async def get_status_map(self, site_id: str = "local") -> dict[str, DeviceStatusRecord]:
        """Return latest reachability records indexed by device IP."""
        if settings.mock_mode:
            if site_id == "local":
                self._ensure_mock_populated()
                return dict(self._mock_status)
            return {}

        try:
            rows = await db.fetch_all(
                """
                SELECT ip, status, latency_ms, consecutive_failures, last_checked, last_up
                FROM netatlas.device_status
                WHERE site_id = %s
                """,
                (site_id,),
            )
            return {
                row["ip"]: DeviceStatusRecord(
                    ip=row["ip"],
                    status=row.get("status") or "unknown",
                    latency_ms=row.get("latency_ms"),
                    consecutive_failures=int(row.get("consecutive_failures") or 0),
                    last_checked=row.get("last_checked"),
                    last_up=row.get("last_up"),
                )
                for row in rows
            }
        except Exception as exc:
            logger.debug("Unable to read device_status for site %s: %s", site_id, exc)
            return {}

    async def get_status_summary(self, site_id: str = "local") -> StatusSummaryResponse:
        """Return aggregated device reachability summary for a site."""
        status_map = await self.get_status_map(site_id)
        records = sorted(status_map.values(), key=lambda r: r.ip)
        counts = {"up": 0, "degraded": 0, "down": 0, "unknown": 0}
        for rec in records:
            counts[rec.status] = counts.get(rec.status, 0) + 1

        last_cycle = self._last_cycle_at
        if last_cycle is None and records:
            timestamps = [r.last_checked for r in records if r.last_checked is not None]
            if timestamps:
                last_cycle = max(timestamps)

        return StatusSummaryResponse(
            enabled=settings.status_poll_enabled,
            interval_seconds=settings.status_poll_interval_seconds,
            last_cycle_at=last_cycle,
            total=len(records),
            up=counts["up"],
            degraded=counts["degraded"],
            down=counts["down"],
            unknown=counts["unknown"],
            devices=records,
            mode="mock" if settings.mock_mode else "live",
        )


status_poller = StatusPoller()
