"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
  contentClassName?: string;
}

/**
 * Morpho tooltip.
 * Lightweight hover tooltip using CSS visibility — no external library.
 * For complex popovers use Dialog.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
  contentClassName,
}: TooltipProps) {
  const positionClasses = {
    top: "bottom-full mb-1.5 left-1/2 -translate-x-1/2",
    bottom: "top-full mt-1.5 left-1/2 -translate-x-1/2",
    left: "right-full mr-1.5 top-1/2 -translate-y-1/2",
    right: "left-full ml-1.5 top-1/2 -translate-y-1/2",
  }[side];

  return (
    <span className={cn("relative inline-flex group", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "absolute z-50 pointer-events-none",
          "opacity-0 invisible group-hover:opacity-100 group-hover:visible",
          "transition-opacity duration-150",
          positionClasses,
          "whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium",
          "bg-[var(--bg-overlay)] text-[var(--text-primary)] border border-[var(--border)] shadow-lg",
          contentClassName
        )}
      >
        {content}
      </span>
    </span>
  );
}
