"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight, Layers, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LayerBadge } from "@/components/ui/layer-badge";
import { buttonVariants } from "@/components/ui/button";

export function ReservesEmpty() {
  return (
    <div className="space-y-6">
      {/* Empty State Card */}
      <Card className="p-8 text-center border-[var(--border)] bg-[var(--bg-elevated)] space-y-4">
        <div className="size-12 rounded-full bg-[var(--bg-subtle)] border border-[var(--border)] flex items-center justify-center mx-auto text-purple-400">
          <Layers className="size-6" />
        </div>

        <div>
          <div className="flex items-center justify-center gap-2 mb-2">
            <LayerBadge layer={2} showName />
            <Badge variant="outline" size="sm" className="text-[10px] font-mono">
              Not Configured
            </Badge>
          </div>
          <h2 className="font-display text-2xl font-medium text-[var(--text-primary)]">
            Layer 2 Position Reserve is not active
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-1.5 max-w-lg mx-auto leading-relaxed">
            Layer 2 acts as a secondary buffer when your hot wallet reserve (Layer 1) runs out.
            It automatically redeems yield-bearing vault shares (ERC-4626) or Aave aTokens to repay
            remaining debt without requiring manual intervention.
          </p>
        </div>

        <div className="pt-2">
          <Link
            href="/dashboard/protection"
            className={buttonVariants({
              variant: "primary",
              size: "sm",
              className: "text-xs font-mono",
            })}
          >
            Configure Layer 2 in Protection <ArrowUpRight className="size-3.5 ml-1" />
          </Link>
        </div>
      </Card>

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
