import type { DeviceRole } from "../types/network";

export interface RoleMeta {
  label: string;
  shortLabel: string;
  badgeClass: string;
  iconColor: string;
  minimapColor: string;
}

export const ROLE_META: Record<DeviceRole, RoleMeta> = {
  firewall: {
    label: "Firewall",
    shortLabel: "FW",
    badgeClass:
      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/70",
    iconColor: "text-rose-700 dark:text-rose-400",
    minimapColor: "#cf222e",
  },
  router: {
    label: "Router",
    shortLabel: "RTR",
    badgeClass:
      "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/70",
    iconColor: "text-amber-700 dark:text-amber-400",
    minimapColor: "#bf8700",
  },
  core: {
    label: "Core",
    shortLabel: "CORE",
    badgeClass:
      "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800/70",
    iconColor: "text-indigo-700 dark:text-indigo-400",
    minimapColor: "#4f46e5",
  },
  distribution: {
    label: "Distribution",
    shortLabel: "DIST",
    badgeClass:
      "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800/70",
    iconColor: "text-sky-700 dark:text-sky-400",
    minimapColor: "#0969da",
  },
  access: {
    label: "Access",
    shortLabel: "ACC",
    badgeClass:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/70",
    iconColor: "text-emerald-700 dark:text-emerald-400",
    minimapColor: "#1a7f37",
  },
  wireless: {
    label: "Wireless AP",
    shortLabel: "WLAN",
    badgeClass:
      "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800/70",
    iconColor: "text-teal-700 dark:text-teal-400",
    minimapColor: "#0d9488",
  },
  unknown: {
    label: "Unmanaged",
    shortLabel: "EXT",
    badgeClass:
      "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    iconColor: "text-slate-500 dark:text-slate-400",
    minimapColor: "#6e7781",
  },
};

export function getRoleMeta(role: DeviceRole): RoleMeta {
  return ROLE_META[role] ?? ROLE_META.unknown;
}

export function formatSpeedShort(
  speedMbps: number | null,
  fallback?: string | null
): string {
  if (speedMbps && speedMbps >= 1000) {
    const g = speedMbps / 1000;
    return `${Number.isInteger(g) ? g : g.toFixed(1)}G`;
  }
  if (speedMbps && speedMbps > 0) {
    return `${speedMbps}M`;
  }
  return fallback ?? "";
}
