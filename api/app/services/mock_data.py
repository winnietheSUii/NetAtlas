from collections import defaultdict
from datetime import datetime, timedelta, timezone
import threading
from typing import Any

from app.models.schemas import (
    ConnectedEndpoint,
    DeviceListResponse,
    DevicePortDetail,
    DevicePortsResponse,
    DeviceSummary,
    EndpointListResponse,
    EndpointRecord,
    PortVlanInfo,
    ScanJob,
    ScanJobsResponse,
    ScanRequest,
    ScanResponse,
    TopologyNode,
    TopologyResponse,
    TopologySummary,
    VlanListResponse,
    VlanSummary,
    VlanSwitchMember,
)
from app.services.topology import classify_device_role, deduplicate_links, parse_speed_mbps

_NOW = datetime.now(timezone.utc)

_MOCK_DEVICES: list[dict[str, Any]] = [
    {
        "ip": "10.0.0.1",
        "hostname": "fw-edge-01",
        "name": "fw-edge-01.corp.netatlas.local",
        "dns": "fw-edge-01.corp.netatlas.local",
        "vendor": "Palo Alto Networks",
        "model": "PA-3260",
        "os": "pan-os",
        "os_ver": "11.1.2-h3",
        "serial": "016801094512",
        "location": "HQ MDF Rack A01",
        "contact": "noc@netatlas.local",
        "layers": "00001100",
        "uptime_seconds": 7843210,
        "last_discover": _NOW - timedelta(minutes=12),
        "last_macsuck": _NOW - timedelta(minutes=15),
        "last_arpnip": _NOW - timedelta(minutes=8),
    },
    {
        "ip": "10.10.0.1",
        "hostname": "core-sw-01",
        "name": "core-sw-01.corp.netatlas.local",
        "dns": "core-sw-01.corp.netatlas.local",
        "vendor": "Cisco",
        "model": "C9606R",
        "os": "ios-xe",
        "os_ver": "17.9.4a",
        "serial": "FXS2419Q0AB",
        "location": "HQ MDF Core Rack A02",
        "contact": "noc@netatlas.local",
        "layers": "00000110",
        "uptime_seconds": 12451000,
        "last_discover": _NOW - timedelta(minutes=10),
        "last_macsuck": _NOW - timedelta(minutes=10),
        "last_arpnip": _NOW - timedelta(minutes=9),
    },
    {
        "ip": "10.10.0.2",
        "hostname": "core-sw-02",
        "name": "core-sw-02.corp.netatlas.local",
        "dns": "core-sw-02.corp.netatlas.local",
        "vendor": "Cisco",
        "model": "C9606R",
        "os": "ios-xe",
        "os_ver": "17.9.4a",
        "serial": "FXS2419Q0AC",
        "location": "HQ MDF Core Rack A03",
        "contact": "noc@netatlas.local",
        "layers": "00000110",
        "uptime_seconds": 12450890,
        "last_discover": _NOW - timedelta(minutes=10),
        "last_macsuck": _NOW - timedelta(minutes=10),
        "last_arpnip": _NOW - timedelta(minutes=9),
    },
    {
        "ip": "10.10.1.1",
        "hostname": "dist-bldgA-01",
        "name": "dist-bldgA-01.corp.netatlas.local",
        "dns": "dist-bldgA-01.corp.netatlas.local",
        "vendor": "Arista",
        "model": "DCS-7280SR-48C6",
        "os": "eos",
        "os_ver": "4.31.2F",
        "serial": "SSJ21440912",
        "location": "Building A IDF-1",
        "contact": "noc@netatlas.local",
        "layers": "00000110",
        "uptime_seconds": 6120440,
        "last_discover": _NOW - timedelta(minutes=11),
        "last_macsuck": _NOW - timedelta(minutes=14),
        "last_arpnip": _NOW - timedelta(minutes=14),
    },
    {
        "ip": "10.10.2.1",
        "hostname": "dist-bldgB-01",
        "name": "dist-bldgB-01.corp.netatlas.local",
        "dns": "dist-bldgB-01.corp.netatlas.local",
        "vendor": "Cisco",
        "model": "C9500-48Y4C",
        "os": "ios-xe",
        "os_ver": "17.9.4a",
        "serial": "FDO2512X18K",
        "location": "Building B IDF-1",
        "contact": "noc@netatlas.local",
        "layers": "00000110",
        "uptime_seconds": 5930120,
        "last_discover": _NOW - timedelta(minutes=11),
        "last_macsuck": _NOW - timedelta(minutes=13),
        "last_arpnip": _NOW - timedelta(minutes=13),
    },
    {
        "ip": "10.10.11.1",
        "hostname": "acc-fl1-01",
        "name": "acc-fl1-01.corp.netatlas.local",
        "dns": "acc-fl1-01.corp.netatlas.local",
        "vendor": "Aruba",
        "model": "CX 6300M",
        "os": "aos-cx",
        "os_ver": "FL.10.13.1010",
        "serial": "SG14KN8045",
        "location": "Building A Floor 1 Closet",
        "contact": "noc@netatlas.local",
        "layers": "00000010",
        "uptime_seconds": 3891200,
        "last_discover": _NOW - timedelta(minutes=12),
        "last_macsuck": _NOW - timedelta(minutes=12),
        "last_arpnip": None,
    },
    {
        "ip": "10.10.12.1",
        "hostname": "acc-fl2-01",
        "name": "acc-fl2-01.corp.netatlas.local",
        "dns": "acc-fl2-01.corp.netatlas.local",
        "vendor": "Juniper",
        "model": "EX4300-48P",
        "os": "junos",
        "os_ver": "23.2R1.14",
        "serial": "PF3719230184",
        "location": "Building A Floor 2 Closet",
        "contact": "noc@netatlas.local",
        "layers": "00000010",
        "uptime_seconds": 4421900,
        "last_discover": _NOW - timedelta(minutes=12),
        "last_macsuck": _NOW - timedelta(minutes=12),
        "last_arpnip": None,
    },
    {
        "ip": "10.10.21.1",
        "hostname": "acc-fl3-01",
        "name": "acc-fl3-01.corp.netatlas.local",
        "dns": "acc-fl3-01.corp.netatlas.local",
        "vendor": "Cisco",
        "model": "C9300-48P",
        "os": "ios-xe",
        "os_ver": "17.9.4a",
        "serial": "FCW2341L092",
        "location": "Building B Floor 3 Closet",
        "contact": "noc@netatlas.local",
        "layers": "00000010",
        "uptime_seconds": 2918300,
        "last_discover": _NOW - timedelta(minutes=13),
        "last_macsuck": _NOW - timedelta(minutes=13),
        "last_arpnip": None,
    },
    {
        "ip": "10.10.22.1",
        "hostname": "acc-dc-01",
        "name": "acc-dc-01.corp.netatlas.local",
        "dns": "acc-dc-01.corp.netatlas.local",
        "vendor": "Arista",
        "model": "DCS-7050SX3-48YC8",
        "os": "eos",
        "os_ver": "4.31.2F",
        "serial": "JPG22110482",
        "location": "HQ Server Room Rack C04",
        "contact": "noc@netatlas.local",
        "layers": "00000010",
        "uptime_seconds": 8210400,
        "last_discover": _NOW - timedelta(minutes=13),
        "last_macsuck": _NOW - timedelta(minutes=11),
        "last_arpnip": None,
    },
    {
        "ip": "10.10.11.50",
        "hostname": "ap-fl1-lobby",
        "name": "ap-fl1-lobby.corp.netatlas.local",
        "dns": "ap-fl1-lobby.corp.netatlas.local",
        "vendor": "Cisco",
        "model": "C9130AXI-B",
        "os": "ios-xe",
        "os_ver": "17.9.4",
        "serial": "KWC24120089",
        "location": "Building A Lobby Ceiling",
        "contact": "noc@netatlas.local",
        "layers": "00000010",
        "uptime_seconds": 1823100,
        "last_discover": _NOW - timedelta(minutes=14),
        "last_macsuck": _NOW - timedelta(minutes=14),
        "last_arpnip": None,
    },
]

