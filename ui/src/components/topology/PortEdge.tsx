import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import { memo } from "react";
import type { PortFlowEdge } from "../../types/network";
import { formatSpeedShort } from "../../utils/roleStyles";

function getCableStyle(
  speedMbps: number | null | undefined,
  status: string | undefined,
  selected: boolean | undefined
): { stroke: string; strokeWidth: number; dash?: string } {
  if (status === "down") {
    return { stroke: "#cf222e", strokeWidth: 1.75, dash: "5 4" };
  }
  if (selected) {
    return { stroke: "#0969da", strokeWidth: 2.75 };
  }
  if (speedMbps && speedMbps >= 100_000) {
    return { stroke: "#4f46e5", strokeWidth: 3 };
  }
  if (speedMbps && speedMbps >= 40_000) {
    return { stroke: "#0284c7", strokeWidth: 2.5 };
  }
  if (speedMbps && speedMbps >= 10_000) {
    return { stroke: "#2563eb", strokeWidth: 2 };
  }
  if (speedMbps && speedMbps >= 1_000) {
    return { stroke: "#6e7781", strokeWidth: 1.5 };
  }
  return { stroke: "#8c959f", strokeWidth: 1.25 };
}

function nudgeFromHandle(
  x: number,
  y: number,
  pos: Position,
  distance: number
): { x: number; y: number } {
  switch (pos) {
    case Position.Top:
      return { x, y: y - distance };
    case Position.Bottom:
      return { x, y: y + distance };
    case Position.Left:
      return { x: x - distance, y };
    case Position.Right:
      return { x: x + distance, y };
    default:
      return { x, y };
  }
}

function PortEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<PortFlowEdge>) {
  const parallelTotal = data?.parallel_total ?? 1;
  const parallelIndex = data?.parallel_index ?? 0;

  let sx = sourceX;
  let sy = sourceY;
  let tx = targetX;
  let ty = targetY;

  if (parallelTotal > 1) {
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const len = Math.hypot(dx, dy) || 1;
    const offset = (parallelIndex - (parallelTotal - 1) / 2) * 14;
    const nx = (-dy / len) * offset;
    const ny = (dx / len) * offset;
    sx += nx;
    sy += ny;
    tx += nx;
    ty += ny;
  }

  const edgeStyle = data?.edgeStyle ?? "straight";
  let edgePath = "";
  let midX = (sx + tx) / 2;
  let midY = (sy + ty) / 2;
  let srcLabelPos = { x: sx + (tx - sx) * 0.22, y: sy + (ty - sy) * 0.22 };
  let dstLabelPos = { x: sx + (tx - sx) * 0.78, y: sy + (ty - sy) * 0.78 };

  if (edgeStyle === "step") {
    const [stepPath, labelX, labelY] = getSmoothStepPath({
      sourceX: sx,
      sourceY: sy,
      sourcePosition,
      targetX: tx,
      targetY: ty,
      targetPosition,
      borderRadius: 4,
    });
    edgePath = stepPath;
    midX = labelX;
    midY = labelY;
    srcLabelPos = nudgeFromHandle(sx, sy, sourcePosition, 18);
    dstLabelPos = nudgeFromHandle(tx, ty, targetPosition, 18);
  } else {
    edgePath = `M ${sx} ${sy} L ${tx} ${ty}`;
  }

  const visual = getCableStyle(data?.speed_mbps, data?.status, selected);
  const speedTag = formatSpeedShort(data?.speed_mbps ?? null, data?.speed);
  const showLabels = data?.showLabels ?? true;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: visual.stroke,
          strokeWidth: visual.strokeWidth,
          strokeDasharray: visual.dash,
        }}
      />
      {showLabels && data && (
        <EdgeLabelRenderer>
          {data.source_port && (
            <div
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${srcLabelPos.x}px, ${srcLabelPos.y}px)`,
                pointerEvents: "none",
              }}
              className="rounded bg-[#f6f8fa]/95 px-1 font-mono text-[9px] leading-tight text-[#57606a] dark:bg-[#0d1117]/95 dark:text-[#8b949e]"
            >
              {data.source_port}
            </div>
          )}

          {data.target_port && (
            <div
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${dstLabelPos.x}px, ${dstLabelPos.y}px)`,
                pointerEvents: "none",
              }}
              className="rounded bg-[#f6f8fa]/95 px-1 font-mono text-[9px] leading-tight text-[#57606a] dark:bg-[#0d1117]/95 dark:text-[#8b949e]"
            >
              {data.target_port}
            </div>
          )}

          {speedTag && (
            <div
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${midX}px, ${midY}px)`,
                pointerEvents: "none",
              }}
              className="rounded border border-[#d0d7de] bg-white/95 px-1 py-px font-mono text-[9px] font-semibold leading-none text-[#1f2328] dark:border-[#30363d] dark:bg-[#161b22]/95 dark:text-[#e6edf3]"
            >
              {speedTag}
            </div>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const PortEdge = memo(PortEdgeComponent);
