from datetime import datetime, timezone
import hashlib
import hmac
import ipaddress
import json
import secrets
import threading
from typing import Any

from fastapi import HTTPException

from app.core.config import settings
from app.core.database import db
from app.models.schemas import (
    AgentListResponse,
    AgentRegisterRequest,
    AgentRegisterResponse,
    AgentSummary,
    IngestResponse,
    IngestSnapshotPayload,
    NodeOverrideRequest,
    NodePositionItem,
    SiteCreateRequest,
    SiteListResponse,
    SiteSummary,
)

_STATE_LOCK = threading.Lock()
_MOCK_SITES: dict[str, dict[str, Any]] = {
    "local": {
        "site_id": "local",
        "name": "Local Site (HQ)",
        "description": "Primary Netdisco discovery engine",
        "is_local": True,
        "created_at": datetime.now(timezone.utc),
    }
}
_MOCK_AGENTS: dict[str, dict[str, Any]] = {}
_MOCK_OVERRIDES: dict[tuple[str, str], dict[str, Any]] = {}
_MOCK_SNAPSHOTS: dict[str, dict[str, Any]] = {}


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def list_sites() -> SiteListResponse:
    """List local and registered remote network sites."""
    if settings.mock_mode:
        from app.services.mock_data import get_mock_device_summaries

        local_device_count = len(get_mock_device_summaries())
        with _STATE_LOCK:
            sites: list[SiteSummary] = []
            for site in _MOCK_SITES.values():
                sid = site["site_id"]
                agent_cnt = sum(1 for a in _MOCK_AGENTS.values() if a["site_id"] == sid)
                snap = _MOCK_SNAPSHOTS.get(sid)
                dev_cnt = (
                    local_device_count
                    if site["is_local"]
                    else len((snap or {}).get("devices", []))
                )
                sites.append(
                    SiteSummary(
                        site_id=sid,
                        name=site["name"],
                        description=site.get("description"),
                        is_local=site["is_local"],
                        agent_count=(1 if site["is_local"] else 0) + agent_cnt,
                        device_count=dev_cnt,
                        last_sync=datetime.now(timezone.utc)
                        if site["is_local"]
                        else (snap or {}).get("received_at"),
                        created_at=site["created_at"],
                    )
                )
            sites.sort(key=lambda s: (not s.is_local, s.site_id))
        return SiteListResponse(sites=sites, total=len(sites), mode="mock")

    rows = await db.fetch_all(
        """
        SELECT
            s.site_id,
            s.name,
            s.description,
            s.is_local,
            s.created_at,
            COUNT(a.agent_id) AS agent_count,
            snap.received_at AS last_sync,
            COALESCE(jsonb_array_length(snap.payload->'devices'), 0) AS snap_devices
        FROM netatlas.sites s
        LEFT JOIN netatlas.agents a ON a.site_id = s.site_id
        LEFT JOIN netatlas.ingested_snapshots snap ON snap.site_id = s.site_id
        GROUP BY s.site_id, s.name, s.description, s.is_local, s.created_at, snap.received_at, snap.payload
        ORDER BY s.is_local DESC, s.site_id ASC
        """
    )

    local_cnt_row = await db.fetch_one("SELECT COUNT(*) AS cnt FROM device")
    local_dev_cnt = int(local_cnt_row["cnt"]) if local_cnt_row else 0
    local_sync_row = await db.fetch_one("SELECT MAX(last_discover) AS ts FROM device")
    local_last_sync = local_sync_row["ts"] if local_sync_row else None

    sites = []
    for row in rows:
        is_local = bool(row["is_local"])
        sites.append(
            SiteSummary(
                site_id=row["site_id"],
                name=row["name"],
                description=row.get("description"),
                is_local=is_local,
                agent_count=int(row["agent_count"] or 0) + (1 if is_local else 0),
                device_count=local_dev_cnt if is_local else int(row["snap_devices"] or 0),
                last_sync=local_last_sync if is_local else row.get("last_sync"),
                created_at=row.get("created_at"),
            )
        )
    return SiteListResponse(sites=sites, total=len(sites), mode="live")


