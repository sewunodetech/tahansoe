/**
 * BudgetStore di Postgres (tabel `llm_usage_daily`, ADR 0011): total biaya LLM
 * harian dibagi lintas proses agar LLM_DAILY_BUDGET_USD berlaku global.
 */

import { sql } from "drizzle-orm";
import { getDb, isDbConfigured } from "@tahansoe/db";
import { budget as defaultBudget, type Budget, type BudgetStore } from "../llm/budget.ts";

function firstNumber(res: unknown): number {
  const rows = (res as { rows?: Array<Record<string, unknown>> }).rows ?? (res as Array<Record<string, unknown>>);
  const v = Array.isArray(rows) && rows[0] ? rows[0].spent_usd : 0;
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export const dbBudgetStore: BudgetStore = {
  async add(day, usd) {
    const res = await getDb().execute(sql`
      INSERT INTO llm_usage_daily (day, spent_usd) VALUES (${day}, ${usd})
      ON CONFLICT (day) DO UPDATE
        SET spent_usd = llm_usage_daily.spent_usd + EXCLUDED.spent_usd, updated_at = now()
      RETURNING spent_usd`);
    return firstNumber(res);
  },
  async get(day) {
    const res = await getDb().execute(sql`SELECT spent_usd FROM llm_usage_daily WHERE day = ${day}`);
    return firstNumber(res);
  },
};

/**
 * Pasang store DB ke budget (bila DATABASE_URL ada) lalu sinkronkan total hari ini.
 * Dipanggil sebelum research run dan chat gateway. Tidak pernah melempar.
 */
export async function syncSharedBudget(b: Budget = defaultBudget): Promise<void> {
  if (!b.hasStore()) {
    if (!isDbConfigured()) return;
    b.attachStore(dbBudgetStore);
  }
  await b.sync();
}
