import type {
  AgentListResponse,
  AgentRegisterResponse,
  DeviceListResponse,
  DevicePortsResponse,
  EndpointListResponse,
  HealthResponse,
  NodeOverrideRequest,
  NodePositionItem,
  ScanJobsResponse,
  ScanRequest,
  ScanResponse,
  SiteListResponse,
  SiteSummary,
  TopologyResponse,
  VlanListResponse,
} from "../types/network";

const API_BASE = "/api";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const errBody = (await response.json()) as {
        detail?: string | Array<{ msg?: string }>;
      };
      if (typeof errBody.detail === "string") {
        detail = errBody.detail;
      } else if (Array.isArray(errBody.detail) && errBody.detail.length > 0) {
        detail = errBody.detail.map((item) => item.msg || "Validation error").join("; ");
      }
    } catch {
      // Ignore non-JSON error payloads
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
}

export function fetchHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>("/health");
}

export function fetchTopology(
  includeUnmanaged = true,
  siteId = "local"
): Promise<TopologyResponse> {
  const qs = new URLSearchParams({
    include_unmanaged: includeUnmanaged ? "true" : "false",
    site_id: siteId,
  });
  return requestJson<TopologyResponse>(`/topology?${qs.toString()}`);
}

export function updateNodeOverride(
  ip: string,
  payload: NodeOverrideRequest,
  siteId = "local"
): Promise<{ status: string; site_id: string }> {
  return requestJson(`/topology/overrides/${encodeURIComponent(ip)}?site_id=${encodeURIComponent(siteId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function saveTopologyLayout(
  siteId: string,
  positions: NodePositionItem[]
): Promise<{ status: string; saved: number }> {
  return requestJson("/topology/layout", {
    method: "POST",
    body: JSON.stringify({ site_id: siteId, positions }),
  });
}

export function resetTopologyLayout(
  siteId = "local"
): Promise<{ status: string; site_id: string }> {
  return requestJson(`/topology/layout?site_id=${encodeURIComponent(siteId)}`, {
    method: "DELETE",
  });
}

export function fetchDevices(params?: {
  search?: string;
  vendor?: string;
  role?: string;
  siteId?: string;
}): Promise<DeviceListResponse> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.vendor) qs.set("vendor", params.vendor);
  if (params?.role) qs.set("role", params.role);
  if (params?.siteId) qs.set("site_id", params.siteId);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return requestJson<DeviceListResponse>(`/devices${suffix}`);
}

export function fetchDevicePorts(
  ip: string,
  siteId = "local"
): Promise<DevicePortsResponse> {
  return requestJson<DevicePortsResponse>(
    `/devices/${encodeURIComponent(ip)}/ports?site_id=${encodeURIComponent(siteId)}`
  );
}

export function fetchEndpoints(params?: {
  search?: string;
  vlan?: string;
  switchIp?: string;
  siteId?: string;
}): Promise<EndpointListResponse> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.vlan) qs.set("vlan", params.vlan);
  if (params?.switchIp) qs.set("switch_ip", params.switchIp);
  if (params?.siteId) qs.set("site_id", params.siteId);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return requestJson<EndpointListResponse>(`/endpoints${suffix}`);
}

export function fetchVlans(siteId = "local"): Promise<VlanListResponse> {
  return requestJson<VlanListResponse>(`/vlans?site_id=${encodeURIComponent(siteId)}`);
}

export function fetchSites(): Promise<SiteListResponse> {
  return requestJson<SiteListResponse>("/sites");
}

export function createSite(payload: {
  site_id: string;
  name: string;
  description?: string;
}): Promise<SiteSummary> {
  return requestJson<SiteSummary>("/sites", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchAgents(): Promise<AgentListResponse> {
  return requestJson<AgentListResponse>("/agents");
}

export function registerAgent(payload: {
  site_id: string;
  name: string;
}): Promise<AgentRegisterResponse> {
  return requestJson<AgentRegisterResponse>("/agents/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function triggerScan(payload: ScanRequest): Promise<ScanResponse> {
  return requestJson<ScanResponse>("/scan", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchScanJobs(limit = 50): Promise<ScanJobsResponse> {
  return requestJson<ScanJobsResponse>(`/scan/jobs?limit=${limit}`);
}