_MOCK_BIDIR_LINKS: list[tuple[str, str, str, str, str, str, str]] = [
    ("10.0.0.1", "ethernet1/1", "10.10.0.1", "Te1/0/1", "10 Gbps", "up", "LLDP"),
    ("10.0.0.1", "ethernet1/2", "10.10.0.2", "Te1/0/1", "10 Gbps", "up", "LLDP"),
    ("10.10.0.1", "Hu1/0/1", "10.10.0.2", "Hu1/0/1", "100 Gbps", "up", "CDP"),
    ("10.10.0.1", "Hu1/0/2", "10.10.0.2", "Hu1/0/2", "100 Gbps", "up", "CDP"),
    ("10.10.0.1", "Fo1/0/3", "10.10.1.1", "Ethernet49/1", "40 Gbps", "up", "LLDP"),
    ("10.10.0.2", "Fo1/0/3", "10.10.1.1", "Ethernet50/1", "40 Gbps", "up", "LLDP"),
    ("10.10.0.1", "Fo1/0/4", "10.10.2.1", "Fo1/0/49", "40 Gbps", "up", "CDP"),
    ("10.10.0.2", "Fo1/0/4", "10.10.2.1", "Fo1/0/50", "40 Gbps", "up", "CDP"),
    ("10.10.1.1", "Ethernet1", "10.10.11.1", "1/1/49", "10 Gbps", "up", "LLDP"),
    ("10.10.1.1", "Ethernet2", "10.10.12.1", "xe-0/2/0", "10 Gbps", "up", "LLDP"),
    ("10.10.2.1", "Te1/0/1", "10.10.21.1", "Te1/1/1", "10 Gbps", "up", "CDP"),
    ("10.10.2.1", "Te1/0/2", "10.10.22.1", "Ethernet49", "10 Gbps", "up", "LLDP"),
    ("10.10.11.1", "1/1/24", "10.10.11.50", "Gi0", "2.5 Gbps", "up", "CDP"),
]

