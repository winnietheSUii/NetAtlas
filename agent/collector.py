"""NetAtlas Remote Site Collector Agent.

Reads discovered L2/L3 state from a site's local Netdisco PostgreSQL database
and pushes normalized snapshots over outbound HTTPS to the Central NetAtlas Server.
"""

import argparse
from collections import defaultdict
from datetime import datetime
import logging
import os
import socket
import time
from typing import Any

import httpx
import psycopg
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] netatlas-agent: %(message)s",
)
logger = logging.getLogger("netatlas-agent")

AGENT_VERSION = "0.1.0"


def _iso(val: Any) -> str | None:
    if isinstance(val, datetime):
        return val.isoformat()
    return str(val) if val is not None else None


def _pick_hostname(dns: str | None, name: str | None, ip: str) -> str:
    candidate = (name or dns or ip).strip()
    if "." in candidate and not candidate.replace(".", "").isdigit():
        return candidate.split(".")[0]
    return candidate


def _classify_role(
    hostname: str,
    vendor: str | None,
    model: str | None,
    layers: str | None,
    uplink_count: int,
) -> tuple[str, int]:
    text = " ".join(part for part in (hostname, vendor or "", model or "") if part).lower()
    if any(t in text for t in ("firewall", "palo alto", "pa-", "forti", "asa", "firepower", "srx", "fw-")):
        return "firewall", 0
    if any(t in text for t in ("ap-", "wap", "wireless", "c91", "air-", "c9800", "unifi")):
        return "wireless", 4
    if any(t in text for t in ("core", "c96", "n9k", "nexus 9", "spine")):
        return "core", 1
    if any(t in text for t in ("dist", "agg", "c95", "7280", "leaf")):
        return "distribution", 2
    if any(t in text for t in ("acc", "c93", "c92", "c2960", "ex43", "6300", "2930", "7050")):
        return "access", 3
    if any(t in text for t in ("rtr", "router", "isr", "asr", "mx", "crs", "gw-")):
        return "router", 0
    if layers and len(layers) == 8 and set(layers) <= {"0", "1"}:
        has_l3 = layers[5] == "1"
        has_l2 = layers[6] == "1"
        if has_l3 and not has_l2:
            return "router", 0
        if has_l3 and has_l2:
            return ("distribution", 2) if uplink_count >= 2 else ("access", 3)
    return "access", 3


