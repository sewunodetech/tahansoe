"use client";

import React, { useState } from "react";
import type { Address } from "viem";
import { Lock } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LayerBadge } from "@/components/ui/layer-badge";
import { useGuardian } from "@/hooks/useGuardian";
import { useGuardianV4 } from "@/hooks/useGuardianV4";
import { ProtectedPositionsList } from "@/components/dashboard/guardian-v4/protected-positions-list";
import { AgentCard } from "@/components/dashboard/agent/agent-card";
import { LiveGate } from "./live-shared";
import { LivePositionCard } from "./live-position-card";
import { LivePolicyForm } from "./live-policy-form";
import { LivePolicyStatus } from "./live-policy-status";
import { LiveMigrationBanner } from "./live-migration-banner";
import { LiveLayer2Form } from "./live-layer2-form";
import { LiveLayer3Form } from "./live-layer3-form";
import { LiveTriggerBandForm } from "./live-trigger-band-form";
import { LiveQuotePreview } from "./live-quote-preview";

const UPCOMING_LAYERS = [
  {
    layer: 2 as const,
    title: "Layer 2: Position Reserve",
    body: "Redeem shares from a vault you choose to repay debt when your wallet reserve runs out.",
  },
  {
    layer: 3 as const,
    title: "Layer 3: Flash Deleverage",
    body: "Flash-loan repay and sell part of your collateral in one transaction, as a last resort.",
  },
];

/** Protection page on live mode: real position, Layer 1 policy on the Guardian, emergency stop. */
export function LiveProtection() {
  const g4 = useGuardianV4();
  const [asset, setAsset] = useState<Address | undefined>(undefined);
  const g = useGuardian(asset);
  const activeAsset = asset ?? g.policy?.debtAsset ?? g.token?.address;
  const p = g.policy;
  // Reset the form whenever the on-chain policy or the selected asset changes.
  const formKey = `${activeAsset}:${p?.enabled}:${p?.triggerHf}:${p?.targetHf}:${p?.maxRepayPerAction}`;

  if (g4.available) {
    return (
      <LiveGate g={g}>
        <div className="space-y-6">
          <LiveMigrationBanner g={g} />
          <AgentCard />
          <ProtectedPositionsList />
        </div>
      </LiveGate>
    );
  }

  return (
    <LiveGate g={g}>
      <div className="space-y-6">
        <LiveMigrationBanner g={g} />
        <AgentCard />
        <LivePositionCard g={g} />

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
          <LivePolicyForm key={formKey} g={g} asset={activeAsset!} onAssetChange={setAsset} />
          <LivePolicyStatus g={g} />
        </div>

        {g.isV2 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
              <LiveLayer2Form g={g} />
              <LiveLayer3Form g={g} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
              <LiveTriggerBandForm g={g} />
              <LiveQuotePreview g={g} />
            </div>
          </>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {UPCOMING_LAYERS.map((l) => (
              <Card key={l.layer} className="opacity-70">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <LayerBadge layer={l.layer} showName />
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--text-tertiary)]">
                      <Lock className="size-3" /> Coming with Guardian v2
                    </span>
                  </div>
                  <CardTitle className="text-sm mt-3">{l.title}</CardTitle>
                  <CardDescription className="text-xs">{l.body}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>
    </LiveGate>
  );
}
