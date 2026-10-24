"use client";

import React from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { useDashboardMode } from "@/lib/dashboard-mode";
import { useLiveTarget } from "@/lib/live-target";

export interface PageHeaderProps {
  eyebrow: string;
  title: string;
  subtitle?: React.ReactNode;
  /** Right-aligned controls (status badge, page action). Stacks under the title on mobile. */
  actions?: React.ReactNode;
}

/**
 * The one header every dashboard page uses: eyebrow + data source, title, one-line subtitle.
 * The source label follows the dashboard mode, so a page never claims a chain it is not reading.
 */
export function PageHeader({ eyebrow, title, subtitle, actions }: PageHeaderProps) {
  const { mode } = useDashboardMode();
  const { chainName } = useLiveTarget();
  const source = mode === "simulation" ? chainName : mode === "live" ? `Live · ${chainName}` : "Demo data";

  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <Eyebrow dot variant="brand">
            {eyebrow}
          </Eyebrow>
          <span className="text-[11px] font-mono text-[var(--text-tertiary)]">{source}</span>
        </div>
        <h1 className="font-display text-2xl md:text-3xl font-light text-[var(--text-primary)]">{title}</h1>
        {subtitle && <p className="text-sm text-[var(--text-secondary)] mt-1 max-w-[65ch]">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