_MOCK_ENDPOINTS: dict[tuple[str, str], list[dict[str, Any]]] = {
    ("10.10.11.1", "1/1/1"): [
        {"mac": "3c:22:fb:91:10:a4", "ip": "10.10.11.101", "oui": "Apple, Inc.", "vlan": "10", "minutes_ago": 2},
    ],
    ("10.10.11.1", "1/1/2"): [
        {"mac": "a4:bb:6d:40:22:18", "ip": "10.10.11.102", "oui": "Dell Inc.", "vlan": "10", "minutes_ago": 4},
        {"mac": "00:1e:be:77:93:01", "ip": "10.10.20.15", "oui": "Cisco Systems (IP Phone)", "vlan": "20", "minutes_ago": 1},
    ],
    ("10.10.11.1", "1/1/3"): [
        {"mac": "d8:9e:f3:19:44:c0", "ip": "10.10.11.108", "oui": "HP Inc.", "vlan": "10", "minutes_ago": 6},
    ],
    ("10.10.12.1", "ge-0/0/1"): [
        {"mac": "b8:27:eb:12:88:4a", "ip": "10.10.12.51", "oui": "Raspberry Pi Foundation", "vlan": "10", "minutes_ago": 3},
    ],
    ("10.10.12.1", "ge-0/0/2"): [
        {"mac": "f0:18:98:55:2a:7c", "ip": "10.10.12.64", "oui": "Apple, Inc.", "vlan": "10", "minutes_ago": 5},
    ],
    ("10.10.21.1", "Gi1/0/1"): [
        {"mac": "4c:52:62:a8:11:09", "ip": "10.10.21.40", "oui": "Lenovo", "vlan": "10", "minutes_ago": 1},
    ],
    ("10.10.21.1", "Gi1/0/2"): [
        {"mac": "28:d2:44:6b:91:e2", "ip": "10.10.21.41", "oui": "Dell Inc.", "vlan": "10", "minutes_ago": 7},
    ],
    ("10.10.22.1", "Ethernet1"): [
        {"mac": "00:50:56:8a:10:01", "ip": "10.10.100.11", "oui": "VMware, Inc.", "vlan": "100", "minutes_ago": 1},
        {"mac": "00:50:56:8a:10:02", "ip": "10.10.100.12", "oui": "VMware, Inc.", "vlan": "100", "minutes_ago": 1},
    ],
    ("10.10.22.1", "Ethernet2"): [
        {"mac": "00:50:56:8a:10:03", "ip": "10.10.100.13", "oui": "VMware, Inc.", "vlan": "100", "minutes_ago": 2},
    ],
    ("10.10.11.50", "Gi0"): [
        {"mac": "7c:2e:bd:11:90:f1", "ip": "10.10.30.22", "oui": "Samsung Electronics", "vlan": "30", "minutes_ago": 3},
        {"mac": "90:9c:4a:62:18:bb", "ip": "10.10.30.29", "oui": "Apple, Inc.", "vlan": "30", "minutes_ago": 2},
    ],
}

