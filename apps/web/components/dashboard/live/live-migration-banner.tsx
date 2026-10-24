"use client";

import React from "react";
import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UseGuardianReturn } from "@/hooks/useGuardian";
import { formatToken, TxStatus } from "./live-shared";

/**
 * Shown when the wallet still has a policy or allowance on an older Guardian. Guardians are
 * immutable, so upgrading means retiring the old one (disable + revoke) and saving the policy
 * again on the current version with the form below.
 */
export function LiveMigrationBanner({ g }: { g: UseGuardianReturn }) {
  if (g.legacy.length === 0) return null;
  const busy = g.tx.step !== null;

  return (
    <div className="p-4 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] space-y-3">
      <div className="flex items-start gap-3">
        <ArrowRightLeft className="size-5 text-[var(--warning)] shrink-0 mt-0.5" />
        <div className="text-xs text-[var(--text-primary)] space-y-1">
          <p className="text-sm">Guardian v{g.guardian.version} is available</p>
          <p className="text-[var(--text-secondary)]">
            You still have access granted to an older version. Retire it, then save your policy again below. Older
            versions keep working until you do, so you are never left unprotected in between.
          </p>
        </div>
      </div>

      {g.legacy.map((x) => (
        <div
          key={x.deployment.address}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]"
        >
          <div className="text-[11px] font-mono text-[var(--text-secondary)] space-y-0.5">
            <p className="text-[var(--text-primary)]">
              Guardian v{x.deployment.version} · {x.deployment.address.slice(0, 6)}…{x.deployment.address.slice(-4)}
            </p>
            {x.policy?.enabled && (
              <p>
                Policy enabled · trigger {x.policy.triggerHf.toFixed(2)} → target {x.policy.targetHf.toFixed(2)}
              </p>
            )}
            {x.allowances.map((a) => (
              <p key={a.asset}>
                Allowance {formatToken(a.amount, a.decimals, 4)} {a.symbol}
              </p>
            ))}
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
