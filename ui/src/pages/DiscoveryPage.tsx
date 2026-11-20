import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Radar,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchScanJobs, triggerScan } from "../api/client";
import type { ScanAction, ScanJob } from "../types/network";

interface DiscoveryPageProps {
  mode: "mock" | "live";
  activeSiteId: string;
  onScanQueued: () => void;
}

const ALL_ACTIONS: Array<{ key: ScanAction; label: string; desc: string }> = [
  { key: "discover", label: "discover", desc: "SNMP device, interfaces & CDP/LLDP" },
  { key: "macsuck", label: "macsuck", desc: "Switch CAM/FDB MAC table" },
  { key: "arpnip", label: "arpnip", desc: "L3 router/SVI ARP IP bindings" },
];

const IPV4_OR_V6_RE =
  /^(?:(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]+:[0-9a-fA-F:]+)$/;

function isValidIpFormat(value: string): boolean {
  const trimmed = value.trim();
  if (!IPV4_OR_V6_RE.test(trimmed)) return false;
  if (trimmed.includes(".")) {
    const octets = trimmed.split(".");
    return (
      octets.length === 4 &&
      octets.every((o) => {
        const n = Number(o);
        return Number.isInteger(n) && n >= 0 && n <= 255;
      })
    );
  }
  return true;
}

function JobStatusBadge({ status }: { status: string }) {
  const norm = status.toLowerCase();
  if (norm === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        done
      </span>
    );
  }
  if (norm === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
        <Loader2 className="h-3 w-3 animate-spin" />
        running
      </span>
    );
  }
  if (norm === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
        <AlertCircle className="h-3 w-3" />
        error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      <Clock className="h-3 w-3" />
      {status}
    </span>
  );
}

