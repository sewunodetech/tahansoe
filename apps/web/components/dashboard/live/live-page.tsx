"use client";

import React from "react";
import { Eyebrow } from "@/components/ui/eyebrow";

export interface LivePageProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

/** Page frame for live-mode dashboard pages, matching the demo page headers. */
export function LivePage({ eyebrow, title, subtitle, children }: LivePageProps) {
  return (
    <div className="w-full p-5 md:p-8 space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Eyebrow dot variant="brand">
            {eyebrow}
          </Eyebrow>
          <span className="text-[11px] font-mono text-[var(--text-tertiary)]">Live · Arbitrum Sepolia</span>
        </div>
        <h1 className="font-display text-2xl md:text-3xl font-light text-[var(--text-primary)]">{title}</h1>
        {subtitle && <p className="text-xs text-[var(--text-secondary)] mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
