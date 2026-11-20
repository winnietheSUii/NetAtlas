import {
  ArrowUpDown,
  LocateFixed,
  RefreshCw,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchDevices } from "../api/client";
import { NetworkIcon } from "../components/topology/NetworkIcons";
import type { DeviceRole, DeviceSummary } from "../types/network";
import { getRoleMeta } from "../utils/roleStyles";

interface InventoryPageProps {
  siteId: string;
  refreshSignal: number;
  onSelectDevice: (ip: string) => void;
  onLocateOnMap: (ip: string) => void;
}

type SortKey =
  | "hostname"
  | "ip"
  | "role"
  | "vendor"
  | "active_port_count"
  | "endpoint_count";

export function InventoryPage({
  siteId,
  refreshSignal,
  onSelectDevice,
  onLocateOnMap,
}: InventoryPageProps) {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | DeviceRole>("");
  const [sortKey, setSortKey] = useState<SortKey>("hostname");
  const [sortAsc, setSortAsc] = useState(true);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchDevices({ siteId });
      setDevices(resp.devices);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load device inventory");
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices, refreshSignal]);

  const vendors = useMemo(() => {
    const unique = new Set(devices.map((d) => d.vendor).filter(Boolean) as string[]);
    return Array.from(unique).sort();
  }, [devices]);

  const filteredDevices = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = devices.filter((d) => {
      if (vendorFilter && d.vendor !== vendorFilter) return false;
      if (roleFilter && d.role !== roleFilter) return false;
      if (!q) return true;
      return [d.hostname, d.ip, d.vendor, d.model, d.serial, d.location, d.os]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "active_port_count" || sortKey === "endpoint_count") {
        cmp = a[sortKey] - b[sortKey];
      } else {
        cmp = (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "");
      }
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [devices, search, vendorFilter, roleFilter, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[#d0d7de] bg-white p-3 dark:border-[#30363d] dark:bg-[#161b22]">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded border border-[#d0d7de] bg-[#f6f8fa] px-2.5 py-1.5 dark:border-[#30363d] dark:bg-[#0d1117]">
              <Search className="h-3.5 w-3.5 text-[#57606a]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by hostname, IP, vendor, model, serial, or location..."
                className="w-full bg-transparent text-xs focus:outline-none"
              />
            </div>

            <select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              className="rounded border border-[#d0d7de] bg-[#f6f8fa] px-2.5 py-1.5 text-xs focus:outline-none dark:border-[#30363d] dark:bg-[#0d1117]"
            >
              <option value="">All Vendors</option>
              {vendors.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>

            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as "" | DeviceRole)}
              className="rounded border border-[#d0d7de] bg-[#f6f8fa] px-2.5 py-1.5 text-xs focus:outline-none dark:border-[#30363d] dark:bg-[#0d1117]"
            >
              <option value="">All Roles</option>
              <option value="firewall">Firewall</option>
              <option value="router">Router</option>
              <option value="core">Core</option>
              <option value="distribution">Distribution</option>
              <option value="access">Access</option>
              <option value="wireless">Wireless AP</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => void loadDevices()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded border border-[#d0d7de] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[#f6f8fa] disabled:opacity-50 dark:border-[#30363d] dark:bg-[#0d1117] dark:hover:bg-[#21262d]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>

        {error && (
          <div className="rounded border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded border border-[#d0d7de] bg-white dark:border-[#30363d] dark:bg-[#161b22]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#d0d7de] bg-[#f6f8fa] text-[11px] uppercase tracking-wider text-[#57606a] dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#8b949e]">
                <tr>
                  <th className="px-3.5 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleSort("hostname")}
                      className="inline-flex items-center gap-1"
                    >
                      Device <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3.5 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleSort("ip")}
                      className="inline-flex items-center gap-1"
                    >
                      Management IP <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3.5 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleSort("role")}
                      className="inline-flex items-center gap-1"
                    >
                      Role <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3.5 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleSort("vendor")}
                      className="inline-flex items-center gap-1"
                    >
                      Platform <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3.5 py-2.5">OS / Serial</th>
                  <th className="px-3.5 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleSort("active_port_count")}
                      className="inline-flex items-center gap-1"
                    >
                      Ports <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3.5 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleSort("endpoint_count")}
                      className="inline-flex items-center gap-1"
                    >
                      Endpoints <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3.5 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d0d7de] dark:divide-[#30363d]">
                {filteredDevices.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-[#57606a]">
                      No devices found in this site.
                    </td>
                  </tr>
                ) : (
                  filteredDevices.map((device) => {
                    const roleMeta = getRoleMeta(device.role);
                    return (
                      <tr
                        key={device.ip}
                        onClick={() => onSelectDevice(device.ip)}
                        className="cursor-pointer hover:bg-[#f6f8fa] dark:hover:bg-[#0d1117]/60"
                      >
                        <td className="px-3.5 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <NetworkIcon
                              role={device.role}
                              className={`h-6 w-6 shrink-0 ${roleMeta.iconColor}`}
                            />
                            <div>
                              <div className="font-semibold">{device.hostname}</div>
                              {device.location && (
                                <div className="text-[11px] text-[#57606a] dark:text-[#8b949e]">
                                  {device.location}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="px-3.5 py-2.5 font-mono font-medium">
                          {device.ip}
                        </td>

                        <td className="px-3.5 py-2.5">
                          <span
                            className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${roleMeta.badgeClass}`}
                          >
                            {roleMeta.label}
                          </span>
                        </td>

                        <td className="px-3.5 py-2.5">
                          <div className="font-medium">{device.vendor ?? "—"}</div>
                          <div className="font-mono text-[11px] text-[#57606a] dark:text-[#8b949e]">
                            {device.model ?? "—"}
                          </div>
                        </td>

                        <td className="px-3.5 py-2.5 font-mono text-[11px]">
                          <div>
                            {[device.os, device.os_ver].filter(Boolean).join(" ") || "—"}
                          </div>
                          <div className="text-[#57606a] dark:text-[#8b949e]">
                            {device.serial ?? "—"}
                          </div>
                        </td>

                        <td className="px-3.5 py-2.5 font-mono">
                          <span className="font-semibold text-[#1a7f37] dark:text-[#3fb950]">
                            {device.active_port_count}
                          </span>
                          <span className="text-[#57606a]">/{device.port_count}</span>
                        </td>

                        <td className="px-3.5 py-2.5 font-mono font-medium text-[#0969da] dark:text-[#58a6ff]">
                          {device.endpoint_count}
                        </td>

                        <td
                          className="px-3.5 py-2.5 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => onLocateOnMap(device.ip)}
                            className="inline-flex items-center gap-1 rounded border border-[#d0d7de] bg-white px-2 py-1 text-[11px] font-medium hover:bg-[#f6f8fa] dark:border-[#30363d] dark:bg-[#0d1117] dark:hover:bg-[#21262d]"
                          >
                            <LocateFixed className="h-3 w-3 text-[#0969da]" />
                            <span>Map</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
