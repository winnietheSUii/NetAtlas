import { useCallback, useEffect, useState } from "react";
import {
  fetchHealth,
  fetchSites,
  fetchTopology,
  fetchVlans,
  resetTopologyLayout,
  saveTopologyLayout,
} from "./api/client";
import { AppShell, type ActiveTab } from "./components/layout/AppShell";
import { DeviceDrawer } from "./components/panels/DeviceDrawer";
import { useTheme } from "./hooks/useTheme";
import { AgentsPage } from "./pages/AgentsPage";
import { DiscoveryPage } from "./pages/DiscoveryPage";
import { EndpointsPage } from "./pages/EndpointsPage";
import { InventoryPage } from "./pages/InventoryPage";
import { OverviewPage } from "./pages/OverviewPage";
import { TopologyPage } from "./pages/TopologyPage";
import { VlansPage } from "./pages/VlansPage";
import type {
  HealthResponse,
  NodePositionItem,
  SiteSummary,
  TopologyResponse,
  VlanSummary,
} from "./types/network";

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<ActiveTab>("topology");
  const [activeSiteId, setActiveSiteId] = useState<string>("local");
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [topology, setTopology] = useState<TopologyResponse | null>(null);
  const [vlans, setVlans] = useState<VlanSummary[]>([]);
  const [topoLoading, setTopoLoading] = useState(false);
  const [topoError, setTopoError] = useState<string | null>(null);
  const [selectedDeviceIp, setSelectedDeviceIp] = useState<string | null>(null);
  const [focusDeviceIp, setFocusDeviceIp] = useState<string | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const loadSites = useCallback(async () => {
    try {
      const resp = await fetchSites();
      setSites(resp.sites);
    } catch {
      // Keep previous site list
    }
  }, []);

  const loadSiteData = useCallback(async () => {
    setTopoLoading(true);
    setTopoError(null);
    try {
      const [healthData, topoData, vlanData, sitesData] = await Promise.all([
        fetchHealth(),
        fetchTopology(true, activeSiteId),
        fetchVlans(activeSiteId),
        fetchSites(),
      ]);
      setHealth(healthData);
      setTopology(topoData);
      setVlans(vlanData.vlans);
      setSites(sitesData.sites);
    } catch (err) {
      setTopoError(
        err instanceof Error ? err.message : "Failed to reach NetAtlas API"
      );
    } finally {
      setTopoLoading(false);
    }
  }, [activeSiteId]);

  useEffect(() => {
    void loadSiteData();
  }, [loadSiteData, refreshSignal]);

  const handleSiteChange = (siteId: string) => {
    setSelectedDeviceIp(null);
    setFocusDeviceIp(null);
    setActiveSiteId(siteId);
  };

  const handleLocateOnMap = (ip: string) => {
    setSelectedDeviceIp(ip);
    setFocusDeviceIp(ip);
    setActiveTab("topology");
  };

  const handleSaveLayout = async (positions: NodePositionItem[]) => {
    await saveTopologyLayout(activeSiteId, positions);
    setRefreshSignal((prev) => prev + 1);
  };

  const handleResetLayout = async () => {
    await resetTopologyLayout(activeSiteId);
    setRefreshSignal((prev) => prev + 1);
  };

  const selectedTopologyNode =
    topology?.nodes.find((n) => n.ip === selectedDeviceIp) ?? null;

  return (
    <AppShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      sites={sites}
      activeSiteId={activeSiteId}
      onSiteChange={handleSiteChange}
      health={health}
      theme={theme}
      onToggleTheme={toggleTheme}
    >
      {activeTab === "overview" && (
        <OverviewPage
          topology={topology}
          vlans={vlans}
          onNavigate={setActiveTab}
        />
      )}

      {activeTab === "topology" && (
        <TopologyPage
          topology={topology}
          vlans={vlans}
          loading={topoLoading}
          error={topoError}
          selectedDeviceIp={selectedDeviceIp}
          focusDeviceIp={focusDeviceIp}
          onSelectDevice={setSelectedDeviceIp}
          onRefresh={() => void loadSiteData()}
          onSaveLayout={handleSaveLayout}
          onResetLayout={handleResetLayout}
          onFocusHandled={() => setFocusDeviceIp(null)}
        />
      )}

      {activeTab === "devices" && (
        <InventoryPage
          siteId={activeSiteId}
          refreshSignal={refreshSignal}
          onSelectDevice={setSelectedDeviceIp}
          onLocateOnMap={handleLocateOnMap}
        />
      )}

      {activeTab === "endpoints" && (
        <EndpointsPage
          siteId={activeSiteId}
          refreshSignal={refreshSignal}
          onSelectDevice={setSelectedDeviceIp}
          onLocateOnMap={handleLocateOnMap}
        />
      )}

      {activeTab === "vlans" && (
        <VlansPage
          vlans={vlans}
          loading={topoLoading}
          onRefresh={() => void loadSiteData()}
          onSelectDevice={setSelectedDeviceIp}
        />
      )}

      {activeTab === "discovery" && (
        <DiscoveryPage
          mode={health?.mode ?? "mock"}
          activeSiteId={activeSiteId}
          onScanQueued={() => setRefreshSignal((prev) => prev + 1)}
        />
      )}

      {activeTab === "agents" && (
        <AgentsPage
          sites={sites}
          onRefreshSites={loadSites}
          onSelectSite={(sid) => {
            handleSiteChange(sid);
            setActiveTab("topology");
          }}
        />
      )}

      <DeviceDrawer
        deviceIp={selectedDeviceIp}
        siteId={activeSiteId}
        topologyNode={selectedTopologyNode}
        onClose={() => setSelectedDeviceIp(null)}
        onSelectDevice={(ip) => setSelectedDeviceIp(ip)}
        onOverrideSaved={() => setRefreshSignal((prev) => prev + 1)}
        onScanTriggered={() => setRefreshSignal((prev) => prev + 1)}
      />
    </AppShell>
  );
}
