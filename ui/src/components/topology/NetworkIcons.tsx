import type { DeviceRole } from "../../types/network";

interface NetworkIconProps {
  role: DeviceRole | "vlan";
  className?: string;
}

export function NetworkIcon({ role, className = "h-10 w-10" }: NetworkIconProps) {
  switch (role) {
    case "firewall":
      return (
        <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
          <rect
            x="6"
            y="10"
            width="36"
            height="28"
            rx="2.5"
            fill="currentColor"
            fillOpacity="0.12"
            stroke="currentColor"
            strokeWidth="2"
          />
          <line x1="6" y1="19" x2="42" y2="19" stroke="currentColor" strokeWidth="1.75" />
          <line x1="6" y1="29" x2="42" y2="29" stroke="currentColor" strokeWidth="1.75" />
          <line x1="18" y1="10" x2="18" y2="19" stroke="currentColor" strokeWidth="1.75" />
          <line x1="30" y1="10" x2="30" y2="19" stroke="currentColor" strokeWidth="1.75" />
          <line x1="12" y1="19" x2="12" y2="29" stroke="currentColor" strokeWidth="1.75" />
          <line x1="24" y1="19" x2="24" y2="29" stroke="currentColor" strokeWidth="1.75" />
          <line x1="36" y1="19" x2="36" y2="29" stroke="currentColor" strokeWidth="1.75" />
          <line x1="18" y1="29" x2="18" y2="38" stroke="currentColor" strokeWidth="1.75" />
          <line x1="30" y1="29" x2="30" y2="38" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      );

    case "router":
      return (
        <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
          <circle
            cx="24"
            cy="24"
            r="17"
            fill="currentColor"
            fillOpacity="0.12"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M24 12v8m0 0-3-3m3 3 3-3M24 36v-8m0 0-3 3m3-3 3 3M12 24h8m0 0-3-3m3 3-3 3M36 24h-8m0 0 3-3m-3 3 3 3"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case "core":
      return (
        <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
          <rect
            x="8"
            y="8"
            width="32"
            height="32"
            rx="3"
            fill="currentColor"
            fillOpacity="0.12"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle cx="24" cy="24" r="9" stroke="currentColor" strokeWidth="1.75" />
          <path
            d="M14 14l4 4m16-4-4 4M14 34l4-4m16 4-4-4M24 15v18M15 24h18"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      );

    case "distribution":
      return (
        <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
          <rect
            x="6"
            y="11"
            width="36"
            height="26"
            rx="2.5"
            fill="currentColor"
            fillOpacity="0.12"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M14 18h14m0 0-3-3m3 3-3 3M34 30H20m0 0 3-3m-3 3 3 3M14 24h20"
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case "access":
      return (
        <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
          <rect
            x="5"
            y="14"
            width="38"
            height="20"
            rx="2"
            fill="currentColor"
            fillOpacity="0.12"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M13 20h10m0 0-2.5-2.5M23 20l-2.5 2.5M35 28H25m0 0 2.5-2.5M25 28l2.5 2.5"
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="11" cy="28" r="1.5" fill="currentColor" />
          <circle cx="16" cy="28" r="1.5" fill="currentColor" />
          <circle cx="32" cy="20" r="1.5" fill="currentColor" />
          <circle cx="37" cy="20" r="1.5" fill="currentColor" />
        </svg>
      );

    case "wireless":
      return (
        <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
          <path
            d="M12 22a17 17 0 0 1 24 0M16.5 26.5a10.5 10.5 0 0 1 15 0"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <rect
            x="10"
            y="30"
            width="28"
            height="9"
            rx="2"
            fill="currentColor"
            fillOpacity="0.14"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle cx="24" cy="28" r="2" fill="currentColor" />
        </svg>
      );

    case "vlan":
      return (
        <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
          <path
            d="M15 34h19a8 8 0 0 0 1.4-15.88A10 10 0 0 0 16.2 15.5 7.5 7.5 0 0 0 15 34Z"
            fill="currentColor"
            fillOpacity="0.12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      );

    default:
      return (
        <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
          <rect
            x="8"
            y="12"
            width="32"
            height="24"
            rx="2.5"
            fill="currentColor"
            fillOpacity="0.08"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="4 3"
          />
          <path
            d="M21 20a3 3 0 1 1 4.5 2.6c-.9.5-1.5 1.1-1.5 2.4M24 29.5h.01"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}
