"use client";

import React, { useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import { LayerBadge } from "@/components/ui/layer-badge";
import { ApprovalExplainer } from "@/components/ui/approval-explainer";
import { TxPreviewModal } from "@/components/dashboard/protection/tx-preview-modal";

export interface StepLayer3Props {
  enabled: boolean;
  setEnabled: (val: boolean) => void;
  cap: number;
  setCap: (val: number) => void;
  slippageBps: number;
  setSlippageBps: (val: number) => void;
  approved: boolean;
  onApprove: () => void;
  debtUsd: number;
  onNext: () => void;
  onBack: () => void;
}

export function StepLayer3({
  enabled,
  setEnabled,
  cap,
  setCap,
  slippageBps,
  setSlippageBps,
  approved,
  onApprove,
  debtUsd,
  onNext,
  onBack,
}: StepLayer3Props) {
  const [modalOpen, setModalOpen] = useState(false);

  // Cost comparison math
  const flashFee = Math.round(debtUsd * 0.0005 * 100) / 100; // 0.05% Aave flash loan fee
  const swapEst = Math.round((debtUsd * (slippageBps / 10000)) * 100) / 100;
  const totalCost = (flashFee + swapEst).toFixed(2);
  const liqPenalty = Math.round(debtUsd * 0.05); // 5% liquidation penalty
  const savedAmount = Math.max(0, liqPenalty - parseFloat(totalCost)).toFixed(2);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <LayerBadge layer={3} showName />
          <span className="text-xs font-mono text-[var(--text-tertiary)]">Priority 3 Defense · Last Resort</span>
        </div>
        <h2 className="text-xl font-light text-[var(--text-primary)] font-display">
          Layer 3: Flash Deleverage
        </h2>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Atomic flash loan deleverage: borrows debt, repays position, sells collateral, and settles flash loan in a single block.
        </p>
      </div>

      <Card className="p-5 space-y-5">
        {/* Enable / Disable Switch */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
          <div>
            <span className="text-sm font-medium text-[var(--text-primary)] block">
              Enable Layer 3 Flash Deleverage
            </span>
            <span className="text-xs text-[var(--text-tertiary)] block mt-0.5">
              Automated circuit breaker if Layers 1 and 2 are empty during severe market flash crashes.
            </span>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {enabled ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="text-xs font-mono uppercase text-[var(--text-tertiary)]">
                  Max Collateral Sold (USD)
                </label>
                <NumberInput
                  value={cap}
                  onChange={(val) => setCap(val)}
                  token="USD"
                  min={500}
                  max={100000}
                  step={500}
                />
                <p className="text-[11px] text-[var(--text-tertiary)] leading-tight">
                  Hard ceiling on the amount of collateral sold during atomic deleveraging.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-mono uppercase text-[var(--text-tertiary)]">
                    Max Slippage Tolerance
                  </label>
                  <span className="text-xs font-mono text-[var(--brand)] font-semibold">
                    {slippageBps} bps ({(slippageBps / 100).toFixed(2)}%)
                  </span>
                </div>
                <NumberInput
                  value={slippageBps}
                  onChange={(val) => setSlippageBps(val)}
                  token="bps"
                  min={10}
                  max={300}
                  step={10}
                />
                <p className="text-[11px] text-[var(--text-tertiary)] leading-tight">
                  Transaction reverts if DEX swap slippage exceeds this threshold.
                </p>
              </div>
            </div>

            {/* Cost Estimate Comparison Card */}
            <div className="p-4 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] space-y-3">
              <div className="flex items-center justify-between text-xs font-mono pb-2 border-b border-[var(--border)]">
                <span className="text-[var(--text-tertiary)] uppercase">Deleverage Cost vs Liquidation</span>
                <span className="text-[var(--safe)] font-semibold">Net Savings: +${savedAmount}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
                <div>
                  <span className="text-[var(--text-tertiary)] block text-[10px]">Flash Loan Fee (0.05%)</span>
                  <span className="text-[var(--text-primary)] font-medium">${flashFee.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-[var(--text-tertiary)] block text-[10px]">Swap Slippage Est.</span>
                  <span className="text-[var(--text-primary)] font-medium">~${swapEst.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-[var(--text-tertiary)] block text-[10px]">Aave Liq Penalty (5%)</span>
                  <span className="text-[var(--danger)] font-medium">-${liqPenalty.toFixed(2)}</span>
                </div>
              </div>

              <p className="text-[11px] text-[var(--text-secondary)] font-sans pt-1">
                Deleveraging via atomic flash loan incurs ~${totalCost} in protocol fees, saving over ${savedAmount} compared to liquidators taking 5.0% of your collateral.
              </p>
            </div>

            {/* Explainer */}
            <div className="pt-2">
              <ApprovalExplainer
                layer={3}
                tokenSymbol="Flash Loan"
                amountCap={`Up to $${cap.toLocaleString("en-US")}`}
              />
            </div>

            {/* Approval CTA */}
            <div className="pt-2 flex items-center justify-between">
              <div className="text-xs text-[var(--text-tertiary)] font-mono">
                {approved ? (
                  <span className="flex items-center gap-1.5 text-[var(--safe)]">
                    <CheckCircle2 className="w-4 h-4" /> Flash deleverage authorized
                  </span>
                ) : (
                  <span>Authorization required when Layer 3 is enabled</span>
                )}
              </div>

              {approved ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setModalOpen(true)}
                  className="text-xs font-mono"
                >
                  Update Parameters
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setModalOpen(true)}
                  className="gap-2"
                >
                  <Zap className="w-4 h-4" /> Review & Authorize Layer 3
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="py-6 text-center text-xs text-[var(--text-tertiary)] space-y-2">
            <p>Layer 3 is disabled. If Layers 1 and 2 are depleted, no flash loan will be taken.</p>
            <Button variant="outline" size="sm" onClick={() => setEnabled(true)}>
              Enable Layer 3
            </Button>
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" size="md" onClick={onBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Button variant="primary" size="md" onClick={onNext} className="gap-2">
          Next: Review & Activate <ArrowRight className="w-4 h-4" />
        </Button>
      </div>

      <TxPreviewModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        layer={3}
        tokenSymbol="Flash Loan"
        amountCap={`Up to $${cap.toLocaleString("en-US")}`}
        onConfirm={onApprove}
      />
    </div>
  );
}
