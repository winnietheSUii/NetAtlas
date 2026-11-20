import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Database,
  Layers,
  LayoutDashboard,
  Moon,
  Network,
  Radar,
  Server,
  Sun,
  Waypoints,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ThemeMode } from "../../hooks/useTheme";
import type { HealthResponse, SiteSummary } from "../../types/network";

export type ActiveTab =
  | "overview"
  | "topology"
  | "devices"
  | "endpoints"
  | "vlans"
  | "discovery"
  | "agents";

interface AppShellProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  sites: SiteSummary[];
  activeSiteId: string;
  onSiteChange: (siteId: string) => void;
  health: HealthResponse | null;
  theme: ThemeMode;
  onToggleTheme: () => void;
  children: ReactNode;
}

const NAV_GROUPS: Array<{
  title: string;
  items: Array<{ key: ActiveTab; label: string; Icon: typeof Network }>;
}> = [
  {
    title: "Monitor",
    items: [
      { key: "overview", label: "Overview", Icon: LayoutDashboard },
      { key: "topology", label: "Topology", Icon: Network },
      { key: "devices", label: "Devices", Icon: Server },
      { key: "endpoints", label: "Endpoints", Icon: Waypoints },
      { key: "vlans", label: "VLANs", Icon: Layers },
    ],
  },
  {
    title: "Operations",
    items: [
      { key: "discovery", label: "Discovery", Icon: Radar },
      { key: "agents", label: "Sites & Agents", Icon: Cpu },
    ],
  },
];

const TAB_TITLES: Record<ActiveTab, string> = {
  overview: "Site Overview",
  topology: "Network Topology",
  devices: "Device Inventory",
  endpoints: "Endpoints & ARP Bindings",
  vlans: "VLAN Directory",
  discovery: "Discovery & Job Queue",
  agents: "Sites & Collector Agents",
};

export function AppShell({
  activeTab,
  onTabChange,
  sites,
  activeSiteId,
  onSiteChange,
  health,
  theme,
  onToggleTheme,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isMock = health?.mode === "mock";
  const isHealthy = health?.status === "ok";
  const currentSite = sites.find((s) => s.site_id === activeSiteId);

  return (
    <div className="flex h-screen overflow-hidden bg-[#f6f8fa] text-[#1f2328] dark:bg-[#0d1117] dark:text-[#e6edf3]">
      <aside
        className={`flex shrink-0 flex-col border-r border-[#d0d7de] bg-white transition-all duration-150 dark:border-[#30363d] dark:bg-[#161b22] ${
          collapsed ? "w-14" : "w-56"
        }`}
      >
        <div className="flex h-12 items-center justify-between border-b border-[#d0d7de] px-3 dark:border-[#30363d]">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[#0969da] bg-[#0969da] text-white">
              <Network className="h-4 w-4" />
            </div>
            {!collapsed && (
              <div className="min-w-0 leading-tight">
                <div className="truncate text-sm font-semibold tracking-tight">
                  NetAtlas
                </div>
                <div className="font-mono text-[10px] text-[#57606a] dark:text-[#8b949e]">
                  NMS v{health?.version ?? "0.1.0"}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            className="rounded p-1 text-[#57606a] hover:bg-[#f6f8fa] hover:text-[#1f2328] dark:text-[#8b949e] dark:hover:bg-[#21262d] dark:hover:text-[#e6edf3]"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        {!collapsed && (
          <div className="border-b border-[#d0d7de] p-2.5 dark:border-[#30363d]">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#57606a] dark:text-[#8b949e]">
              Active Site
            </label>
            <select
              value={activeSiteId}
              onChange={(e) => onSiteChange(e.target.value)}
              className="w-full rounded border border-[#d0d7de] bg-[#f6f8fa] px-2 py-1.5 text-xs font-medium text-[#1f2328] focus:border-[#0969da] focus:outline-none dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#e6edf3]"
            >
              {sites.length === 0 ? (
                <option value="local">Local Site</option>
              ) : (
                sites.map((s) => (
                  <option key={s.site_id} value={s.site_id}>
                    {s.name} ({s.device_count})
                  </option>
                ))
              )}
            </select>
          </div>
        )}

        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              {!collapsed && (
                <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-[#57606a] dark:text-[#8b949e]">
                  {group.title}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map(({ key, label, Icon }) => {
                  const active = activeTab === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onTabChange(key)}
                      title={collapsed ? label : undefined}
                      className={`flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-xs font-medium transition ${
                        active
                          ? "bg-[#ddf4ff] text-[#0969da] dark:bg-[#1f6feb]/20 dark:text-[#58a6ff]"
                          : "text-[#57606a] hover:bg-[#f6f8fa] hover:text-[#1f2328] dark:text-[#8b949e] dark:hover:bg-[#21262d] dark:hover:text-[#e6edf3]"
                      } ${collapsed ? "justify-center px-0" : ""}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="truncate">{label}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[#d0d7de] p-2 dark:border-[#30363d]">
          <button
            type="button"
            onClick={onToggleTheme}
            className={`flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs font-medium text-[#57606a] hover:bg-[#f6f8fa] hover:text-[#1f2328] dark:text-[#8b949e] dark:hover:bg-[#21262d] dark:hover:text-[#e6edf3] ${
              collapsed ? "justify-center px-0" : ""
            }`}
            title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4 shrink-0" />
            ) : (
              <Moon className="h-4 w-4 shrink-0" />
            )}
            {!collapsed && (
              <span>{theme === "dark" ? "Light Theme" : "Dark Theme"}</span>
            )}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#d0d7de] bg-white px-4 dark:border-[#30363d] dark:bg-[#161b22]">
          <div className="flex items-center gap-2.5">
            <h1 className="text-sm font-semibold text-[#1f2328] dark:text-[#e6edf3]">
              {TAB_TITLES[activeTab]}
            </h1>
            <span className="rounded border border-[#d0d7de] bg-[#f6f8fa] px-2 py-0.5 font-mono text-[11px] text-[#57606a] dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#8b949e]">
              {currentSite?.name ?? activeSiteId}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            {health && (
              <div
                className={`hidden items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium sm:flex ${
                  isMock
                    ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                    : isHealthy
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                }`}
              >
                {isMock ? (
                  <Activity className="h-3 w-3" />
                ) : (
                  <Database className="h-3 w-3" />
                )}
                <span>
                  {isMock
                    ? "Mock Dataset"
                    : isHealthy
                    ? "Netdisco Connected"
                    : "DB Disconnected"}
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={() => onTabChange("discovery")}
              className="flex items-center gap-1.5 rounded border border-[#0969da] bg-[#0969da] px-3 py-1 text-xs font-medium text-white transition hover:bg-[#0550ae]"
            >
              <Radar className="h-3.5 w-3.5" />
              <span>Discover</span>
            </button>
          </div>
        </header>

        <main className="relative flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
