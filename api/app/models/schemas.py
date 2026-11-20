from datetime import datetime
import ipaddress
import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

DeviceRole = Literal[
    "firewall",
    "router",
    "core",
    "distribution",
    "access",
    "wireless",
    "unknown",
]

ScanAction = Literal["discover", "macsuck", "arpnip"]
ReachabilityStatus = Literal["up", "degraded", "down", "unknown"]

_SITE_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,48}$")


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    mode: Literal["mock", "live"]
    database: Literal["mock", "connected", "disconnected"]
    version: str
    device_count: int
    timestamp: datetime


class DeviceSummary(BaseModel):
    ip: str
    hostname: str
    name: str | None = None
    dns: str | None = None
    vendor: str | None = None
    model: str | None = None
    os: str | None = None
    os_ver: str | None = None
    serial: str | None = None
    location: str | None = None
    contact: str | None = None
    layers: str | None = None
    role: DeviceRole
    tier: int
    port_count: int = 0
    active_port_count: int = 0
    uplink_count: int = 0
    endpoint_count: int = 0
    uptime_seconds: int | None = None
    last_discover: datetime | None = None
    last_macsuck: datetime | None = None
    last_arpnip: datetime | None = None
    reachability: ReachabilityStatus = "unknown"
    latency_ms: float | None = None
    last_polled: datetime | None = None


class DeviceListResponse(BaseModel):
    devices: list[DeviceSummary]
    total: int
    mode: Literal["mock", "live"]


class TopologyNode(BaseModel):
    id: str
    ip: str
    hostname: str
    vendor: str | None = None
    model: str | None = None
    os: str | None = None
    role: DeviceRole
    tier: int
    location: str | None = None
    managed: bool = True
    port_count: int = 0
    active_port_count: int = 0
    uplink_count: int = 0
    endpoint_count: int = 0
    last_discover: datetime | None = None
    is_root: bool = False
    role_override: DeviceRole | None = None
    pos_x: float | None = None
    pos_y: float | None = None
    reachability: ReachabilityStatus = "unknown"
    latency_ms: float | None = None
    last_polled: datetime | None = None


class TopologyEdge(BaseModel):
    id: str
    source: str
    target: str
    source_port: str
    target_port: str
    speed: str | None = None
    speed_mbps: int | None = None
    link_type: Literal["uplink", "neighbor", "unmanaged"] = "uplink"
    status: Literal["up", "down", "unknown"] = "up"
    protocol: str = "CDP/LLDP"
    parallel_index: int = 0
    parallel_total: int = 1


class TopologySummary(BaseModel):
    total_devices: int
    managed_devices: int
    unmanaged_neighbors: int
    total_links: int
    total_endpoints: int
    vendors: dict[str, int]
    roles: dict[str, int]
    generated_at: datetime
    mode: Literal["mock", "live"]


class TopologyResponse(BaseModel):
    nodes: list[TopologyNode]
    edges: list[TopologyEdge]
    summary: TopologySummary


class NodeOverrideRequest(BaseModel):
    role_override: DeviceRole | None = None
    clear_role_override: bool = False
    is_root: bool | None = None
    pos_x: float | None = None
    pos_y: float | None = None


class NodePositionItem(BaseModel):
    ip: str
    pos_x: float
    pos_y: float

    @field_validator("ip")
    @classmethod
    def validate_ip(cls, value: str) -> str:
        cleaned = value.strip()
        try:
            return str(ipaddress.ip_address(cleaned))
        except ValueError as exc:
            raise ValueError(f"Invalid IP address: {value}") from exc


class BatchLayoutRequest(BaseModel):
    site_id: str = Field(default="local", min_length=1, max_length=64)
    positions: list[NodePositionItem] = Field(default_factory=list)


class PortVlanInfo(BaseModel):
    vlan: int
    native: bool = False
    vlantype: str | None = None


class ConnectedEndpoint(BaseModel):
    mac: str
    ip: str | None = None
    oui: str | None = None
    vlan: str | None = None
    active: bool = True
    time_last: datetime | None = None


class DevicePortDetail(BaseModel):
    port: str
    name: str | None = None
    descr: str | None = None
    up: str | None = None
    up_admin: str | None = None
    speed: str | None = None
    speed_mbps: int | None = None
    duplex: str | None = None
    pvid: int | None = None
    vlans: list[PortVlanInfo] = Field(default_factory=list)
    is_uplink: bool = False
    remote_ip: str | None = None
    remote_port: str | None = None
    remote_id: str | None = None
    remote_type: str | None = None
    endpoints: list[ConnectedEndpoint] = Field(default_factory=list)


class DevicePortsResponse(BaseModel):
    device: DeviceSummary
    ports: list[DevicePortDetail]
    total_ports: int
    active_ports: int
    total_endpoints: int
    mode: Literal["mock", "live"]


class EndpointRecord(BaseModel):
    mac: str
    ip: str | None = None
    oui: str | None = None
    vlan: str | None = None
    switch_ip: str
    switch_hostname: str
    port: str
    active: bool = True
    time_last: datetime | None = None