_ACCESS_PORT_TEMPLATES: dict[str, list[tuple[str, str, str, str, str, int, list[int]]]] = {
    "10.0.0.1": [
        ("ethernet1/3", "WAN-ISP-Primary", "up", "up", "10 Gbps", 99, [99]),
        ("ethernet1/4", "WAN-ISP-Backup", "down", "up", "10 Gbps", 99, [99]),
        ("mgmt", "Out-of-Band Mgmt", "up", "up", "1 Gbps", 99, [99]),
    ],
    "10.10.0.1": [
        ("Te1/0/2", "Spare-Core-Uplink", "down", "down", "10 Gbps", 99, [99]),
        ("Vlan99", "SVI-Management", "up", "up", "10 Gbps", 99, [99]),
    ],
    "10.10.0.2": [
        ("Te1/0/2", "Spare-Core-Uplink", "down", "down", "10 Gbps", 99, [99]),
        ("Vlan99", "SVI-Management", "up", "up", "10 Gbps", 99, [99]),
    ],
    "10.10.1.1": [
        ("Ethernet3", "Unused-IDF-Link", "down", "down", "10 Gbps", 99, [99]),
        ("Management1", "Out-of-Band Mgmt", "up", "up", "1 Gbps", 99, [99]),
    ],
    "10.10.2.1": [
        ("Te1/0/3", "Unused-IDF-Link", "down", "up", "10 Gbps", 99, [99]),
        ("Gi0/0", "Management", "up", "up", "1 Gbps", 99, [99]),
    ],
    "10.10.11.1": [
        ("1/1/1", "Workstation-Drop-A101", "up", "up", "1 Gbps", 10, [10]),
        ("1/1/2", "Desk-Phone-Data-A102", "up", "up", "1 Gbps", 10, [10, 20]),
        ("1/1/3", "ConfRoom-Display-A103", "up", "up", "1 Gbps", 10, [10]),
        ("1/1/4", "Unpatched-Port-A104", "down", "up", "1 Gbps", 10, [10]),
        ("1/1/5", "Disabled-Port-A105", "down", "down", "1 Gbps", 10, [10]),
    ],
    "10.10.12.1": [
        ("ge-0/0/1", "Lab-Sensor-B201", "up", "up", "1 Gbps", 10, [10]),
        ("ge-0/0/2", "Workstation-B202", "up", "up", "1 Gbps", 10, [10]),
        ("ge-0/0/3", "Unpatched-B203", "down", "up", "1 Gbps", 10, [10]),
    ],
    "10.10.21.1": [
        ("Gi1/0/1", "Workstation-C301", "up", "up", "1 Gbps", 10, [10]),
        ("Gi1/0/2", "Workstation-C302", "up", "up", "1 Gbps", 10, [10]),
        ("Gi1/0/3", "Printer-Drop-C303", "down", "down", "1 Gbps", 10, [10]),
    ],
    "10.10.22.1": [
        ("Ethernet1", "ESXi-Host-01-NIC1", "up", "up", "25 Gbps", 100, [100, 99]),
        ("Ethernet2", "ESXi-Host-02-NIC1", "up", "up", "25 Gbps", 100, [100, 99]),
        ("Ethernet3", "Storage-SAN-Spare", "down", "down", "25 Gbps", 100, [100]),
    ],
    "10.10.11.50": [
        ("wlan0", "Corp-WiFi-5GHz", "up", "up", "1 Gbps", 30, [30]),
    ],
}

