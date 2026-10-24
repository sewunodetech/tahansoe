"use client";

import React, { useState } from "react";
import { parseUnits, formatUnits, isAddress, type Address } from "viem";
import { useReadContract } from "wagmi";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { LayerBadge } from "@/components/ui/layer-badge";
import { Input } from "@/components/ui/input";
import { aavePoolAbi } from "@/lib/contracts";
import type { UseGuardianReturn } from "@/hooks/useGuardian";
import { TxStatus } from "./live-shared";

const SLIPPAGE_PRESETS = [
  { label: "0.3%", bps: 30 },
  { label: "0.5%", bps: 50 },
  { label: "1.0%", bps: 100 },
];

export function LiveLayer3Form({ g }: { g: UseGuardianReturn }) {
  const existing = g.layer3;
  const DEFAULT_WETH = g.target.weth;

  const [enabled, setEnabled] = useState<boolean>(existing?.enabled ?? true);
  const [collateralAsset, setCollateralAsset] = useState<string>(
    existing?.collateralAsset && existing.collateralAsset !== "0x0000000000000000000000000000000000000000"
      ? existing.collateralAsset
      : DEFAULT_WETH
  );
  const [maxCollateral, setMaxCollateral] = useState<string>(() => {
    if (existing && existing.maxCollateralPerAction > 0n) {
      return String(Math.floor(Number(formatUnits(existing.maxCollateralPerAction, 18)) * 1000) / 1000);
    }
    return "0.5";
  });
  const [slippageBps, setSlippageBps] = useState<number>(existing?.maxSlippageBps ?? 30);

  const isValidCollateral = isAddress(collateralAsset);
  let maxCollateralUnits = 0n;
  try {
    maxCollateralUnits = maxCollateral ? parseUnits(maxCollateral, 18) : 0n;
  } catch {
    maxCollateralUnits = 0n;
  }

  // Read the Aave reserve data to locate the corresponding aToken address
  const { data: reserveData } = useReadContract({
    chainId: g.target.chain.id,
    address: g.target.pool,
    abi: aavePoolAbi,
    functionName: "getReserveData",
    args: isValidCollateral ? [collateralAsset as Address] : undefined,
    query: { enabled: isValidCollateral },
  });

  const aTokenAddress = reserveData?.aTokenAddress;
  const busy = g.tx.step !== null;

  const saved =
    existing !== null &&
    existing.enabled === enabled &&
    (!enabled ||
      (existing.collateralAsset.toLowerCase() === collateralAsset.toLowerCase() &&
        existing.maxCollateralPerAction === maxCollateralUnits &&
        existing.maxSlippageBps === slippageBps));

  const handleApprove = () => {
    if (!aTokenAddress || maxCollateralUnits === 0n) return;
    g.actions.approve(maxCollateralUnits * 3n, g.guardian.address, aTokenAddress);
  };

  const handleSave = () => {
    if (!enabled) {
      g.actions.setLayer3(false, DEFAULT_WETH, 0n, 30);
      return;
    }
    if (!isValidCollateral || maxCollateralUnits === 0n) return;
    g.actions.setLayer3(true, collateralAsset as Address, maxCollateralUnits, slippageBps);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <LayerBadge layer={3} showName />
          {existing?.enabled && (
            <span className="text-[11px] font-mono text-[var(--safe)] inline-flex items-center gap-1">
              <CheckCircle2 className="size-3.5" /> Active on-chain
            </span>
          )}
        </div>
        <CardTitle className="text-sm mt-3">Layer 3: Flash Deleverage</CardTitle>
        <CardDescription className="text-xs">
          Flash-loan debt repayment and sell part of collateral (e.g. WETH) on Uniswap in one transaction as a final defense.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
          <div>
            <p className="text-xs font-medium text-[var(--text-primary)]">Flash Deleverage State</p>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              {enabled ? "Layer 3 will execute if L1 + L2 cannot restore HF" : "Disabled"}
            </p>
          </div>
          <Button
            type="button"
            variant={enabled ? "default" : "outline"}
            size="sm"
            onClick={() => setEnabled(!enabled)}
          >
            {enabled ? "Enabled" : "Disabled"}
          </Button>
        </div>

        {enabled && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs text-[var(--text-secondary)]">Collateral Asset (WETH)</label>
              <Input
                placeholder="0x..."
                value={collateralAsset}
                onChange={(e) => setCollateralAsset(e.target.value.trim())}
                className="font-mono text-xs"
              />
              {!isValidCollateral && (
                <p className="text-[11px] text-[var(--danger)]">Enter a valid token address</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-[var(--text-secondary)]">Max Collateral per Action (WETH)</label>
              <Input
                type="number"
                placeholder="0.5"
                value={maxCollateral}
                onChange={(e) => setMaxCollateral(e.target.value)}
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-[var(--text-secondary)]">Max Slippage</label>
              <div className="flex gap-2">
                {SLIPPAGE_PRESETS.map((p) => (
                  <Button
                    key={p.bps}
                    type="button"
                    variant={slippageBps === p.bps ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSlippageBps(p.bps)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={busy || !aTokenAddress || maxCollateralUnits === 0n}
                onClick={handleApprove}
                title={aTokenAddress ? `Approve ${aTokenAddress.slice(0, 6)}… to Guardian` : "Locating aToken..."}
              >
                Approve Collateral aToken
              </Button>
              <Button
                variant="default"
                size="sm"
                className="flex-1"
                disabled={busy || !isValidCollateral || maxCollateralUnits === 0n || saved}
                onClick={handleSave}
              >
                {saved ? "Saved" : "Save Layer 3"}
              </Button>
            </div>
          </>
        )}

        {!enabled && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={busy || !existing?.enabled}
            onClick={handleSave}
          >
            Disable Layer 3
          </Button>
        )}

        <TxStatus tx={g.tx} steps={["approve", "setLayer3"]} />
      </CardContent>
    </Card>
  );
}
