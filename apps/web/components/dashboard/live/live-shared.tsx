"use client";

import React from "react";
import { formatUnits } from "viem";
import { AlertTriangle, ArrowUpRight, Loader2, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { explorerTx } from "@/lib/contracts";
import type { TxState, TxStep, UseGuardianReturn } from "@/hooks/useGuardian";

export function formatToken(amount: bigint, decimals: number, maxFractionDigits = 2): string {
  return Number(formatUnits(amount, decimals)).toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits });
}

export function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

const STEP_LABELS: Record<TxStep, string> = {
  switch: "Switching network",
  approve: "Approving",
  setPolicy: "Saving policy",
  disable: "Disabling policy",
  revoke: "Revoking allowance",
  migrate: "Retiring old Guardian",
  setLayer2: "Saving Layer 2",
  setLayer3: "Saving Layer 3",
  setTriggerBand: "Saving trigger band",
  protect: "Executing protection",
};

/**
 * Inline status line for the transaction in flight, the last hash, or the last error.
 * With `steps`, only transactions started from those steps are shown.
 */
export function TxStatus({ tx, steps }: { tx: TxState; steps?: TxStep[] }) {
  if (steps && (!tx.last || !steps.includes(tx.last))) return null;
  if (tx.step) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-secondary)]">
        <Loader2 className="size-3 animate-spin" />
        {STEP_LABELS[tx.step]}… {tx.hash ? "waiting for confirmation" : "confirm in your wallet"}
        {tx.hash && <TxLink hash={tx.hash} />}
      </p>
    );
  }
  if (tx.error) {
    return <p className="text-[11px] font-mono text-[var(--danger)] break-words">{tx.error}</p>;
  }
  if (tx.hash) {
    return (
      <p className="text-[11px] font-mono text-[var(--safe)]">
        Confirmed <TxLink hash={tx.hash} />
      </p>
    );
  }
  return null;
}

function TxLink({ hash }: { hash: string }) {
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 text-[var(--brand)] hover:underline"
    >
      {hash.slice(0, 8)}… <ArrowUpRight className="size-3" />
    </a>
  );
}

/**
 * Renders children once the live reads are usable; otherwise explains what is missing
 * (wrong network, loading, RPC error).
 */
export function LiveGate({ g, children }: { g: UseGuardianReturn; children: React.ReactNode }) {
  if (g.wrongChain) {
    return (
      <Card className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Network className="size-5 text-[var(--brand)] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-[var(--text-primary)]">Switch to Arbitrum Sepolia</p>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              The live dashboard reads your Aave V3 position and Guardian policy on Arbitrum Sepolia.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button size="sm" onClick={g.actions.switchToLiveChain} disabled={g.tx.step === "switch"}>
            Switch network
          </Button>
          <TxStatus tx={g.tx} steps={["switch"]} />
        </div>
      </Card>
    );
  }

  if (g.readError) {
    return (
      <Card className="p-6 flex items-start gap-3">
        <AlertTriangle className="size-5 text-[var(--warning)] shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-[var(--text-primary)]">Could not read on-chain data</p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1 break-words">{g.readError.message.split("\n")[0]}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => g.actions.refetch()}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  if (g.isLoading || !g.account || !g.token) {
    return (
      <Card className="p-6 flex items-center gap-2 text-xs font-mono text-[var(--text-tertiary)]">
        <Loader2 className="size-4 animate-spin" /> Reading Arbitrum Sepolia…
      </Card>
    );
  }

  return <>{children}</>;
}
