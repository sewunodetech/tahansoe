import * as React from "react";
import { cn } from "@/lib/utils";

export interface ZoneBarProps extends React.HTMLAttributes<HTMLDivElement> {
  hf: number;
  showLabels?: boolean;
  trigger?: number;
  target?: number;
}

const ZONE_SEGMENTS = [
  { label: "Critical", upTo: 1.2, color: "bg-[var(--danger)]", width: "15%" },
  { label: "Warning", upTo: 1.5, color: "bg-[var(--warning)]", width: "15%" },
  { label: "Watch", upTo: 2.0, color: "bg-[var(--warning)] opacity-60", width: "25%" },
  { label: "Safe", upTo: 10, color: "bg-[var(--safe)]", width: "45%" },
];

function hfToPercent(hf: number): number {
  const min = 0.8;
  const max = 3.5;
  return Math.min(Math.max(((hf - min) / (max - min)) * 100, 0), 100);
}

/**
 * Morpho zone bar — horizontal HF zone visualization with colored segments.
 * Shows Current, Trigger, and Target markers on the bar.
 */
export function ZoneBar({ hf, showLabels = true, trigger, target, className, ...props }: ZoneBarProps) {
  const cursorPct = hfToPercent(hf);
  const triggerPct = trigger !== undefined ? hfToPercent(trigger) : undefined;
  const targetPct = target !== undefined ? hfToPercent(target) : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)} {...props}>
      <div className="relative flex h-2.5 w-full rounded-full overflow-hidden">
        {ZONE_SEGMENTS.map((s) => (
          <div
            key={s.label}
            className={cn("h-full", s.color)}
            style={{ width: s.width }}
            title={s.label}
          />
        ))}

        {triggerPct !== undefined && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white/60"
            style={{ left: `${triggerPct}%` }}
          />
        )}

        {targetPct !== undefined && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white/80"
            style={{ left: `${targetPct}%` }}
          />
        )}

        <div
          className="absolute top-0 bottom-0 w-1 rounded-full bg-white shadow-sm ring-1 ring-black/20 transition-all duration-500"
          style={{ left: `max(${cursorPct}% - 2px, 0px)` }}
        />
      </div>

      {showLabels && (
        <div className="flex justify-between text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wide">
          {ZONE_SEGMENTS.map((s) => (
            <span key={s.label}>{s.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}
