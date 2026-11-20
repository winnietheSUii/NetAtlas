import {
  ArrowRight,
  Cable,
  Layers,
  Laptop,
  Radar,
  Server,
} from "lucide-react";
import { useEffect, useState } from "react";
import { fetchScanJobs } from "../api/client";
import type { ActiveTab } from "../components/layout/AppShell";
import type {
  DeviceRole,
  ScanJob,
  TopologyResponse,
  VlanSummary,
} from "../types/network";
import { getRoleMeta } from "../utils/roleStyles";

interface OverviewPageProps {
  topology: TopologyResponse | null;
  vlans: VlanSummary[];
  onNavigate: (tab: ActiveTab) => void;
}

export function OverviewPage({ topology, vlans, onNavigate }: OverviewPageProps) {
  const [recentJobs, setRecentJobs] = useState<ScanJob[]>([]);

  useEffect(() => {
    void fetchScanJobs(8)
      .then((res) => setRecentJobs(res.jobs))
      .catch(() => setRecentJobs([]));
  }, [topology]);

  const summary = topology?.summary;
  const roles = Object.entries(summary?.roles ?? {});
  const vendors = Object.entries(summary?.vendors ?? {});

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <button
            type="button"
            onClick={() => onNavigate("devices")}
            className="rounded border border-[#d0d7de] bg-white p-4 text-left transition hover:border-[#0969da] dark:border-[#30363d] dark:bg-[#161b22]"
          >
            <div className="flex items-center justify-between text-xs text-[#57606a] dark:text-[#8b949e]">
              <span>Managed Devices</span>
              <Server className="h-4 w-4 text-[#0969da]" />
            </div>
            <div className="mt-1.5 font-mono text-2xl font-semibold">
              {summary?.managed_devices ?? 0}
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate("topology")}
            className="rounded border border-[#d0d7de] bg-white p-4 text-left transition hover:border-[#0969da] dark:border-[#30363d] dark:bg-[#161b22]"
          >
            <div className="flex items-center justify-between text-xs text-[#57606a] dark:text-[#8b949e]">
              <span>CDP/LLDP Links</span>
              <Cable className="h-4 w-4 text-[#0969da]" />
            </div>
            <div className="mt-1.5 font-mono text-2xl font-semibold">
              {summary?.total_links ?? 0}
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate("endpoints")}
            className="rounded border border-[#d0d7de] bg-white p-4 text-left transition hover:border-[#0969da] dark:border-[#30363d] dark:bg-[#161b22]"
          >
            <div className="flex items-center justify-between text-xs text-[#57606a] dark:text-[#8b949e]">
              <span>Active Endpoints</span>
              <Laptop className="h-4 w-4 text-[#0969da]" />
            </div>
            <div className="mt-1.5 font-mono text-2xl font-semibold">
              {summary?.total_endpoints ?? 0}
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate("vlans")}
            className="rounded border border-[#d0d7de] bg-white p-4 text-left transition hover:border-[#0969da] dark:border-[#30363d] dark:bg-[#161b22]"
          >
            <div className="flex items-center justify-between text-xs text-[#57606a] dark:text-[#8b949e]">
              <span>Discovered VLANs</span>
              <Layers className="h-4 w-4 text-[#0969da]" />
            </div>
            <div className="mt-1.5 font-mono text-2xl font-semibold">
              {vlans.length}
            </div>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded border border-[#d0d7de] bg-white dark:border-[#30363d] dark:bg-[#161b22]">
            <div className="flex items-center justify-between border-b border-[#d0d7de] px-4 py-2.5 dark:border-[#30363d]">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#57606a] dark:text-[#8b949e]">
                Infrastructure by Role
              </h2>
              <button
                type="button"
                onClick={() => onNavigate("topology")}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#0969da] hover:underline dark:text-[#58a6ff]"
              >
                Open Map <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <div className="divide-y divide-[#d0d7de] text-xs dark:divide-[#30363d]">
              {roles.length === 0 ? (
                <div className="p-4 text-center text-[#57606a]">
                  No devices discovered yet. Run a scan from Discovery.
                </div>
              ) : (
                roles.map(([role, count]) => {
                  const meta = getRoleMeta(role as DeviceRole);
                  return (
                    <div
                      key={role}
                      className="flex items-center justify-between px-4 py-2"
                    >
                      <span
                        className={`rounded border px-2 py-0.5 text-[11px] font-medium ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                      <span className="font-mono font-semibold">{count}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded border border-[#d0d7de] bg-white dark:border-[#30363d] dark:bg-[#161b22]">
            <div className="flex items-center justify-between border-b border-[#d0d7de] px-4 py-2.5 dark:border-[#30363d]">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#57606a] dark:text-[#8b949e]">
                Vendor Breakdown
              </h2>
              <button
                type="button"
                onClick={() => onNavigate("devices")}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#0969da] hover:underline dark:text-[#58a6ff]"
              >
                View Devices <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <div className="divide-y divide-[#d0d7de] text-xs dark:divide-[#30363d]">
              {vendors.length === 0 ? (
                <div className="p-4 text-center text-[#57606a]">
                  No vendor telemetry yet.
                </div>
              ) : (
                vendors.map(([vendor, count]) => (
                  <div
                    key={vendor}
                    className="flex items-center justify-between px-4 py-2"
                  >
                    <span className="font-medium">{vendor}</span>
                    <span className="font-mono font-semibold">{count}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="rounded border border-[#d0d7de] bg-white dark:border-[#30363d] dark:bg-[#161b22]">
          <div className="flex items-center justify-between border-b border-[#d0d7de] px-4 py-2.5 dark:border-[#30363d]">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#57606a] dark:text-[#8b949e]">
              <Radar className="h-3.5 w-3.5" />
              <span>Recent Discovery Jobs</span>
            </div>
            <button
              type="button"
              onClick={() => onNavigate("discovery")}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#0969da] hover:underline dark:text-[#58a6ff]"
            >
              Manage Scans <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#d0d7de] bg-[#f6f8fa] text-[11px] uppercase tracking-wider text-[#57606a] dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#8b949e]">
                <tr>
                  <th className="px-4 py-2">Job</th>
                  <th className="px-4 py-2">Target IP</th>
                  <th className="px-4 py-2">Action</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d0d7de] dark:divide-[#30363d]">
                {recentJobs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-[#57606a]">
                      No discovery jobs queued yet.
                    </td>
                  </tr>
                ) : (
                  recentJobs.map((job) => (
                    <tr key={job.job_id}>
                      <td className="px-4 py-2 font-mono text-[#57606a]">
                        #{job.job_id}
                      </td>
                      <td className="px-4 py-2 font-mono font-medium">
                        {job.device ?? "global"}
                      </td>
                      <td className="px-4 py-2 font-mono">{job.action}</td>
                      <td className="px-4 py-2">
                        <span className="rounded border border-[#d0d7de] px-1.5 py-0.5 font-mono text-[10px] uppercase dark:border-[#30363d]">
                          {job.status}
                        </span>
                      </td>
                      <td className="max-w-md truncate px-4 py-2 text-[#57606a] dark:text-[#8b949e]">
                        {job.log ?? "—"}
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
