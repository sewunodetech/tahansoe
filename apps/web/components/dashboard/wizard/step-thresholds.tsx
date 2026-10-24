"use client";

import React from "react";
import { ArrowLeft, ArrowRight, Info, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NumberInput } from "@/components/ui/number-input";
import { ZoneBar } from "@/components/ui/zone-bar";

export interface StepThresholdsProps {
  currentHF: number;
  ethPrice: number;
  triggerHF: number;
  setTriggerHF: (val: number) => void;
  targetHF: number;
  setTargetHF: (val: number) => void;
  bufferPct: number;
  setBufferPct: (val: number) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepThresholds({
  currentHF,
  ethPrice,
  triggerHF,
  setTriggerHF,
  targetHF,
  setTargetHF,
  bufferPct,
  setBufferPct,
  onNext,
  onBack,
}: StepThresholdsProps) {
  // Plain language translation
  const triggerEthPrice = Math.max(0, Math.round((ethPrice * triggerHF) / currentHF));
  const dropPct = ethPrice > 0 ? Math.max(0, Math.round(((ethPrice - triggerEthPrice) / ethPrice) * 100)) : 0;
  const isInvalid = triggerHF >= targetHF;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-light text-[var(--text-primary)] font-display">
          Set Protection Thresholds
        </h2>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Define when Tahansoe takes defensive action and the target Health Factor to restore.
        </p>
      </div>

      <Card className="p-5 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Trigger HF */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-mono uppercase text-[var(--text-tertiary)]">
                Trigger Health Factor
              </label>
              <span className="text-xs font-mono text-[var(--warning)] font-semibold">
                {triggerHF.toFixed(2)}
              </span>
            </div>
            <NumberInput
              value={triggerHF}
              onChange={(val) => setTriggerHF(Number(val.toFixed(2)))}
              min={1.1}
              max={1.5}
              step={0.05}
            />
            <p className="text-[11px] text-[var(--text-tertiary)] leading-tight">
              Defensive actions kick in automatically when HF drops to this level.
            </p>
          </div>

          {/* Target HF */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-mono uppercase text-[var(--text-tertiary)]">
                Target Health Factor
              </label>
              <span className="text-xs font-mono text-[var(--safe)] font-semibold">
                {targetHF.toFixed(2)}
              </span>
            </div>
            <NumberInput
              value={targetHF}
              onChange={(val) => setTargetHF(Number(val.toFixed(2)))}
              min={1.3}
              max={2.5}
              step={0.05}
            />
            <p className="text-[11px] text-[var(--text-tertiary)] leading-tight">
              Position is restored to this safe buffer after repayment.
            </p>
          </div>

          {/* Buffer % */}
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-mono uppercase text-[var(--text-tertiary)]">
                Safety Execution Buffer (%)
              </label>
              <span className="text-xs font-mono text-[var(--brand)] font-semibold">
                +{bufferPct}%
              </span>
            </div>
            <NumberInput
              value={bufferPct}
              onChange={(val) => setBufferPct(val)}
              min={0}
              max={30}
              step={1}
            />
            <p className="text-[11px] text-[var(--text-tertiary)] leading-tight">
              Extra repayment buffer to ensure Health Factor clears volatility swings.
            </p>
          </div>
        </div>

        {/* Translation Card */}
        <div className="p-4 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
            <Info className="w-4 h-4 text-[var(--brand)]" />
            <span>Plain-English Translation</span>
          </div>

          <div className="text-xs text-[var(--text-secondary)] space-y-1.5 font-sans leading-relaxed">
            <p>
              • We act when ETH drops to <strong className="text-[var(--warning)] font-mono">${triggerEthPrice.toLocaleString("en-US")}</strong> (a <strong className="text-[var(--text-primary)]">-{dropPct}% drop</strong> from ${ethPrice.toLocaleString("en-US")}).
            </p>
            <p>
              • Automated remediation repays debt to lift your Health Factor back up to <strong className="text-[var(--safe)] font-mono">{targetHF.toFixed(2)}</strong>.
            </p>
            <p>
              • Standard Aave liquidation would only occur if HF hit 1.0 (ETH $1,556), giving Tahansoe a wide safety margin.
            </p>
          </div>
        </div>

        {/* Visual Zone Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-[var(--text-tertiary)]">
            <span>Visual Calibration</span>
            <span>Trigger {triggerHF.toFixed(2)} → Target {targetHF.toFixed(2)}</span>
          </div>
          <ZoneBar hf={currentHF} trigger={triggerHF} target={targetHF} />
        </div>

        {isInvalid && (
          <div className="p-3 rounded-xl bg-[var(--danger-bg)] border border-[var(--danger-border)] text-xs text-[var(--danger)] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Target Health Factor must be higher than Trigger Health Factor.</span>
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" size="md" onClick={onBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={onNext}
          disabled={isInvalid}
          className="gap-2"
        >
          Next: Layer 1 Wallet Reserve <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