_JOB_LOCK = threading.Lock()
_MOCK_JOBS: list[dict[str, Any]] = [
    {
        "job_id": 1001,
        "device": "10.10.0.1",
        "action": "discover",
        "subaction": None,
        "status": "done",
        "entered": _NOW - timedelta(minutes=16),
        "started": _NOW - timedelta(minutes=16) + timedelta(seconds=2),
        "finished": _NOW - timedelta(minutes=15),
        "username": "netatlas",
        "log": "Discovered core-sw-01 (Cisco C9606R) and 4 CDP/LLDP neighbors.",
    },
    {
        "job_id": 1002,
        "device": "10.10.0.1",
        "action": "macsuck",
        "subaction": None,
        "status": "done",
        "entered": _NOW - timedelta(minutes=14),
        "started": _NOW - timedelta(minutes=14) + timedelta(seconds=1),
        "finished": _NOW - timedelta(minutes=13),
        "username": "netatlas",
        "log": "Collected MAC/FDB entries across VLANs 10, 20, 30, 99, 100.",
    },
    {
        "job_id": 1003,
        "device": "10.10.0.1",
        "action": "arpnip",
        "subaction": None,
        "status": "done",
        "entered": _NOW - timedelta(minutes=12),
        "started": _NOW - timedelta(minutes=12) + timedelta(seconds=1),
        "finished": _NOW - timedelta(minutes=11),
        "username": "netatlas",
        "log": "Collected 11 active ARP bindings from core-sw-01.",
    },
]
_NEXT_JOB_ID = 1004


def _build_device_ports_map() -> dict[str, list[DevicePortDetail]]:
    dev_by_ip = {d["ip"]: d for d in _MOCK_DEVICES}
    ports_by_ip: dict[str, list[DevicePortDetail]] = defaultdict(list)

    def _add_uplink(
        local_ip: str,
        local_port: str,
        remote_ip: str,
        remote_port: str,
        speed: str,
        up: str,
        protocol: str,
    ) -> None:
        _, speed_mbps = parse_speed_mbps(speed)
        remote_dev = dev_by_ip.get(remote_ip, {})
        endpoints = [
            ConnectedEndpoint(
                mac=ep["mac"],
                ip=ep["ip"],
                oui=ep["oui"],
                vlan=ep["vlan"],
                active=True,
                time_last=_NOW - timedelta(minutes=ep["minutes_ago"]),
            )
            for ep in _MOCK_ENDPOINTS.get((local_ip, local_port), [])
        ]
        ports_by_ip[local_ip].append(
            DevicePortDetail(
                port=local_port,
                name=local_port,
                descr=f"Uplink to {remote_dev.get('hostname', remote_ip)} ({remote_port})",
                up=up,
                up_admin="up",
                speed=speed,
                speed_mbps=speed_mbps,
                duplex="full",
                pvid=99,
                vlans=[
                    PortVlanInfo(vlan=99, native=True, vlantype="ieee8021q"),
                    PortVlanInfo(vlan=10, native=False, vlantype="ieee8021q"),
                    PortVlanInfo(vlan=20, native=False, vlantype="ieee8021q"),
                    PortVlanInfo(vlan=30, native=False, vlantype="ieee8021q"),
                    PortVlanInfo(vlan=100, native=False, vlantype="ieee8021q"),
                ],
                is_uplink=True,
                remote_ip=remote_ip,
                remote_port=remote_port,
                remote_id=remote_dev.get("hostname", remote_ip),
                remote_type=protocol,
                endpoints=endpoints,
            )
        )

    for src_ip, src_port, dst_ip, dst_port, speed, up, proto in _MOCK_BIDIR_LINKS:
        _add_uplink(src_ip, src_port, dst_ip, dst_port, speed, up, proto)
        _add_uplink(dst_ip, dst_port, src_ip, src_port, speed, up, proto)

    for ip, templates in _ACCESS_PORT_TEMPLATES.items():
        for port_name, descr, up, up_admin, speed, pvid, vlan_ids in templates:
            _, speed_mbps = parse_speed_mbps(speed)
            endpoints = [
                ConnectedEndpoint(
                    mac=ep["mac"],
                    ip=ep["ip"],
                    oui=ep["oui"],
                    vlan=ep["vlan"],
                    active=True,
                    time_last=_NOW - timedelta(minutes=ep["minutes_ago"]),
                )
                for ep in _MOCK_ENDPOINTS.get((ip, port_name), [])
            ]
            ports_by_ip[ip].append(
                DevicePortDetail(
                    port=port_name,
                    name=port_name,
                    descr=descr,
                    up=up,
                    up_admin=up_admin,
                    speed=speed,
                    speed_mbps=speed_mbps,
                    duplex="full" if up == "up" else None,
                    pvid=pvid,
                    vlans=[
                        PortVlanInfo(vlan=vid, native=(vid == pvid), vlantype="ieee8021q")
                        for vid in vlan_ids
                    ],
                    is_uplink=False,
                    endpoints=endpoints,
                )
            )

    for ip in ports_by_ip:
        ports_by_ip[ip].sort(key=lambda p: (not p.is_uplink, p.port))
    return ports_by_ip