async def create_site(req: SiteCreateRequest) -> SiteSummary:
    """Create a new remote site for multi-site collector agents."""
    if settings.mock_mode:
        with _STATE_LOCK:
            if req.site_id in _MOCK_SITES:
                raise HTTPException(
                    status_code=409,
                    detail=f"Site '{req.site_id}' already exists.",
                )
            now = datetime.now(timezone.utc)
            _MOCK_SITES[req.site_id] = {
                "site_id": req.site_id,
                "name": req.name.strip(),
                "description": req.description,
                "is_local": False,
                "created_at": now,
            }
            return SiteSummary(
                site_id=req.site_id,
                name=req.name.strip(),
                description=req.description,
                is_local=False,
                agent_count=0,
                device_count=0,
                created_at=now,
            )

    existing = await db.fetch_one(
        "SELECT site_id FROM netatlas.sites WHERE site_id = %s",
        (req.site_id,),
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"Site '{req.site_id}' already exists.")

    row = await db.execute_returning(
        """
        INSERT INTO netatlas.sites (site_id, name, description, is_local)
        VALUES (%s, %s, %s, FALSE)
        RETURNING site_id, name, description, is_local, created_at
        """,
        (req.site_id, req.name.strip(), req.description),
    )
    assert row is not None
    return SiteSummary(
        site_id=row["site_id"],
        name=row["name"],
        description=row.get("description"),
        is_local=False,
        agent_count=0,
        device_count=0,
        created_at=row.get("created_at"),
    )


