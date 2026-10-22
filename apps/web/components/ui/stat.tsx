import * as React from "react";
import { cn } from "@/lib/utils";

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  sub?: string;
  size?: "sm" | "md" | "lg";
}

/**
 * Morpho stat display — a labelled numeric value with optional sub-label.
 * Used in hero sections, overview cards, and data summaries.
 */
export function Stat({ label, value, sub, size = "md", className, ...props }: StatProps) {
  const valueClasses = {
    sm: "text-xl font-semibold tabular-nums",
    md: "text-2xl font-semibold tabular-nums",
    lg: "text-4xl font-semibold tabular-nums",
  }[size];

  const labelClasses = {
    sm: "text-[11px]",
    md: "text-xs",
    lg: "text-sm",
  }[size];

  return (
    <div className={cn("flex flex-col gap-0.5", className)} {...props}>
      <span className={cn("text-[var(--text-tertiary)] leading-none uppercase tracking-wider font-mono", labelClasses)}>
        {label}
      </span>
      <span className={cn("text-[var(--text-primary)] leading-tight font-display", valueClasses)}>
        {value}
      </span>
      {sub && (
        <span className="text-[11px] text-[var(--text-tertiary)] leading-none mt-0.5">
          {sub}
        </span>
      )}
    </div>
  );
}
