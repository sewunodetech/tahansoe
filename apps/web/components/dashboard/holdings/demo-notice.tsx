"use client";

import React from "react";
import Link from "next/link";
import { Sparkles, Wallet, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export function HoldingsDemoNotice() {
  return (
    <Card className="p-5 border-[var(--brand-glow)] bg-[var(--bg-elevated)] mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-[var(--brand-bg)] text-[var(--brand)] shrink-0 mt-0.5">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Demo Mode Active
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xl leading-relaxed">
              Holdings and Reserves reflect real on-chain balances and Guardian permissions.
              Connect your Web3 wallet to inspect your live positions, or try a Simulation with
              pre-funded burner assets on a local fork.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Link
            href="/connect"
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "text-xs font-mono",
            })}
          >
            <Wallet className="size-3.5 mr-1 text-[var(--brand)]" /> Connect Wallet
          </Link>
          <Link
            href="/dashboard"
            className={buttonVariants({
              variant: "primary",
              size: "sm",
              className: "text-xs font-mono",
            })}
          >
            Try Simulation <ArrowRight className="size-3.5 ml-1" />
          </Link>
        </div>
      </div>
    </Card>
  );
}
