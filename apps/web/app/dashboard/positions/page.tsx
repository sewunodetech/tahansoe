"use client";

import React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { useDashboardMode } from "@/lib/dashboard-mode";
import { LivePage } from "@/components/dashboard/live/live-page";
import { PositionsView } from "@/components/dashboard/positions/positions-view";

export default function PositionsPage() {
  const { isLive } = useDashboardMode();
  return (
    <LivePage eyebrow="Positions" title="Your borrow positions" subtitle="Every Aave V3 and Morpho Blue position we can read for this wallet.">
      {isLive ? (
        <PositionsView />
      ) : (
        <Card className="p-6">
          <p className="text-sm text-[var(--text-primary)]">Positions are read on-chain</p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            Demo mode runs an in-memory position. Switch to Live in{" "}
            <Link href="/dashboard/settings" className="text-[var(--brand)] hover:underline">
              Settings
            </Link>{" "}
            to see your real positions.
          </p>
        </Card>
      )}
    </LivePage>
  );
}
