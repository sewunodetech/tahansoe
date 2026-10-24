"use client";

import React from "react";
import { MessageCircleOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LiveOverview } from "@/components/dashboard/live/live-overview";
import { LivePage } from "@/components/dashboard/live/live-page";
import { SimScenarioPanel } from "./sim-scenario-panel";
import { SimSetupWizard } from "./sim-setup-wizard";
import { SimTxList } from "./sim-tx-list";
import { SimWithoutPanel } from "./sim-without-panel";
import { SimTopUp } from "./sim-topup";
import { SimCta } from "./sim-cta";

/** Overview page in Simulation Mode: the Live overview on the fork plus the simulation controls. */
export function SimDashboard() {
  return (
    <LivePage
      eyebrow="Simulation"
      title="Try the Guardian on a fork"
      subtitle="Open a position with fake funds, move the market, and watch Layer 1 → Layer 3 step in."
    >
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <LiveOverview />
          <SimTxList />
        </div>
        <div className="space-y-5 min-w-0">
          <SimScenarioPanel />
          <SimWithoutPanel />
          <SimSetupWizard />
          <SimTopUp />
        </div>
      </div>
      <SimCta />
    </LivePage>
  );
}

/** Shown instead of pages that need a real account (Telegram linking) while simulating. */
export function SimUnavailable({ feature }: { feature: string }) {
  return (
    <div className="w-full p-5 md:p-8">
      <Card className="p-6 flex items-start gap-3 max-w-[640px]">
        <MessageCircleOff className="size-5 text-[var(--text-tertiary)] shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-[var(--text-primary)]">{feature} is not available in Simulation Mode</p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            The simulation wallet has no account. Connect a real wallet to use {feature.toLowerCase()}.
          </p>
        </div>
      </Card>
    </div>
  );
}
