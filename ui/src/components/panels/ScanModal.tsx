import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Radar,
  RefreshCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { fetchScanJobs, triggerScan } from "../../api/client";
import type { ScanAction, ScanJob } from "../../types/network";

interface ScanModalProps {
  open: boolean;
  mode: "mock" | "live";
  onClose: () => void;
  onScanQueued?: () => void;
}

const ALL_ACTIONS: Array<{ key: ScanAction; label: string; desc: string }> = [
  { key: "discover", label: "discover", desc: "SNMP device, ports & CDP/LLDP" },
  { key: "macsuck", label: "macsuck", desc: "Switch MAC/FDB tables" },
  { key: "arpnip", label: "arpnip", desc: "Router/SVI ARP IP bindings" },
];

const IPV4_OR_V6_RE =
  /^(?:(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]+:[0-9a-fA-F:]+)$/;

function isValidIpFormat(value: string): boolean {
  const trimmed = value.trim();
  if (!IPV4_OR_V6_RE.test(trimmed)) return false;
  if (trimmed.includes(".")) {
    const octets = trimmed.split(".");
    if (octets.length !== 4) return false;
    return octets.every((o) => {
      const n = Number(o);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });
  }
  return true;
}

function StatusBadge({ status }: { status: string }) {
  const norm = status.toLowerCase();
  if (norm === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        done
      </span>
    );
  }
  if (norm === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
        <Loader2 className="h-3 w-3 animate-spin" />
        running
      </span>
    );
  }
  if (norm === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
        <AlertCircle className="h-3 w-3" />
        error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
      <Clock className="h-3 w-3" />
      {status}
    </span>
  );
}

export function ScanModal({ open, mode, onClose, onScanQueued }: ScanModalProps) {
  const [targetIp, setTargetIp] = useState("10.10.0.1");
  const [actions, setActions] = useState<ScanAction[]>(["discover", "macsuck", "arpnip"]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const resp = await fetchScanJobs(25);
      setJobs(resp.jobs);
    } catch {
      // Keep previous list if transient error
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setFeedback(null);
    void loadJobs();
    const timer = window.setInterval(() => {
      void loadJobs();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [open, loadJobs]);

  if (!open) return null;

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
      onScanQueued?.();
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
              <Radar className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Network Discovery Scan
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Seed a Core Switch IP to enqueue jobs in Netdisco&apos;s{" "}
                <code className="font-mono">admin</code> queue ({mode.toUpperCase()} mode).
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 border-b border-slate-200 p-6 dark:border-slate-800">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Seed Core Switch / Router IP
              </label>
              <input
                type="text"
                value={targetIp}
                onChange={(e) => setTargetIp(e.target.value)}
                placeholder="e.g. 10.10.0.1"
                className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-sky-600/25 transition hover:bg-sky-500 disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Radar className="h-4 w-4" />
                )}
                <span>Start Discovery</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {ALL_ACTIONS.map((item) => {
              const checked = actions.includes(item.key);
              return (
                <label
                  key={item.key}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 text-xs transition ${
                    checked
                      ? "border-sky-500/50 bg-sky-500/10"
                      : "border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/40"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleAction(item.key)}
                    className="mt-0.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <div>
                    <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {item.label}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {item.desc}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {feedback && (
            <div
              className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
                feedback.type === "ok"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
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

        <div className="flex flex-1 flex-col overflow-hidden p-6 pt-4">
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Recent Netdisco Jobs ({jobs.length})
            </h3>
            <button
              type="button"
              onClick={() => void loadJobs()}
              disabled={loadingJobs}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`h-3 w-3 ${loadingJobs ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2">Job</th>
                  <th className="px-3 py-2">Device</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Log / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                      No jobs in queue yet. Enter a seed switch IP above to start discovery.
                    </td>
                  </tr>
                ) : (
                  jobs.map((job) => (
                    <tr
                      key={job.job_id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-3 py-2 font-mono text-slate-500">
                        #{job.job_id}
                      </td>
                      <td className="px-3 py-2 font-mono font-medium text-slate-900 dark:text-slate-100">
                        {job.device ?? "global"}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300">
                        {job.action}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={job.status} />
                      </td>
                      <td className="max-w-xs truncate px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">
                        {job.log ?? (job.entered ? new Date(job.entered).toLocaleTimeString() : "—")}
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
