"use client";

import React, { useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Sparkles, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LayerBadge } from "@/components/ui/layer-badge";
import { Badge } from "@/components/ui/badge";

export interface StepReviewProps {
  triggerHF: number;
  targetHF: number;
  currentHF: number;
  ethPrice: number;
  l1Cap: number;
  l1Approved: boolean;
  l2Enabled: boolean;
  l2Source: string;
  l2Cap: number;
  l2Approved: boolean;
  l3Enabled: boolean;
  l3Cap: number;
  slippageBps: number;
  l3Approved: boolean;
  isActivated: boolean;
  onActivate: () => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepReview({
  triggerHF,
  targetHF,
  currentHF,
  ethPrice,
  l1Cap,
  l1Approved,
  l2Enabled,
  l2Source,
  l2Cap,
  l2Approved,
  l3Enabled,
  l3Cap,
  slippageBps,
  l3Approved,
  isActivated,
  onActivate,
  onNext,
  onBack,
}: StepReviewProps) {
  const [activating, setActivating] = useState(false);

  const triggerEthPrice = Math.max(0, Math.round((ethPrice * triggerHF) / currentHF));
  const dropPct = ethPrice > 0 ? Math.max(0, Math.round(((ethPrice - triggerEthPrice) / ethPrice) * 100)) : 0;

  const totalDefenseCap = l1Cap + (l2Enabled ? l2Cap : 0) + (l3Enabled ? l3Cap : 0);

  const handleActivate = () => {
    setActivating(true);
    setTimeout(() => {
      setActivating(false);
      onActivate();
    }, 900);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-light text-[var(--text-primary)] font-display">
          Review & Activate Policy
        </h2>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Review your 3-layer defensive configuration before writing the policy to the contract.
        </p>
      </div>

      <Card className="p-5 space-y-5">
        {/* Policy Summary Header */}
        <div className="p-4 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)] block">
              Automated Defense Trigger
            </span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-lg font-mono font-medium text-[var(--warning)]">
                HF &lt; {triggerHF.toFixed(2)}
              </span>
              <span className="text-xs text-[var(--text-tertiary)] font-mono">
                (ETH &lt; ${triggerEthPrice.toLocaleString("en-US")} · -{dropPct}%)
              </span>
            </div>
          </div>

          <div className="flex items-center gap-6 sm:text-right">
            <div>
              <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)] block">
                Target HF
              </span>
              <span className="text-lg font-mono font-medium text-[var(--safe)] mt-1 block">
                {targetHF.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)] block">
                Total Defensive Cap
              </span>
              <span className="text-lg font-mono font-medium text-[var(--text-primary)] mt-1 block">
                ${totalDefenseCap.toLocaleString("en-US")}
              </span>
            </div>
          </div>
        </div>

        {/* 3 Layers Breakdown */}
        <div className="space-y-3">
          <span className="text-xs font-mono uppercase text-[var(--text-tertiary)] block">
            Cascade Defensive Order
          </span>

          {/* L1 */}
          <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--card)] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <LayerBadge layer={1} />
              <div>
                <span className="text-xs font-medium text-[var(--text-primary)] block">
                  Layer 1: Wallet Reserve
                </span>
                <span className="text-[11px] text-[var(--text-tertiary)] font-mono">
                  Up to {l1Cap.toLocaleString("en-US")} USDC from hot wallet
                </span>
              </div>
            </div>
            <Badge variant={l1Approved ? "safe" : "warning"} dot>
              {l1Approved ? "Approved" : "Pending"}
            </Badge>
          </div>

          {/* L2 */}
          <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--card)] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <LayerBadge layer={2} />
              <div>
                <span className="text-xs font-medium text-[var(--text-primary)] block">
                  Layer 2: Position Reserve
                </span>
                <span className="text-[11px] text-[var(--text-tertiary)] font-mono">
                  {l2Enabled
                    ? `Up to $${l2Cap.toLocaleString("en-US")} from ${l2Source}`
                    : "Not enabled (skipped)"}
                </span>
              </div>
            </div>
            {l2Enabled ? (
              <Badge variant={l2Approved ? "safe" : "warning"} dot>
                {l2Approved ? "Authorized" : "Pending"}
              </Badge>
            ) : (
              <span className="text-[11px] font-mono text-[var(--text-tertiary)]">Inactive</span>
            )}
          </div>

          {/* L3 */}
          <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--card)] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <LayerBadge layer={3} />
              <div>
                <span className="text-xs font-medium text-[var(--text-primary)] block">
                  Layer 3: Flash Deleverage
                </span>
                <span className="text-[11px] text-[var(--text-tertiary)] font-mono">
                  {l3Enabled
                    ? `Atomic flash loan deleverage (cap $${l3Cap.toLocaleString("en-US")}, max ${slippageBps} bps slippage)`
                    : "Not enabled (skipped)"}
                </span>
              </div>
            </div>
            {l3Enabled ? (
              <Badge variant={l3Approved ? "safe" : "warning"} dot>
                {l3Approved ? "Authorized" : "Pending"}
              </Badge>
            ) : (
              <span className="text-[11px] font-mono text-[var(--text-tertiary)]">Inactive</span>
            )}
          </div>
        </div>

        {/* Security Invariants Box */}
        <div className="p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] text-xs text-[var(--text-secondary)] space-y-1.5 leading-relaxed">
          <div className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
            <Lock className="w-3.5 h-3.5 text-[var(--brand)]" />
            <span>Non-Custodial Guarantee</span>
          </div>
          <p className="text-[11px]">
            Tahansoe contracts hold 0 funds. Allowances can only be drawn when on-chain price feeds push HF &lt; {triggerHF.toFixed(2)}, and funds are used strictly to repay debt.
          </p>
        </div>

        {/* Activation Button */}
        <div className="pt-2">
          {isActivated ? (
            <div className="p-4 rounded-xl bg-[var(--safe-bg)] border border-[var(--safe-border)] flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--safe)]">
                <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                <span>Policy Activated & Registered on Arbitrum Sepolia</span>
              </div>
              <Button variant="primary" size="sm" onClick={onNext} className="gap-1.5">
                Continue to Telegram <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          ) : (
            <Button
              variant="primary"
              size="lg"
              onClick={handleActivate}
              disabled={activating}
              className="w-full gap-2 font-medium"
            >
              {activating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Registering Policy on Chain…
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Activate Liquidation Protection
                </>
              )}
            </Button>
          )}
        </div>
      </Card>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" size="md" onClick={onBack} className="gap-2" disabled={activating}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        {isActivated && (
          <Button variant="outline" size="md" onClick={onNext} className="gap-2">
            Next: Telegram Alerts <ArrowRight className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
