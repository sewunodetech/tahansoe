"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface HfGaugeProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  min?: number;
  max?: number;
  trigger?: number;
  target?: number;
  showValue?: boolean;
  size?: "sm" | "md" | "lg";
}

function getZone(hf: number): { zone: string; color: string } {
  if (hf >= 2.0) return { zone: "Safe", color: "var(--safe)" };
  if (hf >= 1.5) return { zone: "Watch", color: "var(--warning)" };
  if (hf >= 1.2) return { zone: "Warning", color: "var(--warning)" };
  return { zone: "Critical", color: "var(--danger)" };
}

/**
 * Morpho health factor gauge.
 * Displays the current HF as a colored bar with optional trigger/target markers.
 */
export function HfGauge({
  value,
  min = 0.8,
  max = 3.0,
  trigger,
  target,
  showValue = true,
  size = "md",
  className,
  ...props
}: HfGaugeProps) {
  const { zone, color } = getZone(value);
  const pct = Math.min(Math.max((value - min) / (max - min), 0), 1) * 100;

  const h = { sm: "h-1.5", md: "h-2.5", lg: "h-3.5" }[size];
  const textSize = { sm: "text-xs", md: "text-sm", lg: "text-base" }[size];

  const markerPct = (v: number) =>
    Math.min(Math.max(((v - min) / (max - min)) * 100, 0), 100);

  return (
    <div className={cn("flex flex-col gap-1.5", className)} {...props}>
      {showValue && (
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn("font-mono font-semibold tabular-nums leading-none", textSize)}
            style={{ color }}
          >
            {value.toFixed(2)}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wide text-[var(--text-tertiary)]">
            {zone}
          </span>
        </div>
      )}

      <div className={cn("relative w-full rounded-full bg-[var(--bg-overlay)]", h)}>
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out")}
          style={{ width: `${pct}%`, backgroundColor: color }}
        />

        {trigger !== undefined && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-[var(--warning)] opacity-70"
            style={{ left: `${markerPct(trigger)}%` }}
            title={`Trigger: ${trigger}`}
          />
        )}

        {target !== undefined && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-[var(--safe)] opacity-70"
            style={{ left: `${markerPct(target)}%` }}
            title={`Target: ${target}`}
          />
        )}
      </div>
    </div>
  );
}
