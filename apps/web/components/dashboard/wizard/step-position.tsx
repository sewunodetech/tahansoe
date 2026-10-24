"use client";

import React from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { ZoneBar } from "@/components/ui/zone-bar";
import type { Position } from "@/lib/mock-data";

export interface StepPositionProps {
  position: Position | null;
  hf: number;
  ethPrice: number;
  onNext: () => void;
}

export function StepPosition({ position, hf, ethPrice, onNext }: StepPositionProps) {
  const protocol = position?.protocol ?? "Aave V3";
  const chain = position?.chain ?? "Arbitrum";
  const collateral = position?.collateral ?? "4.2 ETH";
  const collateralUsd = position?.collateralUsd ?? 14280;
  const debt = position?.debt ?? "5,400 USDC";
  const debtUsd = position?.debtUsd ?? 5400;

  const liqThreshold = 0.825;
  const liquidationPrice = Math.round(debtUsd / (4.2 * liqThreshold));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-light text-[var(--text-primary)] font-display">
          Active Position Detected
        </h2>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Tahansoe found an active borrow position on {chain}. Configure automated 3-layer protection to prevent liquidation.
        </p>
      </div>

      <Card className="p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-medium text-[var(--text-primary)]">{protocol}</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--brand-bg)] text-[var(--brand)] border border-[var(--border)]">
                {chain}
              </span>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] font-mono mt-1">
              Collateral: {collateral} (${collateralUsd.toLocaleString("en-US")}) · Debt: {debt}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)] block">
                Health Factor
              </span>
              <span className="text-3xl font-light font-mono text-[var(--text-primary)]">
                {hf.toFixed(2)}
              </span>
            </div>
            <StatusPill zone={hf > 1.6 ? "Safe" : hf > 1.3 ? "Watch" : "Warning"} size="md" />
          </div>
        </div>

        {/* HF Visual Meter */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-[var(--text-tertiary)]">
            <span>Risk Scale</span>
            <span>Current: {hf.toFixed(2)}</span>
          </div>
          <ZoneBar hf={hf} trigger={1.3} target={1.6} />
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <div className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)]">
            <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)] block">
              Current ETH Price
            </span>
            <span className="text-sm font-mono font-medium text-[var(--text-primary)] mt-0.5 block">
              ${ethPrice.toLocaleString("en-US")}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)]">
            <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)] block">
              Liquidation Price
            </span>
            <span className="text-sm font-mono font-medium text-[var(--danger)] mt-0.5 block">
              ${liquidationPrice.toLocaleString("en-US")}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)]">
            <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)] block">
              Distance to Liq
            </span>
            <span className="text-sm font-mono font-medium text-[var(--safe)] mt-0.5 block">
              -{Math.round(((ethPrice - liquidationPrice) / ethPrice) * 100)}%
            </span>
          </div>
          <div className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)]">
            <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)] block">
              Max Liq Penalty
            </span>
            <span className="text-sm font-mono font-medium text-[var(--warning)] mt-0.5 block">
              5.0% ($270+)
            </span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[var(--brand-bg)] border border-[var(--brand-glow)] text-xs text-[var(--text-secondary)] flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 text-[var(--brand)] shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            Tahansoe automates defensive repayments before liquidators seize collateral at a 5% discount. Next, set your target and trigger thresholds.
          </p>
        </div>
      </Card>

      <div className="flex justify-end pt-2">
        <Button variant="primary" size="md" onClick={onNext} className="gap-2">
          Configure Thresholds <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
