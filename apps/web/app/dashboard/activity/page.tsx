"use client";

import React, { useMemo } from "react";
import { Play } from "lucide-react";
import { useProtection } from "@/hooks/useProtection";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { ActivityStats } from "@/components/dashboard/activity/activity-stats";
import { HfRecoveryChart } from "@/components/dashboard/activity/hf-recovery-chart";
import { ActivityTable } from "@/components/dashboard/activity/activity-table";
import { useDashboardMode } from "@/lib/dashboard-mode";
import { LivePage } from "@/components/dashboard/live/live-page";
import { LiveActivity } from "@/components/dashboard/live/live-activity";

function DemoActivityPage() {
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
    <div className="w-full p-5 md:p-8 space-y-6">
      <PageHeader
        eyebrow="Activity"
        title="Guardian activity"
        subtitle="Every repay the Guardian made across Layers 1, 2 and 3, in order."
        actions={
          <Button variant="secondary" size="sm" onClick={() => actions.simulatePriceDrop(15)} className="text-xs gap-1.5">
            <Play className="size-3 text-[var(--warning)]" />
            Simulate a 15% drop
          </Button>
        }
      />

      {/* Summary Stats */}
      <ActivityStats activity={activity} />

      {/* HF Recovery Chart */}
      <HfRecoveryChart data={recoveryData} />

      {/* Execution Table */}
      <ActivityTable entries={activity} />
    </div>
  );
}

export default function ActivityPage() {
  const { isLive } = useDashboardMode();
  if (!isLive) return <DemoActivityPage />;
  return (
    <LivePage eyebrow="Activity" title="Guardian activity" subtitle="Every policy change and repay the Guardian made for this wallet.">
      <LiveActivity />
    </LivePage>
  );
}
