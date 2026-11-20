import { AlertCircle, Loader2 } from "lucide-react";
import { NetworkGraph } from "../components/topology/NetworkGraph";
import type {
  NodePositionItem,
  TopologyResponse,
  VlanSummary,
} from "../types/network";

interface TopologyPageProps {
  topology: TopologyResponse | null;
  vlans: VlanSummary[];
  loading: boolean;
  error: string | null;
  selectedDeviceIp: string | null;
  focusDeviceIp: string | null;
  onSelectDevice: (ip: string) => void;
  onRefresh: () => void;
  onSaveLayout: (positions: NodePositionItem[]) => Promise<void>;
  onResetLayout: () => Promise<void>;
  onFocusHandled: () => void;
}

export function TopologyPage({
  topology,
  vlans,
  loading,
  error,
  selectedDeviceIp,
  focusDeviceIp,
  onSelectDevice,
  onRefresh,
  onSaveLayout,
  onResetLayout,
  onFocusHandled,
}: TopologyPageProps) {
  return (
    <div className="relative h-full w-full overflow-hidden">
      {error && (
        <div className="absolute inset-x-4 top-14 z-20 flex items-center gap-2 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-800 dark:bg-rose-950/80 dark:text-rose-200">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !topology && (
        <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-[#f6f8fa]/70 text-xs text-[#57606a] dark:bg-[#0d1117]/70 dark:text-[#8b949e]">
          <Loader2 className="h-4 w-4 animate-spin text-[#0969da]" />
          <span>Loading network topology...</span>
        </div>
      )}

      <NetworkGraph
        topology={topology}
        vlans={vlans}
        loading={loading}
        selectedDeviceIp={selectedDeviceIp}
        focusDeviceIp={focusDeviceIp}
        onSelectDevice={onSelectDevice}
        onRefresh={onRefresh}
        onSaveLayout={onSaveLayout}
        onResetLayout={onResetLayout}
        onFocusHandled={onFocusHandled}
      />
    </div>
  );
}