_PORTS_BY_IP = _build_device_ports_map()


def get_mock_device_summaries() -> list[DeviceSummary]:
    """Return mock device inventory summaries."""
    summaries: list[DeviceSummary] = []
    for dev in _MOCK_DEVICES:
        ip = dev["ip"]
        ports = _PORTS_BY_IP.get(ip, [])
        active_ports = sum(1 for p in ports if p.up == "up")
        uplinks = sum(1 for p in ports if p.is_uplink)
        endpoints = sum(len(p.endpoints) for p in ports)
        role, tier = classify_device_role(
            hostname=dev["hostname"],
            vendor=dev["vendor"],
            model=dev["model"],
            layers=dev["layers"],
            uplink_count=uplinks,
            managed=True,
        )
        summaries.append(
            DeviceSummary(
                ip=ip,
                hostname=dev["hostname"],
                name=dev["name"],
                dns=dev["dns"],
                vendor=dev["vendor"],
                model=dev["model"],
                os=dev["os"],
                os_ver=dev["os_ver"],
                serial=dev["serial"],
                location=dev["location"],
                contact=dev["contact"],
                layers=dev["layers"],
                role=role,
                tier=tier,
                port_count=len(ports),
                active_port_count=active_ports,
                uplink_count=uplinks,
                endpoint_count=endpoints,
                uptime_seconds=dev["uptime_seconds"],
                last_discover=dev["last_discover"],
                last_macsuck=dev["last_macsuck"],
                last_arpnip=dev["last_arpnip"],
            )
        )
    return summaries


