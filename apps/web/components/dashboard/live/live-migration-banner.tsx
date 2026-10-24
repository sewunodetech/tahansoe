"use client";

import React from "react";
import { ArrowRightLeft } from "lucide-react";
import type { Address } from "viem";
import type { GuardianDeployment } from "@tahansoe/domain";
import { Button } from "@/components/ui/button";
import type { LivePolicy, LegacyExposure, UseGuardianReturn } from "@/hooks/useGuardian";
import { formatToken, TxStatus } from "./live-shared";

/**
 * Pure helper to compute legacy exposures that require migration.
 * Exposed for deterministic unit testing.
 */
export function computeMigrationExposures({
  deployments,
  policies,
  allowances,
}: {
  deployments: GuardianDeployment[];
  policies: (LivePolicy | null)[];
  allowances: { asset: Address; symbol: string; decimals: number; amount: bigint }[][];
}): LegacyExposure[] {
  return deployments
    .map((deployment, i) => ({
      deployment,
      policy: policies[i] ?? null,
      allowances: (allowances[i] ?? []).filter((a) => a.amount > 0n),
    }))
    .filter((x) => Boolean(x.policy?.enabled) || x.allowances.length > 0);
}

/**
 * Returns true if the user still has an active policy or non-zero token allowance on an older Guardian.
 */
export function isMigrationRequired(legacy: LegacyExposure[]): boolean {
  return legacy.some((x) => Boolean(x.policy?.enabled) || x.allowances.some((a) => a.amount > 0n));
}

/**
 * Shown when the wallet still has a policy or allowance on an older Guardian.
 * Walks the user through retiring v1 (disablePolicy + approve 0) before setting up v4 per position.
 */
export function LiveMigrationBanner({ g }: { g: UseGuardianReturn }) {
  if (g.legacy.length === 0) return null;
  const busy = g.tx.step !== null;

  return (
    <div className="p-4 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] space-y-3">
      <div className="flex items-start gap-3">
        <ArrowRightLeft className="size-5 text-[var(--warning)] shrink-0 mt-0.5" />
        <div className="text-xs text-[var(--text-primary)] space-y-1">
          <p className="text-sm font-medium">Upgrade to Guardian v4 (per-position protection)</p>
          <p className="text-[var(--text-secondary)]">
            You still have an active policy or token allowance on an older Guardian version. Follow these steps to migrate:
          </p>
          <ol className="list-decimal list-inside text-[var(--text-secondary)] space-y-0.5 mt-1">
            <li>Retire the older version below (disables policy and resets token allowances to 0).</li>
            <li>Configure Guardian v4 protection per position below.</li>
          </ol>
        </div>
      </div>

      {g.legacy.map((x) => (
        <div
          key={x.deployment.address}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]"
        >
          <div className="text-[11px] font-mono text-[var(--text-secondary)] space-y-0.5">
            <p className="text-[var(--text-primary)] font-semibold">
              Guardian v{x.deployment.version} · {x.deployment.address.slice(0, 6)}…{x.deployment.address.slice(-4)}
            </p>
            {x.policy?.enabled ? (
              <p className="text-[var(--warning)]">
                Active policy · trigger {x.policy.triggerHf.toFixed(2)} → target {x.policy.targetHf.toFixed(2)}
              </p>
            ) : (
              <p className="text-[var(--text-tertiary)]">No active policy</p>
            )}
            {x.allowances.length > 0 ? (
              x.allowances.map((a) => (
                <p key={a.asset}>
                  Allowance: {formatToken(a.amount, a.decimals, 4)} {a.symbol}
                </p>
              ))
            ) : (
              <p className="text-[var(--text-tertiary)]">Allowance: 0</p>
            )}
          </div>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => g.actions.retireLegacy(x)}>
            Retire v{x.deployment.version}
          </Button>
        </div>
      ))}
      <TxStatus tx={g.tx} steps={["migrate"]} />
    </div>
  );
}
