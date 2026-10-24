"use client";

import React, { useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NumberInput } from "@/components/ui/number-input";
import { AmountPresets } from "@/components/ui/amount-presets";
import { demoCapPresets } from "@/lib/cap-presets";
import { LayerBadge } from "@/components/ui/layer-badge";
import { ApprovalExplainer } from "@/components/ui/approval-explainer";
import { TxPreviewModal } from "@/components/dashboard/protection/tx-preview-modal";

export interface StepLayer1Props {
  cap: number;
  setCap: (val: number) => void;
  approved: boolean;
  onApprove: () => void;
  debtUsd: number;
  triggerHF: number;
  targetHF: number;
  onNext: () => void;
  onBack: () => void;
}

export function StepLayer1({
  cap,
  setCap,
  approved,
  onApprove,
  debtUsd,
  triggerHF,
  targetHF,
  onNext,
  onBack,
}: StepLayer1Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const coversPct = debtUsd > 0 ? Math.min(100, Math.round((cap / debtUsd) * 100)) : 100;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <LayerBadge layer={1} showName />
          <span className="text-xs font-mono text-[var(--text-tertiary)]">Priority 1 Defense</span>
        </div>
        <h2 className="text-xl font-light text-[var(--text-primary)] font-display">
          Layer 1: Wallet Reserve
        </h2>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Approve USDC in your hot wallet. Tahansoe draws only up to your cap and only to repay your own debt.
        </p>
      </div>

      <Card className="p-5 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-2">
            <label className="text-xs font-mono uppercase text-[var(--text-tertiary)]">
              Approved Cap (USDC)
            </label>
            <AmountPresets
              presets={demoCapPresets(debtUsd, triggerHF, targetHF)}
              current={cap}
              onSelect={(val) => setCap(val)}
            />
            <NumberInput
              value={cap}
              onChange={(val) => setCap(val)}
              token="USDC"
              min={100}
              max={50000}
              step={100}
            />
            <p className="text-[11px] text-[var(--text-tertiary)] leading-tight">
              Maximum USDC Tahansoe can ever pull to repay debt.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] flex flex-col justify-center text-xs font-mono space-y-1.5">
            <div className="flex justify-between">
              <span className="text-[var(--text-tertiary)]">Total Debt</span>
              <span className="text-[var(--text-primary)]">${debtUsd.toLocaleString("en-US")} USDC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-tertiary)]">Coverage Provided</span>
              <span className="text-[var(--brand)] font-semibold">{coversPct}% of active debt</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-[var(--border)]">
              <span className="text-[var(--text-tertiary)]">Allowance State</span>
              <span className={approved ? "text-[var(--safe)] font-semibold" : "text-[var(--warning)]"}>
                {approved ? "Approved ✓" : "Pending Approval"}
              </span>
            </div>
          </div>
        </div>

        {/* Security / Approval Explainer */}
        <div className="pt-2">
          <ApprovalExplainer
            layer={1}
            tokenSymbol="USDC"
            amountCap={`${cap.toLocaleString("en-US")} USDC`}
          />
        </div>

        {/* Action Button */}
        <div className="pt-2 flex items-center justify-between">
          <div className="text-xs text-[var(--text-tertiary)] font-mono">
            {approved ? (
              <span className="flex items-center gap-1.5 text-[var(--safe)]">
                <CheckCircle2 className="w-4 h-4" /> Ready for defense
              </span>
            ) : (
              <span>Allowance required before activation</span>
            )}
          </div>

          {approved ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setModalOpen(true)}
              className="text-xs font-mono"
            >
              Update / Re-approve Cap
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              onClick={() => setModalOpen(true)}
              className="gap-2"
            >
              <Zap className="w-4 h-4" /> Review & Approve Layer 1
            </Button>
          )}
        </div>
      </Card>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" size="md" onClick={onBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Button variant="primary" size="md" onClick={onNext} className="gap-2">
          Next: Layer 2 Position Reserve <ArrowRight className="w-4 h-4" />
        </Button>
      </div>

      <TxPreviewModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        layer={1}
        tokenSymbol="USDC"
        amountCap={`${cap.toLocaleString("en-US")} USDC`}
        onConfirm={onApprove}
      />
    </div>
  );
}
