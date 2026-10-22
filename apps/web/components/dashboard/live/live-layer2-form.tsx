"use client";

import React, { useState } from "react";
import { parseUnits, formatUnits, isAddress, type Address } from "viem";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { LayerBadge } from "@/components/ui/layer-badge";
import { Input } from "@/components/ui/input";
import { L2_NONE, L2_ERC4626, L2_ATOKEN } from "@tahansoe/domain";
import type { UseGuardianReturn } from "@/hooks/useGuardian";
import { TxStatus } from "./live-shared";

export function LiveLayer2Form({ g }: { g: UseGuardianReturn }) {
  const token = g.token!;
  const existing = g.layer2;

  const [kind, setKind] = useState<number>(existing?.kind ?? L2_ERC4626);
  const [source, setSource] = useState<string>(
    existing?.source && existing.source !== "0x0000000000000000000000000000000000000000"
      ? existing.source
      : ""
  );
  const [maxAssets, setMaxAssets] = useState<string>(() => {
    if (existing && existing.maxAssetsPerAction > 0n) {
      return String(Math.floor(Number(formatUnits(existing.maxAssetsPerAction, token.decimals)) * 100) / 100);
    }
    return "500";
  });

  const decimals = token.decimals;
  let maxAssetsUnits = 0n;
  try {
    maxAssetsUnits = maxAssets ? parseUnits(maxAssets, decimals) : 0n;
  } catch {
    maxAssetsUnits = 0n;
  }

  const isValidAddress = isAddress(source);
  const busy = g.tx.step !== null;

  const saved =
    existing !== null &&
    existing.kind === kind &&
    (kind === L2_NONE ||
      (existing.source.toLowerCase() === source.toLowerCase() &&
        existing.maxAssetsPerAction === maxAssetsUnits));

  const handleApprove = () => {
    if (!isValidAddress || maxAssetsUnits === 0n) return;
    g.actions.approve(maxAssetsUnits * 3n, g.guardian.address, source as Address);
  };

  const handleSave = () => {
    if (kind === L2_NONE) {
      g.actions.setLayer2(L2_NONE, "0x0000000000000000000000000000000000000000", 0n);
      return;
    }
    if (!isValidAddress || maxAssetsUnits === 0n) return;
    g.actions.setLayer2(kind, source as Address, maxAssetsUnits);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <LayerBadge layer={2} showName />
          {existing && existing.kind !== L2_NONE && (
            <span className="text-[11px] font-mono text-[var(--safe)] inline-flex items-center gap-1">
              <CheckCircle2 className="size-3.5" /> Active on-chain
            </span>
          )}
        </div>
        <CardTitle className="text-sm mt-3">Layer 2: Position Reserve</CardTitle>
        <CardDescription className="text-xs">
          Redeem shares from an ERC-4626 vault or an aToken to repay debt when your wallet balance is insufficient.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs text-[var(--text-secondary)]">Reserve Type</label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={kind === L2_ERC4626 ? "default" : "outline"}
              size="sm"
              onClick={() => setKind(L2_ERC4626)}
            >
              ERC-4626 Vault
            </Button>
            <Button
              type="button"
              variant={kind === L2_ATOKEN ? "default" : "outline"}
              size="sm"
              onClick={() => setKind(L2_ATOKEN)}
            >
              aToken Reserve
            </Button>
            <Button
              type="button"
              variant={kind === L2_NONE ? "default" : "outline"}
              size="sm"
              onClick={() => setKind(L2_NONE)}
            >
              Disable L2
            </Button>
          </div>
        </div>

        {kind !== L2_NONE && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs text-[var(--text-secondary)]">
                {kind === L2_ERC4626 ? "Vault Contract Address" : "aToken Contract Address"}
              </label>
              <Input
                placeholder="0x..."
                value={source}
                onChange={(e) => setSource(e.target.value.trim())}
                className="font-mono text-xs"
              />
              {!isValidAddress && source.length > 0 && (
                <p className="text-[11px] text-[var(--danger)]">Enter a valid contract address</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-[var(--text-secondary)]">Max Assets per Action ({token.symbol})</label>
              <Input
                type="number"
                placeholder="500"
                value={maxAssets}
                onChange={(e) => setMaxAssets(e.target.value)}
                className="font-mono text-xs"
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={busy || !isValidAddress || maxAssetsUnits === 0n}
                onClick={handleApprove}
              >
                Approve Reserve Shares
              </Button>
              <Button
                variant="default"
                size="sm"
                className="flex-1"
                disabled={busy || !isValidAddress || maxAssetsUnits === 0n || saved}
                onClick={handleSave}
              >
                {saved ? "Saved" : "Save Layer 2"}
              </Button>
            </div>
          </>
        )}

        {kind === L2_NONE && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={busy || (existing?.kind === L2_NONE)}
            onClick={handleSave}
          >
            Disable Layer 2
          </Button>
        )}

        <TxStatus tx={g.tx} steps={["approve", "setLayer2"]} />
      </CardContent>
    </Card>
  );
}
