import { LocateFixed, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchEndpoints } from "../api/client";
import type { EndpointRecord } from "../types/network";

interface EndpointsPageProps {
  siteId: string;
  refreshSignal: number;
  onSelectDevice: (ip: string) => void;
  onLocateOnMap: (ip: string) => void;
}

export function EndpointsPage({
  siteId,
  refreshSignal,
  onSelectDevice,
  onLocateOnMap,
}: EndpointsPageProps) {
  const [endpoints, setEndpoints] = useState<EndpointRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [vlanFilter, setVlanFilter] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchEndpoints({ siteId });
      setEndpoints(resp.endpoints);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load endpoints");
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    void loadData();
  }, [loadData, refreshSignal]);

  const vlanOptions = useMemo(() => {
    const unique = new Set(
      endpoints.map((e) => e.vlan).filter((v): v is string => Boolean(v))
    );
    return Array.from(unique).sort((a, b) => Number(a) - Number(b));
  }, [endpoints]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return endpoints.filter((ep) => {
      if (vlanFilter && (ep.vlan || "") !== vlanFilter) return false;
      if (!q) return true;
      return [
        ep.ip,
        ep.mac,
        ep.oui,
        ep.vlan,
        ep.switch_hostname,
        ep.switch_ip,
        ep.port,
      ]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    });
  }, [endpoints, search, vlanFilter]);

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[#d0d7de] bg-white p-3 dark:border-[#30363d] dark:bg-[#161b22]">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded border border-[#d0d7de] bg-[#f6f8fa] px-2.5 py-1.5 dark:border-[#30363d] dark:bg-[#0d1117]">
              <Search className="h-3.5 w-3.5 text-[#57606a]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Trace MAC, IP address, OUI vendor, switch, or port..."
                className="w-full bg-transparent text-xs focus:outline-none"
              />
            </div>

            <select
              value={vlanFilter}
              onChange={(e) => setVlanFilter(e.target.value)}
              className="rounded border border-[#d0d7de] bg-[#f6f8fa] px-2.5 py-1.5 text-xs focus:outline-none dark:border-[#30363d] dark:bg-[#0d1117]"
            >
              <option value="">All VLANs</option>
              {vlanOptions.map((v) => (
                <option key={v} value={v}>
                  VLAN {v}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 text-xs text-[#57606a] dark:text-[#8b949e]">
            <span>
              <strong className="font-mono text-[#1f2328] dark:text-[#e6edf3]">
                {filtered.length}
              </strong>{" "}
              active bindings
            </span>
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded border border-[#d0d7de] bg-white px-3 py-1.5 text-xs font-medium text-[#1f2328] hover:bg-[#f6f8fa] disabled:opacity-50 dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#e6edf3] dark:hover:bg-[#21262d]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>
          </div>
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
                  <th className="px-3.5 py-2.5">IP Address</th>
                  <th className="px-3.5 py-2.5">MAC Address</th>
                  <th className="px-3.5 py-2.5">OUI Vendor</th>
                  <th className="px-3.5 py-2.5">VLAN</th>
                  <th className="px-3.5 py-2.5">Connected Switch</th>
                  <th className="px-3.5 py-2.5">Switch Port</th>
                  <th className="px-3.5 py-2.5 text-right">Locate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d0d7de] dark:divide-[#30363d]">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[#57606a]">
                      No endpoint MAC/ARP records matched. Run macsuck &amp; arpnip to collect bindings.
                    </td>
                  </tr>
                ) : (
                  filtered.map((ep, idx) => (
                    <tr
                      key={`${ep.switch_ip}-${ep.port}-${ep.mac}-${ep.ip ?? idx}`}
                      className="hover:bg-[#f6f8fa] dark:hover:bg-[#0d1117]/60"
                    >
                      <td className="px-3.5 py-2.5 font-mono font-medium">
                        {ep.ip ?? "—"}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono">{ep.mac}</td>
                      <td className="px-3.5 py-2.5">{ep.oui ?? "Unknown"}</td>
                      <td className="px-3.5 py-2.5 font-mono">
                        {ep.vlan ? (
                          <span className="rounded border border-[#d0d7de] bg-[#f6f8fa] px-1.5 py-0.5 text-[11px] dark:border-[#30363d] dark:bg-[#0d1117]">
                            {ep.vlan}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <button
                          type="button"
                          onClick={() => onSelectDevice(ep.switch_ip)}
                          className="text-left font-medium text-[#0969da] hover:underline dark:text-[#58a6ff]"
                        >
                          {ep.switch_hostname}
                        </button>
                        <div className="font-mono text-[11px] text-[#57606a] dark:text-[#8b949e]">
                          {ep.switch_ip}
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5 font-mono font-semibold">
                        {ep.port}
                      </td>
                      <td className="px-3.5 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => onLocateOnMap(ep.switch_ip)}
                          className="inline-flex items-center gap-1 rounded border border-[#d0d7de] bg-white px-2 py-1 text-[11px] font-medium hover:bg-[#f6f8fa] dark:border-[#30363d] dark:bg-[#0d1117] dark:hover:bg-[#21262d]"
                        >
                          <LocateFixed className="h-3 w-3 text-[#0969da]" />
                          <span>Map</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
