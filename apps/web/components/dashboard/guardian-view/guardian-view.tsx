"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, Network, ShieldOff } from "lucide-react";
import { hfToWad, recommendedRepayBase } from "@tahansoe/domain";
import { Card } from "@/components/ui/card";
import { useGuardian } from "@/hooks/useGuardian";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { useHoldings } from "@/hooks/useHoldings";
import { useReserves } from "@/hooks/useReserves";
import { usePositions, type PositionWithStatus } from "@/hooks/usePositions";
import { byDebtDesc, hasDebt } from "@/lib/positions/status";
import { unitPrice } from "@/lib/positions/format";
import { healthFactorOf } from "@/lib/positions/source";
import { LiveMigrationBanner } from "@/components/dashboard/live/live-migration-banner";
import { EmptyBorrows, PositionSkeleton } from "@/components/dashboard/positions/positions-view";
import { PositionCard } from "@/components/dashboard/positions/position-card";
import { computeCapacity } from "./capacity";
import { GuardCard } from "./guard-card";

type ProtectedItem = PositionWithStatus & { status: { kind: "protected" } };

const isProtected = (p: PositionWithStatus): p is ProtectedItem => p.status.kind === "protected";

/**
 * Overview in Live mode and the result panel in Simulation Mode (spec §3.7): one card per
 * Protected position with its HF gauge, price thresholds, last check and ready reserves.
 * Without a Protected position it shows the largest one with a CTA; without any, an empty state.
 */
export function GuardianView({ showMigration = true }: { showMigration?: boolean }) {
  const g = useGuardian();
  const { l1CapacityUsd } = useHoldings();
  const { l2CapacityUsd } = useReserves();
  const { positions, isLoading, unavailable, guardianChainId } = usePositions();
  const heartbeat = useHeartbeat();

  const guarded = positions.filter(isProtected);
  const top = positions.filter((p) => hasDebt(p.position)).sort((a, b) => byDebtDesc(a.position, b.position))[0];

  /** The Guardian chain's HF from useGuardian refreshes every 15 s, faster than the position list. */
  const liveHf = (item: PositionWithStatus) =>
    item.position.chainId === guardianChainId && item.position.protocol === "aave-v3" && g.account
      ? g.account.hf
      : healthFactorOf(item.position);

  const main = guarded[0]?.position.mainCollateral;
  const capacity = computeCapacity({
    policy: g.policy,
    token: g.token,
    layer2: g.layer2,
    layer3: g.layer3,
    l3Collateral: main ? { address: main.address, symbol: main.symbol, decimals: main.decimals, unitPriceUsd: unitPrice(main) } : undefined,
    l1CapacityUsd,
    l2CapacityUsd,
  });

  if (unavailable) {
    return (
      <Card className="p-6 flex items-start gap-3">
        <Network className="size-5 text-[var(--warning)] shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-[var(--text-primary)]">Simulation chain not connected</p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">The Guardian view starts once the simulation fork is ready.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {showMigration && <LiveMigrationBanner g={g} />}

      {isLoading && positions.length === 0 ? (
        <PositionSkeleton />
      ) : guarded.length > 0 ? (
        <div className="grid grid-cols-1 gap-5">
          {guarded.map((item) => {
            const rescueUsd =
              g.account && item.position.chainId === guardianChainId
                ? Number(recommendedRepayBase(g.account.debtBase, hfToWad(item.status.triggerHf), hfToWad(item.status.targetHf))) / 1e8
                : 0;
            return <GuardCard key={item.position.id} item={item} hf={liveHf(item)} heartbeat={heartbeat} capacity={capacity} rescueUsd={rescueUsd} />;
          })}
        </div>
      ) : top ? (
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-3">
            <ShieldOff className="size-4 text-[var(--warning)] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm text-[var(--text-primary)]">Nothing is guarding your positions yet</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {top.status.kind === "not-protected"
                  ? "Your largest position is below. Set a policy and the Guardian repays it before liquidation."
                  : "Your largest position is on a chain we only monitor for now."}
              </p>
            </div>
          </div>
          <PositionCard item={top} hfOverride={liveHf(top)} />
          {positions.length > 1 && (
            <Link href="/dashboard/positions" className="inline-flex items-center gap-1 text-xs text-[var(--brand)] hover:underline">
              See all positions <ArrowRight className="size-3" />
            </Link>
          )}
        </div>
      ) : (
        <EmptyBorrows isSimulation={g.target.isSimulation} />
      )}
    </div>
  );
}
