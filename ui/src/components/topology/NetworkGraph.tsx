import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react";
import {
  ArrowDownUp,
  ArrowLeftRight,
  Check,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Spline,
  Tag,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DeviceFlowNode,
  DeviceRole,
  EdgeStyle,
  LayoutDirection,
  NodePositionItem,
  PortFlowEdge,
  TopologyCanvasNode,
  TopologyResponse,
  TopologyViewMode,
  VlanFlowNode,
  VlanSummary,
} from "../../types/network";
import { getLayoutedElements } from "../../utils/layout";
import { getRoleMeta } from "../../utils/roleStyles";
import { DeviceNode, VlanNode } from "./DeviceNode";
import { PortEdge } from "./PortEdge";

const nodeTypes: NodeTypes = {
  device: DeviceNode,
  vlan: VlanNode,
};

const edgeTypes: EdgeTypes = {
  portEdge: PortEdge,
};

interface NetworkGraphProps {
  topology: TopologyResponse | null;
  vlans: VlanSummary[];
  loading: boolean;
  selectedDeviceIp: string | null;
  focusDeviceIp: string | null;
  onSelectDevice: (ip: string) => void;
  onRefresh: () => void;
  onSaveLayout: (positions: NodePositionItem[]) => Promise<void>;
  onResetLayout: () => Promise<void>;
  onFocusHandled: () => void;
}