def build_mock_topology(include_unmanaged: bool = True) -> TopologyResponse:
    """Build normalized topology response from mock campus data."""
    del include_unmanaged
    summaries = get_mock_device_summaries()
    nodes: list[TopologyNode] = []
    node_tiers: dict[str, int] = {}
    managed_ips: set[str] = set()
    vendor_counts: dict[str, int] = defaultdict(int)
    role_counts: dict[str, int] = defaultdict(int)
    total_endpoints = 0

    for dev in summaries:
        managed_ips.add(dev.ip)
        node_tiers[dev.ip] = dev.tier
        vendor_counts[dev.vendor or "Unknown"] += 1
        role_counts[dev.role] += 1
        total_endpoints += dev.endpoint_count
        nodes.append(
            TopologyNode(
                id=dev.ip,
                ip=dev.ip,
                hostname=dev.hostname,
                vendor=dev.vendor,
                model=dev.model,
                os=dev.os,
                role=dev.role,
                tier=dev.tier,
                location=dev.location,
                managed=True,
                port_count=dev.port_count,
                active_port_count=dev.active_port_count,
                uplink_count=dev.uplink_count,
                endpoint_count=dev.endpoint_count,
                last_discover=dev.last_discover,
            )
        )

    raw_links: list[dict[str, Any]] = []
    for ip, ports in _PORTS_BY_IP.items():
        for p in ports:
            if p.remote_ip:
                raw_links.append(
                    {
                        "local_ip": ip,
                        "local_port": p.port,
                        "remote_ip": p.remote_ip,
                        "remote_port": p.remote_port,
                        "remote_type": p.remote_type,
                        "speed": p.speed,
                        "up": p.up,
                        "is_uplink": p.is_uplink,
                    }
                )

    edges = deduplicate_links(raw_links, node_tiers, managed_ips=managed_ips)

    summary = TopologySummary(
        total_devices=len(nodes),
        managed_devices=len(nodes),
        unmanaged_neighbors=0,
        total_links=len(edges),
        total_endpoints=total_endpoints,
        vendors=dict(sorted(vendor_counts.items())),
        roles=dict(sorted(role_counts.items())),
        generated_at=datetime.now(timezone.utc),
        mode="mock",
    )
    return TopologyResponse(nodes=nodes, edges=edges, summary=summary)


def list_mock_devices(
    search: str | None = None,
    vendor: str | None = None,
    role: str | None = None,
) -> DeviceListResponse:
    """Filter mock devices by query string, vendor, and role."""
    devices = get_mock_device_summaries()
    if search:
        term = search.strip().lower()
        devices = [
            d
            for d in devices
            if any(
                term in (field or "").lower()
                for field in (
                    d.hostname,
                    d.name,
                    d.dns,
                    d.ip,
                    d.vendor,
                    d.model,
                    d.serial,
                    d.location,
                )
            )
        ]
    if vendor:
        v_norm = vendor.strip().lower()
        devices = [d for d in devices if (d.vendor or "").lower() == v_norm]
    if role:
        r_norm = role.strip().lower()
        devices = [d for d in devices if d.role.lower() == r_norm]

    return DeviceListResponse(devices=devices, total=len(devices), mode="mock")


def get_mock_device_ports(ip: str) -> DevicePortsResponse | None:
    """Return port/VLAN/endpoint inspection payload for a mock device IP."""
    summaries = {d.ip: d for d in get_mock_device_summaries()}
    device = summaries.get(ip)
    if device is None:
        return None
    ports = _PORTS_BY_IP.get(ip, [])
    return DevicePortsResponse(
        device=device,
        ports=ports,
        total_ports=len(ports),
        active_ports=sum(1 for p in ports if p.up == "up"),
        total_endpoints=sum(len(p.endpoints) for p in ports),
        mode="mock",
    )


def list_mock_endpoints(
    search: str | None = None,
    vlan: str | None = None,
    switch_ip: str | None = None,
    site_id: str = "local",
) -> EndpointListResponse:
    """Return flattened endpoint bindings from mock campus switches."""
    host_by_ip = {d["ip"]: d["hostname"] for d in _MOCK_DEVICES}
    records: list[EndpointRecord] = []
    for ip, ports in _PORTS_BY_IP.items():
        if switch_ip and ip != switch_ip.strip():
            continue
        sw_host = host_by_ip.get(ip, ip)
        for port in ports:
            for ep in port.endpoints:
                if vlan and str(ep.vlan or "") != str(vlan).strip():
                    continue
                if search:
                    q = search.strip().lower()
                    haystack = " ".join(
                        part or ""
                        for part in (ep.mac, ep.ip, ep.oui, ep.vlan, ip, sw_host, port.port)
                    ).lower()
                    if q not in haystack:
                        continue
                records.append(
                    EndpointRecord(
                        mac=ep.mac,
                        ip=ep.ip,
                        oui=ep.oui,
                        vlan=ep.vlan,
                        switch_ip=ip,
                        switch_hostname=sw_host,
                        port=port.port,
                        active=ep.active,
                        time_last=ep.time_last,
                    )
                )
    records.sort(key=lambda r: (r.switch_hostname, r.port, r.mac))
    return EndpointListResponse(
        endpoints=records,
        total=len(records),
        site_id=site_id,
        mode="mock",
    )


