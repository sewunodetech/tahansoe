"use client";

import React, { useState, useMemo } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { AlertCircle, Info, Loader2, Shield } from "lucide-react";
import type { PositionDetail } from "@tahansoe/domain";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import { LayerBadge } from "@/components/ui/layer-badge";
import { useGuardianV4 } from "@/hooks/useGuardianV4";
import { validatePolicyInputs } from "@/lib/guardian-v4";
import { hfLabel, usd } from "@/lib/positions/format";

export interface PositionProtectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: PositionDetail;
  initialDebtAsset?: Address;
  onSuccess?: () => void;
}

export function PositionProtectionDialog({
  open,
  onOpenChange,
  position,
  initialDebtAsset,
  onSuccess,
}: PositionProtectionDialogProps) {
  const g4 = useGuardianV4();
  const isAave = position.protocol === "aave-v3";
  const isMorpho = position.protocol === "morpho-blue";

  // For Aave: which debt asset is being protected
  const [selectedDebtAsset, setSelectedDebtAsset] = useState<Address>(() => {
    if (initialDebtAsset) return initialDebtAsset;
    return position.debt[0]?.address ?? ("0x0000000000000000000000000000000000000000" as Address);
  });

  const activeDebt = useMemo(() => {
    if (isAave) {
      return (
        position.debt.find((d) => d.address.toLowerCase() === selectedDebtAsset.toLowerCase()) ??
        position.debt[0]
      );
    }
    return position.debt[0];
  }, [isAave, position.debt, selectedDebtAsset]);

  // Existing policy if any
  const existingPolicy = useMemo(() => {
    if (isAave && activeDebt) {
      return g4.aavePolicies.get(activeDebt.address.toLowerCase());
    }
    if (isMorpho) {
      return g4.morphoPolicies.get(position.id.toLowerCase());
    }
    return null;
  }, [isAave, isMorpho, activeDebt, position.id, g4.aavePolicies, g4.morphoPolicies]);

  // Form states
  const [triggerHf, setTriggerHf] = useState<number>(existingPolicy?.triggerHf ?? (isMorpho ? 1.15 : 1.3));
  const [targetHf, setTargetHf] = useState<number>(existingPolicy?.targetHf ?? (isMorpho ? 1.4 : 1.6));
  const [maxRepay, setMaxRepay] = useState<string>(() => {
    if (existingPolicy && activeDebt) {
      return formatUnits(existingPolicy.maxRepayPerAction, activeDebt.decimals);
    }
    if (activeDebt && activeDebt.amount > 0n) {
      // default to 50% of debt
      const half = activeDebt.amount / 2n;
      return formatUnits(half > 0n ? half : activeDebt.amount, activeDebt.decimals);
    }
    return "100";
  });

  // Layer 2 configuration
  const [l2Enabled, setL2Enabled] = useState(false);
  const [l2Kind, setL2Kind] = useState<number>(1); // 1 = ERC4626, 2 = aToken
  const [l2Source, setL2Source] = useState<string>("");
  const [l2MaxAssets, setL2MaxAssets] = useState<string>("");

  // Layer 3 configuration (Aave only)
  const [l3Enabled, setL3Enabled] = useState(false);
  const [l3Collateral, setL3Collateral] = useState<string>(position.collateral[0]?.address ?? "");
  const [l3MaxCollateral, setL3MaxCollateral] = useState<string>("0.5");
  const [l3SlippageBps, setL3SlippageBps] = useState<number>(50);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const decimals = activeDebt?.decimals ?? 18;
  const maxRepayUnits = useMemo(() => {
    try {
      return maxRepay ? parseUnits(maxRepay, decimals) : 0n;
    } catch {
      return 0n;
    }
  }, [maxRepay, decimals]);

  const validation = validatePolicyInputs({
    triggerHf,
    targetHf,
    maxRepayPerAction: maxRepayUnits,
  });

  const handleSave = async () => {
    setFormError(null);
    if (!validation.valid) {
      setFormError(validation.error ?? "Invalid policy inputs");
      return;
    }

    setSaving(true);
    try {
      if (isAave && activeDebt) {
        // 1. Set policy on Aave Guardian v4
        const ok = await g4.actions.setAavePolicy(
          activeDebt.address,
          triggerHf,
          targetHf,
          maxRepayUnits
        );
        if (!ok) throw new Error(g4.tx.error ?? "Failed to set Aave protection policy");

        // 2. Set Layer 2 if enabled
        if (l2Enabled && l2Source) {
          const l2Units = l2MaxAssets ? parseUnits(l2MaxAssets, decimals) : maxRepayUnits;
          await g4.actions.setAaveLayer2(activeDebt.address, l2Kind, l2Source as Address, l2Units);
        }

        // 3. Set Layer 3 if enabled
        if (l3Enabled && l3Collateral) {
          const collatAsset = position.collateral.find(
            (c) => c.address.toLowerCase() === l3Collateral.toLowerCase()
          );
          const collatDecimals = collatAsset?.decimals ?? 18;
          const collatUnits = parseUnits(l3MaxCollateral || "0.5", collatDecimals);
          await g4.actions.setAaveLayer3(
            activeDebt.address,
            true,
            l3Collateral as Address,
            collatUnits,
            l3SlippageBps
          );
        }
      } else if (isMorpho) {
        const marketId = position.id as `0x${string}`;
        // 1. Set policy on Morpho Guardian v4
        const ok = await g4.actions.setMorphoPolicy(
          marketId,
          triggerHf,
          targetHf,
          maxRepayUnits
        );
        if (!ok) throw new Error(g4.tx.error ?? "Failed to set Morpho protection policy");

        // 2. Set Layer 2 if enabled
        if (l2Enabled && l2Source) {
          const l2Units = l2MaxAssets ? parseUnits(l2MaxAssets, decimals) : maxRepayUnits;
          await g4.actions.setMorphoLayer2(marketId, l2Source as Address, l2Units);
        }
      }

      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save policy");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 text-[var(--brand)]">
            <Shield className="size-4" />
            <span className="text-xs font-mono uppercase tracking-wider">
              {isAave ? "Aave V3" : "Morpho Blue"} Position Protection
            </span>
          </div>
          <DialogTitle className="text-lg font-medium text-[var(--text-primary)]">
            Protect this position
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--text-tertiary)]">
            Set an automated protection policy. Guardian repays debt when your Health Factor reaches the trigger.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Position summary */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-xs font-mono space-y-1.5">
            <div className="flex justify-between">
              <span className="text-[var(--text-tertiary)]">Current Health Factor</span>
              <span className="text-[var(--text-primary)] font-medium">
                {hfLabel(position.healthFactor ? Number(position.healthFactor) / 1e18 : null)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-tertiary)]">Collateral Value</span>
              <span className="text-[var(--text-primary)]">
                {usd(Number(position.collateralValueUsd) / 1e8)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-tertiary)]">Total Debt</span>
              <span className="text-[var(--text-primary)]">
                {usd(Number(position.debtValueUsd) / 1e8)}
              </span>
            </div>
          </div>

          {/* Aave: choose debt asset */}
          {isAave && position.debt.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--text-primary)]">
                Select debt asset to protect
              </label>
              <div className="grid grid-cols-2 gap-2">
                {position.debt.map((d) => (
                  <button
                    key={d.address}
                    type="button"
                    onClick={() => setSelectedDebtAsset(d.address)}
                    className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                      selectedDebtAsset.toLowerCase() === d.address.toLowerCase()
                        ? "border-[var(--brand)] bg-[var(--brand-bg)] text-[var(--text-primary)]"
                        : "border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <p className="font-mono font-medium">{d.symbol}</p>
                    <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                      Debt: {formatUnits(d.amount, d.decimals)} {d.symbol}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Policy trigger and target */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-primary)] block mb-1">
                Trigger Health Factor
              </label>
              <NumberInput
                value={triggerHf}
                onChange={setTriggerHf}
                min={1.05}
                max={3.0}
                step={0.05}
              />
              <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
                When HF drops to this level, Guardian triggers repayment.
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-primary)] block mb-1">
                Target Health Factor
              </label>
              <NumberInput
                value={targetHf}
                onChange={setTargetHf}
                min={1.2}
                max={5.0}
                step={0.05}
              />
              <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
                Guardian repays enough debt to restore HF to this target.
              </p>
            </div>
          </div>

          {/* Max repay per action */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[var(--text-primary)]">
                Max repay per action ({activeDebt?.symbol ?? "Token"})
              </label>
              <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
                Borrow: {activeDebt ? formatUnits(activeDebt.amount, activeDebt.decimals) : "0"} {activeDebt?.symbol}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={maxRepay}
                onChange={(e) => setMaxRepay(e.target.value)}
                placeholder="Amount in token units"
                className="w-full h-9 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand)]"
              />
              {activeDebt && activeDebt.amount > 0n && (
                <button
                  type="button"
                  onClick={() => setMaxRepay(formatUnits(activeDebt.amount, activeDebt.decimals))}
                  className="px-2.5 py-1.5 rounded-md border border-[var(--border)] text-[11px] font-mono text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  100%
                </button>
              )}
            </div>
          </div>

          {/* Layer 2: Vault Reserve */}
          <div className="rounded-lg border border-[var(--border)] p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LayerBadge layer={2} showName />
                <span className="text-xs text-[var(--text-secondary)]">Vault Reserve</span>
              </div>
              <Switch checked={l2Enabled} onCheckedChange={setL2Enabled} />
            </div>
            {l2Enabled && (
              <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                {isAave && (
                  <div>
                    <label className="text-[11px] text-[var(--text-tertiary)] block mb-1">Source kind</label>
                    <select
                      value={l2Kind}
                      onChange={(e) => setL2Kind(Number(e.target.value))}
                      className="w-full h-8 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-2 text-xs font-mono text-[var(--text-primary)]"
                    >
                      <option value={1}>ERC-4626 Vault</option>
                      <option value={2}>aToken</option>
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-[11px] text-[var(--text-tertiary)] block mb-1">
                    {isMorpho ? "ERC-4626 vault address (underlying must equal loan token)" : "Vault or token source address"}
                  </label>
                  <input
                    type="text"
                    value={l2Source}
                    onChange={(e) => setL2Source(e.target.value)}
                    placeholder="0x..."
                    className="w-full h-8 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-2.5 text-xs font-mono text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[var(--text-tertiary)] block mb-1">Max assets per action</label>
                  <input
                    type="text"
                    value={l2MaxAssets}
                    onChange={(e) => setL2MaxAssets(e.target.value)}
                    placeholder="Leave empty to match policy cap"
                    className="w-full h-8 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-2.5 text-xs font-mono text-[var(--text-primary)]"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Layer 3: Flash Deleverage (Aave only) */}
          {isAave && (
            <div className="rounded-lg border border-[var(--border)] p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <LayerBadge layer={3} showName />
                  <span className="text-xs text-[var(--text-secondary)]">Flash Deleverage</span>
                </div>
                <Switch checked={l3Enabled} onCheckedChange={setL3Enabled} />
              </div>
              {l3Enabled && (
                <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                  <div>
                    <label className="text-[11px] text-[var(--text-tertiary)] block mb-1">Collateral to sell</label>
                    <select
                      value={l3Collateral}
                      onChange={(e) => setL3Collateral(e.target.value)}
                      className="w-full h-8 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-2 text-xs font-mono text-[var(--text-primary)]"
                    >
                      {position.collateral.map((c) => (
                        <option key={c.address} value={c.address}>
                          {c.symbol} ({c.address.slice(0, 8)}...)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-[var(--text-tertiary)] block mb-1">Max collateral</label>
                      <input
                        type="text"
                        value={l3MaxCollateral}
                        onChange={(e) => setL3MaxCollateral(e.target.value)}
                        placeholder="0.5"
                        className="w-full h-8 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-2 text-xs font-mono text-[var(--text-primary)]"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[var(--text-tertiary)] block mb-1">Max slippage (bps)</label>
                      <input
                        type="number"
                        value={l3SlippageBps}
                        onChange={(e) => setL3SlippageBps(Number(e.target.value))}
                        className="w-full h-8 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-2 text-xs font-mono text-[var(--text-primary)]"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Morpho explicit note */}
          {isMorpho && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3 flex items-start gap-2.5">
              <Info className="size-4 text-[var(--brand)] shrink-0 mt-0.5" />
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Layer 3 flash deleverage for Morpho is not available yet. Tahansoe never asks for Morpho authorization in this version.
              </p>
            </div>
          )}

          {formError && (
            <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 flex items-start gap-2">
              <AlertCircle className="size-4 text-[var(--danger)] shrink-0 mt-0.5" />
              <p className="text-xs text-[var(--danger)]">{formError}</p>
            </div>
          )}
        </div>

        <DialogFooter className="pt-3 border-t border-[var(--border)] gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={saving || !validation.valid}
          >
            {saving ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" /> Saving...
              </span>
            ) : (
              "Save protection policy"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
