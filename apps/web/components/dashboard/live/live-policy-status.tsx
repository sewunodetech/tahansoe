"use client";

import React from "react";
import { AlertTriangle, ArrowUpRight, Power, RotateCcw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { assetSymbol } from "@/lib/live-target";
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
  const guardianHref = g.target.explorerAddress(guardian.address);
  const t = token!;
  const busy = g.tx.step !== null;
  const lowCapacity = policy?.enabled === true && g.actionsLeft < 1;

  const qp = g.quoteProtect;
  const hasV2Repay = Boolean(qp && qp.l1Repay + qp.l2Repay + qp.l3Repay > 0n);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">On-chain status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] text-[11px] font-mono space-y-1.5">
          <Row label="Guardian">
            {guardianHref ? (
              <a
                href={guardianHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[var(--brand)] hover:underline"
              >
                v{guardian.version} · {guardian.address.slice(0, 6)}…{guardian.address.slice(-4)}
                <ArrowUpRight className="size-3" />
              </a>
            ) : (
              <span>v{guardian.version} · {guardian.address.slice(0, 6)}…{guardian.address.slice(-4)}</span>
            )}
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
              {g.isV2 && g.effectiveTrigger !== null && g.effectiveTrigger !== policy.triggerHf && (
                <Row label="Effective trigger">
                  <span className="text-[var(--brand)]">{g.effectiveTrigger.toFixed(2)} (AI dynamic)</span>
                </Row>
              )}
              <Row label="Max per action">
                {formatToken(policy.maxRepayPerAction, t.decimals)} {assetSymbol(g.target, policy.debtAsset)}
              </Row>
            </>
          )}
          {g.isV2 && (
            <>
              <Row label="Layer 2">
                {g.layer2 && g.layer2.kind !== 0 ? (
                  <span className="text-[var(--safe)]">
                    {g.layer2.kind === 1 ? "ERC-4626 Vault" : "aToken Reserve"}
                  </span>
                ) : (
                  <span className="text-[var(--text-tertiary)]">Disabled</span>
                )}
              </Row>
              <Row label="Layer 3">
                {g.layer3 && g.layer3.enabled ? (
                  <span className="text-[var(--safe)]">Active (Flash Deleverage)</span>
                ) : (
                  <span className="text-[var(--text-tertiary)]">Disabled</span>
                )}
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
          {!g.isV2 && policy?.enabled && g.quoteRepay > 0n && (
            <Row label="Would repay now">
              {formatToken(g.quoteRepay, t.decimals)} {t.symbol}
            </Row>
          )}
          {g.isV2 && policy?.enabled && hasV2Repay && qp && (
            <>
              <Row label="Would repay now (L1)">
                {formatToken(qp.l1Repay, t.decimals)} {t.symbol}
              </Row>
              {qp.l2Repay > 0n && (
                <Row label="Would repay now (L2)">
                  {formatToken(qp.l2Repay, t.decimals)} {t.symbol}
                </Row>
              )}
              {qp.l3Repay > 0n && (
                <Row label="Would repay now (L3)">
                  {formatToken(qp.l3Repay, t.decimals)} {t.symbol}
                </Row>
              )}
              <Row label="Expected HF after protect">
                <span className="text-[var(--safe)]">{qp.expectedHf.toFixed(2)}</span>
              </Row>
            </>
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

        {g.canProtect && (
          <Button
            variant="danger"
            size="sm"
            className="w-full flex items-center justify-center gap-1.5 font-medium shadow-sm"
            disabled={busy}
            onClick={g.actions.protect}
            title="Immediately execute on-chain debt repayment to rescue this position"
          >
            <ShieldAlert className="size-4" /> Run protect now
          </Button>
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
        <TxStatus tx={g.tx} steps={["disable", "revoke", "protect"]} />
      </CardContent>
    </Card>
  );
}
