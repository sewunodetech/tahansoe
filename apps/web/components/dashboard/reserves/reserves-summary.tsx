"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight, ExternalLink, ShieldCheck, Zap, Info, Vault } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LayerBadge } from "@/components/ui/layer-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatToken, formatUsd } from "@/components/dashboard/live/live-shared";
import type { ReserveState } from "@/lib/reserves";

export interface ReservesSummaryProps {
  reserves: ReserveState;
  explorerAddress: (address: string) => string | null;
  chainName: string;
}

export function ReservesSummary({
  reserves,
  explorerAddress,
  chainName,
}: ReservesSummaryProps) {
  const {
    kind,
    source,
    asset,
    shares,
    assetsValue,
    valueUsd,
    capPerAction,
    allowance,
    l2CapacityUsd,
  } = reserves;

  const decimals = asset?.decimals ?? 18;
  const symbol = asset?.symbol ?? "ASSET";
  const sourceUrl = source ? explorerAddress(source) : null;
  const assetUrl = asset ? explorerAddress(asset.address) : null;

  const kindLabel = kind === "erc4626" ? "ERC-4626 Yield Vault" : "Aave aToken";

  return (
    <div className="space-y-6">
      {/* Primary Capacity Hero Card */}
      <Card className="p-6 border-[var(--border)] bg-[var(--bg-elevated)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <LayerBadge layer={2} showName />
              <Badge variant="outline" size="sm" className="font-mono text-[10px]">
                {chainName}
              </Badge>
              <Badge variant="safe" size="sm" dot>
                {kindLabel}
              </Badge>
            </div>

            {l2CapacityUsd !== null && l2CapacityUsd > 0 ? (
              <div>
                <h2 className="font-display text-2xl md:text-3xl text-[var(--text-primary)] font-medium tracking-tight">
                  Layer 2 can redeem up to{" "}
                  <span className="text-purple-400">
                    {formatUsd(l2CapacityUsd)}
                  </span>{" "}
                  per action
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xl">
                  Bounded by the minimum of your vault assets value, per-action cap,
                  and Guardian allowance.
                </p>
              </div>
            ) : (
              <div>
                <h2 className="font-display text-2xl md:text-3xl text-[var(--text-primary)] font-medium tracking-tight">
                  Layer 2 can redeem up to{" "}
                  <span className="text-[var(--warning)]">$0.00</span> per action
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xl">
                  Layer 2 is configured, but either the redeemable balance or Guardian allowance is currently 0.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/dashboard/protection"
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className: "text-xs font-mono",
              })}
            >
              Edit Layer 2 Settings <ArrowUpRight className="size-3.5 ml-1" />
            </Link>
          </div>
        </div>

        {/* Invariant Explanation */}
        <div className="mt-5 pt-4 border-t border-[var(--border)] flex items-start gap-2.5 text-xs text-[var(--text-secondary)]">
          <Info className="size-4 text-purple-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <span className="text-[var(--text-primary)] font-medium">
              Yield reserve invariant:
            </span>{" "}
            During cascade execution, the Guardian withdraws or redeems only the exact amount
            of underlying {symbol} needed to bring Health Factor back to your target. Any excess
            is immediately refunded to your wallet.
          </p>
        </div>
      </Card>

      {/* Reserve Configuration & Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Source Contract Card */}
        <Card className="p-5 border-[var(--border)] bg-[var(--bg-elevated)] space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
            <div className="flex items-center gap-2">
              <Vault className="size-4 text-purple-400" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Reserve Source Details
              </h3>
            </div>
            <span className="text-[11px] font-mono text-[var(--text-tertiary)] uppercase">
              {kind === "erc4626" ? "Vault" : "aToken"}
            </span>
          </div>

          <div className="space-y-3 text-xs font-mono">
            <div className="flex items-center justify-between py-1 border-b border-[var(--border)]/50">
              <span className="text-[var(--text-tertiary)]">Source Contract</span>
              <div className="flex items-center gap-1.5">
                {source && sourceUrl ? (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--brand)] hover:underline inline-flex items-center gap-1"
                  >
                    {source.slice(0, 6)}…{source.slice(-4)}
                    <ExternalLink className="size-3" />
                  </a>
                ) : (
                  <span className="text-[var(--text-primary)]">{source ?? "—"}</span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-[var(--border)]/50">
              <span className="text-[var(--text-tertiary)]">Underlying Asset</span>
              <div className="flex items-center gap-1.5">
                {asset && assetUrl ? (
                  <a
                    href={assetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--brand)] hover:underline inline-flex items-center gap-1"
                  >
                    {symbol} ({asset.address.slice(0, 6)}…{asset.address.slice(-4)})
                    <ExternalLink className="size-3" />
                  </a>
                ) : (
                  <span className="text-[var(--text-primary)]">{symbol}</span>
                )}
              </div>
            </div>

            {kind === "erc4626" && (
              <div className="flex items-center justify-between py-1 border-b border-[var(--border)]/50">
                <span className="text-[var(--text-tertiary)]">Vault Shares</span>
                <span className="text-[var(--text-primary)] font-medium">
                  {shares !== null ? formatToken(shares, decimals) : "0.00"} shares
                </span>
              </div>
            )}

            <div className="flex items-center justify-between py-1">
              <span className="text-[var(--text-tertiary)]">Redeemable Asset Value</span>
              <div className="text-right">
                <div className="text-[var(--text-primary)] font-medium">
                  {assetsValue !== null ? formatToken(assetsValue, decimals) : "0.00"} {symbol}
                </div>
                {valueUsd !== null && (
                  <div className="text-[10px] text-[var(--text-tertiary)]">
                    ≈ {formatUsd(valueUsd)}
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Protection Limits & Allowance Card */}
        <Card className="p-5 border-[var(--border)] bg-[var(--bg-elevated)] space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-[var(--safe)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Execution Limits
              </h3>
            </div>
            <span className="text-[11px] font-mono text-[var(--text-tertiary)] uppercase">
              On-chain Policy
            </span>
          </div>

          <div className="space-y-3 text-xs font-mono">
            <div className="flex items-center justify-between py-1 border-b border-[var(--border)]/50">
              <span className="text-[var(--text-tertiary)]">Per-Action Cap</span>
              <span className="text-[var(--text-primary)] font-medium">
                {capPerAction !== null ? formatToken(capPerAction, decimals) : "0.00"} {symbol}
              </span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-[var(--border)]/50">
              <span className="text-[var(--text-tertiary)]">Guardian Allowance</span>
              <span
                className={
                  allowance && allowance > 0n
                    ? "text-[var(--safe)] font-medium"
                    : "text-[var(--text-tertiary)]"
                }
              >
                {allowance !== null
                  ? allowance > 10n ** 30n
                    ? "Unlimited"
                    : `${formatToken(allowance, decimals)} ${kind === "erc4626" ? "shares" : symbol}`
                  : "0.00"}
              </span>
            </div>

            <div className="flex items-center justify-between py-1">
              <span className="text-[var(--text-tertiary)]">Net Ready L2 Capacity</span>
              <div className="text-right">
                <span className="text-base font-semibold text-purple-400">
                  {l2CapacityUsd !== null ? formatUsd(l2CapacityUsd) : "—"}
                </span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Layer 3 Flash Loan Explanation Card */}
      <Card className="p-6 border-[var(--border)] bg-[var(--bg-elevated)]">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0 mt-0.5">
            <Zap className="size-5" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <LayerBadge layer={3} showName />
              <Badge variant="outline" size="sm" className="text-[10px] font-mono">
                Flash Loan Deleverage
              </Badge>
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Layer 3 uses a flash loan and needs no reserve.
            </h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed max-w-2xl">
              Unlike Layer 1 (wallet funds) and Layer 2 (yield vaults), Layer 3 operates as an emergency
              last resort. The Guardian takes an Aave flash loan to repay debt, then immediately sells
              part of your deposited collateral on Uniswap to repay the flash loan in the same transaction.
              No pre-deposited reserve or collateral locking is required.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
