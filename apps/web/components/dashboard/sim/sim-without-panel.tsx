"use client";

import React from "react";
import { ShieldOff } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { unprotectedOutcome, WETH_LIQUIDATION_BONUS } from "@/lib/sim/fee";
import { useSimSession, useSimStatus } from "@/lib/sim/hooks";
import { useSimDashboard, type SimBaseline } from "./sim-context";

/** Mock simnet starts ETH at $3,000; the sample is 2 ETH at HF 1.8 with WETH's LT of 0.83. */
const SAMPLE_BASELINE: SimBaseline = { collateralEth: 2, debtUsd: (2 * 3_000 * 0.83) / 1.8, liquidationThreshold: 0.83 };

const usd = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

/**
 * The same position with no Guardian: its HF at the current simulation price and what an Aave
 * liquidation would cost (spec m1-simulation-mode §2). No liquidator runs on the fork; this is math.
 */
export function SimWithoutPanel() {
  const { data: session } = useSimSession();
  const { data: status } = useSimStatus(Boolean(session));
  const { baseline } = useSimDashboard();

  const position = baseline ?? (session?.mock ? SAMPLE_BASELINE : null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldOff className="size-4 text-[var(--danger)]" /> Without Tahansoe
        </CardTitle>
        <CardDescription className="text-xs">
          {baseline ? "Your position as you opened it, never protected." : "The sample position (2 ETH, HF 1.8), never protected."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!position || !status ? (
          <p className="text-xs text-[var(--text-tertiary)]">Open and protect a position to compare.</p>
        ) : (
          <WithoutBody position={position} price={status.price} />
        )}
      </CardContent>
    </Card>
  );
}

function WithoutBody({ position, price }: { position: SimBaseline; price: number }) {
  const out = unprotectedOutcome(position, price);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
          <p className="text-[10px] font-mono uppercase text-[var(--text-tertiary)]">Health Factor</p>
          <p className={`text-xl font-mono font-light ${out.liquidatable ? "text-[var(--danger)]" : "text-[var(--text-primary)]"}`}>
            {Number.isFinite(out.hf) ? out.hf.toFixed(2) : "—"}
          </p>
        </div>
        <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
          <p className="text-[10px] font-mono uppercase text-[var(--text-tertiary)]">Est. liquidation penalty</p>
          <p className={`text-xl font-mono font-light ${out.liquidatable ? "text-[var(--danger)]" : "text-[var(--text-primary)]"}`}>
            {out.liquidatable ? usd(out.penaltyUsd) : "$0.00"}
          </p>
        </div>
      </div>
      <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
        {out.liquidatable
          ? `Below HF 1.0 a liquidator can repay ${usd(out.debtRepaidUsd)} of debt and take that much WETH plus a ${(WETH_LIQUIDATION_BONUS * 100).toFixed(0)}% bonus. That bonus is your loss.`
          : `Still above HF 1.0 at ETH ${usd(price)}. Crash the price to see where an unprotected position gets liquidated.`}
      </p>
    </div>
  );
}
