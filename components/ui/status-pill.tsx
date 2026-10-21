import * as React from "react";
import { cn } from "@/lib/utils";

export type StatusZone = "Safe" | "Watch" | "Warning" | "Critical";

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  zone: StatusZone;
  dot?: boolean;
  size?: "sm" | "md";
}

const zoneStyles: Record<StatusZone, { bg: string; text: string; border: string; dot: string }> = {
  Safe: {
    bg: "bg-[var(--safe-bg)]",
    text: "text-[var(--safe)]",
    border: "border-[var(--safe-border)]",
    dot: "bg-[var(--safe)]",
  },
  Watch: {
    bg: "bg-[var(--warning-bg)]",
    text: "text-[var(--warning)]",
    border: "border-[var(--warning-border)]",
    dot: "bg-[var(--warning)]",
  },
  Warning: {
    bg: "bg-[var(--warning-bg)]",
    text: "text-[var(--warning)]",
    border: "border-[var(--warning-border)]",
    dot: "bg-[var(--warning)]",
  },
  Critical: {
    bg: "bg-[var(--danger-bg)]",
    text: "text-[var(--danger)]",
    border: "border-[var(--danger-border)]",
    dot: "bg-[var(--danger)]",
  },
};

/**
 * Morpho status pill — displays the current health factor zone.
 * Zones: Safe, Watch, Warning, Critical.
 */
export function StatusPill({ zone, dot = true, size = "sm", className, ...props }: StatusPillProps) {
  const styles = zoneStyles[zone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium transition-colors select-none border",
        styles.bg,
        styles.text,
        styles.border,
        size === "sm" ? "text-[11px] px-2 py-0.5" : "text-xs px-2.5 py-1",
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn("rounded-full shrink-0 animate-pulse", styles.dot, size === "sm" ? "size-1.5" : "size-2")}
          aria-hidden="true"
        />
      )}
      {zone}
    </span>
  );
}