def collect_snapshot(conninfo: str, site_id: str, agent_id: str) -> dict[str, Any]:
    """Query local Netdisco PostgreSQL and assemble a Central ingest payload."""
    with psycopg.connect(conninfo, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    host(d.ip) AS ip,
                    d.name,
                    d.dns,
                    d.vendor,
                    d.model,
                    d.os,
                    d.os_ver,
                    d.serial,
                    d.location,
                    d.contact,
                    d.layers,
                    d.uptime,
                    d.last_discover,
                    d.last_macsuck,
                    d.last_arpnip,
                    COALESCE(p.port_count, 0) AS port_count,
                    COALESCE(p.active_port_count, 0) AS active_port_count,
                    COALESCE(p.uplink_count, 0) AS uplink_count,
                    COALESCE(n.endpoint_count, 0) AS endpoint_count
                FROM device d
                LEFT JOIN (
                    SELECT
                        ip,
                        COUNT(*) AS port_count,
                        COUNT(*) FILTER (WHERE up = 'up') AS active_port_count,
                        COUNT(*) FILTER (WHERE is_uplink IS TRUE OR remote_ip IS NOT NULL) AS uplink_count
                    FROM device_port
                    GROUP BY ip
                ) p ON p.ip = d.ip
                LEFT JOIN (
                    SELECT switch AS ip, COUNT(*) AS endpoint_count
                    FROM node
                    WHERE active IS TRUE
                    GROUP BY switch
                ) n ON n.ip = d.ip
                ORDER BY d.name NULLS LAST, d.ip
                """
            )
            device_rows = cur.fetchall()

            cur.execute(
                """
                SELECT
                    host(dp.ip) AS local_ip,
                    dp.port AS local_port,
                    dp.name,
                    dp.descr,
                    dp.up,
                    dp.up_admin,
                    dp.speed,
                    dp.duplex,
                    dp.pvid,
                    COALESCE(dp.is_uplink, FALSE) AS is_uplink,
                    COALESCE(host(dip.ip), host(dp.remote_ip)) AS remote_ip,
                    dp.remote_port,
                    dp.remote_id,
                    dp.remote_type
                FROM device_port dp
                LEFT JOIN device_ip dip ON dp.remote_ip = dip.alias
                ORDER BY dp.ip, dp.port
                """
            )
            port_rows = cur.fetchall()

            cur.execute(
                """
                SELECT host(ip) AS ip, port, vlan, COALESCE(native, FALSE) AS native, vlantype
                FROM device_port_vlan
                ORDER BY ip, port, vlan
                """
            )
            vlan_rows = cur.fetchall()

            cur.execute(
                """
                SELECT
                    host(n.switch) AS switch_ip,
                    n.port,
                    n.mac::text AS mac,
                    host(ni.ip) AS ip,
                    n.oui,
                    n.vlan,
                    COALESCE(n.active, TRUE) AS active,
                    n.time_last
                FROM node n
                LEFT JOIN node_ip ni ON n.mac = ni.mac AND ni.active IS TRUE
                WHERE n.active IS TRUE
                ORDER BY n.time_last DESC NULLS LAST
                LIMIT 2000
                """
            )
            endpoint_rows = cur.fetchall()

    devices: list[dict[str, Any]] = []
    host_by_ip: dict[str, str] = {}
    for row in device_rows:
        ip = row["ip"]
        hostname = _pick_hostname(row.get("dns"), row.get("name"), ip)
        host_by_ip[ip] = hostname
        uplinks = int(row.get("uplink_count") or 0)
        role, tier = _classify_role(
            hostname, row.get("vendor"), row.get("model"), row.get("layers"), uplinks
        )
        raw_uptime = row.get("uptime")
        devices.append(
            {
                "ip": ip,
                "hostname": hostname,
                "name": row.get("name"),
                "dns": row.get("dns"),
                "vendor": row.get("vendor"),
                "model": row.get("model"),
                "os": row.get("os"),
                "os_ver": row.get("os_ver"),
                "serial": row.get("serial"),
                "location": row.get("location"),
                "contact": row.get("contact"),
                "layers": row.get("layers"),
                "role": role,
                "tier": tier,
                "port_count": int(row.get("port_count") or 0),
                "active_port_count": int(row.get("active_port_count") or 0),
                "uplink_count": uplinks,
                "endpoint_count": int(row.get("endpoint_count") or 0),
                "uptime_seconds": int(raw_uptime) // 100 if raw_uptime is not None else None,
                "last_discover": _iso(row.get("last_discover")),
                "last_macsuck": _iso(row.get("last_macsuck")),
                "last_arpnip": _iso(row.get("last_arpnip")),
            }
        )

    vlans_by_port: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    vlan_agg: dict[int, dict[str, dict[str, int]]] = defaultdict(dict)
    for vrow in vlan_rows:
        vip = vrow["ip"]
        vid = int(vrow["vlan"])
        vlans_by_port[(vip, vrow["port"])].append(
            {
                "vlan": vid,
                "native": bool(vrow.get("native")),
                "vlantype": vrow.get("vlantype"),
            }
        )
        sw_map = vlan_agg[vid].setdefault(vip, {"port_count": 0, "native_port_count": 0})
        sw_map["port_count"] += 1
        if vrow.get("native"):
            sw_map["native_port_count"] += 1

    endpoints_by_port: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    endpoints: list[dict[str, Any]] = []
    for erow in endpoint_rows:
        sw_ip = erow["switch_ip"]
        port = erow["port"]
        ep_item = {
            "mac": erow["mac"],
            "ip": erow.get("ip"),
            "oui": erow.get("oui"),
            "vlan": erow.get("vlan"),
            "active": bool(erow.get("active", True)),
            "time_last": _iso(erow.get("time_last")),
        }
        endpoints_by_port[(sw_ip, port)].append(ep_item)
        endpoints.append(
            {
                **ep_item,
                "switch_ip": sw_ip,
                "switch_hostname": host_by_ip.get(sw_ip, sw_ip),
                "port": port,
            }
        )

    ports_by_ip: dict[str, list[dict[str, Any]]] = defaultdict(list)
    raw_links: list[dict[str, Any]] = []
    for prow in port_rows:
        lip = prow["local_ip"]
        lport = prow["local_port"]
        remote_ip = prow.get("remote_ip")
        p_vlans = vlans_by_port.get((lip, lport), [])
        if not p_vlans and prow.get("pvid") is not None:
            p_vlans = [{"vlan": int(prow["pvid"]), "native": True, "vlantype": None}]

        ports_by_ip[lip].append(
            {
                "port": lport,
                "name": prow.get("name"),
                "descr": prow.get("descr"),
                "up": prow.get("up"),
                "up_admin": prow.get("up_admin"),
                "speed": prow.get("speed"),
                "speed_mbps": None,
                "duplex": prow.get("duplex"),
                "pvid": prow.get("pvid"),
                "vlans": p_vlans,
                "is_uplink": bool(prow.get("is_uplink") or remote_ip),
                "remote_ip": remote_ip,
                "remote_port": prow.get("remote_port"),
                "remote_id": prow.get("remote_id"),
                "remote_type": prow.get("remote_type"),
                "endpoints": endpoints_by_port.get((lip, lport), []),
            }
        )
        if remote_ip:
            raw_links.append(
                {
                    "local_ip": lip,
                    "local_port": lport,
                    "remote_ip": remote_ip,
                    "remote_port": prow.get("remote_port"),
                    "remote_type": prow.get("remote_type"),
                    "speed": prow.get("speed"),
                    "up": prow.get("up"),
                    "is_uplink": bool(prow.get("is_uplink")),
                }
            )

    vlans: list[dict[str, Any]] = []
    for vid in sorted(vlan_agg):
        switches = [
            {
                "ip": sw_ip,
                "hostname": host_by_ip.get(sw_ip, sw_ip),
                "port_count": counts["port_count"],
                "native_port_count": counts["native_port_count"],
            }
            for sw_ip, counts in sorted(vlan_agg[vid].items())
        ]
        vlans.append(
            {
                "vlan": vid,
                "switch_count": len(switches),
                "port_count": sum(s["port_count"] for s in switches),
                "native_port_count": sum(s["native_port_count"] for s in switches),
                "switches": switches,
            }
        )

    return {
        "site_id": site_id,
        "agent_id": agent_id,
        "hostname": socket.gethostname(),
        "version": AGENT_VERSION,
        "devices": devices,
        "ports_by_ip": dict(ports_by_ip),
        "raw_links": raw_links,
        "endpoints": endpoints,
        "vlans": vlans,
    }


def push_once(conninfo: str, central_url: str, site_id: str, agent_id: str, token: str) -> None:
    """Collect a snapshot from local Netdisco DB and upload it to Central NetAtlas."""
    payload = collect_snapshot(conninfo, site_id=site_id, agent_id=agent_id)
    ingest_endpoint = f"{central_url.rstrip('/')}/api/v1/ingest"
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            ingest_endpoint,
            json=payload,
            headers={"X-Agent-Token": token},
        )
        resp.raise_for_status()
        body = resp.json()
        logger.info(
            "Synced site=%s devices=%s links=%s",
            site_id,
            body.get("devices_ingested"),
            body.get("links_ingested"),
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="NetAtlas Site Collector Agent")
    parser.add_argument("--once", action="store_true", help="Run a single sync cycle and exit")
    args = parser.parse_args()

    central_url = os.environ["CENTRAL_URL"]
    site_id = os.environ["SITE_ID"]
    agent_id = os.environ["AGENT_ID"]
    agent_token = os.environ["AGENT_TOKEN"]
    poll_seconds = int(os.environ.get("POLL_INTERVAL_SECONDS", "60"))

    conninfo = make_conninfo(
        host=os.environ.get("NETDISCO_DB_HOST", "netdisco-postgresql"),
        port=int(os.environ.get("NETDISCO_DB_PORT", "5432")),
        dbname=os.environ.get("NETDISCO_DB_NAME", "netdisco"),
        user=os.environ.get("NETDISCO_DB_USER", "netdisco"),
        password=os.environ.get("NETDISCO_DB_PASS", "netatlas_dev_password"),
        connect_timeout=5,
    )

    if args.once:
        push_once(conninfo, central_url, site_id, agent_id, agent_token)
        return

    logger.info("Starting collector loop for site=%s -> %s (every %ss)", site_id, central_url, poll_seconds)
    while True:
        try:
            push_once(conninfo, central_url, site_id, agent_id, agent_token)
        except Exception as exc:
            logger.warning("Sync cycle failed (will retry): %s", exc)
        time.sleep(poll_seconds)


if __name__ == "__main__":
    main()
