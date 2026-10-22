"use client";

import React from "react";
import { Calculator, ArrowRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { LayerBadge } from "@/components/ui/layer-badge";
import type { UseGuardianReturn } from "@/hooks/useGuardian";
import { formatToken } from "./live-shared";

export function LiveQuotePreview({ g }: { g: UseGuardianReturn }) {
  const token = g.token!;
  const qp = g.quoteProtect;
  const isV2 = g.isV2;

  const totalRepay = isV2
    ? (qp ? qp.l1Repay + qp.l2Repay + qp.l3Repay : 0n)
    : g.quoteRepay;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--brand)]">
          <Calculator className="size-4" /> Real-time Execution Quote
        </div>
        <CardTitle className="text-sm mt-1">Cascade Simulation Preview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {totalRepay === 0n ? (
          <p className="text-xs text-[var(--text-tertiary)] py-2">
            No debt repayment needed at current Health Factor ({g.account?.hf?.toFixed(2) ?? "—"}).
          </p>
        ) : (
          <div className="space-y-2 text-xs">
            {isV2 && qp ? (
              <>
                <div className="flex items-center justify-between p-2 rounded bg-[var(--bg-subtle)]">
                  <div className="flex items-center gap-2">
                    <LayerBadge layer={1} />
                    <span className="text-[var(--text-secondary)]">Wallet Repay</span>
                  </div>
                  <span className="font-mono font-medium text-[var(--text-primary)]">
                    {formatToken(qp.l1Repay, token.decimals)} {token.symbol}
                  </span>
                </div>

                <div className="flex items-center justify-between p-2 rounded bg-[var(--bg-subtle)]">
                  <div className="flex items-center gap-2">
                    <LayerBadge layer={2} />
                    <span className="text-[var(--text-secondary)]">Reserve Redeem</span>
                  </div>
                  <span className="font-mono font-medium text-[var(--text-primary)]">
                    {formatToken(qp.l2Repay, token.decimals)} {token.symbol}
                  </span>
                </div>

                <div className="flex items-center justify-between p-2 rounded bg-[var(--bg-subtle)]">
                  <div className="flex items-center gap-2">
                    <LayerBadge layer={3} />
                    <span className="text-[var(--text-secondary)]">Flash Deleverage</span>
                  </div>
                  <span className="font-mono font-medium text-[var(--text-primary)]">
                    {formatToken(qp.l3Repay, token.decimals)} {token.symbol}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[var(--border)] font-medium">
                  <span className="text-[var(--text-secondary)]">Expected HF</span>
                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="text-[var(--danger)]">{g.account?.hf?.toFixed(2) ?? "—"}</span>
                    <ArrowRight className="size-3 text-[var(--text-tertiary)]" />
                    <span className="text-[var(--safe)]">{qp.expectedHf.toFixed(2)}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between p-2 rounded bg-[var(--bg-subtle)]">
                <div className="flex items-center gap-2">
                  <LayerBadge layer={1} />
                  <span className="text-[var(--text-secondary)]">L1 Repay</span>
                </div>
                <span className="font-mono font-medium text-[var(--text-primary)]">
                  {formatToken(g.quoteRepay, token.decimals)} {token.symbol}
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