function NetworkGraphInner({
  topology,
  vlans,
  loading,
  selectedDeviceIp,
  focusDeviceIp,
  onSelectDevice,
  onRefresh,
  onSaveLayout,
  onResetLayout,
  onFocusHandled,
}: NetworkGraphProps) {
  const [viewMode, setViewMode] = useState<TopologyViewMode>("l2");
  const [direction, setDirection] = useState<LayoutDirection>("TB");
  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>("straight");
  const [showLabels, setShowLabels] = useState(true);
  const [roleFilter, setRoleFilter] = useState<"all" | DeviceRole>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [savingLayout, setSavingLayout] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<TopologyCanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<PortFlowEdge>([]);
  const { fitView, setCenter } = useReactFlow();

  const layouted = useMemo(() => {
    if (!topology) {
      return { nodes: [] as TopologyCanvasNode[], edges: [] as PortFlowEdge[] };
    }
    const q = searchTerm.trim().toLowerCase();

    if (viewMode === "l3") {
      const deviceNodes: DeviceFlowNode[] = topology.nodes
        .filter((n) => n.managed)
        .map((n) => ({
          id: n.id,
          type: "device",
          selected: n.ip === selectedDeviceIp,
          position: { x: 0, y: 0 },
          data: {
            ...n,
            direction,
            isHighlighted:
              q.length > 0 &&
              (n.hostname.toLowerCase().includes(q) || n.ip.toLowerCase().includes(q)),
          },
        }));

      const deviceIds = new Set(deviceNodes.map((n) => n.id));
      const vlanNodes: VlanFlowNode[] = vlans.map((v) => ({
        id: `vlan-${v.vlan}`,
        type: "vlan",
        position: { x: 0, y: 0 },
        data: {
          ...v,
          direction,
          isHighlighted: q.length > 0 && String(v.vlan).includes(q),
        },
      }));

      const vlanEdges: PortFlowEdge[] = [];
      for (const v of vlans) {
        for (const sw of v.switches) {
          if (!deviceIds.has(sw.ip)) continue;
          vlanEdges.push({
            id: `v${v.vlan}-${sw.ip}`,
            source: sw.ip,
            target: `vlan-${v.vlan}`,
            type: "portEdge",
            data: {
              id: `v${v.vlan}-${sw.ip}`,
              source: sw.ip,
              target: `vlan-${v.vlan}`,
              source_port: `${sw.port_count}p`,
              target_port: sw.native_port_count > 0 ? "native" : "trunk",
              speed: null,
              speed_mbps: null,
              link_type: "neighbor",
              status: "up",
              protocol: "802.1Q",
              parallel_index: 0,
              parallel_total: 1,
              showLabels,
              edgeStyle,
            },
          });
        }
      }

      return getLayoutedElements(
        [...deviceNodes, ...vlanNodes],
        vlanEdges,
        direction,
        false
      );
    }

    const filteredNodes = topology.nodes.filter((n) =>
      roleFilter === "all" ? true : n.role === roleFilter
    );
    const visibleIds = new Set(filteredNodes.map((n) => n.id));

    const flowNodes: DeviceFlowNode[] = filteredNodes.map((n) => {
      const isHighlighted =
        q.length > 0 &&
        (n.hostname.toLowerCase().includes(q) ||
          n.ip.toLowerCase().includes(q) ||
          (n.vendor || "").toLowerCase().includes(q) ||
          (n.model || "").toLowerCase().includes(q));
      return {
        id: n.id,
        type: "device",
        selected: n.ip === selectedDeviceIp,
        position: { x: 0, y: 0 },
        data: {
          ...n,
          direction,
          isHighlighted,
        },
      };
    });

    const flowEdges: PortFlowEdge[] = topology.edges
      .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "portEdge",
        data: {
          ...e,
          showLabels,
          edgeStyle,
        },
      }));

    return getLayoutedElements(flowNodes, flowEdges, direction, true);
  }, [
    topology,
    vlans,
    viewMode,
    direction,
    edgeStyle,
    showLabels,
    roleFilter,
    searchTerm,
    selectedDeviceIp,
  ]);

  useEffect(() => {
    setNodes(layouted.nodes);
    setEdges(layouted.edges);
  }, [layouted, setNodes, setEdges]);

  useEffect(() => {
    if (!focusDeviceIp || nodes.length === 0) return;
    const target = nodes.find((n) => n.id === focusDeviceIp);
    if (target) {
      setCenter(target.position.x + 68, target.position.y + 44, {
        zoom: 1.15,
        duration: 350,
      });
      onFocusHandled();
    }
  }, [focusDeviceIp, nodes, setCenter, onFocusHandled]);

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.16, duration: 300 });
  }, [fitView]);

  const handleSavePositions = async () => {
    const positions: NodePositionItem[] = nodes
      .filter((n): n is DeviceFlowNode => n.type === "device")
      .map((n) => ({
        ip: n.data.ip,
        pos_x: Math.round(n.position.x),
        pos_y: Math.round(n.position.y),
      }));
    setSavingLayout(true);
    try {
      await onSaveLayout(positions);
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 2000);
    } finally {
      setSavingLayout(false);
    }
  };

  const handleResetPositions = async () => {
    setSavingLayout(true);
    try {
      await onResetLayout();
    } finally {
      setSavingLayout(false);
    }
  };

  const handleJumpFirstMatch = useCallback(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return;
    const match = nodes.find(
      (n): n is DeviceFlowNode =>
        n.type === "device" &&
        (n.data.hostname.toLowerCase().includes(q) ||
          n.data.ip.toLowerCase().includes(q))
    );
    if (match) {
      setCenter(match.position.x + 68, match.position.y + 44, {
        zoom: 1.15,
        duration: 350,
      });
      onSelectDevice(match.data.ip);
    }
  }, [nodes, searchTerm, setCenter, onSelectDevice]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#d0d7de] bg-white px-3 py-2 text-xs dark:border-[#30363d] dark:bg-[#161b22]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded border border-[#d0d7de] bg-[#f6f8fa] p-0.5 dark:border-[#30363d] dark:bg-[#0d1117]">
            <button
              type="button"
              onClick={() => setViewMode("l2")}
              className={`rounded px-2.5 py-1 text-[11px] font-medium ${
                viewMode === "l2"
                  ? "bg-white text-[#1f2328] shadow-sm dark:bg-[#21262d] dark:text-[#e6edf3]"
                  : "text-[#57606a] dark:text-[#8b949e]"
              }`}
            >
              L2 Physical
            </button>
            <button
              type="button"
              onClick={() => setViewMode("l3")}
              className={`rounded px-2.5 py-1 text-[11px] font-medium ${
                viewMode === "l3"
                  ? "bg-white text-[#1f2328] shadow-sm dark:bg-[#21262d] dark:text-[#e6edf3]"
                  : "text-[#57606a] dark:text-[#8b949e]"
              }`}
            >
              L3 VLANs
            </button>
          </div>

          <div className="flex items-center gap-1.5 rounded border border-[#d0d7de] bg-[#f6f8fa] px-2 py-1 dark:border-[#30363d] dark:bg-[#0d1117]">
            <Search className="h-3.5 w-3.5 text-[#57606a]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleJumpFirstMatch();
              }}
              placeholder="Locate node or IP..."
              className="w-36 bg-transparent text-xs focus:outline-none"
            />
          </div>

          {viewMode === "l2" && (
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as "all" | DeviceRole)}
              className="rounded border border-[#d0d7de] bg-[#f6f8fa] px-2 py-1 text-xs text-[#1f2328] focus:outline-none dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#e6edf3]"
            >
              <option value="all">All Roles</option>
              <option value="firewall">Firewall</option>
              <option value="router">Router</option>
              <option value="core">Core</option>
              <option value="distribution">Distribution</option>
              <option value="access">Access</option>
              <option value="wireless">Wireless AP</option>
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center rounded border border-[#d0d7de] bg-[#f6f8fa] p-0.5 dark:border-[#30363d] dark:bg-[#0d1117]">
            <button
              type="button"
              onClick={() => setDirection("TB")}
              className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
                direction === "TB"
                  ? "bg-white text-[#1f2328] shadow-sm dark:bg-[#21262d] dark:text-[#e6edf3]"
                  : "text-[#57606a] dark:text-[#8b949e]"
              }`}
              title="Top-Down Hierarchy"
            >
              <ArrowDownUp className="h-3 w-3" />
              <span>TB</span>
            </button>
            <button
              type="button"
              onClick={() => setDirection("LR")}
              className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
                direction === "LR"
                  ? "bg-white text-[#1f2328] shadow-sm dark:bg-[#21262d] dark:text-[#e6edf3]"
                  : "text-[#57606a] dark:text-[#8b949e]"
              }`}
              title="Left-Right Hierarchy"
            >
              <ArrowLeftRight className="h-3 w-3" />
              <span>LR</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() =>
              setEdgeStyle((prev) => (prev === "straight" ? "step" : "straight"))
            }
            className="flex items-center gap-1 rounded border border-[#d0d7de] bg-white px-2 py-1 text-[11px] font-medium text-[#1f2328] hover:bg-[#f6f8fa] dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#e6edf3] dark:hover:bg-[#21262d]"
            title="Toggle Straight vs Orthogonal cable routing"
          >
            <Spline className="h-3 w-3" />
            <span>{edgeStyle === "straight" ? "Straight" : "Orthogonal"}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowLabels((prev) => !prev)}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium ${
              showLabels
                ? "border-[#0969da] bg-[#ddf4ff] text-[#0969da] dark:border-[#1f6feb] dark:bg-[#1f6feb]/20 dark:text-[#58a6ff]"
                : "border-[#d0d7de] bg-white text-[#57606a] dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#8b949e]"
            }`}
            title="Show or hide interface port labels"
          >
            <Tag className="h-3 w-3" />
            <span>Ports</span>
          </button>

          {viewMode === "l2" && (
            <>
              <button
                type="button"
                onClick={() => void handleSavePositions()}
                disabled={savingLayout}
                className="flex items-center gap-1 rounded border border-[#d0d7de] bg-white px-2 py-1 text-[11px] font-medium text-[#1f2328] hover:bg-[#f6f8fa] disabled:opacity-50 dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#e6edf3] dark:hover:bg-[#21262d]"
                title="Save dragged node coordinates to database"
              >
                {savedNotice ? (
                  <Check className="h-3 w-3 text-[#1a7f37]" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                <span>{savedNotice ? "Saved" : "Save Layout"}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleResetPositions()}
                disabled={savingLayout}
                className="flex items-center gap-1 rounded border border-[#d0d7de] bg-white px-2 py-1 text-[11px] font-medium text-[#57606a] hover:bg-[#f6f8fa] disabled:opacity-50 dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#8b949e] dark:hover:bg-[#21262d]"
                title="Reset saved positions back to auto hierarchy"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Auto</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={handleFitView}
            className="rounded border border-[#d0d7de] bg-white p-1.5 text-[#57606a] hover:bg-[#f6f8fa] dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#8b949e] dark:hover:bg-[#21262d]"
            title="Fit topology to view"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="rounded border border-[#d0d7de] bg-white p-1.5 text-[#57606a] hover:bg-[#f6f8fa] disabled:opacity-50 dark:border-[#30363d] dark:bg-[#0d1117] dark:text-[#8b949e] dark:hover:bg-[#21262d]"
            title="Refresh topology"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="relative flex-1 bg-[#f6f8fa] dark:bg-[#0d1117]">
        <ReactFlow<TopologyCanvasNode, PortFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_event, node) => {
            if (node.type === "device") {
              onSelectDevice(node.data.ip);
            }
          }}
          fitView
          fitViewOptions={{ padding: 0.16 }}
          minZoom={0.2}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            className="opacity-35"
          />

          <Controls showInteractive={false} />

          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => {
              if (node.type === "vlan") return "#0969da";
              const role =
                (node.data as DeviceFlowNode["data"] | undefined)?.role ?? "unknown";
              return getRoleMeta(role).minimapColor;
            }}
          />
        </ReactFlow>

        <div className="pointer-events-none absolute bottom-3 left-14 hidden items-center gap-3 rounded border border-[#d0d7de] bg-white/95 px-2.5 py-1 text-[10px] font-medium text-[#57606a] dark:border-[#30363d] dark:bg-[#161b22]/95 dark:text-[#8b949e] md:flex">
          <span className="flex items-center gap-1.5">
            <span className="h-[3px] w-4 bg-[#4f46e5]" />
            100G
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[2.5px] w-4 bg-[#0284c7]" />
            40G
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-4 bg-[#2563eb]" />
            10G
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[1.5px] w-4 bg-[#6e7781]" />
            1G–2.5G
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-4 border-t-2 border-dashed border-[#cf222e]" />
            Down
          </span>
        </div>
      </div>
    </div>
  );
}

export function NetworkGraph(props: NetworkGraphProps) {
  return (
    <ReactFlowProvider>
      <NetworkGraphInner {...props} />
    </ReactFlowProvider>
  );
}