export function DiscoveryPage({
  mode,
  activeSiteId,
  onScanQueued,
}: DiscoveryPageProps) {
  const [targetIp, setTargetIp] = useState("10.10.0.1");
  const [actions, setActions] = useState<ScanAction[]>([
    "discover",
    "macsuck",
    "arpnip",
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loadingJobs, setLoadingJobs] = useState(false);

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const resp = await fetchScanJobs(100);
      setJobs(resp.jobs);
    } catch {
      // Keep prior jobs if transient error
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
    const timer = window.setInterval(() => {
      void loadJobs();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [loadJobs]);

  const filteredJobs = useMemo(() => {
    if (statusFilter === "all") return jobs;
    return jobs.filter((j) => j.status.toLowerCase() === statusFilter);
  }, [jobs, statusFilter]);

  const toggleAction = (key: ScanAction) => {
    setActions((prev) =>
      prev.includes(key) ? prev.filter((a) => a !== key) : [...prev, key]
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!isValidIpFormat(targetIp)) {
      setFeedback({ type: "err", text: "Enter a valid IPv4 or IPv6 management IP." });
      return;
    }
    if (actions.length === 0) {
      setFeedback({ type: "err", text: "Select at least one discovery action." });
      return;
    }

    setSubmitting(true);
    try {
      const resp = await triggerScan({
        target_ip: targetIp.trim(),
        actions,
      });
      setFeedback({ type: "ok", text: resp.message });
      await loadJobs();
      onScanQueued();
    } catch (err) {
      setFeedback({
        type: "err",
        text: err instanceof Error ? err.message : "Failed to queue scan job",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-7xl space-y-5">
        {activeSiteId !== "local" && (
          <div className="rounded border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Note: On-demand SNMP scans execute on the <strong>Local Site</strong> Netdisco engine. Remote site <code>{activeSiteId}</code> receives scheduled snapshots from its deployed Agent collector.
          </div>
        )}

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-4 rounded border border-[#d0d7de] bg-white p-5 dark:border-[#30363d] dark:bg-[#161b22]"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Seed Network Discovery</h2>
              <p className="text-xs text-[#57606a] dark:text-[#8b949e]">
                Enter any reachable Switch, Router, or Firewall IP ({mode.toUpperCase()} mode). Netdisco will crawl CDP/LLDP neighbors automatically and infer topology hierarchy by graph centrality.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-[#57606a] dark:text-[#8b949e]">
                Target Seed IP Address
              </label>
              <input
                type="text"
                value={targetIp}
                onChange={(e) => setTargetIp(e.target.value)}
                placeholder="e.g. 10.10.0.1"
                className="mt-1 w-full rounded border border-[#d0d7de] bg-[#f6f8fa] px-3 py-2 font-mono text-xs focus:border-[#0969da] focus:outline-none dark:border-[#30363d] dark:bg-[#0d1117]"
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-1.5 rounded border border-[#0969da] bg-[#0969da] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0550ae] disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Radar className="h-3.5 w-3.5" />
                )}
                <span>Enqueue Scan</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {ALL_ACTIONS.map((item) => {
              const checked = actions.includes(item.key);
              return (
                <label
                  key={item.key}
                  className={`flex cursor-pointer items-start gap-2 rounded border p-2.5 text-xs ${
                    checked
                      ? "border-[#0969da] bg-[#ddf4ff]/60 dark:border-[#1f6feb] dark:bg-[#1f6feb]/15"
                      : "border-[#d0d7de] bg-[#f6f8fa] dark:border-[#30363d] dark:bg-[#0d1117]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleAction(item.key)}
                    className="mt-0.5 rounded border-[#d0d7de]"
                  />
                  <div>
                    <div className="font-mono font-semibold">{item.label}</div>
                    <div className="text-[11px] text-[#57606a] dark:text-[#8b949e]">
                      {item.desc}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {feedback && (
            <div
              className={`flex items-center gap-2 rounded border px-3 py-2 text-xs ${
                feedback.type === "ok"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
              }`}
            >
              {feedback.type === "ok" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}
        </form>

        <div className="rounded border border-[#d0d7de] bg-white dark:border-[#30363d] dark:bg-[#161b22]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#d0d7de] px-4 py-2.5 dark:border-[#30363d]">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#57606a] dark:text-[#8b949e]">
              Netdisco Admin Job Queue ({filteredJobs.length})
            </h3>
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded border border-[#d0d7de] bg-[#f6f8fa] px-2 py-1 text-xs focus:outline-none dark:border-[#30363d] dark:bg-[#0d1117]"
              >
                <option value="all">All Statuses</option>
                <option value="queued">Queued</option>
                <option value="running">Running</option>
                <option value="done">Done</option>
                <option value="error">Error</option>
              </select>

              <button
                type="button"
                onClick={() => void loadJobs()}
                disabled={loadingJobs}
                className="flex items-center gap-1 rounded border border-[#d0d7de] bg-white px-2.5 py-1 text-xs hover:bg-[#f6f8fa] dark:border-[#30363d] dark:bg-[#0d1117] dark:hover:bg-[#21262d]"
              >
                <RefreshCw className={`h-3 w-3 ${loadingJobs ? "animate-spin" : ""}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#d0d7de] bg-[#f6f8fa] text-[11px] uppercase tracking-wider text-[#57606a] dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#8b949e]">
                <tr>
                  <th className="px-3.5 py-2">Job</th>
                  <th className="px-3.5 py-2">Device</th>
                  <th className="px-3.5 py-2">Action</th>
                  <th className="px-3.5 py-2">Status</th>
                  <th className="px-3.5 py-2">Entered</th>
                  <th className="px-3.5 py-2">Log / Output</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d0d7de] dark:divide-[#30363d]">
                {filteredJobs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[#57606a]">
                      No jobs in queue.
                    </td>
                  </tr>
                ) : (
                  filteredJobs.map((job) => (
                    <tr key={job.job_id}>
                      <td className="px-3.5 py-2 font-mono text-[#57606a]">
                        #{job.job_id}
                      </td>
                      <td className="px-3.5 py-2 font-mono font-medium">
                        {job.device ?? "global"}
                      </td>
                      <td className="px-3.5 py-2 font-mono">{job.action}</td>
                      <td className="px-3.5 py-2">
                        <JobStatusBadge status={job.status} />
                      </td>
                      <td className="px-3.5 py-2 font-mono text-[11px] text-[#57606a] dark:text-[#8b949e]">
                        {job.entered ? new Date(job.entered).toLocaleTimeString() : "—"}
                      </td>
                      <td className="max-w-md truncate px-3.5 py-2 text-[11px] text-[#57606a] dark:text-[#8b949e]">
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
