"use client";

import React, { useMemo } from "react";
import { Play } from "lucide-react";
import { useProtection } from "@/hooks/useProtection";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { ActivityStats } from "@/components/dashboard/activity/activity-stats";
import { HfRecoveryChart } from "@/components/dashboard/activity/hf-recovery-chart";
import { ActivityTable } from "@/components/dashboard/activity/activity-table";

export default function ActivityPage() {
  const { activity, actions } = useProtection();

  const recoveryData = useMemo(() => {
    return activity
      .filter((h) => h.status === "success" && h.action !== "NOOP")
      .slice(0, 10)
      .map((h) => {
        const layerNum: 1 | 2 | 3 =
          h.layer ??
          (h.source.includes("L1") || h.source.includes("Hot")
            ? 1
            : h.source.includes("L2") || h.source.includes("Position")
            ? 2
            : 3);

        return {
          id: h.id,
          label: `${h.protocol.slice(0, 4)} ${h.timestamp.slice(5, 10)}`,
          layer: layerNum,
          before: h.hfBefore,
          after: h.hfAfter,
          protocol: h.protocol,
        };
      });
  }, [activity]);

  return (
    <div className="w-full p-5 md:p-7 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Eyebrow dot variant="brand">
              Audit Trail
            </Eyebrow>
            <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
              Arbitrum Sepolia
            </span>
          </div>
          <h1 className="font-display text-2xl md:text-3xl font-light text-[var(--text-primary)]">
            Execution Activity & Audit Log
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1 font-mono">
            On-chain interventions across Layers 1, 2, and 3 · Deterministic execution record
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => actions.simulatePriceDrop(15)}
            className="text-xs font-mono gap-1.5"
          >
            <Play className="w-3 h-3 text-[var(--warning)]" />
            Simulate Drop (Test Cascade)
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <ActivityStats activity={activity} />

      {/* HF Recovery Chart */}
      <HfRecoveryChart data={recoveryData} />

      {/* Execution Table */}
      <ActivityTable entries={activity} />
    </div>
  );
}
