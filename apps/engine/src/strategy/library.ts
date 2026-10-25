/**
 * Strategy Library (spec m4-protection-strategy-agent §3.4, ADR 0005, ADR 0016).
 *
 * Memuat StrategyVersion aktif dari tabel `strategy_versions` bila tersedia di DB,
 * atau fallback ke seed version bawaan `pp-2026.10.0` dengan playbook MANUAL yang
 * didasarkan pada panduan regime-to-buffer PRD §6.
 *
 * Playbook adalah data, bukan instruksi (ADR 0005).
 */

import { desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured, strategyVersions, type Db } from "@tahansoe/db";
import type { Playbook, StrategyVersion } from "@tahansoe/domain";

/**
 * Seed version awal bawaan yang di-grounding ke PRD §6:
 * - CALM: trigger 1.15 - 1.25
 * - ELEVATED: trigger 1.30 - 1.40 (repay target ~1.45)
 * - STRESSED: trigger 1.45 - 1.60 (repay target ~1.55 - 1.60)
 * - CRISIS: target ~1.70 - 1.80
 */
export const SEED_STRATEGY_VERSION: StrategyVersion = {
  version: "pp-2026.10.0",
  status: "ACTIVE",
  playbooks: [
    {
      id: "pb-crisis-deleverage",
      description: "[illustrative seed] Crisis regime with low reserves or critical HF -> deleverage to safe buffer",
      when: { regimeAtLeast: "CRISIS", hfBelow: 1.3 },
      action: "DELEVERAGE",
      targetHf: 1.8,
      source: "MANUAL",
    },
    {
      id: "pb-crisis-repay-vault",
      description: "[illustrative seed] Crisis regime -> repay from vault reserve to 1.80 target HF",
      when: { regimeAtLeast: "CRISIS", hfBelow: 1.5 },
      action: "REPAY_VAULT",
      targetHf: 1.8,
      source: "MANUAL",
    },
    {
      id: "pb-crisis-repay-wallet",
      description: "[illustrative seed] Crisis regime -> repay from wallet reserve to 1.70 target HF",
      when: { regimeAtLeast: "CRISIS", hfBelow: 1.5 },
      action: "REPAY_WALLET",
      targetHf: 1.7,
      source: "MANUAL",
    },
    {
      id: "pb-stressed-repay-vault",
      description: "[illustrative seed] Stressed regime with deteriorating HF -> repay from vault to 1.60",
      when: { regimeAtLeast: "STRESSED", hfBelow: 1.35 },
      action: "REPAY_VAULT",
      targetHf: 1.6,
      source: "MANUAL",
    },
    {
      id: "pb-stressed-repay-wallet",
      description: "[illustrative seed] Stressed regime with deteriorating HF -> repay from wallet to 1.55",
      when: { regimeAtLeast: "STRESSED", hfBelow: 1.35 },
      action: "REPAY_WALLET",
      targetHf: 1.55,
      source: "MANUAL",
    },
    {
      id: "pb-stressed-shift-trigger",
      description: "[illustrative seed] Stressed regime preemptive trigger shift to 1.45 (PRD §6: 1.45 - 1.60)",
      when: { regimeAtLeast: "STRESSED", hfBelow: 1.6 },
      action: "SHIFT_TRIGGER",
      targetHf: 1.45,
      source: "MANUAL",
    },
    {
      id: "pb-elevated-repay-wallet",
      description: "[illustrative seed] Elevated regime with low HF -> repay from wallet to 1.45",
      when: { regimeAtLeast: "ELEVATED", hfBelow: 1.25 },
      action: "REPAY_WALLET",
      targetHf: 1.45,
      source: "MANUAL",
    },
    {
      id: "pb-elevated-shift-trigger",
      description: "[illustrative seed] Elevated regime preemptive trigger shift to 1.30 (PRD §6: 1.30 - 1.40)",
      when: { regimeAtLeast: "ELEVATED", hfBelow: 1.4 },
      action: "SHIFT_TRIGGER",
      targetHf: 1.3,
      source: "MANUAL",
    },
  ],
};

export interface StrategyLibrary {
  getActiveVersion(): Promise<StrategyVersion>;
}

/**
 * Muat StrategyVersion aktif dari DB jika ada, atau fallback ke seed version.
 */
export async function loadActiveStrategyVersion(customDb?: Db): Promise<StrategyVersion> {
  const dbAvailable = customDb != null || isDbConfigured();
  if (!dbAvailable) {
    return SEED_STRATEGY_VERSION;
  }

  try {
    const database = customDb ?? getDb();
    const rows = await database
      .select({
        version: strategyVersions.version,
        playbooks: strategyVersions.playbooks,
        status: strategyVersions.status,
      })
      .from(strategyVersions)
      .where(eq(strategyVersions.status, "ACTIVE"))
      .orderBy(desc(strategyVersions.createdAt))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return SEED_STRATEGY_VERSION;
    }

    return {
      version: row.version,
      playbooks: row.playbooks as Playbook[],
      status: (row.status as "ACTIVE") ?? "ACTIVE",
    };
  } catch {
    return SEED_STRATEGY_VERSION;
  }
}

/**
 * Factory untuk membuat StrategyLibrary.
 */
export function createStrategyLibrary(customDb?: Db): StrategyLibrary {
  return {
    getActiveVersion: () => loadActiveStrategyVersion(customDb),
  };
}
