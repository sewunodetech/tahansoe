"use client";

import React, { useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NumberInput } from "@/components/ui/number-input";
import { AmountPresets } from "@/components/ui/amount-presets";
import { demoCapPresets } from "@/lib/cap-presets";
import { Switch } from "@/components/ui/switch";
import { LayerBadge } from "@/components/ui/layer-badge";
import { ApprovalExplainer } from "@/components/ui/approval-explainer";
import { TxPreviewModal } from "@/components/dashboard/protection/tx-preview-modal";

export interface StepLayer2Props {
  enabled: boolean;
  setEnabled: (val: boolean) => void;
  cap: number;
  setCap: (val: number) => void;
  source: string;
  setSource: (val: string) => void;
  approved: boolean;
  onApprove: () => void;
  debtUsd: number;
  triggerHF: number;
  targetHF: number;
  onNext: () => void;
  onBack: () => void;
}

const VAULT_OPTIONS = [
  { id: "morpho-steak-usdc", name: "Morpho Vault (steakUSDC)", apy: "6.8%", protocol: "Morpho Blue" },
  { id: "aave-v3-ausdc", name: "Aave V3 aUSDC", apy: "4.2%", protocol: "Aave V3" },
  { id: "yearn-v3-usdc", name: "Yearn V3 USDC Vault", apy: "5.1%", protocol: "Yearn" },
];

export function StepLayer2({
  enabled,
  setEnabled,
  cap,
  setCap,
  source,
  setSource,
  approved,
  onApprove,
  debtUsd,
  triggerHF,
  targetHF,
  onNext,
  onBack,
}: StepLayer2Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const coversPct = debtUsd > 0 ? Math.min(100, Math.round((cap / debtUsd) * 100)) : 100;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <LayerBadge layer={2} showName />
          <span className="text-xs font-mono text-[var(--text-tertiary)]">Priority 2 Defense · Optional</span>
        </div>
        <h2 className="text-xl font-light text-[var(--text-primary)] font-display">
          Layer 2: Position Reserve
        </h2>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Redeem shares from an ERC-4626 vault or secondary lending position if hot wallet USDC is depleted.
        </p>
      </div>

      <Card className="p-5 space-y-5">
        {/* Enable / Disable Switch */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
          <div>
            <span className="text-sm font-medium text-[var(--text-primary)] block">
              Enable Layer 2 Position Reserve
            </span>
            <span className="text-xs text-[var(--text-tertiary)] block mt-0.5">
              Activates when Layer 1 is exhausted or insufficient.
            </span>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {enabled ? (
          <>
            {/* Vault Source Selection */}
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase text-[var(--text-tertiary)] block">
                Select Source Vault / Position
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {VAULT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSource(opt.name)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      source === opt.name
                        ? "border-[var(--brand)] bg-[var(--brand-bg)]"
                        : "border-[var(--border)] bg-[var(--bg-subtle)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)]">
                        {opt.protocol}
                      </span>
                      <span className="text-[10px] font-mono text-[var(--safe)]">{opt.apy} APY</span>
                    </div>
                    <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                      {opt.name}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Cap & Coverage */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
              <div className="space-y-2">
                <label className="text-xs font-mono uppercase text-[var(--text-tertiary)]">
                  Redemption Cap (USD)
                </label>
                <AmountPresets
                  presets={demoCapPresets(debtUsd, triggerHF, targetHF)}
                  current={cap}
                  onSelect={(val) => setCap(val)}
                />
                <NumberInput
                  value={cap}
                  onChange={(val) => setCap(val)}
                  token="USD"
                  min={100}
                  max={50000}
                  step={250}
                />
                <p className="text-[11px] text-[var(--text-tertiary)] leading-tight">
                  Maximum dollar value redeemed from this vault.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] flex flex-col justify-center text-xs font-mono space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-[var(--text-tertiary)]">Selected Source</span>
                  <span className="text-[var(--text-primary)] truncate max-w-[170px]">{source}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-tertiary)]">Coverage Added</span>
                  <span className="text-[var(--brand)] font-semibold">+{coversPct}% of debt</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-[var(--border)]">
                  <span className="text-[var(--text-tertiary)]">Authorization</span>
                  <span className={approved ? "text-[var(--safe)] font-semibold" : "text-[var(--warning)]"}>
                    {approved ? "Authorized ✓" : "Pending Authorization"}
                  </span>
                </div>
              </div>
            </div>

            {/* Explainer */}
            <div className="pt-2">
              <ApprovalExplainer
                layer={2}
                tokenSymbol="Vault Shares"
                amountCap={`$${cap.toLocaleString()}`}
              />
            </div>

            {/* Approval CTA */}
            <div className="pt-2 flex items-center justify-between">
              <div className="text-xs text-[var(--text-tertiary)] font-mono">
                {approved ? (
                  <span className="flex items-center gap-1.5 text-[var(--safe)]">
                    <CheckCircle2 className="w-4 h-4" /> Ready for fallback defense
                  </span>
                ) : (
                  <span>Authorization required when Layer 2 is enabled</span>
                )}
              </div>

              {approved ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setModalOpen(true)}
                  className="text-xs font-mono"
                >
                  Update Cap / Position
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setModalOpen(true)}
                  className="gap-2"
                >
                  <Zap className="w-4 h-4" /> Review & Authorize Layer 2
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="py-6 text-center text-xs text-[var(--text-tertiary)] space-y-2">
            <p>Layer 2 is currently disabled. Protection will cascade directly from Layer 1 to Layer 3.</p>
            <Button variant="outline" size="sm" onClick={() => setEnabled(true)}>
              Enable Layer 2
            </Button>
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" size="md" onClick={onBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Button variant="primary" size="md" onClick={onNext} className="gap-2">
          Next: Layer 3 Flash Deleverage <ArrowRight className="w-4 h-4" />
        </Button>
      </div>

      <TxPreviewModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        layer={2}
        tokenSymbol="Vault Shares"
        amountCap={`$${cap.toLocaleString()}`}
        onConfirm={onApprove}
      />
    </div>
  );
}
