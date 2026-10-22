"use client";

import React from "react";
import { AlertTriangle, ArrowUpRight, Power, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { explorerAddress, debtAssetSymbol } from "@/lib/contracts";
import type { UseGuardianReturn } from "@/hooks/useGuardian";
import { formatToken, TxStatus } from "./live-shared";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[var(--text-tertiary)]">{label}</span>
      <span className="text-[var(--text-primary)] text-right">{children}</span>
    </div>
  );
}

/** What the Guardian holds for this wallet right now, capacity left, and the emergency stop. */
export function LivePolicyStatus({ g }: { g: UseGuardianReturn }) {
  const { policy, token, guardian } = g;
  const t = token!;
  const busy = g.tx.step !== null;
  const lowCapacity = policy?.enabled === true && g.actionsLeft < 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">On-chain status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] text-[11px] font-mono space-y-1.5">
          <Row label="Guardian">
            <a
              href={explorerAddress(guardian.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[var(--brand)] hover:underline"
            >
              v{guardian.version} · {guardian.address.slice(0, 6)}…{guardian.address.slice(-4)}
              <ArrowUpRight className="size-3" />
            </a>
          </Row>
          <Row label="Policy">
            {policy === null ? "None" : policy.enabled ? (
              <span className="text-[var(--safe)]">Enabled</span>
            ) : (
              <span className="text-[var(--text-tertiary)]">Disabled</span>
            )}
          </Row>
          {policy && (
            <>
              <Row label="Trigger → target">
                {policy.triggerHf.toFixed(2)} → {policy.targetHf.toFixed(2)}
              </Row>
              <Row label="Max per action">
                {formatToken(policy.maxRepayPerAction, t.decimals)} {debtAssetSymbol(policy.debtAsset)}
              </Row>
            </>
          )}
          <Row label="Allowance">
            {formatToken(t.allowance, t.decimals)} {t.symbol}
          </Row>
          <Row label="Wallet balance">
            {formatToken(t.balance, t.decimals)} {t.symbol}
          </Row>
          {policy?.enabled && <Row label="Actions left">{g.actionsLeft}</Row>}
          {policy?.enabled && g.quoteRepay > 0n && (
            <Row label="Would repay now">
              {formatToken(g.quoteRepay, t.decimals)} {t.symbol}
            </Row>
          )}
        </div>

        {lowCapacity && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--warning-bg)] border border-[var(--warning-border)] text-xs text-[var(--warning)]">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>
              Less than one full action left. Approve more {t.symbol} or top up your wallet, or Tahansoe cannot step in
              when your Health Factor drops.
            </span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={busy || !policy?.enabled}
            onClick={g.actions.disablePolicy}
            title="Stop Tahansoe from acting on this wallet"
          >
            <Power className="size-3.5" /> Disable policy
          </Button>
          <Button
            variant="danger"
            size="sm"
            className="flex-1"
            disabled={busy || t.allowance === 0n}
            onClick={g.actions.revoke}
            title={`Set the ${t.symbol} allowance back to 0`}
          >
            <RotateCcw className="size-3.5" /> Revoke allowance
          </Button>
        </div>
        <TxStatus tx={g.tx} steps={["disable", "revoke"]} />
      </CardContent>
    </Card>
  );
}
