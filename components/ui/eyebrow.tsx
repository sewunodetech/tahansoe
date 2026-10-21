import * as React from "react";
import { cn } from "@/lib/utils";

export interface EyebrowProps extends React.HTMLAttributes<HTMLSpanElement> {
  dot?: boolean;
  variant?: "default" | "brand" | "safe" | "warning" | "danger" | "neutral";
}

/**
 * Morpho mono eyebrow pill / tag.
 * Clean, lightweight monospace label used above section headings and in status badges.
 */
export function Eyebrow({
  children,
  className,
  dot = false,
  variant = "default",
  ...props
}: EyebrowProps) {
  const dotColor = {
    default: "bg-[var(--text-tertiary)]",
    brand: "bg-[var(--brand)]",
    safe: "bg-[var(--safe)]",
    warning: "bg-[var(--warning)]",
    danger: "bg-[var(--danger)]",
    neutral: "bg-[var(--text-secondary)]",
  }[variant];

  const textColor = {
    default: "text-[var(--text-secondary)]",
    brand: "text-[var(--brand)]",
    safe: "text-[var(--safe)]",
    warning: "text-[var(--warning)]",
    danger: "text-[var(--danger)]",
    neutral: "text-[var(--text-tertiary)]",
  }[variant];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider font-medium leading-none select-none",
        textColor,
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn("size-1.5 rounded-full shrink-0", dotColor)}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
