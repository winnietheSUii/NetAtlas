from collections import defaultdict
import ipaddress
from typing import Any

from fastapi import HTTPException

from app.core.config import settings
from app.core.database import db
from app.models.schemas import (
    ConnectedEndpoint,
    DeviceListResponse,
    DevicePortDetail,
    DevicePortsResponse,
    DeviceSummary,
    EndpointListResponse,
    EndpointRecord,
    PortVlanInfo,
    VlanListResponse,
    VlanSummary,
    VlanSwitchMember,
)
from app.services.topology import classify_device_role, parse_speed_mbps


def _pick_hostname(dns: str | None, name: str | None, ip: str) -> str:
    candidate = (name or dns or ip).strip()
    if "." in candidate and not candidate.replace(".", "").isdigit():
        return candidate.split(".")[0]
    return candidate


def _row_to_device_summary(row: dict[str, Any]) -> DeviceSummary:
    ip = row["ip"]
    hostname = _pick_hostname(row.get("dns"), row.get("name"), ip)
    uplinks = int(row.get("uplink_count") or 0)
    role, tier = classify_device_role(
        hostname=hostname,
        vendor=row.get("vendor"),
        model=row.get("model"),
        layers=row.get("layers"),
        uplink_count=uplinks,
        managed=True,
    )
    raw_uptime = row.get("uptime")
    uptime_seconds = int(raw_uptime) // 100 if raw_uptime is not None else None
    return DeviceSummary(
        ip=ip,
        hostname=hostname,
        name=row.get("name"),
        dns=row.get("dns"),
        vendor=row.get("vendor"),
        model=row.get("model"),
        os=row.get("os"),
        os_ver=row.get("os_ver"),
        serial=row.get("serial"),
        location=row.get("location"),
        contact=row.get("contact"),
        layers=row.get("layers"),
        role=role,
        tier=tier,
        port_count=int(row.get("port_count") or 0),
        active_port_count=int(row.get("active_port_count") or 0),
        uplink_count=uplinks,
        endpoint_count=int(row.get("endpoint_count") or 0),
        uptime_seconds=uptime_seconds,
        last_discover=row.get("last_discover"),
        last_macsuck=row.get("last_macsuck"),
        last_arpnip=row.get("last_arpnip"),
    )


async def list_devices(
    search: str | None = None,
    vendor: str | None = None,
    role: str | None = None,
    site_id: str = "local",
) -> DeviceListResponse:
    """List discovered devices with optional search, vendor, and role filtering."""
    mode_str = "mock" if settings.mock_mode else "live"

    if site_id != "local":
        from app.services.control_plane import get_site_snapshot

        snapshot = await get_site_snapshot(site_id)
        if snapshot is None:
            return DeviceListResponse(devices=[], total=0, mode=mode_str)
        devices = [DeviceSummary(**item) for item in snapshot.get("devices", [])]
        if search:
            term = search.strip().lower()
            devices = [
                d
                for d in devices
                if any(
                    term in (f or "").lower()
                    for f in (d.hostname, d.name, d.dns, d.ip, d.vendor, d.model, d.serial, d.location)
                )
            ]
        if vendor:
            v_norm = vendor.strip().lower()
            devices = [d for d in devices if (d.vendor or "").lower() == v_norm]
        if role:
            r_norm = role.strip().lower()
            devices = [d for d in devices if d.role.lower() == r_norm]
        return DeviceListResponse(devices=devices, total=len(devices), mode=mode_str)

    if settings.mock_mode:
        from app.services.mock_data import list_mock_devices

        return list_mock_devices(search=search, vendor=vendor, role=role)

    conditions: list[str] = []
    params: list[Any] = []

    if search and search.strip():
        like = f"%{search.strip()}%"
        conditions.append(
            "("
            "COALESCE(d.name, '') ILIKE %s OR "
            "COALESCE(d.dns, '') ILIKE %s OR "
            "host(d.ip) ILIKE %s OR "
            "COALESCE(d.vendor, '') ILIKE %s OR "
            "COALESCE(d.model, '') ILIKE %s OR "
            "COALESCE(d.serial, '') ILIKE %s OR "
            "COALESCE(d.location, '') ILIKE %s"
            ")"
        )
        params.extend([like] * 7)

    if vendor and vendor.strip():
        conditions.append("LOWER(COALESCE(d.vendor, '')) = LOWER(%s)")
        params.append(vendor.strip())

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    rows = await db.fetch_all(
        f"""
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
            SELECT
                switch AS ip,
                COUNT(*) AS endpoint_count
            FROM node
            WHERE active IS TRUE
            GROUP BY switch
        ) n ON n.ip = d.ip
        {where_sql}
        ORDER BY d.name NULLS LAST, d.ip
        """,
        params,
    )

    devices = [_row_to_device_summary(row) for row in rows]
    if role and role.strip():
        role_norm = role.strip().lower()
        devices = [d for d in devices if d.role.lower() == role_norm]

    return DeviceListResponse(devices=devices, total=len(devices), mode="live")


