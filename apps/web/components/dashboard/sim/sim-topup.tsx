"use client";

import React, { useState } from "react";
import { Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSimActions } from "@/lib/sim/hooks";
import { FAUCET_LIMITS, type FaucetAsset } from "@/lib/sim/types";

const PRESETS: { asset: FaucetAsset; amount: number; label: string }[] = [
  { asset: "ETH", amount: 5, label: "+5 ETH" },
  { asset: "WETH", amount: 2, label: "+2 WETH" },
  { asset: "USDC", amount: 5_000, label: "+5,000 USDC" },
];

/** Fake-funds faucet, capped per session (spec m1-simulation-mode §3.5). */
export function SimTopUp() {
  const { topUp } = useSimActions();
  const [busy, setBusy] = useState<FaucetAsset | null>(null);
  const [used, setUsed] = useState<Partial<Record<FaucetAsset, number>>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const handle = async (asset: FaucetAsset, amount: number) => {
    setBusy(asset);
    setMessage(null);
    try {
      const res = await topUp(asset, amount);
      setUsed(res.used);
      setMessage({ ok: true, text: `Added ${amount.toLocaleString("en-US")} ${asset}.` });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Top-up failed" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Droplets className="size-4 text-[var(--brand)]" /> Top up
        </CardTitle>
        <CardDescription className="text-xs">Fake funds. You start with 10 ETH and 5,000 USDC.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((p) => {
            const left = FAUCET_LIMITS[p.asset] - (used[p.asset] ?? 0);
            return (
              <Button key={p.asset} size="sm" variant="secondary" disabled={busy !== null || left < p.amount} onClick={() => handle(p.asset, p.amount)}>
                {busy === p.asset ? "…" : p.label}
              </Button>
            );
          })}
        </div>
        <p className="text-[11px] text-[var(--text-tertiary)]">
          Limit per session: {FAUCET_LIMITS.ETH} ETH, {FAUCET_LIMITS.WETH} WETH, {FAUCET_LIMITS.USDC.toLocaleString("en-US")} USDC.
        </p>
        {message && (
          <p role="status" className={`text-[11px] ${message.ok ? "text-[var(--safe)]" : "text-[var(--danger)]"}`}>
            {message.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
