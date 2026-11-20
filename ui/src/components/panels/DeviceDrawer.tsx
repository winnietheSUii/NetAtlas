import {
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  Laptop,
  Loader2,
  MapPin,
  Pin,
  Radar,
  RefreshCw,
  Search,
  Server,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchDevicePorts, triggerScan, updateNodeOverride } from "../../api/client";
import type {
  ConnectedEndpoint,
  DevicePortDetail,
  DevicePortsResponse,
  DeviceRole,
  TopologyNodeItem,
} from "../../types/network";
import { getRoleMeta } from "../../utils/roleStyles";
import { NetworkIcon } from "../topology/NetworkIcons";

interface DeviceDrawerProps {
  deviceIp: string | null;
  siteId: string;
  topologyNode?: TopologyNodeItem | null;
  onClose: () => void;
  onSelectDevice: (ip: string) => void;
  onOverrideSaved: () => void;
  onScanTriggered?: () => void;
}

type DrawerTab = "ports" | "endpoints" | "details";
type PortFilter = "all" | "up" | "uplinks";

function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${mins}m`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function PortStatusDot({ port }: { port: DevicePortDetail }) {
  if (port.up === "up") {
    return (
      <span
        className="inline-block h-2 w-2 rounded-full bg-[#1a7f37] dark:bg-[#3fb950]"
        title="Link Up"
      />
    );
  }
  if (port.up_admin === "down") {
    return (
      <span
        className="inline-block h-2 w-2 rounded-full bg-[#8c959f]"
        title="Admin Down"
      />
    );
  }
  return (
    <span
      className="inline-block h-2 w-2 rounded-full bg-[#cf222e]"
      title="Link Down"
    />
  );
}

export function DeviceDrawer({
  deviceIp,
  siteId,
  topologyNode,
  onClose,
  onSelectDevice,
  onOverrideSaved,
  onScanTriggered,
}: DeviceDrawerProps) {
  const [data, setData] = useState<DevicePortsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DrawerTab>("ports");
  const [portFilter, setPortFilter] = useState<PortFilter>("all");
  const [search, setSearch] = useState("");
  const [scanning, setScanning] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadDevice = async (ip: string, activeSite: string) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const resp = await fetchDevicePorts(ip, activeSite);
      setData(resp);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Failed to load device details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!deviceIp) {
      setData(null);
      setError(null);
      return;
    }
    setSearch("");
    setTab("ports");
    setPortFilter("all");
    void loadDevice(deviceIp, siteId);
  }, [deviceIp, siteId]);

  const flattenedEndpoints = useMemo(() => {
    if (!data) return [];
    const list: Array<ConnectedEndpoint & { port: string }> = [];
    for (const port of data.ports) {
      for (const ep of port.endpoints) {
        list.push({ ...ep, port: port.port });
      }
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (ep) =>
        ep.mac.toLowerCase().includes(q) ||
        (ep.ip || "").toLowerCase().includes(q) ||
        (ep.oui || "").toLowerCase().includes(q) ||
        ep.port.toLowerCase().includes(q) ||
        (ep.vlan || "").toLowerCase().includes(q)
    );
  }, [data, search]);

  const filteredPorts = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.ports.filter((port) => {
      if (portFilter === "up" && port.up !== "up") return false;
      if (portFilter === "uplinks" && !port.is_uplink) return false;
      if (!q) return true;
      const vlanMatch = port.vlans.some((v) => String(v.vlan).includes(q));
      return (
        port.port.toLowerCase().includes(q) ||
        (port.descr || "").toLowerCase().includes(q) ||
        (port.remote_id || "").toLowerCase().includes(q) ||
        (port.remote_ip || "").toLowerCase().includes(q) ||
        vlanMatch
      );
    });
  }, [data, portFilter, search]);

  if (!deviceIp) return null;

  const effectiveRole = topologyNode?.role ?? data?.device.role ?? "unknown";
  const effectiveReachability =
    data?.device.reachability ?? topologyNode?.reachability ?? "unknown";
  const effectiveLatency = data?.device.latency_ms ?? topologyNode?.latency_ms ?? null;
  const isRoot = topologyNode?.is_root ?? false;
  const roleOverrideValue = topologyNode?.role_override ?? "";

  const handleRescan = async () => {
    setScanning(true);
    setNotice(null);
    try {
      const resp = await triggerScan({
        target_ip: deviceIp,
        actions: ["discover", "macsuck", "arpnip"],
      });
      setNotice(resp.message);
      onScanTriggered?.();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to queue scan");
    } finally {
      setScanning(false);
    }
  };

  const handleToggleRoot = async () => {
    setSavingOverride(true);
    setNotice(null);
    try {
      await updateNodeOverride(deviceIp, { is_root: !isRoot }, siteId);
      setNotice(!isRoot ? "Pinned as topology root." : "Unpinned topology root.");
      onOverrideSaved();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to update root pin");
    } finally {
      setSavingOverride(false);
    }
  };

  const handleRoleOverrideChange = async (value: string) => {
    setSavingOverride(true);
    setNotice(null);
    try {
      if (value === "") {
        await updateNodeOverride(deviceIp, { clear_role_override: true }, siteId);
        setNotice("Restored automatic role classification.");
      } else {
        await updateNodeOverride(
          deviceIp,
          { role_override: value as DeviceRole },
          siteId
        );
        setNotice(`Overrode device role to ${value}.`);
      }
      onOverrideSaved();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to update role override");
    } finally {
      setSavingOverride(false);
    }
  };

  const roleMeta = getRoleMeta(effectiveRole);

  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-full max-w-2xl flex-col border-l border-[#d0d7de] bg-white shadow-xl dark:border-[#30363d] dark:bg-[#161b22]">
      <div className="flex items-start justify-between gap-3 border-b border-[#d0d7de] px-4 py-3 dark:border-[#30363d]">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-[#d0d7de] bg-[#f6f8fa] dark:border-[#30363d] dark:bg-[#0d1117]">
            <NetworkIcon
              role={effectiveRole}
              className={`h-7 w-7 ${roleMeta.iconColor}`}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-[#1f2328] dark:text-[#e6edf3]">
                {data?.device.hostname ?? topologyNode?.hostname ?? deviceIp}
              </h2>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${roleMeta.badgeClass}`}
              >
                {roleMeta.label}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[#57606a] dark:text-[#8b949e]">
              <span className="font-mono text-[#1f2328] dark:text-[#e6edf3]">
                {deviceIp}
              </span>
              <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                <span
                  className={`h-2 w-2 rounded-full ${
                    effectiveReachability === "up"
                      ? "bg-[#1a7f37] dark:bg-[#3fb950]"
                      : effectiveReachability === "degraded"
                      ? "bg-[#bf8700] dark:bg-[#d29922]"
                      : effectiveReachability === "down"
                      ? "bg-[#cf222e] dark:bg-[#f85149]"
                      : "bg-[#8c959f]"
                  }`}
                />
                <span className="uppercase">{effectiveReachability}</span>
                {effectiveReachability === "up" && effectiveLatency !== null && (
                  <span>({effectiveLatency.toFixed(1)} ms)</span>
                )}
              </span>
              {data?.device.vendor && (
                <>
                  <span>·</span>
                  <span>
                    {data.device.vendor} {data.device.model ?? ""}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {siteId === "local" && (
            <button
              type="button"
              onClick={() => void handleRescan()}
              disabled={scanning}
              className="flex items-center gap-1 rounded border border-[#d0d7de] bg-white px-2.5 py-1 text-xs font-medium text-[#1f2328] hover:bg-[#f6f8fa] disabled:opacity-50 dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#e6edf3] dark:hover:bg-[#21262d]"
            >
              {scanning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Radar className="h-3.5 w-3.5 text-[#0969da]" />
              )}
              <span>Rescan</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void loadDevice(deviceIp, siteId)}
            disabled={loading}
            className="rounded border border-[#d0d7de] bg-white p-1 text-[#57606a] hover:bg-[#f6f8fa] dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#8b949e] dark:hover:bg-[#21262d]"
            title="Reload device details"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#57606a] hover:bg-[#f6f8fa] hover:text-[#1f2328] dark:text-[#8b949e] dark:hover:bg-[#21262d] dark:hover:text-[#e6edf3]"
            aria-label="Close inspector"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#d0d7de] bg-[#f6f8fa] px-4 py-2 text-xs dark:border-[#30363d] dark:bg-[#0d1117]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleToggleRoot()}
            disabled={savingOverride}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition ${
              isRoot
                ? "border-[#0969da] bg-[#ddf4ff] text-[#0969da] dark:border-[#1f6feb] dark:bg-[#1f6feb]/20 dark:text-[#58a6ff]"
                : "border-[#d0d7de] bg-white text-[#1f2328] hover:bg-[#f6f8fa] dark:border-[#30363d] dark:bg-[#161b22] dark:text-[#e6edf3]"
            }`}
          >
            <Pin className="h-3 w-3" />
            <span>{isRoot ? "Pinned Root" : "Pin as Root"}</span>
          </button>

          <label className="flex items-center gap-1.5 text-[11px] text-[#57606a] dark:text-[#8b949e]">
            <span>Role:</span>
            <select
              value={roleOverrideValue}
              disabled={savingOverride}
              onChange={(e) => void handleRoleOverrideChange(e.target.value)}
              className="rounded border border-[#d0d7de] bg-white px-2 py-1 text-[11px] text-[#1f2328] focus:outline-none dark:border-[#30363d] dark:bg-[#161b22] dark:text-[#e6edf3]"
            >
              <option value="">Auto ({data?.device.role ?? effectiveRole})</option>
              <option value="firewall">Firewall</option>
              <option value="router">Router</option>
              <option value="core">Core Switch</option>
              <option value="distribution">Distribution</option>
              <option value="access">Access Switch</option>
              <option value="wireless">Wireless AP</option>
            </select>
          </label>
        </div>

        {notice && (
          <div className="flex items-center gap-1 text-[11px] text-[#1a7f37] dark:text-[#3fb950]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{notice}</span>
          </div>
        )}
      </div>

      {loading && !data ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-[#57606a]">
          <Loader2 className="h-4 w-4 animate-spin text-[#0969da]" />
          <span>Loading device interfaces &amp; endpoints...</span>
        </div>
      ) : error ? (
        <div className="m-4 rounded border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          <p className="font-semibold">Unable to inspect {deviceIp}</p>
          <p className="mt-1">{error}</p>
        </div>
      ) : data ? (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-[#d0d7de] bg-white px-4 py-2 dark:border-[#30363d] dark:bg-[#161b22]">
            <div className="flex items-center gap-1">
              {(
                [
                  { key: "ports", label: `Interfaces (${data.total_ports})` },
                  { key: "endpoints", label: `Endpoints (${data.total_endpoints})` },
                  { key: "details", label: "System Info" },
                ] as const
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  className={`rounded px-2.5 py-1 text-xs font-medium ${
                    tab === item.key
                      ? "bg-[#ddf4ff] text-[#0969da] dark:bg-[#1f6feb]/20 dark:text-[#58a6ff]"
                      : "text-[#57606a] hover:bg-[#f6f8fa] dark:text-[#8b949e] dark:hover:bg-[#21262d]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {tab !== "details" && (
              <div className="flex items-center gap-1.5 rounded border border-[#d0d7de] bg-[#f6f8fa] px-2 py-1 dark:border-[#30363d] dark:bg-[#0d1117]">
                <Search className="h-3.5 w-3.5 text-[#57606a]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={tab === "ports" ? "Filter port/VLAN..." : "Filter MAC/IP..."}
                  className="w-32 bg-transparent text-xs focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {tab === "ports" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-[#57606a] dark:text-[#8b949e]">
                  <span>
                    Showing{" "}
                    <strong className="text-[#1f2328] dark:text-[#e6edf3]">
                      {filteredPorts.length}
                    </strong>{" "}
                    ports ({data.active_ports} up)
                  </span>
                  <div className="flex items-center gap-1">
                    {(["all", "up", "uplinks"] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setPortFilter(f)}
                        className={`rounded border px-2 py-0.5 text-[11px] font-medium capitalize ${
                          portFilter === f
                            ? "border-[#0969da] bg-[#0969da] text-white"
                            : "border-[#d0d7de] bg-white text-[#57606a] dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#8b949e]"
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-hidden rounded border border-[#d0d7de] dark:border-[#30363d]">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#d0d7de] bg-[#f6f8fa] text-[11px] uppercase tracking-wider text-[#57606a] dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#8b949e]">
                      <tr>
                        <th className="px-3 py-2">Interface</th>
                        <th className="px-3 py-2">Speed</th>
                        <th className="px-3 py-2">VLANs</th>
                        <th className="px-3 py-2">Neighbor / Endpoints</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#d0d7de] dark:divide-[#30363d]">
                      {filteredPorts.map((port) => (
                        <tr
                          key={port.port}
                          className="hover:bg-[#f6f8fa] dark:hover:bg-[#0d1117]/60"
                        >
                          <td className="px-3 py-2 align-top">
                            <div className="flex items-center gap-2">
                              <PortStatusDot port={port} />
                              <span className="font-mono font-semibold">
                                {port.port}
                              </span>
                            </div>
                            {port.descr && (
                              <div className="mt-0.5 pl-4 text-[11px] text-[#57606a] dark:text-[#8b949e]">
                                {port.descr}
                              </div>
                            )}
                          </td>

                          <td className="px-3 py-2 align-top font-mono text-[11px]">
                            <div>{port.speed ?? "—"}</div>
                            {port.duplex && (
                              <div className="text-[10px] text-[#57606a] dark:text-[#8b949e]">
                                {port.duplex}
                              </div>
                            )}
                          </td>

                          <td className="px-3 py-2 align-top">
                            <div className="flex flex-wrap gap-1">
                              {port.vlans.length > 0 ? (
                                port.vlans.map((v) => (
                                  <span
                                    key={`${port.port}-${v.vlan}-${v.native}`}
                                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                                      v.native
                                        ? "border-[#0969da]/50 bg-[#ddf4ff] text-[#0969da] dark:border-[#58a6ff]/40 dark:bg-[#1f6feb]/20 dark:text-[#58a6ff]"
                                        : "border-[#d0d7de] bg-[#f6f8fa] text-[#57606a] dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#8b949e]"
                                    }`}
                                    title={v.native ? "Native / PVID VLAN" : "Tagged VLAN"}
                                  >
                                    {v.vlan}
                                    {v.native ? "*" : ""}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[#8c959f]">—</span>
                              )}
                            </div>
                          </td>

                          <td className="px-3 py-2 align-top">
                            {port.remote_ip ? (
                              <button
                                type="button"
                                onClick={() => onSelectDevice(port.remote_ip!)}
                                className="inline-flex items-center gap-1 rounded border border-[#d0d7de] bg-[#f6f8fa] px-2 py-0.5 text-[11px] font-medium text-[#0969da] hover:border-[#0969da] dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#58a6ff]"
                              >
                                <span>
                                  {port.remote_id ?? port.remote_ip} ({port.remote_port ?? "?"})
                                </span>
                                <ArrowUpRight className="h-3 w-3" />
                              </button>
                            ) : port.endpoints.length > 0 ? (
                              <div className="space-y-1">
                                {port.endpoints.map((ep) => (
                                  <div
                                    key={`${port.port}-${ep.mac}-${ep.ip ?? "noip"}`}
                                    className="flex flex-wrap items-center gap-1.5 text-[11px]"
                                  >
                                    <Laptop className="h-3 w-3 text-[#57606a]" />
                                    <span className="font-mono font-medium">
                                      {ep.ip ?? ep.mac}
                                    </span>
                                    {ep.ip && (
                                      <span className="font-mono text-[10px] text-[#57606a] dark:text-[#8b949e]">
                                        {ep.mac}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[11px] text-[#8c959f]">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === "endpoints" && (
              <div className="overflow-hidden rounded border border-[#d0d7de] dark:border-[#30363d]">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#d0d7de] bg-[#f6f8fa] text-[11px] uppercase tracking-wider text-[#57606a] dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#8b949e]">
                    <tr>
                      <th className="px-3 py-2">IP Address</th>
                      <th className="px-3 py-2">MAC Address</th>
                      <th className="px-3 py-2">OUI Vendor</th>
                      <th className="px-3 py-2">Port / VLAN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#d0d7de] dark:divide-[#30363d]">
                    {flattenedEndpoints.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-[#57606a]">
                          No active endpoints recorded on this device.
                        </td>
                      </tr>
                    ) : (
                      flattenedEndpoints.map((ep, index) => (
                        <tr key={`${ep.port}-${ep.mac}-${ep.ip ?? index}`}>
                          <td className="px-3 py-2 font-mono font-medium">
                            {ep.ip ?? "—"}
                          </td>
                          <td className="px-3 py-2 font-mono">{ep.mac}</td>
                          <td className="px-3 py-2">{ep.oui ?? "Unknown"}</td>
                          <td className="px-3 py-2 font-mono text-[11px]">
                            <span>{ep.port}</span>
                            {ep.vlan && (
                              <span className="ml-1.5 rounded border border-[#d0d7de] px-1 py-px text-[10px] dark:border-[#30363d]">
                                VLAN {ep.vlan}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "details" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded border border-[#d0d7de] p-3 dark:border-[#30363d]">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#57606a] dark:text-[#8b949e]">
                    <Server className="h-3.5 w-3.5" />
                    Hardware &amp; OS
                  </div>
                  <dl className="mt-2 space-y-1.5 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#57606a] dark:text-[#8b949e]">Vendor</dt>
                      <dd className="font-medium">{data.device.vendor ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#57606a] dark:text-[#8b949e]">Model</dt>
                      <dd className="font-mono font-medium">{data.device.model ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#57606a] dark:text-[#8b949e]">OS / Version</dt>
                      <dd className="font-mono">
                        {[data.device.os, data.device.os_ver].filter(Boolean).join(" ") || "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#57606a] dark:text-[#8b949e]">Serial</dt>
                      <dd className="font-mono">{data.device.serial ?? "—"}</dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded border border-[#d0d7de] p-3 dark:border-[#30363d]">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#57606a] dark:text-[#8b949e]">
                    <MapPin className="h-3.5 w-3.5" />
                    Site &amp; Telemetry
                  </div>
                  <dl className="mt-2 space-y-1.5 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#57606a] dark:text-[#8b949e]">Location</dt>
                      <dd className="text-right font-medium">{data.device.location ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#57606a] dark:text-[#8b949e]">Contact</dt>
                      <dd className="font-mono">{data.device.contact ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#57606a] dark:text-[#8b949e]">Uptime</dt>
                      <dd className="font-mono">{formatUptime(data.device.uptime_seconds)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#57606a] dark:text-[#8b949e]">SNMP Layers</dt>
                      <dd className="font-mono">{data.device.layers ?? "—"}</dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded border border-[#d0d7de] p-3 dark:border-[#30363d] sm:col-span-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#57606a] dark:text-[#8b949e]">
                    <Cpu className="h-3.5 w-3.5" />
                    Polling Timestamps
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                    <div className="rounded border border-[#d0d7de] bg-[#f6f8fa] p-2 dark:border-[#30363d] dark:bg-[#0d1117]">
                      <div className="text-[11px] text-[#57606a] dark:text-[#8b949e]">
                        Discover
                      </div>
                      <div className="mt-0.5 font-mono text-[11px]">
                        {formatTimestamp(data.device.last_discover)}
                      </div>
                    </div>
                    <div className="rounded border border-[#d0d7de] bg-[#f6f8fa] p-2 dark:border-[#30363d] dark:bg-[#0d1117]">
                      <div className="text-[11px] text-[#57606a] dark:text-[#8b949e]">
                        Macsuck
                      </div>
                      <div className="mt-0.5 font-mono text-[11px]">
                        {formatTimestamp(data.device.last_macsuck)}
                      </div>
                    </div>
                    <div className="rounded border border-[#d0d7de] bg-[#f6f8fa] p-2 dark:border-[#30363d] dark:bg-[#0d1117]">
                      <div className="text-[11px] text-[#57606a] dark:text-[#8b949e]">
                        Arpnip
                      </div>
                      <div className="mt-0.5 font-mono text-[11px]">
                        {formatTimestamp(data.device.last_arpnip)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      ) : null}
    </aside>
  );
}
