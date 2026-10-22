"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useGuardian } from "@/hooks/useGuardian";
import { LiveGate } from "./live-shared";
import { LivePositionCard } from "./live-position-card";
import { LivePolicyStatus } from "./live-policy-status";
import { LiveMigrationBanner } from "./live-migration-banner";

/** Overview on live mode: position health, what the Guardian holds, and the next step. */
export function LiveOverview() {
  const g = useGuardian();

  return (
    <LiveGate g={g}>
      <div className="space-y-6">
        <LiveMigrationBanner g={g} />
        <LivePositionCard g={g} />

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
          <Card className="p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="size-5 text-[var(--brand)] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-[var(--text-primary)]">
                  {g.policy?.enabled ? "Layer 1 is protecting this wallet" : "Protection is not active yet"}
                </p>
                <p className="text-xs text-[var(--text-tertiary)] mt-1">
                  {g.policy?.enabled
                    ? `When your Health Factor falls below ${g.policy.triggerHf.toFixed(2)}, anyone can call protect() and the Guardian repays from your wallet reserve until HF is back at ${g.policy.targetHf.toFixed(2)}.`
                    : "Approve a capped amount and save a policy. Tahansoe then repays your Aave debt from your wallet when your Health Factor gets close to liquidation."}
                </p>
              </div>
            </div>
            <Button size="sm" className="self-start" asChild>
              <Link href="/dashboard/protection">
                {g.policy?.enabled ? "Manage protection" : "Set up Layer 1"} <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </Card>
          <LivePolicyStatus g={g} />
        </div>
      </div>
    </LiveGate>
  );
}
