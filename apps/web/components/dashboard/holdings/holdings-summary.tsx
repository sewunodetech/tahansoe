"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight, ShieldCheck, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LayerBadge } from "@/components/ui/layer-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatUsd } from "@/components/dashboard/live/live-shared";
import type { HoldingRow } from "@/lib/holdings";
import type { LivePolicy } from "@/hooks/useGuardian";

export interface HoldingsSummaryProps {
  l1CapacityUsd: number | null;
  items: HoldingRow[];
  policy: LivePolicy | null;
  chainName: string;
}

export function HoldingsSummary({
  l1CapacityUsd,
  items,
  policy,
  chainName,
}: HoldingsSummaryProps) {
  const totalValueUsd = items.reduce(
    (sum, item) => sum + (item.valueUsd ?? 0),
    0
  );

  const l1Asset = items.find((item) => item.usedByLayer1);

  return (
    <div className="space-y-4">
      {/* Primary Capacity Hero Card */}
      <Card className="p-6 border-[var(--border)] bg-[var(--bg-elevated)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <LayerBadge layer={1} showName />
              <Badge variant="outline" size="sm" className="font-mono text-[10px]">
                {chainName}
              </Badge>
            </div>

            {l1CapacityUsd !== null && l1CapacityUsd > 0 ? (
              <div>
                <h2 className="font-display text-2xl md:text-3xl text-[var(--text-primary)] font-medium tracking-tight">
                  Layer 1 can repay up to{" "}
                  <span className="text-[var(--brand)]">
                    {formatUsd(l1CapacityUsd)}
                  </span>{" "}
                  now
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xl">
                  Calculated from the lowest of your wallet balance, Guardian allowance,
                  and policy per-action cap for {l1Asset?.symbol ?? "your debt asset"}.
                </p>
              </div>
            ) : l1CapacityUsd === 0 ? (
              <div>
                <h2 className="font-display text-2xl md:text-3xl text-[var(--text-primary)] font-medium tracking-tight">
                  Layer 1 capacity is currently{" "}
                  <span className="text-[var(--warning)]">$0.00</span>
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xl">
                  Your protection policy is active, but your wallet balance or Guardian allowance is currently 0.
                  Approve an allowance in Protection to activate hot wallet reserve.
                </p>
              </div>
            ) : (
              <div>
                <h2 className="font-display text-2xl md:text-3xl text-[var(--text-primary)] font-medium tracking-tight">
                  Layer 1 is not configured
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xl">
                  No active protection policy found. Set your trigger and approve a bounded allowance
                  in Protection to enable automated Layer 1 repayments.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {policy?.enabled ? (
              <Link
                href="/dashboard/protection"
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className: "text-xs font-mono",
                })}
              >
                Adjust Allowance <ArrowUpRight className="size-3.5 ml-1" />
              </Link>
            ) : (
              <Link
                href="/dashboard/protection"
                className={buttonVariants({
                  variant: "primary",
                  size: "sm",
                  className: "text-xs font-mono",
                })}
              >
                Enable Protection <ArrowUpRight className="size-3.5 ml-1" />
              </Link>
            )}
          </div>
        </div>

        {/* Explain how L1 pays within the allowance */}
        <div className="mt-5 pt-4 border-t border-[var(--border)] flex items-start gap-2.5 text-xs text-[var(--text-secondary)]">
          <Info className="size-4 text-[var(--brand)] shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <span className="text-[var(--text-primary)] font-medium">
              Non-custodial reserve invariant:
            </span>{" "}
            Layer 1 pays directly from your wallet funds only within your explicit token allowance.
            TahansoeGuardian holds no custody over user assets between calls and only draws funds
            when Health Factor falls below your trigger to repay your loan.
          </p>
        </div>
      </Card>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4">
          <CardContent className="p-0">
            <span className="text-[11px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">
              Total Wallet Value
            </span>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xl font-medium text-[var(--text-primary)]">
                {formatUsd(totalValueUsd)}
              </span>
              <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                ({items.length} tokens)
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="p-4">
          <CardContent className="p-0">
            <span className="text-[11px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">
              Active L1 Debt Asset
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              {l1Asset ? (
                <>
                  <span className="font-mono text-base font-semibold text-[var(--text-primary)]">
                    {l1Asset.symbol}
                  </span>
                  <Badge variant="safe" size="sm" dot>
                    Active
                  </Badge>
                </>
              ) : (
                <span className="text-sm font-mono text-[var(--text-tertiary)]">
                  None configured
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="p-4">
          <CardContent className="p-0">
            <span className="text-[11px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">
              Layer 1 Ready Capacity
            </span>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="font-mono text-xl font-medium text-[var(--brand)]">
                {l1CapacityUsd !== null ? formatUsd(l1CapacityUsd) : "—"}
              </span>
              {l1CapacityUsd !== null && l1CapacityUsd > 0 && (
                <ShieldCheck className="size-4 text-[var(--safe)] self-center" />
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
