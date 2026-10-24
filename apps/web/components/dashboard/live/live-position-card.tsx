"use client";

import React from "react";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { ZoneBar } from "@/components/ui/zone-bar";
import { calculateZone } from "@/hooks/useProtection";
import type { UseGuardianReturn } from "@/hooks/useGuardian";
import { formatUsd } from "./live-shared";

/** Default thresholds drawn on the zone bar before the user has a policy. */
const DEFAULT_TRIGGER = 1.3;
const DEFAULT_TARGET = 1.6;

/** The wallet's real Aave V3 position: HF, zone, collateral and debt. */
export function LivePositionCard({ g }: { g: UseGuardianReturn }) {
  const account = g.account!;
  const trigger = g.policy?.triggerHf ?? DEFAULT_TRIGGER;
  const target = g.policy?.targetHf ?? DEFAULT_TARGET;

  if (account.hf === null && g.target.isSimulation) {
    return (
      <Card className="p-6">
        <p className="text-sm text-[var(--text-primary)]">No Aave V3 borrow on your simulation wallet yet</p>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Use the setup wizard above to supply WETH and borrow USDC on the fork, or press Auto-fill.
        </p>
      </Card>
    );
  }

  if (account.hf === null) {
    return (
      <Card className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--text-primary)]">No Aave V3 borrow on this wallet</p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            Supply collateral and borrow on Aave V3 (Arbitrum Sepolia) first. You can still set a policy now; it
            activates once you have debt.
          </p>
        </div>
        <a
          href="https://app.aave.com/?marketName=proto_arbitrum_sepolia_v3"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-[var(--brand)] hover:underline shrink-0"
        >
          Open Aave testnet <ArrowUpRight className="size-3.5" />
        </a>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">Aave V3 Position</p>
          <p className="text-xs font-mono text-[var(--text-tertiary)] mt-1">
            {g.target.chainName} · Collateral {formatUsd(account.collateralUsd)} · Debt {formatUsd(account.debtUsd)} ·
            Liquidation threshold {account.liquidationThreshold.toFixed(3)}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)] block">Health Factor</span>
            <span className="text-2xl font-light font-mono text-[var(--text-primary)]">{account.hf.toFixed(2)}</span>
          </div>
          <StatusPill zone={calculateZone(account.hf, trigger)} size="md" />
        </div>
      </div>
      <div className="pt-4">
        <ZoneBar hf={account.hf} trigger={trigger} target={target} />
      </div>
    </Card>
  );
}
