"use client";

import React from "react";
import Link from "next/link";
import { Loader2, AlertTriangle, Wallet } from "lucide-react";
import { useAccount } from "wagmi";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { useHoldings } from "@/hooks/useHoldings";
import { useGuardian } from "@/hooks/useGuardian";
import { useLiveTarget } from "@/lib/live-target";
import { useDashboardMode } from "@/lib/dashboard-mode";
import { HoldingsDemoNotice } from "./demo-notice";
import { HoldingsSummary } from "./holdings-summary";
import { HoldingsTable } from "./holdings-table";

export function HoldingsView() {
  const { address: user } = useAccount();
  const { isLive, isSimulation } = useDashboardMode();
  const target = useLiveTarget();
  const { items, l1CapacityUsd, isLoading, error } = useHoldings();
  const { policy, actions } = useGuardian();

  // Show Demo mode notice when in demo mode
  const showDemoNotice = !isLive;

  // Not connected state (when in live mode without wallet or simulation)
  if (!user && !isSimulation) {
    return (
      <div className="space-y-6">
        {showDemoNotice && <HoldingsDemoNotice />}
        <Card className="p-8 text-center border-[var(--border)] bg-[var(--bg-elevated)] space-y-4">
          <div className="size-12 rounded-full bg-[var(--bg-subtle)] border border-[var(--border)] flex items-center justify-center mx-auto text-[var(--brand)]">
            <Wallet className="size-6" />
          </div>
          <div>
            <h2 className="font-display text-xl font-medium text-[var(--text-primary)]">
              Wallet Not Connected
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-md mx-auto">
              Connect your Web3 wallet or launch a simulation session to view token balances,
              Aave oracle valuations, and Guardian Layer 1 allowances.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Link
              href="/connect"
              className={buttonVariants({
                variant: "primary",
                size: "sm",
                className: "text-xs font-mono",
              })}
            >
              Connect Wallet
            </Link>
            <Link
              href="/dashboard"
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className: "text-xs font-mono",
              })}
            >
              Try Simulation
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  if (isLoading && items.length === 0) {
    return (
      <div className="space-y-6">
        {showDemoNotice && <HoldingsDemoNotice />}
        <Card className="p-8 flex items-center justify-center gap-3 border-[var(--border)] bg-[var(--bg-elevated)] text-xs font-mono text-[var(--text-secondary)]">
          <Loader2 className="size-4 animate-spin text-[var(--brand)]" />
          Reading wallet holdings and allowances on {target.chainName}…
        </Card>
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="space-y-6">
        {showDemoNotice && <HoldingsDemoNotice />}
        <Card className="p-6 border-[var(--danger-border)] bg-[var(--danger-bg)] flex items-start gap-3">
          <AlertTriangle className="size-5 text-[var(--danger)] shrink-0 mt-0.5" />
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--danger)]">
              Failed to load holdings data
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              {error instanceof Error ? error.message : "Error reading token balances from chain"}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => actions.refetch()}
              className="text-xs font-mono mt-2"
            >
              Retry
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {showDemoNotice && <HoldingsDemoNotice />}

      <HoldingsSummary
        l1CapacityUsd={l1CapacityUsd}
        items={items}
        policy={policy}
        chainName={target.chainName}
      />

      <HoldingsTable
        items={items}
        explorerAddress={target.explorerAddress}
      />
    </div>
  );
}
