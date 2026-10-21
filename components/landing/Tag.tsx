import * as React from "react";
import { cn } from "@/lib/utils";

/** Small boxed mono label used above landing section headings. */
export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center h-5 px-1.5 rounded-[4px] border border-[var(--border)] bg-[var(--bg-elevated)]",
        "font-mono text-[10px] uppercase tracking-[0.08em] leading-none text-[var(--text-secondary)]",
        className
      )}
    >
      {children}
    </span>
  );
}
