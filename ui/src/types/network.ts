import type { Edge, Node } from "@xyflow/react";

export type DeviceRole =
  | "firewall"
  | "router"
  | "core"
  | "distribution"
  | "access"
  | "wireless"
  | "unknown";

export type ScanAction = "discover" | "macsuck" | "arpnip";
export type ReachabilityStatus = "up" | "degraded" | "down" | "unknown";
export type LayoutDirection = "TB" | "LR";
export type EdgeStyle = "straight" | "step";
export type TopologyViewMode = "l2" | "l3";

export interface HealthResponse {
  status: "ok" | "degraded";
  mode: "mock" | "live";
  database: "mock" | "connected" | "disconnected";
  version: string;
  device_count: number;
  timestamp: string;
}

export interface DeviceSummary {
  ip: string;
  hostname: string;
  name: string | null;
  dns: string | null;
  vendor: string | null;
  model: string | null;
  os: string | null;
  os_ver: string | null;
  serial: string | null;
  location: string | null;
  contact: string | null;
  layers: string | null;
  role: DeviceRole;
  tier: number;
  port_count: number;
  active_port_count: number;
  uplink_count: number;
  endpoint_count: number;
  uptime_seconds: number | null;
  last_discover: string | null;
  last_macsuck: string | null;
  last_arpnip: string | null;
  reachability: ReachabilityStatus;
  latency_ms: number | null;
  last_polled: string | null;
}

export interface DeviceListResponse {
  devices: DeviceSummary[];
  total: number;
  mode: "mock" | "live";
}

export interface TopologyNodeItem {
  id: string;
  ip: string;
  hostname: string;
  vendor: string | null;
  model: string | null;
  os: string | null;
  role: DeviceRole;
  tier: number;
  location: string | null;
  managed: boolean;
  port_count: number;
  active_port_count: number;
  uplink_count: number;
  endpoint_count: number;
  last_discover: string | null;
  is_root: boolean;
  role_override: DeviceRole | null;
  pos_x: number | null;
  pos_y: number | null;
  reachability: ReachabilityStatus;
  latency_ms: number | null;
  last_polled: string | null;
}

export interface TopologyEdgeItem {
  id: string;
  source: string;
  target: string;
  source_port: string;
  target_port: string;
  speed: string | null;
  speed_mbps: number | null;
  link_type: "uplink" | "neighbor" | "unmanaged";
  status: "up" | "down" | "unknown";
  protocol: string;
  parallel_index: number;
  parallel_total: number;
}

export interface TopologySummary {
  total_devices: number;
  managed_devices: number;
  unmanaged_neighbors: number;
  total_links: number;
  total_endpoints: number;
  vendors: Record<string, number>;
  roles: Record<string, number>;
  generated_at: string;
  mode: "mock" | "live";
}

export interface TopologyResponse {
  nodes: TopologyNodeItem[];
  edges: TopologyEdgeItem[];
  summary: TopologySummary;
}

export interface NodeOverrideRequest {
  role_override?: DeviceRole | null;
  clear_role_override?: boolean;
  is_root?: boolean;
  pos_x?: number;
  pos_y?: number;
}

export interface NodePositionItem {
  ip: string;
  pos_x: number;
  pos_y: number;
}

export interface PortVlanInfo {
  vlan: number;
  native: boolean;
  vlantype: string | null;
}

export interface ConnectedEndpoint {
  mac: string;
  ip: string | null;
  oui: string | null;
  vlan: string | null;
  active: boolean;
  time_last: string | null;
}

export interface DevicePortDetail {
  port: string;
  name: string | null;
  descr: string | null;
  up: string | null;
  up_admin: string | null;
  speed: string | null;
  speed_mbps: number | null;
  duplex: string | null;
  pvid: number | null;
  vlans: PortVlanInfo[];
  is_uplink: boolean;
  remote_ip: string | null;
  remote_port: string | null;
  remote_id: string | null;
  remote_type: string | null;
  endpoints: ConnectedEndpoint[];
}

export interface DevicePortsResponse {
  device: DeviceSummary;
  ports: DevicePortDetail[];
  total_ports: number;
  active_ports: number;
  total_endpoints: number;
  mode: "mock" | "live";
}

export interface EndpointRecord {
  mac: string;
  ip: string | null;
  oui: string | null;
  vlan: string | null;
  switch_ip: string;
  switch_hostname: string;
  port: string;
  active: boolean;
  time_last: string | null;
}

export interface EndpointListResponse {
  endpoints: EndpointRecord[];
  total: number;
  site_id: string;
  mode: "mock" | "live";
}

export interface VlanSwitchMember {
  ip: string;
  hostname: string;
  port_count: number;
  native_port_count: number;
}

export interface VlanSummary {
  vlan: number;
  switch_count: number;
  port_count: number;
  native_port_count: number;
  switches: VlanSwitchMember[];
}

export interface VlanListResponse {
  vlans: VlanSummary[];
  total: number;
  site_id: string;
  mode: "mock" | "live";
}

export interface SiteSummary {
  site_id: string;
  name: string;
  description: string | null;
  is_local: boolean;
  agent_count: number;
  device_count: number;
  last_sync: string | null;
  created_at: string | null;
}

export interface SiteListResponse {
  sites: SiteSummary[];
  total: number;
  mode: "mock" | "live";
}

export interface AgentSummary {
  agent_id: string;
  site_id: string;
  site_name: string | null;
  name: string;
  hostname: string | null;
  version: string | null;
  status: string;
  is_local: boolean;
  last_seen: string | null;
  device_count: number;
  link_count: number;
}

export interface AgentListResponse {
  agents: AgentSummary[];
  total: number;
  mode: "mock" | "live";
}

export interface AgentRegisterResponse {
  agent: AgentSummary;
  token: string;
  ingest_url: string;
}

export interface ScanRequest {
  target_ip: string;
  actions: ScanAction[];
  requested_by?: string;
}

export interface ScanJob {
  job_id: number;
  device: string | null;
  action: string;
  subaction: string | null;
  status: string;
  entered: string | null;
  started: string | null;
  finished: string | null;
  username: string | null;
  log: string | null;
}

export interface ScanResponse {
  queued_jobs: ScanJob[];
  message: string;
  mode: "mock" | "live";
}

export interface ScanJobsResponse {
  jobs: ScanJob[];
  total: number;
  mode: "mock" | "live";
}

export interface DeviceStatusRecord {
  ip: string;
  status: ReachabilityStatus;
  latency_ms: number | null;
  consecutive_failures: number;
  last_checked: string | null;
  last_up: string | null;
}

export interface StatusSummaryResponse {
  enabled: boolean;
  interval_seconds: number;
  last_cycle_at: string | null;
  total: number;
  up: number;
  degraded: number;
  down: number;
  unknown: number;
  devices: DeviceStatusRecord[];
  mode: "mock" | "live";
}

export type DeviceNodeData = TopologyNodeItem &
  Record<string, unknown> & {
    direction: LayoutDirection;
    isHighlighted?: boolean;
  };

export type VlanNodeData = VlanSummary &
  Record<string, unknown> & {
    direction: LayoutDirection;
    isHighlighted?: boolean;
  };

export type PortEdgeData = TopologyEdgeItem &
  Record<string, unknown> & {
    showLabels: boolean;
    edgeStyle: EdgeStyle;
  };

export type DeviceFlowNode = Node<DeviceNodeData, "device">;
export type VlanFlowNode = Node<VlanNodeData, "vlan">;
export type TopologyCanvasNode = DeviceFlowNode | VlanFlowNode;
export type PortFlowEdge = Edge<PortEdgeData, "portEdge">;
