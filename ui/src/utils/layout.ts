import dagre from "@dagrejs/dagre";
import { Position } from "@xyflow/react";
import type {
  LayoutDirection,
  PortFlowEdge,
  TopologyCanvasNode,
} from "../types/network";

export const DEVICE_NODE_WIDTH = 136;
export const DEVICE_NODE_HEIGHT = 88;
export const VLAN_NODE_WIDTH = 152;
export const VLAN_NODE_HEIGHT = 74;

export function getLayoutedElements(
  nodes: TopologyCanvasNode[],
  edges: PortFlowEdge[],
  direction: LayoutDirection = "TB",
  respectSavedPositions = true
): { nodes: TopologyCanvasNode[]; edges: PortFlowEdge[] } {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    nodesep: 72,
    ranksep: 125,
    marginx: 36,
    marginy: 36,
  });

  const sortedNodes = [...nodes].sort((a, b) => {
    const aTier = a.type === "device" ? a.data.tier : 4;
    const bTier = b.type === "device" ? b.data.tier : 4;
    if (aTier !== bTier) return aTier - bTier;
    const aName = a.type === "device" ? a.data.hostname : String(a.data.vlan);
    const bName = b.type === "device" ? b.data.hostname : String(b.data.vlan);
    return aName.localeCompare(bName);
  });

  const nodeIds = new Set(sortedNodes.map((n) => n.id));

  for (const node of sortedNodes) {
    const w = node.type === "vlan" ? VLAN_NODE_WIDTH : DEVICE_NODE_WIDTH;
    const h = node.type === "vlan" ? VLAN_NODE_HEIGHT : DEVICE_NODE_HEIGHT;
    graph.setNode(node.id, { width: w, height: h });
  }

  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(graph);

  const isHorizontal = direction === "LR";

  const layoutedNodes: TopologyCanvasNode[] = sortedNodes.map((node) => {
    const w = node.type === "vlan" ? VLAN_NODE_WIDTH : DEVICE_NODE_WIDTH;
    const h = node.type === "vlan" ? VLAN_NODE_HEIGHT : DEVICE_NODE_HEIGHT;
    const pos = graph.node(node.id);
    const hasSaved =
      respectSavedPositions &&
      node.type === "device" &&
      node.data.pos_x !== null &&
      node.data.pos_y !== null;

    const x =
      hasSaved && node.type === "device" && node.data.pos_x !== null
        ? node.data.pos_x
        : pos.x - w / 2;
    const y =
      hasSaved && node.type === "device" && node.data.pos_y !== null
        ? node.data.pos_y
        : pos.y - h / 2;

    if (node.type === "device") {
      return {
        ...node,
        targetPosition: isHorizontal ? Position.Left : Position.Top,
        sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
        data: { ...node.data, direction },
        position: { x, y },
      };
    }

    return {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      data: { ...node.data, direction },
      position: { x, y },
    };
  });

  return { nodes: layoutedNodes, edges };
}
