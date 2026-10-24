"use client";

import React from "react";
import Link from "next/link";
import { Loader2, AlertTriangle, Wallet } from "lucide-react";
import { useAccount } from "wagmi";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { useReserves } from "@/hooks/useReserves";
import { useGuardian } from "@/hooks/useGuardian";
import { useLiveTarget } from "@/lib/live-target";
import { useDashboardMode } from "@/lib/dashboard-mode";
import { ReservesDemoNotice } from "./demo-notice";
import { ReservesSummary } from "./reserves-summary";
import { ReservesEmpty } from "./reserves-empty";

export function ReservesView() {
  const { address: user } = useAccount();
  const { isLive, isSimulation } = useDashboardMode();
  const target = useLiveTarget();
  const reserves = useReserves();
  const { actions } = useGuardian();

  // Show Demo mode notice when in demo mode
  const showDemoNotice = !isLive;

  // Not connected state (when in live mode without wallet or simulation)
  if (!user && !isSimulation) {
    return (
      <div className="space-y-6">
        {showDemoNotice && <ReservesDemoNotice />}
        <Card className="p-8 text-center border-[var(--border)] bg-[var(--bg-elevated)] space-y-4">
          <div className="size-12 rounded-full bg-[var(--bg-subtle)] border border-[var(--border)] flex items-center justify-center mx-auto text-purple-400">
            <Wallet className="size-6" />
          </div>
          <div>
            <h2 className="font-display text-xl font-medium text-[var(--text-primary)]">
              Wallet Not Connected
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-md mx-auto">
              Connect your Web3 wallet or launch a simulation session to view active Layer 2
              yield reserve vaults and Guardian redemption allowances.
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

  if (reserves.isLoading && !reserves.enabled) {
    return (
      <div className="space-y-6">
        {showDemoNotice && <ReservesDemoNotice />}
        <Card className="p-8 flex items-center justify-center gap-3 border-[var(--border)] bg-[var(--bg-elevated)] text-xs font-mono text-[var(--text-secondary)]">
          <Loader2 className="size-4 animate-spin text-[var(--brand)]" />
          Reading Layer 2 reserve configuration on {target.chainName}…
        </Card>
      </div>
    );
  }

  if (reserves.error) {
    return (
      <div className="space-y-6">
        {showDemoNotice && <ReservesDemoNotice />}
        <Card className="p-6 border-[var(--danger-border)] bg-[var(--danger-bg)] flex items-start gap-3">
          <AlertTriangle className="size-5 text-[var(--danger)] shrink-0 mt-0.5" />
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--danger)]">
              Failed to load reserve data
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              {reserves.error instanceof Error
                ? reserves.error.message
                : "Error reading reserve contract from chain"}
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
      {showDemoNotice && <ReservesDemoNotice />}

      {reserves.enabled ? (
        <ReservesSummary
          reserves={reserves}
          explorerAddress={target.explorerAddress}
          chainName={target.chainName}
        />
      ) : (
        <ReservesEmpty />
      )}
    </div>
  );
}
