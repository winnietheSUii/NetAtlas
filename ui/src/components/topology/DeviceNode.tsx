import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Pin } from "lucide-react";
import { memo } from "react";
import type {
  DeviceFlowNode,
  ReachabilityStatus,
  VlanFlowNode,
} from "../../types/network";
import { getRoleMeta } from "../../utils/roleStyles";
import { NetworkIcon } from "./NetworkIcons";

function getStatusDotClass(status: ReachabilityStatus, managed: boolean): string {
  if (!managed) return "bg-[#8c959f]";
  switch (status) {
    case "up":
      return "bg-[#1a7f37] dark:bg-[#3fb950]";
    case "degraded":
      return "bg-[#bf8700] dark:bg-[#d29922]";
    case "down":
      return "bg-[#cf222e] dark:bg-[#f85149]";
    default:
      return "bg-[#8c959f]";
  }
}

function formatStatusTitle(
  status: ReachabilityStatus,
  latencyMs: number | null,
  managed: boolean
): string {
  if (!managed) return "Unmanaged Neighbor";
  const label = status.toUpperCase();
  if (status === "up" && latencyMs !== null) {
    return `${label} (${latencyMs.toFixed(1)} ms)`;
  }
  return label;
}

function DeviceNodeComponent({ data, selected }: NodeProps<DeviceFlowNode>) {
  const roleMeta = getRoleMeta(data.role);
  const isHorizontal = data.direction === "LR";
  const statusLabel = formatStatusTitle(
    data.reachability,
    data.latency_ms,
    data.managed
  );

  return (
    <div
      className="group relative flex w-[136px] flex-col items-center select-none"
      title={`${data.hostname} (${data.ip}) — ${[data.vendor, data.model].filter(Boolean).join(" ") || roleMeta.label} [${statusLabel}]`}
    >
      <Handle
        type="target"
        position={isHorizontal ? Position.Left : Position.Top}
        className="!h-2 !w-2 !border !border-white !bg-[#8c959f] opacity-0 transition-opacity group-hover:opacity-100 dark:!border-[#0d1117]"
      />

      <div
        className={`relative flex h-12 w-12 items-center justify-center rounded-md border bg-white transition dark:bg-[#161b22] ${
          selected
            ? "border-[#0969da] ring-2 ring-[#0969da]/30 dark:border-[#58a6ff] dark:ring-[#58a6ff]/30"
            : data.isHighlighted
            ? "border-amber-500 ring-2 ring-amber-400/35"
            : data.managed && data.reachability === "down"
            ? "border-[#cf222e] dark:border-[#f85149]"
            : data.managed
            ? "border-[#d0d7de] group-hover:border-[#8c959f] dark:border-[#30363d] dark:group-hover:border-[#6e7681]"
            : "border-dashed border-[#8c959f] dark:border-[#6e7681]"
        }`}
      >
        <NetworkIcon
          role={data.role}
          className={`h-8 w-8 ${roleMeta.iconColor}`}
        />

        <span
          className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-[#161b22] ${getStatusDotClass(
            data.reachability,
            data.managed
          )}`}
          title={statusLabel}
        />

        {data.is_root && (
          <span
            className="absolute -left-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-[#d0d7de] bg-white text-[#0969da] dark:border-[#30363d] dark:bg-[#161b22] dark:text-[#58a6ff]"
            title="Pinned Topology Root"
          >
            <Pin className="h-2.5 w-2.5" />
          </span>
        )}
      </div>

      <div className="mt-1.5 w-full rounded bg-[#f6f8fa]/90 px-1 py-0.5 text-center dark:bg-[#0d1117]/90">
        <div className="truncate text-[11px] font-semibold leading-tight text-[#1f2328] dark:text-[#e6edf3]">
          {data.hostname}
        </div>
        <div className="truncate font-mono text-[10px] leading-tight text-[#57606a] dark:text-[#8b949e]">
          {data.ip}
        </div>
      </div>

      <Handle
        type="source"
        position={isHorizontal ? Position.Right : Position.Bottom}
        className="!h-2 !w-2 !border !border-white !bg-[#8c959f] opacity-0 transition-opacity group-hover:opacity-100 dark:!border-[#0d1117]"
      />
    </div>
  );
}

function VlanNodeComponent({ data, selected }: NodeProps<VlanFlowNode>) {
  const isHorizontal = data.direction === "LR";

  return (
    <div className="group relative flex w-[152px] flex-col items-center select-none">
      <Handle
        type="target"
        position={isHorizontal ? Position.Left : Position.Top}
        className="!h-2 !w-2 !border !border-white !bg-[#8c959f] opacity-0 group-hover:opacity-100 dark:!border-[#0d1117]"
      />

      <div
        className={`flex w-full items-center gap-2 rounded-md border bg-white px-2.5 py-2 dark:bg-[#161b22] ${
          selected
            ? "border-[#0969da] ring-2 ring-[#0969da]/30"
            : data.isHighlighted
            ? "border-amber-500 ring-2 ring-amber-400/35"
            : "border-[#d0d7de] dark:border-[#30363d]"
        }`}
      >
        <NetworkIcon
          role="vlan"
          className="h-7 w-7 shrink-0 text-[#0969da] dark:text-[#58a6ff]"
        />
        <div className="min-w-0 leading-tight">
          <div className="font-mono text-xs font-semibold text-[#1f2328] dark:text-[#e6edf3]">
            VLAN {data.vlan}
          </div>
          <div className="text-[10px] text-[#57606a] dark:text-[#8b949e]">
            {data.switch_count} sw · {data.port_count} ports
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={isHorizontal ? Position.Right : Position.Bottom}
        className="!h-2 !w-2 !border !border-white !bg-[#8c959f] opacity-0 group-hover:opacity-100 dark:!border-[#0d1117]"
      />
    </div>
  );
}

export const DeviceNode = memo(DeviceNodeComponent);
export const VlanNode = memo(VlanNodeComponent);
