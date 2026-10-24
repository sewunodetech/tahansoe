"use client";

import React, { useState } from "react";
import { parseUnits, formatUnits, type Address } from "viem";
import { CheckCircle2 } from "lucide-react";
import { validatePolicy, MIN_TRIGGER_HF, MAX_TARGET_HF } from "@tahansoe/domain";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { LayerBadge } from "@/components/ui/layer-badge";
import { NumberInput } from "@/components/ui/number-input";
import { AmountPresets, type AmountPreset } from "@/components/ui/amount-presets";
import type { UseGuardianReturn } from "@/hooks/useGuardian";
import { TxStatus, formatToken } from "./live-shared";

type AllowanceMode = 1 | 3 | "custom";

export interface LivePolicyFormProps {
  g: UseGuardianReturn;
  asset: Address;
  onAssetChange: (asset: Address) => void;
}

/** Converts a typed amount to token units; invalid input counts as 0. */
function toUnits(value: string, decimals: number): bigint {
  try {
    return value ? parseUnits(value, decimals) : 0n;
  } catch {
    return 0n;
  }
}

function toInput(amount: bigint, decimals: number): string {
  // Two decimals are enough for a cap and keep the field readable.
  return String(Math.floor(Number(formatUnits(amount, decimals)) * 100) / 100);
}

/**
 * Layer 1 policy on the live Guardian: approve a bounded allowance, then save the
 * policy on-chain (M1 spec §3.1). Re-rendered with a new key when the on-chain
 * policy changes so the fields start from what the contract holds.
 */