class EndpointListResponse(BaseModel):
    endpoints: list[EndpointRecord]
    total: int
    site_id: str
    mode: Literal["mock", "live"]


class VlanSwitchMember(BaseModel):
    ip: str
    hostname: str
    port_count: int
    native_port_count: int = 0


class VlanSummary(BaseModel):
    vlan: int
    switch_count: int
    port_count: int
    native_port_count: int
    switches: list[VlanSwitchMember] = Field(default_factory=list)


class VlanListResponse(BaseModel):
    vlans: list[VlanSummary]
    total: int
    site_id: str
    mode: Literal["mock", "live"]


class SiteSummary(BaseModel):
    site_id: str
    name: str
    description: str | None = None
    is_local: bool = False
    agent_count: int = 0
    device_count: int = 0
    last_sync: datetime | None = None
    created_at: datetime | None = None


class SiteCreateRequest(BaseModel):
    site_id: str = Field(..., min_length=2, max_length=49)
    name: str = Field(..., min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=255)

    @field_validator("site_id")
    @classmethod
    def validate_site_id(cls, value: str) -> str:
        slug = value.strip().lower()
        if not _SITE_SLUG_RE.match(slug):
            raise ValueError(
                "site_id must be 2-49 chars of lowercase letters, numbers, '-' or '_'"
            )
        return slug


class SiteListResponse(BaseModel):
    sites: list[SiteSummary]
    total: int
    mode: Literal["mock", "live"]


class AgentSummary(BaseModel):
    agent_id: str
    site_id: str
    site_name: str | None = None
    name: str
    hostname: str | None = None
    version: str | None = None
    status: str
    is_local: bool = False
    last_seen: datetime | None = None
    device_count: int = 0
    link_count: int = 0


class AgentRegisterRequest(BaseModel):
    site_id: str = Field(..., min_length=2, max_length=49)
    name: str = Field(..., min_length=2, max_length=100)


class AgentRegisterResponse(BaseModel):
    agent: AgentSummary
    token: str
    ingest_url: str


class AgentListResponse(BaseModel):
    agents: list[AgentSummary]
    total: int
    mode: Literal["mock", "live"]


class IngestSnapshotPayload(BaseModel):
    site_id: str
    agent_id: str
    hostname: str | None = None
    version: str | None = None
    devices: list[DeviceSummary] = Field(default_factory=list)
    ports_by_ip: dict[str, list[DevicePortDetail]] = Field(default_factory=dict)
    raw_links: list[dict[str, Any]] = Field(default_factory=list)
    endpoints: list[EndpointRecord] = Field(default_factory=list)
    vlans: list[VlanSummary] = Field(default_factory=list)


class IngestResponse(BaseModel):
    status: Literal["accepted"]
    site_id: str
    agent_id: str
    devices_ingested: int
    links_ingested: int
    received_at: datetime


class ScanRequest(BaseModel):
    target_ip: str = Field(..., description="Management IP of seed device to scan")
    actions: list[ScanAction] = Field(
        default_factory=lambda: ["discover", "macsuck", "arpnip"],
        min_length=1,
    )
    requested_by: str = Field(default="netatlas", max_length=64)

    @field_validator("target_ip")
    @classmethod
    def validate_target_ip(cls, value: str) -> str:
        cleaned = value.strip()
        try:
            addr = ipaddress.ip_address(cleaned)
        except ValueError as exc:
            raise ValueError(f"Invalid IP address: {value}") from exc
        return str(addr)

    @field_validator("actions")
    @classmethod
    def deduplicate_actions(cls, value: list[ScanAction]) -> list[ScanAction]:
        seen: list[ScanAction] = []
        for action in value:
            if action not in seen:
                seen.append(action)
        if not seen:
            raise ValueError("At least one scan action is required.")
        return seen


class ScanJob(BaseModel):
    job_id: int
    device: str | None = None
    action: str
    subaction: str | None = None
    status: str
    entered: datetime | None = None
    started: datetime | None = None
    finished: datetime | None = None
    username: str | None = None
    log: str | None = None


class ScanResponse(BaseModel):
    queued_jobs: list[ScanJob]
    message: str
    mode: Literal["mock", "live"]


class ScanJobsResponse(BaseModel):
    jobs: list[ScanJob]
    total: int
    mode: Literal["mock", "live"]


class DeviceStatusRecord(BaseModel):
    ip: str
    status: ReachabilityStatus
    latency_ms: float | None = None
    consecutive_failures: int = 0
    last_checked: datetime | None = None
    last_up: datetime | None = None


class StatusSummaryResponse(BaseModel):
    enabled: bool
    interval_seconds: int
    last_cycle_at: datetime | None = None
    total: int
    up: int
    degraded: int
    down: int
    unknown: int
    devices: list[DeviceStatusRecord]
    mode: Literal["mock", "live"]
