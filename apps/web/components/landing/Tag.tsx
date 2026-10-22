import * as React from "react";
import { cn } from "@/lib/utils";

/** Small boxed mono label used above landing section headings. */
export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[12px] font-light uppercase tracking-[0.06em] leading-none text-[var(--text-secondary)]",
        "before:content-[''] before:size-1.5 before:rounded-full before:bg-[image:var(--iridescent)]",
        className
      )}
    >
      {children}
    </span>
  );
}
