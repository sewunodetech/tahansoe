import * as React from "react";
import { cn } from "@/lib/utils";

export type LayerId = 1 | 2 | 3 | "L1" | "L2" | "L3";

export interface LayerBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  layer: LayerId;
  showName?: boolean;
  size?: "sm" | "md";
}

const LAYER_CONFIG = {
  1: {
    tag: "L1",
    name: "Wallet Reserve",
    color: "bg-[var(--brand-bg)] text-[var(--brand)] border-[var(--brand-glow)]",
    dot: "bg-[var(--brand)]",
  },
  2: {
    tag: "L2",
    name: "Position Reserve",
    color: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    dot: "bg-purple-400",
  },
  3: {
    tag: "L3",
    name: "Flash Deleverage",
    color: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    dot: "bg-amber-400",
  },
};

/**
 * Morpho layer badge.
 * Fixed badge for the 3 protection layers:
 * L1 (Wallet Reserve), L2 (Position Reserve), L3 (Flash Deleverage).
 */
export function LayerBadge({
  layer,
  showName = false,
  size = "sm",
  className,
  ...props
}: LayerBadgeProps) {
  const normalizedLayer = (
    typeof layer === "string" ? parseInt(layer.replace("L", ""), 10) : layer
  ) as 1 | 2 | 3;

  const cfg = LAYER_CONFIG[normalizedLayer] || LAYER_CONFIG[1];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-mono font-medium border select-none transition-colors",
        cfg.color,
        size === "sm" ? "text-[10px] px-2 py-0.5" : "text-xs px-2.5 py-1",
        className
      )}
      {...props}
    >
      <span className={cn("size-1.5 rounded-full shrink-0", cfg.dot)} aria-hidden="true" />
      <span>{cfg.tag}</span>
      {showName && <span className="font-sans font-normal opacity-90">· {cfg.name}</span>}
    </span>
  );
}