export function LivePolicyForm({ g, asset, onAssetChange }: LivePolicyFormProps) {
  const token = g.token!;
  const existing = g.policy;

  const [trigger, setTrigger] = useState(existing?.triggerHf ?? 1.3);
  const [target, setTarget] = useState(existing?.targetHf ?? 1.6);
  const [maxRepay, setMaxRepay] = useState(() => {
    if (existing) return toInput(existing.maxRepayPerAction, token.decimals);
    const recommended = g.recommendedMaxRepay(1.3, 1.6);
    return recommended > 0n ? toInput(recommended, token.decimals) : "";
  });
  const [allowanceMode, setAllowanceMode] = useState<AllowanceMode>(3);
  const [customAllowance, setCustomAllowance] = useState("");

  const maxRepayUnits = toUnits(maxRepay, token.decimals);
  const requiredAllowance =
    allowanceMode === "custom" ? toUnits(customAllowance, token.decimals) : maxRepayUnits * BigInt(allowanceMode);

  const policyError = validatePolicy({ triggerHf: trigger, targetHf: target, maxRepayPerAction: maxRepayUnits });
  const allowanceError =
    requiredAllowance < maxRepayUnits ? "Allowance must cover at least one action" : null;
  const error = policyError ?? allowanceError;

  const approved = token.allowance >= requiredAllowance && requiredAllowance > 0n;
  const saved =
    existing?.enabled === true &&
    existing.debtAsset.toLowerCase() === asset.toLowerCase() &&
    existing.triggerHf === trigger &&
    existing.targetHf === target &&
    existing.maxRepayPerAction === maxRepayUnits;
  const busy = g.tx.step !== null;

  const recommended = g.recommendedMaxRepay(trigger, target);
  const repayPresets: AmountPreset<string>[] = [
    ...(recommended > 0n
      ? [{
          label: "Recommended",
          value: toInput(recommended, token.decimals),
          hint: "Repay needed to lift HF from the trigger back to the target",
        }]
      : []),
    ...[25, 50, 100]
      .filter(() => g.debtInToken > 0n)
      .map((pct) => ({
        label: `${pct}% of debt`,
        value: toInput((g.debtInToken * BigInt(pct)) / 100n, token.decimals),
      })),
    { label: "Max", value: toInput(token.balance, token.decimals), hint: "Your wallet balance" },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <LayerBadge layer={1} showName />
          {existing?.enabled && (
            <span className="text-[11px] font-mono text-[var(--safe)] inline-flex items-center gap-1">
              <CheckCircle2 className="size-3.5" /> Active on-chain
            </span>
          )}
        </div>
        <CardTitle className="text-sm mt-3">Layer 1: Wallet Reserve</CardTitle>
        <CardDescription className="text-xs">
          Tahansoe may use up to the amount below from your wallet, only to repay your own Aave debt, and only when your
          Health Factor drops under the trigger. Your tokens stay in your wallet until then.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Debt asset */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-mono uppercase text-[var(--text-tertiary)] block">Repay with</label>
          <div className="flex gap-2">
            {g.target.debtAssets.map((a) => (
              <button
                key={a.address}
                type="button"
                onClick={() => onAssetChange(a.address)}
                disabled={busy}
                className={`h-8 px-3 rounded-full border text-xs font-mono transition-colors cursor-pointer ${
                  a.address === asset
                    ? "border-[var(--brand)] bg-[var(--brand-bg)] text-[var(--brand)]"
                    : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
                }`}
              >
                {a.symbol}
              </button>
            ))}
          </div>
          <p className="text-[11px] font-mono text-[var(--text-tertiary)]">
            Wallet balance {formatToken(token.balance, token.decimals)} {token.symbol}
          </p>
        </div>

        {/* Thresholds */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-mono uppercase text-[var(--text-tertiary)] block">Act when HF falls below</label>
            <NumberInput value={trigger} onChange={setTrigger} min={MIN_TRIGGER_HF} max={MAX_TARGET_HF} step={0.05} />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-mono uppercase text-[var(--text-tertiary)] block">Bring HF back to</label>
            <NumberInput value={target} onChange={setTarget} min={MIN_TRIGGER_HF} max={MAX_TARGET_HF} step={0.05} />
          </div>
        </div>

        {/* Per-action cap */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-mono uppercase text-[var(--text-tertiary)] block">
            Most Tahansoe may repay in one action
          </label>
          <AmountPresets presets={repayPresets} current={maxRepay} onSelect={setMaxRepay} disabled={busy} />
          <NumberInput
            value={maxRepay}
            onValueChange={setMaxRepay}
            onChange={() => {}}
            token={token.symbol}
            min={0}
            step={1}
            placeholder="0"
          />
        </div>

        {/* Allowance */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-mono uppercase text-[var(--text-tertiary)] block">Total allowance</label>
          <AmountPresets<AllowanceMode>
            presets={[
              { label: "1 action", value: 1, hint: "Safest: re-approve after every rescue" },
              { label: "3 actions", value: 3, hint: "Covers repeated drops without re-approving" },
              { label: "Custom", value: "custom" },
            ]}
            current={allowanceMode}
            onSelect={setAllowanceMode}
            disabled={busy}
          />
          {allowanceMode === "custom" && (
            <NumberInput
              value={customAllowance}
              onValueChange={setCustomAllowance}
              onChange={() => {}}
              token={token.symbol}
              min={0}
              step={1}
              placeholder="0"
            />
          )}
          <p className="text-[11px] font-mono text-[var(--text-tertiary)]">
            Approving {formatToken(requiredAllowance, token.decimals)} {token.symbol} · currently approved{" "}
            {formatToken(token.allowance, token.decimals)} {token.symbol}. Never unlimited.
          </p>
        </div>

        {error && <p className="text-[11px] font-mono text-[var(--danger)]">{error}</p>}

        {/* Steps */}
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <Button
            variant={approved ? "outline" : "primary"}
            size="sm"
            className="flex-1"
            disabled={busy || !!error || approved}
            onClick={() => g.actions.approve(requiredAllowance)}
          >
            {approved ? <><CheckCircle2 className="size-3.5" /> {token.symbol} approved</> : `1. Approve ${token.symbol}`}
          </Button>
          <Button
            variant={saved ? "outline" : "primary"}
            size="sm"
            className="flex-1"
            disabled={busy || !!error || !approved || saved}
            onClick={() => g.actions.setPolicy(trigger, target, maxRepayUnits)}
          >
            {saved ? <><CheckCircle2 className="size-3.5" /> Policy saved</> : existing ? "2. Update policy" : "2. Save policy"}
          </Button>
        </div>
        <TxStatus tx={g.tx} steps={["approve", "setPolicy"]} />
      </CardContent>
    </Card>
  );
}