async def get_device_ports(ip: str, site_id: str = "local") -> DevicePortsResponse:
    """Return full port inventory, VLAN tags, neighbor links, and connected endpoints for a device."""
    try:
        normalized_ip = str(ipaddress.ip_address(ip.strip()))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid IP address: {ip}") from exc

    if site_id != "local":
        from app.services.control_plane import get_site_snapshot

        mode_str = "mock" if settings.mock_mode else "live"
        snapshot = await get_site_snapshot(site_id)
        if snapshot is None:
            raise HTTPException(status_code=404, detail=f"No snapshot ingested for site '{site_id}'.")
        devices_by_ip = {d["ip"]: DeviceSummary(**d) for d in snapshot.get("devices", [])}
        device = devices_by_ip.get(normalized_ip)
        if device is None:
            raise HTTPException(status_code=404, detail=f"Device {normalized_ip} not found in site '{site_id}'.")
        raw_ports = snapshot.get("ports_by_ip", {}).get(normalized_ip, [])
        ports = [DevicePortDetail(**p) for p in raw_ports]
        return DevicePortsResponse(
            device=device,
            ports=ports,
            total_ports=len(ports),
            active_ports=sum(1 for p in ports if p.up == "up"),
            total_endpoints=sum(len(p.endpoints) for p in ports),
            mode=mode_str,
        )

    if settings.mock_mode:
        from app.services.mock_data import get_mock_device_ports

        result = get_mock_device_ports(normalized_ip)
        if result is None:
            raise HTTPException(status_code=404, detail=f"Device {normalized_ip} not found.")
        return result

    device_row = await db.fetch_one(
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
            SELECT
                switch AS ip,
                COUNT(*) AS endpoint_count
            FROM node
            WHERE active IS TRUE
            GROUP BY switch
        ) n ON n.ip = d.ip
        WHERE d.ip = %s::inet
        """,
        (normalized_ip,),
    )
    if device_row is None:
        raise HTTPException(status_code=404, detail=f"Device {normalized_ip} not found.")

    port_rows = await db.fetch_all(
        """
        SELECT
            dp.port,
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
        WHERE dp.ip = %s::inet
        ORDER BY COALESCE(dp.is_uplink, FALSE) DESC, dp.port ASC
        """,
        (normalized_ip,),
    )

    vlan_rows = await db.fetch_all(
        """
        SELECT port, vlan, COALESCE(native, FALSE) AS native, vlantype
        FROM device_port_vlan
        WHERE ip = %s::inet
        ORDER BY port ASC, native DESC, vlan ASC
        """,
        (normalized_ip,),
    )

    endpoint_rows = await db.fetch_all(
        """
        SELECT
            n.port,
            n.mac::text AS mac,
            host(ni.ip) AS ip,
            n.oui,
            n.vlan,
            COALESCE(n.active, TRUE) AS active,
            n.time_last
        FROM node n
        LEFT JOIN node_ip ni ON n.mac = ni.mac AND ni.active IS TRUE
        WHERE n.switch = %s::inet AND n.active IS TRUE
        ORDER BY n.port ASC, n.time_last DESC NULLS LAST
        """,
        (normalized_ip,),
    )

    vlans_by_port: dict[str, list[PortVlanInfo]] = defaultdict(list)
    for row in vlan_rows:
        vlans_by_port[row["port"]].append(
            PortVlanInfo(
                vlan=int(row["vlan"]),
                native=bool(row.get("native")),
                vlantype=row.get("vlantype"),
            )
        )

    endpoints_by_port: dict[str, list[ConnectedEndpoint]] = defaultdict(list)
    for row in endpoint_rows:
        endpoints_by_port[row["port"]].append(
            ConnectedEndpoint(
                mac=row["mac"],
                ip=row.get("ip"),
                oui=row.get("oui"),
                vlan=row.get("vlan"),
                active=bool(row.get("active", True)),
                time_last=row.get("time_last"),
            )
        )

    ports: list[DevicePortDetail] = []
    for row in port_rows:
        port_id = row["port"]
        speed_disp, speed_mbps = parse_speed_mbps(row.get("speed"))
        port_vlans = vlans_by_port.get(port_id, [])
        if not port_vlans and row.get("pvid") is not None:
            port_vlans = [PortVlanInfo(vlan=int(row["pvid"]), native=True)]
        ports.append(
            DevicePortDetail(
                port=port_id,
                name=row.get("name"),
                descr=row.get("descr"),
                up=row.get("up"),
                up_admin=row.get("up_admin"),
                speed=speed_disp or row.get("speed"),
                speed_mbps=speed_mbps,
                duplex=row.get("duplex"),
                pvid=row.get("pvid"),
                vlans=port_vlans,
                is_uplink=bool(row.get("is_uplink") or row.get("remote_ip")),
                remote_ip=row.get("remote_ip"),
                remote_port=row.get("remote_port"),
                remote_id=row.get("remote_id"),
                remote_type=row.get("remote_type"),
                endpoints=endpoints_by_port.get(port_id, []),
            )
        )

    device = _row_to_device_summary(device_row)
    return DevicePortsResponse(
        device=device,
        ports=ports,
        total_ports=len(ports),
        active_ports=sum(1 for p in ports if p.up == "up"),
        total_endpoints=sum(len(p.endpoints) for p in ports),
        mode="live",
    )


async def list_endpoints(
    search: str | None = None,
    vlan: str | None = None,
    switch_ip: str | None = None,
    site_id: str = "local",
) -> EndpointListResponse:
    """List active MAC/IP endpoint bindings across switches in a site."""
    mode_str = "mock" if settings.mock_mode else "live"

    if site_id != "local":
        from app.services.control_plane import get_site_snapshot

        snapshot = await get_site_snapshot(site_id)
        if snapshot is None:
            return EndpointListResponse(endpoints=[], total=0, site_id=site_id, mode=mode_str)
        records = [EndpointRecord(**item) for item in snapshot.get("endpoints", [])]
        if switch_ip and switch_ip.strip():
            records = [r for r in records if r.switch_ip == switch_ip.strip()]
        if vlan and vlan.strip():
            records = [r for r in records if str(r.vlan or "") == vlan.strip()]
        if search and search.strip():
            q = search.strip().lower()
            records = [
                r
                for r in records
                if q
                in " ".join(
                    p or "" for p in (r.mac, r.ip, r.oui, r.vlan, r.switch_ip, r.switch_hostname, r.port)
                ).lower()
            ]
        return EndpointListResponse(endpoints=records, total=len(records), site_id=site_id, mode=mode_str)

    if settings.mock_mode:
        from app.services.mock_data import list_mock_endpoints

        return list_mock_endpoints(search=search, vlan=vlan, switch_ip=switch_ip, site_id=site_id)

    conditions = ["n.active IS TRUE"]
    params: list[Any] = []

    if switch_ip and switch_ip.strip():
        try:
            norm_sw = str(ipaddress.ip_address(switch_ip.strip()))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid switch_ip: {switch_ip}") from exc
        conditions.append("n.switch = %s::inet")
        params.append(norm_sw)

    if vlan and vlan.strip():
        conditions.append("COALESCE(n.vlan, '') = %s")
        params.append(vlan.strip())

    if search and search.strip():
        like = f"%{search.strip()}%"
        conditions.append(
            "("
            "n.mac::text ILIKE %s OR "
            "COALESCE(host(ni.ip), '') ILIKE %s OR "
            "COALESCE(n.oui, '') ILIKE %s OR "
            "COALESCE(n.vlan, '') ILIKE %s OR "
            "host(n.switch) ILIKE %s OR "
            "COALESCE(d.name, '') ILIKE %s OR "
            "COALESCE(d.dns, '') ILIKE %s OR "
            "n.port ILIKE %s"
            ")"
        )
        params.extend([like] * 8)

    where_sql = f"WHERE {' AND '.join(conditions)}"

    rows = await db.fetch_all(
        f"""
        SELECT
            n.mac::text AS mac,
            host(ni.ip) AS ip,
            n.oui,
            n.vlan,
            host(n.switch) AS switch_ip,
            d.name AS switch_name,
            d.dns AS switch_dns,
            n.port,
            COALESCE(n.active, TRUE) AS active,
            n.time_last
        FROM node n
        LEFT JOIN node_ip ni ON n.mac = ni.mac AND ni.active IS TRUE
        LEFT JOIN device d ON d.ip = n.switch
        {where_sql}
        ORDER BY n.time_last DESC NULLS LAST, n.switch, n.port
        LIMIT 1000
        """,
        params,
    )

    records = [
        EndpointRecord(
            mac=row["mac"],
            ip=row.get("ip"),
            oui=row.get("oui"),
            vlan=row.get("vlan"),
            switch_ip=row["switch_ip"],
            switch_hostname=_pick_hostname(
                row.get("switch_dns"), row.get("switch_name"), row["switch_ip"]
            ),
            port=row["port"],
            active=bool(row.get("active", True)),
            time_last=row.get("time_last"),
        )
        for row in rows
    ]
    return EndpointListResponse(
        endpoints=records, total=len(records), site_id=site_id, mode="live"
    )


async def list_vlans(site_id: str = "local") -> VlanListResponse:
    """Aggregate VLAN memberships across switches in a site."""
    mode_str = "mock" if settings.mock_mode else "live"

    if site_id != "local":
        from app.services.control_plane import get_site_snapshot

        snapshot = await get_site_snapshot(site_id)
        if snapshot is None:
            return VlanListResponse(vlans=[], total=0, site_id=site_id, mode=mode_str)
        vlans = [VlanSummary(**item) for item in snapshot.get("vlans", [])]
        return VlanListResponse(vlans=vlans, total=len(vlans), site_id=site_id, mode=mode_str)

    if settings.mock_mode:
        from app.services.mock_data import list_mock_vlans

        return list_mock_vlans(site_id=site_id)

    rows = await db.fetch_all(
        """
        SELECT
            v.vlan,
            host(v.ip) AS ip,
            d.name,
            d.dns,
            COUNT(*) AS port_count,
            COUNT(*) FILTER (WHERE v.native IS TRUE) AS native_port_count
        FROM device_port_vlan v
        JOIN device d ON d.ip = v.ip
        GROUP BY v.vlan, v.ip, d.name, d.dns
        ORDER BY v.vlan ASC, d.name NULLS LAST, v.ip ASC
        """
    )

    grouped: dict[int, list[VlanSwitchMember]] = defaultdict(list)
    for row in rows:
        vid = int(row["vlan"])
        sw_ip = row["ip"]
        grouped[vid].append(
            VlanSwitchMember(
                ip=sw_ip,
                hostname=_pick_hostname(row.get("dns"), row.get("name"), sw_ip),
                port_count=int(row["port_count"] or 0),
                native_port_count=int(row["native_port_count"] or 0),
            )
        )

    vlans = [
        VlanSummary(
            vlan=vid,
            switch_count=len(members),
            port_count=sum(m.port_count for m in members),
            native_port_count=sum(m.native_port_count for m in members),
            switches=members,
        )
        for vid, members in sorted(grouped.items())
    ]
    return VlanListResponse(vlans=vlans, total=len(vlans), site_id=site_id, mode="live")