async def list_agents() -> AgentListResponse:
    """List built-in local Netdisco collector and registered remote site agents."""
    if settings.mock_mode:
        from app.services.mock_data import build_mock_topology

        topo = build_mock_topology()
        agents: list[AgentSummary] = [
            AgentSummary(
                agent_id="local-netdisco",
                site_id="local",
                site_name="Local Site (HQ)",
                name="Local Netdisco Engine (Mock)",
                hostname="netdisco-backend",
                version=settings.app_version,
                status="online",
                is_local=True,
                last_seen=datetime.now(timezone.utc),
                device_count=topo.summary.managed_devices,
                link_count=topo.summary.total_links,
            )
        ]
        with _STATE_LOCK:
            for item in _MOCK_AGENTS.values():
                site_name = _MOCK_SITES.get(item["site_id"], {}).get("name", item["site_id"])
                agents.append(
                    AgentSummary(
                        agent_id=item["agent_id"],
                        site_id=item["site_id"],
                        site_name=site_name,
                        name=item["name"],
                        hostname=item.get("hostname"),
                        version=item.get("version"),
                        status=item["status"],
                        is_local=False,
                        last_seen=item.get("last_seen"),
                        device_count=item.get("device_count", 0),
                        link_count=item.get("link_count", 0),
                    )
                )
        return AgentListResponse(agents=agents, total=len(agents), mode="mock")

    dev_row = await db.fetch_one(
        "SELECT COUNT(*) AS cnt, MAX(last_discover) AS ts FROM device"
    )
    link_row = await db.fetch_one(
        "SELECT COUNT(*) AS cnt FROM device_port WHERE remote_ip IS NOT NULL"
    )
    local_agent = AgentSummary(
        agent_id="local-netdisco",
        site_id="local",
        site_name="Local Site",
        name="Local Netdisco Engine",
        hostname="netdisco-backend",
        version=settings.app_version,
        status="online",
        is_local=True,
        last_seen=dev_row["ts"] if dev_row else None,
        device_count=int(dev_row["cnt"]) if dev_row else 0,
        link_count=(int(link_row["cnt"]) // 2) if link_row and link_row["cnt"] else 0,
    )

    rows = await db.fetch_all(
        """
        SELECT
            a.agent_id,
            a.site_id,
            s.name AS site_name,
            a.name,
            a.hostname,
            a.version,
            a.status,
            a.last_seen,
            a.device_count,
            a.link_count
        FROM netatlas.agents a
        JOIN netatlas.sites s ON s.site_id = a.site_id
        ORDER BY a.created_at DESC
        """
    )
    agents = [local_agent]
    for row in rows:
        agents.append(
            AgentSummary(
                agent_id=row["agent_id"],
                site_id=row["site_id"],
                site_name=row.get("site_name"),
                name=row["name"],
                hostname=row.get("hostname"),
                version=row.get("version"),
                status=row["status"],
                is_local=False,
                last_seen=row.get("last_seen"),
                device_count=int(row.get("device_count") or 0),
                link_count=int(row.get("link_count") or 0),
            )
        )
    return AgentListResponse(agents=agents, total=len(agents), mode="live")


async def register_agent(req: AgentRegisterRequest) -> AgentRegisterResponse:
    """Register a remote site collector agent and return its one-time ingest token."""
    agent_id = f"agt-{secrets.token_hex(6)}"
    token = f"na_{secrets.token_urlsafe(32)}"
    token_hash = _hash_token(token)

    if settings.mock_mode:
        with _STATE_LOCK:
            site = _MOCK_SITES.get(req.site_id)
            if site is None:
                raise HTTPException(status_code=404, detail=f"Site '{req.site_id}' not found.")
            _MOCK_AGENTS[agent_id] = {
                "agent_id": agent_id,
                "site_id": req.site_id,
                "name": req.name.strip(),
                "token_hash": token_hash,
                "hostname": None,
                "version": None,
                "status": "registered",
                "last_seen": None,
                "device_count": 0,
                "link_count": 0,
            }
            summary = AgentSummary(
                agent_id=agent_id,
                site_id=req.site_id,
                site_name=site["name"],
                name=req.name.strip(),
                status="registered",
                is_local=False,
            )
        return AgentRegisterResponse(agent=summary, token=token, ingest_url="/api/v1/ingest")

    site_row = await db.fetch_one(
        "SELECT site_id, name FROM netatlas.sites WHERE site_id = %s",
        (req.site_id,),
    )
    if site_row is None:
        raise HTTPException(status_code=404, detail=f"Site '{req.site_id}' not found.")

    await db.execute(
        """
        INSERT INTO netatlas.agents (agent_id, site_id, name, token_hash, status)
        VALUES (%s, %s, %s, %s, 'registered')
        """,
        (agent_id, req.site_id, req.name.strip(), token_hash),
    )

    summary = AgentSummary(
        agent_id=agent_id,
        site_id=req.site_id,
        site_name=site_row["name"],
        name=req.name.strip(),
        status="registered",
        is_local=False,
    )
    return AgentRegisterResponse(agent=summary, token=token, ingest_url="/api/v1/ingest")


async def ingest_snapshot(
    payload: IngestSnapshotPayload,
    token: str | None,
) -> IngestResponse:
    """Authenticate an agent token and store its latest site discovery snapshot."""
    if not token or not token.strip():
        raise HTTPException(status_code=401, detail="Missing X-Agent-Token header.")

    presented_hash = _hash_token(token.strip())
    now = datetime.now(timezone.utc)
    serialized = payload.model_dump(mode="json")

    if settings.mock_mode:
        with _STATE_LOCK:
            agent = _MOCK_AGENTS.get(payload.agent_id)
            if (
                agent is None
                or agent["site_id"] != payload.site_id
                or not hmac.compare_digest(agent["token_hash"], presented_hash)
            ):
                raise HTTPException(status_code=401, detail="Invalid agent credentials.")

            _MOCK_SNAPSHOTS[payload.site_id] = {
                "agent_id": payload.agent_id,
                "payload": serialized,
                "received_at": now,
                "devices": serialized.get("devices", []),
            }
            agent["status"] = "online"
            agent["last_seen"] = now
            agent["hostname"] = payload.hostname
            agent["version"] = payload.version
            agent["device_count"] = len(payload.devices)
            agent["link_count"] = len(payload.raw_links)

        return IngestResponse(
            status="accepted",
            site_id=payload.site_id,
            agent_id=payload.agent_id,
            devices_ingested=len(payload.devices),
            links_ingested=len(payload.raw_links),
            received_at=now,
        )

    agent_row = await db.fetch_one(
        "SELECT agent_id, site_id, token_hash FROM netatlas.agents WHERE agent_id = %s",
        (payload.agent_id,),
    )
    if (
        agent_row is None
        or agent_row["site_id"] != payload.site_id
        or not hmac.compare_digest(agent_row["token_hash"], presented_hash)
    ):
        raise HTTPException(status_code=401, detail="Invalid agent credentials.")

    await db.execute(
        """
        INSERT INTO netatlas.ingested_snapshots (site_id, agent_id, payload, received_at)
        VALUES (%s, %s, %s::jsonb, NOW())
        ON CONFLICT (site_id)
        DO UPDATE SET
            agent_id = EXCLUDED.agent_id,
            payload = EXCLUDED.payload,
            received_at = NOW()
        """,
        (payload.site_id, payload.agent_id, json.dumps(serialized)),
    )
    await db.execute(
        """
        UPDATE netatlas.agents
        SET status = 'online',
            last_seen = NOW(),
            hostname = %s,
            version = %s,
            device_count = %s,
            link_count = %s
        WHERE agent_id = %s
        """,
        (
            payload.hostname,
            payload.version,
            len(payload.devices),
            len(payload.raw_links),
            payload.agent_id,
        ),
    )

    return IngestResponse(
        status="accepted",
        site_id=payload.site_id,
        agent_id=payload.agent_id,
        devices_ingested=len(payload.devices),
        links_ingested=len(payload.raw_links),
        received_at=now,
    )


async def get_site_snapshot(site_id: str) -> dict[str, Any] | None:
    """Return latest ingested snapshot dict for a remote site, or None."""
    if settings.mock_mode:
        with _STATE_LOCK:
            if site_id not in _MOCK_SITES:
                raise HTTPException(status_code=404, detail=f"Site '{site_id}' not found.")
            entry = _MOCK_SNAPSHOTS.get(site_id)
            return entry["payload"] if entry else None

    site_row = await db.fetch_one(
        "SELECT site_id FROM netatlas.sites WHERE site_id = %s",
        (site_id,),
    )
    if site_row is None:
        raise HTTPException(status_code=404, detail=f"Site '{site_id}' not found.")

    snap_row = await db.fetch_one(
        "SELECT payload FROM netatlas.ingested_snapshots WHERE site_id = %s",
        (site_id,),
    )
    if snap_row is None:
        return None
    payload = snap_row["payload"]
    return json.loads(payload) if isinstance(payload, str) else dict(payload)


async def get_node_overrides(site_id: str = "local") -> dict[str, dict[str, Any]]:
    """Return saved node role/root/position overrides indexed by IP."""
    if settings.mock_mode:
        with _STATE_LOCK:
            return {
                ip: dict(val)
                for (sid, ip), val in _MOCK_OVERRIDES.items()
                if sid == site_id
            }

    rows = await db.fetch_all(
        """
        SELECT ip, role_override, is_root, pos_x, pos_y
        FROM netatlas.node_overrides
        WHERE site_id = %s
        """,
        (site_id,),
    )
    return {row["ip"]: dict(row) for row in rows}


async def upsert_node_override(
    site_id: str,
    ip: str,
    req: NodeOverrideRequest,
) -> dict[str, Any]:
    """Persist role override, pinned root flag, or position for a device node."""
    try:
        normalized_ip = str(ipaddress.ip_address(ip.strip()))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid IP address: {ip}") from exc

    if settings.mock_mode:
        with _STATE_LOCK:
            if req.is_root is True:
                for (sid, other_ip), data in _MOCK_OVERRIDES.items():
                    if sid == site_id and other_ip != normalized_ip:
                        data["is_root"] = False

            entry = _MOCK_OVERRIDES.setdefault(
                (site_id, normalized_ip),
                {
                    "ip": normalized_ip,
                    "role_override": None,
                    "is_root": False,
                    "pos_x": None,
                    "pos_y": None,
                },
            )
            if req.clear_role_override:
                entry["role_override"] = None
            elif req.role_override is not None:
                entry["role_override"] = req.role_override
            if req.is_root is not None:
                entry["is_root"] = req.is_root
            if req.pos_x is not None:
                entry["pos_x"] = req.pos_x
            if req.pos_y is not None:
                entry["pos_y"] = req.pos_y
            return dict(entry)

    if req.is_root is True:
        await db.execute(
            "UPDATE netatlas.node_overrides SET is_root = FALSE WHERE site_id = %s AND ip <> %s",
            (site_id, normalized_ip),
        )

    existing = await db.fetch_one(
        """
        SELECT role_override, is_root, pos_x, pos_y
        FROM netatlas.node_overrides
        WHERE site_id = %s AND ip = %s
        """,
        (site_id, normalized_ip),
    )

    role_val = (
        None
        if req.clear_role_override
        else (
            req.role_override
            if req.role_override is not None
            else (existing.get("role_override") if existing else None)
        )
    )
    root_val = (
        req.is_root
        if req.is_root is not None
        else bool(existing.get("is_root") if existing else False)
    )
    px_val = req.pos_x if req.pos_x is not None else (existing.get("pos_x") if existing else None)
    py_val = req.pos_y if req.pos_y is not None else (existing.get("pos_y") if existing else None)

    row = await db.execute_returning(
        """
        INSERT INTO netatlas.node_overrides (site_id, ip, role_override, is_root, pos_x, pos_y, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (site_id, ip)
        DO UPDATE SET
            role_override = EXCLUDED.role_override,
            is_root = EXCLUDED.is_root,
            pos_x = EXCLUDED.pos_x,
            pos_y = EXCLUDED.pos_y,
            updated_at = NOW()
        RETURNING ip, role_override, is_root, pos_x, pos_y
        """,
        (site_id, normalized_ip, role_val, root_val, px_val, py_val),
    )
    assert row is not None
    return dict(row)


async def save_batch_layout(
    site_id: str, positions: list[NodePositionItem]
) -> int:
    """Save canvas coordinates for multiple nodes in a site."""
    if settings.mock_mode:
        with _STATE_LOCK:
            for item in positions:
                entry = _MOCK_OVERRIDES.setdefault(
                    (site_id, item.ip),
                    {
                        "ip": item.ip,
                        "role_override": None,
                        "is_root": False,
                        "pos_x": None,
                        "pos_y": None,
                    },
                )
                entry["pos_x"] = item.pos_x
                entry["pos_y"] = item.pos_y
        return len(positions)

    for item in positions:
        await db.execute(
            """
            INSERT INTO netatlas.node_overrides (site_id, ip, pos_x, pos_y, updated_at)
            VALUES (%s, %s, %s, %s, NOW())
            ON CONFLICT (site_id, ip)
            DO UPDATE SET
                pos_x = EXCLUDED.pos_x,
                pos_y = EXCLUDED.pos_y,
                updated_at = NOW()
            """,
            (site_id, item.ip, item.pos_x, item.pos_y),
        )
    return len(positions)


async def reset_site_layout(site_id: str = "local") -> None:
    """Clear saved manual node coordinates so Dagre auto-layout takes over."""
    if settings.mock_mode:
        with _STATE_LOCK:
            for (sid, _ip), data in _MOCK_OVERRIDES.items():
                if sid == site_id:
                    data["pos_x"] = None
                    data["pos_y"] = None
        return

    await db.execute(
        "UPDATE netatlas.node_overrides SET pos_x = NULL, pos_y = NULL, updated_at = NOW() WHERE site_id = %s",
        (site_id,),
    )
