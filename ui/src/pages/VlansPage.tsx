import { RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { VlanSummary } from "../types/network";

interface VlansPageProps {
  vlans: VlanSummary[];
  loading: boolean;
  onRefresh: () => void;
  onSelectDevice: (ip: string) => void;
}

export function VlansPage({
  vlans,
  loading,
  onRefresh,
  onSelectDevice,
}: VlansPageProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vlans;
    return vlans.filter(
      (v) =>
        String(v.vlan).includes(q) ||
        v.switches.some(
          (sw) =>
            sw.hostname.toLowerCase().includes(q) || sw.ip.toLowerCase().includes(q)
        )
    );
  }, [vlans, search]);

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[#d0d7de] bg-white p-3 dark:border-[#30363d] dark:bg-[#161b22]">
          <div className="flex min-w-[240px] max-w-md flex-1 items-center gap-2 rounded border border-[#d0d7de] bg-[#f6f8fa] px-2.5 py-1.5 dark:border-[#30363d] dark:bg-[#0d1117]">
            <Search className="h-3.5 w-3.5 text-[#57606a]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter VLAN ID or switch hostname/IP..."
              className="w-full bg-transparent text-xs focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 rounded border border-[#d0d7de] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[#f6f8fa] disabled:opacity-50 dark:border-[#30363d] dark:bg-[#0d1117] dark:hover:bg-[#21262d]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="overflow-hidden rounded border border-[#d0d7de] bg-white dark:border-[#30363d] dark:bg-[#161b22]">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#d0d7de] bg-[#f6f8fa] text-[11px] uppercase tracking-wider text-[#57606a] dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#8b949e]">
              <tr>
                <th className="px-4 py-2.5">VLAN ID</th>
                <th className="px-4 py-2.5">Switches</th>
                <th className="px-4 py-2.5">Total Ports</th>
                <th className="px-4 py-2.5">Native / Access Ports</th>
                <th className="px-4 py-2.5">Switch Distribution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d0d7de] dark:divide-[#30363d]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[#57606a]">
                    No VLAN memberships recorded.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr
                    key={item.vlan}
                    className="hover:bg-[#f6f8fa] dark:hover:bg-[#0d1117]/60"
                  >
                    <td className="px-4 py-2.5 font-mono font-semibold text-[#0969da] dark:text-[#58a6ff]">
                      VLAN {item.vlan}
                    </td>
                    <td className="px-4 py-2.5 font-mono">{item.switch_count}</td>
                    <td className="px-4 py-2.5 font-mono">{item.port_count}</td>
                    <td className="px-4 py-2.5 font-mono">{item.native_port_count}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {item.switches.map((sw) => (
                          <button
                            key={`${item.vlan}-${sw.ip}`}
                            type="button"
                            onClick={() => onSelectDevice(sw.ip)}
                            className="rounded border border-[#d0d7de] bg-[#f6f8fa] px-2 py-0.5 font-mono text-[11px] hover:border-[#0969da] hover:text-[#0969da] dark:border-[#30363d] dark:bg-[#0d1117] dark:hover:border-[#58a6ff] dark:hover:text-[#58a6ff]"
                          >
                            {sw.hostname} ({sw.port_count})
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
