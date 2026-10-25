"use client";

import React, { useState, useMemo } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { AlertCircle, Bot, ExternalLink, Info, Loader2, Shield, Sparkles } from "lucide-react";
import { getChainConfig, type PositionDetail } from "@tahansoe/domain";
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
import { useLiveTarget } from "@/lib/live-target";
import { useSimSession } from "@/lib/sim/hooks";
import {
  formatPositionKeyAave,
  formatPositionKeyMorpho,
  calculateDefaultBand,
  validatePolicyInputs,
  validateTriggerBandInputs,
  getSavedTriggerBand,
  ZERO_ADDRESS,
} from "@/lib/guardian-v4";
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
  const target = useLiveTarget();
  const { data: simSession } = useSimSession(target.isSimulation);

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

  // Position key for Guardian v4
  const positionKey = useMemo(() => {
    if (isAave && activeDebt && g4.aaveGuardianAddress) {
      return formatPositionKeyAave({
        chainId: target.chain.id,
        guardian: g4.aaveGuardianAddress,
        debtAsset: activeDebt.address,
      });
    }
    if (isMorpho && g4.morphoGuardianAddress) {
      return formatPositionKeyMorpho({
        chainId: target.chain.id,
        guardian: g4.morphoGuardianAddress,
        marketId: position.id as `0x${string}`,
      });
    }
    return null;
  }, [isAave, isMorpho, activeDebt, g4.aaveGuardianAddress, g4.morphoGuardianAddress, target.chain.id, position.id]);

  // Existing protected position object from g4
  const existingProtectedPos = useMemo(() => {
    if (!positionKey) return null;
    return g4.protectedPositions.find((p) => p.positionKey.toLowerCase() === positionKey.toLowerCase()) ?? null;
  }, [g4.protectedPositions, positionKey]);

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

  // Saved trigger band in local state or localStorage
  const existingSavedBand = useMemo(() => {
    if (existingProtectedPos?.savedBand) return existingProtectedPos.savedBand;
    return positionKey ? getSavedTriggerBand(positionKey) : null;
  }, [existingProtectedPos, positionKey]);

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

  // Dynamic Trigger Band configuration
  // Risk agent: from simnet session if in simulation mode, else ChainConfig.riskAgent from chain registry
  const chainRiskAgent = useMemo(() => {
    if (target.isSimulation) {
      return (simSession?.contracts as { riskAgent?: Address } | undefined)?.riskAgent;
    }
    const cfg = getChainConfig(target.chain.id);
    return cfg?.riskAgent;
  }, [target.isSimulation, target.chain.id, simSession?.contracts]);

  const defaultBand = useMemo(() => {
    return calculateDefaultBand(triggerHf, targetHf);
  }, [triggerHf, targetHf]);

  const [dynamicTriggerEnabled, setDynamicTriggerEnabled] = useState<boolean>(() => {
    return existingSavedBand?.enabled ?? Boolean(existingProtectedPos?.dynamicTrigger?.active);
  });
  const [bandMinHf, setBandMinHf] = useState<number>(() => {
    return existingSavedBand?.minTriggerHf ?? defaultBand.minTriggerHf;
  });
  const [bandMaxHf, setBandMaxHf] = useState<number>(() => {
    return existingSavedBand?.maxTriggerHf ?? defaultBand.maxTriggerHf;
  });
  const [bandModified, setBandModified] = useState(false);

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

  const policyValidation = validatePolicyInputs({
    triggerHf,
    targetHf,
    maxRepayPerAction: maxRepayUnits,
  });

  const bandValidation = validateTriggerBandInputs({
    minTriggerHf: bandMinHf,
    maxTriggerHf: bandMaxHf,
    targetHf,
    riskAgent: chainRiskAgent,
    enabled: dynamicTriggerEnabled,
  });

  const isValid = policyValidation.valid && bandValidation.valid;

  const handleSave = async () => {
    setFormError(null);
    if (!policyValidation.valid) {
      setFormError(policyValidation.error ?? "Invalid policy inputs");
      return;
    }
    if (!bandValidation.valid) {
      setFormError(bandValidation.error ?? "Invalid trigger band");
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

        // 4. Set Trigger Band
        if (dynamicTriggerEnabled && chainRiskAgent) {
          await g4.actions.setAaveTriggerBand(activeDebt.address, bandMinHf, bandMaxHf, chainRiskAgent);
        } else if (!dynamicTriggerEnabled && (existingSavedBand?.enabled || existingProtectedPos?.dynamicTrigger?.active)) {
          // Turning off resets the band per GuardianCore with riskAgent = 0x0
          await g4.actions.setAaveTriggerBand(activeDebt.address, 0, 0, ZERO_ADDRESS);
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

        // 3. Set Trigger Band
        if (dynamicTriggerEnabled && chainRiskAgent) {
          await g4.actions.setMorphoTriggerBand(marketId, bandMinHf, bandMaxHf, chainRiskAgent);
        } else if (!dynamicTriggerEnabled && (existingSavedBand?.enabled || existingProtectedPos?.dynamicTrigger?.active)) {
          await g4.actions.setMorphoTriggerBand(marketId, 0, 0, ZERO_ADDRESS);
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
                onChange={(val) => {
                  setTriggerHf(val);
                  if (!bandModified) {
                    const b = calculateDefaultBand(val, targetHf);
                    setBandMinHf(b.minTriggerHf);
                    setBandMaxHf(b.maxTriggerHf);
                  }
                }}
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
                onChange={(val) => {
                  setTargetHf(val);
                  if (!bandModified) {
                    const b = calculateDefaultBand(triggerHf, val);
                    setBandMinHf(b.minTriggerHf);
                    setBandMaxHf(b.maxTriggerHf);
                  }
                }}
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

          {/* Dynamic trigger (Tahansoe risk agent) */}
          {target.isSimulation && !chainRiskAgent ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3 flex items-start gap-2.5">
              <Info className="size-4 text-[var(--text-tertiary)] shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-[var(--text-secondary)]">Dynamic trigger</p>
                <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed mt-0.5">
                  Dynamic triggers are disabled in Simulation Mode (no simulation risk agent configured).
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--border)] p-3.5 space-y-3.5 bg-[var(--bg-elevated)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bot className="size-4 text-[var(--brand)]" />
                  <div>
                    <span className="text-xs font-medium text-[var(--text-primary)] block">
                      Dynamic trigger (Tahansoe risk agent)
                    </span>
                    <span className="text-[11px] text-[var(--text-tertiary)]">
                      AI risk agent raises trigger preemptively when market volatility rises
                    </span>
                  </div>
                </div>
                <Switch
                  checked={dynamicTriggerEnabled}
                  onCheckedChange={(checked) => {
                    setDynamicTriggerEnabled(checked);
                    if (checked && !bandModified) {
                      setBandMinHf(defaultBand.minTriggerHf);
                      setBandMaxHf(defaultBand.maxTriggerHf);
                    }
                  }}
                />
              </div>

              {dynamicTriggerEnabled && (
                <div className="space-y-3 pt-3 border-t border-[var(--border)]">
                  {/* Active dynamic trigger notice if active */}
                  {existingProtectedPos?.dynamicTrigger?.active && (
                    <div className="rounded-md bg-[var(--brand-bg)] border border-[var(--brand-border)] p-2.5 flex items-start gap-2 text-xs">
                      <Sparkles className="size-3.5 text-[var(--brand)] shrink-0 mt-0.5" />
                      <div className="text-[11px] font-mono text-[var(--text-primary)]">
                        <span>Active dynamic trigger: {existingProtectedPos.dynamicTrigger.dynamicTriggerHf.toFixed(2)}</span>
                        <span className="text-[var(--text-tertiary)] block mt-0.5">
                          Expires in {Math.floor(existingProtectedPos.dynamicTrigger.remainingSeconds / 60)}m {existingProtectedPos.dynamicTrigger.remainingSeconds % 60}s
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Band inputs */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-medium text-[var(--text-primary)]">
                          Min Trigger HF
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setBandMinHf(defaultBand.minTriggerHf);
                          }}
                          className="text-[10px] text-[var(--brand)] hover:underline"
                        >
                          Reset ({defaultBand.minTriggerHf.toFixed(2)})
                        </button>
                      </div>
                      <NumberInput
                        value={bandMinHf}
                        onChange={(val) => {
                          setBandMinHf(val);
                          setBandModified(true);
                        }}
                        min={1.05}
                        max={bandMaxHf}
                        step={0.05}
                      />
                      <p className="text-[10px] text-[var(--text-tertiary)] mt-1 font-mono">
                        Default: static trigger ({triggerHf.toFixed(2)})
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-medium text-[var(--text-primary)]">
                          Max Trigger HF
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setBandMaxHf(defaultBand.maxTriggerHf);
                          }}
                          className="text-[10px] text-[var(--brand)] hover:underline"
                        >
                          Reset ({defaultBand.maxTriggerHf.toFixed(2)})
                        </button>
                      </div>
                      <NumberInput
                        value={bandMaxHf}
                        onChange={(val) => {
                          setBandMaxHf(val);
                          setBandModified(true);
                        }}
                        min={bandMinHf}
                        max={Math.min(3.0, targetHf - 0.01)}
                        step={0.05}
                      />
                      <p className="text-[10px] text-[var(--text-tertiary)] mt-1 font-mono">
                        Cap: min(target - 0.05, trigger + 0.25)
                      </p>
                    </div>
                  </div>

                  {/* Risk agent address (read-only with explorer link) */}
                  <div>
                    <label className="text-[11px] text-[var(--text-tertiary)] block mb-1">
                      Risk agent (read-only from registry)
                    </label>
                    <div className="flex items-center justify-between h-8 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-2.5 font-mono text-xs text-[var(--text-secondary)]">
                      <span>
                        {chainRiskAgent
                          ? `${chainRiskAgent.slice(0, 10)}...${chainRiskAgent.slice(-8)}`
                          : "No risk agent registered"}
                      </span>
                      {chainRiskAgent && target.explorerAddress(chainRiskAgent) && (
                        <a
                          href={target.explorerAddress(chainRiskAgent)!}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--brand)] hover:underline inline-flex items-center gap-1 text-[11px]"
                        >
                          Explorer <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Plain explanation */}
                  <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed bg-[var(--bg-subtle)] p-2 rounded border border-[var(--border)]">
                    Tahansoe may move your trigger inside this band when risk rises. It cannot move funds. If the agent stops, your static trigger applies.
                  </p>
                </div>
              )}
            </div>
          )}

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
            disabled={saving || !isValid}
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
