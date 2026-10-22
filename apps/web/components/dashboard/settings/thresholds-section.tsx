"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { NumberInput } from "@/components/ui/number-input";
import { ZoneBar } from "@/components/ui/zone-bar";
import type { PolicySettings } from "@/lib/simulation-context";

interface ThresholdsSectionProps {
  policy: PolicySettings;
  onUpdatePolicy: (patch: Partial<PolicySettings>) => void;
}

export function ThresholdsSection({ policy, onUpdatePolicy }: ThresholdsSectionProps) {
  const isInvalid = policy.triggerHF >= policy.targetHF;
  const effectiveTarget = (policy.targetHF * (1 + policy.bufferPct / 100)).toFixed(2);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Protection Thresholds</CardTitle>
        <CardDescription>
          Guardian keepers execute when HF drops to trigger and restore to target. Formula: HF = (collateral × 0.825) ÷ debt
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Visual Zone Bar Preview */}
        <div className="p-4 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] space-y-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-[var(--text-tertiary)] uppercase tracking-wider">
              Threshold Configuration Preview
            </span>
            <span className="text-[var(--text-secondary)]">
              Effective Target: <strong className="text-[var(--safe)]">{effectiveTarget}</strong>
            </span>
          </div>

          <ZoneBar hf={policy.targetHF} trigger={policy.triggerHF} target={policy.targetHF} />

          <div className="grid grid-cols-3 gap-2 text-xs font-mono pt-1">
            <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border)]">
              <span className="text-[9px] uppercase text-[var(--text-tertiary)]">Trigger HF</span>
              <p className="text-sm font-semibold text-[var(--warning)]">
                {policy.triggerHF.toFixed(2)}
              </p>
              <p className="text-[9px] text-[var(--text-tertiary)]">Execution fires</p>
            </div>
            <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border)]">
              <span className="text-[9px] uppercase text-[var(--text-tertiary)]">Target HF</span>
              <p className="text-sm font-semibold text-[var(--safe)]">
                {policy.targetHF.toFixed(2)}
              </p>
              <p className="text-[9px] text-[var(--text-tertiary)]">Restored goal</p>
            </div>
            <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border)]">
              <span className="text-[9px] uppercase text-[var(--text-tertiary)]">Oracle Buffer</span>
              <p className="text-sm font-semibold text-[var(--brand)]">
                +{policy.bufferPct}%
              </p>
              <p className="text-[9px] text-[var(--text-tertiary)]">Slippage cushion</p>
            </div>
          </div>
        </div>

        {/* Inputs list */}
        <div className="divide-y divide-[var(--border)]">
          <div className="flex items-center justify-between gap-4 py-3.5 first:pt-0">
            <div>
              <p className="text-xs font-medium text-[var(--text-primary)]">Trigger Health Factor</p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 max-w-sm leading-relaxed">
                Repayment cascade fires when HF drops to this level. Recommended: 1.25–1.35.
              </p>
            </div>
            <div className="w-28 shrink-0">
              <NumberInput
                value={policy.triggerHF}
                onChange={(v) => onUpdatePolicy({ triggerHF: v })}
                min={1.05}
                max={1.5}
                step={0.01}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 py-3.5">
            <div>
              <p className="text-xs font-medium text-[var(--text-primary)]">Target Restored HF</p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 max-w-sm leading-relaxed">
                Repayment size is computed to lift HF back to this target. Must be &gt; Trigger HF.
              </p>
            </div>
            <div className="w-28 shrink-0">
              <NumberInput
                value={policy.targetHF}
                onChange={(v) => onUpdatePolicy({ targetHF: v })}
                min={1.1}
                max={2.5}
                step={0.01}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 py-3.5 last:pb-0">
            <div>
              <p className="text-xs font-medium text-[var(--text-primary)]">Conservative Buffer %</p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 max-w-sm leading-relaxed">
                Additional percentage buffer applied to the target to protect against oracle latency.
              </p>
            </div>
            <div className="w-28 shrink-0">
              <NumberInput
                value={policy.bufferPct}
                onChange={(v) => onUpdatePolicy({ bufferPct: v })}
                min={0}
                max={50}
                step={1}
                token="%"
              />
            </div>
          </div>
        </div>

        {isInvalid && (
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[var(--danger-bg)] border border-[var(--danger-border)] text-xs text-[var(--danger)]">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <p>Target Health Factor must be strictly greater than Trigger Health Factor.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
