import { Check, Copy, Cpu, Plus, RefreshCw, Server } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createSite,
  fetchAgents,
  registerAgent,
} from "../api/client";
import type {
  AgentRegisterResponse,
  AgentSummary,
  SiteSummary,
} from "../types/network";

interface AgentsPageProps {
  sites: SiteSummary[];
  onRefreshSites: () => Promise<void>;
  onSelectSite: (siteId: string) => void;
}

export function AgentsPage({
  sites,
  onRefreshSites,
  onSelectSite,
}: AgentsPageProps) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [siteIdInput, setSiteIdInput] = useState("");
  const [siteNameInput, setSiteNameInput] = useState("");
  const [siteDescInput, setSiteDescInput] = useState("");
  const [creatingSite, setCreatingSite] = useState(false);

  const [agentSiteId, setAgentSiteId] = useState("local");
  const [agentNameInput, setAgentNameInput] = useState("");
  const [registeringAgent, setRegisteringAgent] = useState(false);
  const [issuedCreds, setIssuedCreds] = useState<AgentRegisterResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchAgents();
      setAgents(resp.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    const remote = sites.find((s) => !s.is_local);
    if (remote && agentSiteId === "local") {
      setAgentSiteId(remote.site_id);
    }
  }, [sites, agentSiteId]);

  const handleCreateSite = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreatingSite(true);
    try {
      const created = await createSite({
        site_id: siteIdInput.trim().toLowerCase(),
        name: siteNameInput.trim(),
        description: siteDescInput.trim() || undefined,
      });
      setSiteIdInput("");
      setSiteNameInput("");
      setSiteDescInput("");
      setAgentSiteId(created.site_id);
      await onRefreshSites();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create site");
    } finally {
      setCreatingSite(false);
    }
  };

  const handleRegisterAgent = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setRegisteringAgent(true);
    try {
      const res = await registerAgent({
        site_id: agentSiteId,
        name: agentNameInput.trim(),
      });
      setIssuedCreds(res);
      setAgentNameInput("");
      await Promise.all([loadAgents(), onRefreshSites()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register agent");
    } finally {
      setRegisteringAgent(false);
    }
  };

  const copyEnvSnippet = async () => {
    if (!issuedCreds) return;
    const text = [
      `CENTRAL_URL=https://YOUR_CENTRAL_NETATLAS_HOST`,
      `SITE_ID=${issuedCreds.agent.site_id}`,
      `AGENT_ID=${issuedCreds.agent.agent_id}`,
      `AGENT_TOKEN=${issuedCreds.token}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-7xl space-y-5">
        {error && (
          <div className="rounded border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <form
            onSubmit={(e) => void handleCreateSite(e)}
            className="space-y-3 rounded border border-[#d0d7de] bg-white p-4 dark:border-[#30363d] dark:bg-[#161b22]"
          >
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#57606a] dark:text-[#8b949e]">
              <Server className="h-3.5 w-3.5" />
              <span>1. Add Remote Site</span>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <input
                type="text"
                required
                value={siteIdInput}
                onChange={(e) => setSiteIdInput(e.target.value)}
                placeholder="Site slug (e.g. branch-bkk)"
                className="rounded border border-[#d0d7de] bg-[#f6f8fa] px-2.5 py-1.5 font-mono text-xs focus:border-[#0969da] focus:outline-none dark:border-[#30363d] dark:bg-[#0d1117]"
              />
              <input
                type="text"
                required
                value={siteNameInput}
                onChange={(e) => setSiteNameInput(e.target.value)}
                placeholder="Display Name (e.g. Bangkok Office)"
                className="rounded border border-[#d0d7de] bg-[#f6f8fa] px-2.5 py-1.5 text-xs focus:border-[#0969da] focus:outline-none dark:border-[#30363d] dark:bg-[#0d1117]"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={siteDescInput}
                onChange={(e) => setSiteDescInput(e.target.value)}
                placeholder="Optional description or subnet notes"
                className="flex-1 rounded border border-[#d0d7de] bg-[#f6f8fa] px-2.5 py-1.5 text-xs focus:border-[#0969da] focus:outline-none dark:border-[#30363d] dark:bg-[#0d1117]"
              />
              <button
                type="submit"
                disabled={creatingSite}
                className="inline-flex items-center gap-1 rounded border border-[#d0d7de] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[#f6f8fa] dark:border-[#30363d] dark:bg-[#0d1117] dark:hover:bg-[#21262d]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Create Site</span>
              </button>
            </div>
          </form>

          <form
            onSubmit={(e) => void handleRegisterAgent(e)}
            className="space-y-3 rounded border border-[#d0d7de] bg-white p-4 dark:border-[#30363d] dark:bg-[#161b22]"
          >
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#57606a] dark:text-[#8b949e]">
              <Cpu className="h-3.5 w-3.5" />
              <span>2. Register Site Collector Agent</span>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <select
                value={agentSiteId}
                onChange={(e) => setAgentSiteId(e.target.value)}
                className="rounded border border-[#d0d7de] bg-[#f6f8fa] px-2.5 py-1.5 text-xs focus:outline-none dark:border-[#30363d] dark:bg-[#0d1117]"
              >
                {sites.map((s) => (
                  <option key={s.site_id} value={s.site_id}>
                    {s.name} ({s.site_id})
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                value={agentNameInput}
                onChange={(e) => setAgentNameInput(e.target.value)}
                placeholder="Agent Name (e.g. bkk-probe-01)"
                className="rounded border border-[#d0d7de] bg-[#f6f8fa] px-2.5 py-1.5 text-xs focus:border-[#0969da] focus:outline-none dark:border-[#30363d] dark:bg-[#0d1117]"
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] text-[#57606a] dark:text-[#8b949e]">
              <span>
                Agents push outbound HTTPS snapshots to <code>/api/v1/ingest</code>.
              </span>
              <button
                type="submit"
                disabled={registeringAgent}
                className="inline-flex items-center gap-1 rounded border border-[#0969da] bg-[#0969da] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0550ae]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Issue Token</span>
              </button>
            </div>
          </form>
        </div>

        {issuedCreds && (
          <div className="rounded border border-[#0969da]/50 bg-[#ddf4ff]/50 p-4 text-xs dark:border-[#58a6ff]/40 dark:bg-[#1f6feb]/15">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-[#0969da] dark:text-[#58a6ff]">
                Agent Token Issued (save now — shown once): {issuedCreds.agent.agent_id}
              </div>
              <button
                type="button"
                onClick={() => void copyEnvSnippet()}
                className="inline-flex items-center gap-1 rounded border border-[#d0d7de] bg-white px-2.5 py-1 text-[11px] font-medium dark:border-[#30363d] dark:bg-[#161b22]"
              >
                {copied ? <Check className="h-3 w-3 text-[#1a7f37]" /> : <Copy className="h-3 w-3" />}
                <span>{copied ? "Copied" : "Copy Env"}</span>
              </button>
            </div>
            <pre className="mt-2 overflow-x-auto rounded border border-[#d0d7de] bg-white p-2.5 font-mono text-[11px] dark:border-[#30363d] dark:bg-[#0d1117]">
{`# Run on remote site using agent/compose.agent.yaml:
CENTRAL_URL=https://YOUR_CENTRAL_NETATLAS_HOST
SITE_ID=${issuedCreds.agent.site_id}
AGENT_ID=${issuedCreds.agent.agent_id}
AGENT_TOKEN=${issuedCreds.token}`}
            </pre>
          </div>
        )}

        <div className="rounded border border-[#d0d7de] bg-white dark:border-[#30363d] dark:bg-[#161b22]">
          <div className="flex items-center justify-between border-b border-[#d0d7de] px-4 py-2.5 dark:border-[#30363d]">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#57606a] dark:text-[#8b949e]">
              Registered Collectors &amp; Sites ({agents.length})
            </h3>
            <button
              type="button"
              onClick={() => {
                void loadAgents();
                void onRefreshSites();
              }}
              disabled={loading}
              className="flex items-center gap-1 rounded border border-[#d0d7de] bg-white px-2.5 py-1 text-xs hover:bg-[#f6f8fa] dark:border-[#30363d] dark:bg-[#0d1117]"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#d0d7de] bg-[#f6f8fa] text-[11px] uppercase tracking-wider text-[#57606a] dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#8b949e]">
                <tr>
                  <th className="px-4 py-2.5">Agent ID</th>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Site</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Devices / Links</th>
                  <th className="px-4 py-2.5">Last Sync</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d0d7de] dark:divide-[#30363d]">
                {agents.map((ag) => (
                  <tr key={ag.agent_id}>
                    <td className="px-4 py-2.5 font-mono text-[11px]">
                      {ag.agent_id}
                    </td>
                    <td className="px-4 py-2.5 font-medium">{ag.name}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{ag.site_name ?? ag.site_id}</span>
                      <span className="ml-1.5 font-mono text-[11px] text-[#57606a]">
                        ({ag.site_id})
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          ag.status === "online"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "border-[#d0d7de] bg-[#f6f8fa] text-[#57606a] dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#8b949e]"
                        }`}
                      >
                        {ag.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono">
                      {ag.device_count} / {ag.link_count}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-[#57606a] dark:text-[#8b949e]">
                      {ag.last_seen ? new Date(ag.last_seen).toLocaleString() : "Awaiting sync"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => onSelectSite(ag.site_id)}
                        className="rounded border border-[#d0d7de] bg-white px-2.5 py-1 text-[11px] font-medium hover:bg-[#f6f8fa] dark:border-[#30363d] dark:bg-[#0d1117]"
                      >
                        View Site
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