def list_mock_vlans(site_id: str = "local") -> VlanListResponse:
    """Aggregate VLAN memberships across mock switches and ports."""
    host_by_ip = {d["ip"]: d["hostname"] for d in _MOCK_DEVICES}
    by_vlan: dict[int, dict[str, dict[str, int]]] = defaultdict(dict)

    for ip, ports in _PORTS_BY_IP.items():
        for port in ports:
            for v in port.vlans:
                sw_map = by_vlan[v.vlan].setdefault(
                    ip, {"port_count": 0, "native_port_count": 0}
                )
                sw_map["port_count"] += 1
                if v.native:
                    sw_map["native_port_count"] += 1

    vlans: list[VlanSummary] = []
    for vid in sorted(by_vlan):
        sw_entries = by_vlan[vid]
        switches = [
            VlanSwitchMember(
                ip=sw_ip,
                hostname=host_by_ip.get(sw_ip, sw_ip),
                port_count=counts["port_count"],
                native_port_count=counts["native_port_count"],
            )
            for sw_ip, counts in sorted(sw_entries.items())
        ]
        vlans.append(
            VlanSummary(
                vlan=vid,
                switch_count=len(switches),
                port_count=sum(s.port_count for s in switches),
                native_port_count=sum(s.native_port_count for s in switches),
                switches=switches,
            )
        )

    return VlanListResponse(vlans=vlans, total=len(vlans), site_id=site_id, mode="mock")


def _materialize_job(raw: dict[str, Any]) -> ScanJob:
    now = datetime.now(timezone.utc)
    entered = raw["entered"]
    if raw["status"] == "queued" and entered is not None:
        elapsed = (now - entered).total_seconds()
        if elapsed >= 6:
            return ScanJob(
                job_id=raw["job_id"],
                device=raw["device"],
                action=raw["action"],
                subaction=raw["subaction"],
                status="done",
                entered=entered,
                started=entered + timedelta(seconds=1),
                finished=entered + timedelta(seconds=6),
                username=raw["username"],
                log=f"[MOCK] Completed {raw['action']} on {raw['device']}.",
            )
        if elapsed >= 2:
            return ScanJob(
                job_id=raw["job_id"],
                device=raw["device"],
                action=raw["action"],
                subaction=raw["subaction"],
                status="running",
                entered=entered,
                started=entered + timedelta(seconds=1),
                finished=None,
                username=raw["username"],
                log=f"[MOCK] Polling {raw['device']} via SNMP...",
            )
    return ScanJob(**raw)


def enqueue_mock_scan(req: ScanRequest) -> ScanResponse:
    """Enqueue simulated Netdisco jobs into the in-memory mock queue."""
    global _NEXT_JOB_ID
    now = datetime.now(timezone.utc)
    created: list[ScanJob] = []
    with _JOB_LOCK:
        for action in req.actions:
            entry = {
                "job_id": _NEXT_JOB_ID,
                "device": req.target_ip,
                "action": action,
                "subaction": None,
                "status": "queued",
                "entered": now,
                "started": None,
                "finished": None,
                "username": req.requested_by,
                "log": f"[MOCK] Queued {action} job for {req.target_ip}.",
            }
            _NEXT_JOB_ID += 1
            _MOCK_JOBS.insert(0, entry)
            created.append(ScanJob(**entry))

    return ScanResponse(
        queued_jobs=created,
        message=f"[MOCK] Queued {len(created)} discovery job(s) for {req.target_ip}.",
        mode="mock",
    )


def list_mock_jobs(limit: int = 50) -> ScanJobsResponse:
    """Return recent simulated Netdisco jobs."""
    with _JOB_LOCK:
        jobs = [_materialize_job(item) for item in _MOCK_JOBS[:limit]]
    return ScanJobsResponse(jobs=jobs, total=len(jobs), mode="mock")
