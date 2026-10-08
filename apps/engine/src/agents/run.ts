/**
 * Orkestrasi satu research run (spec §3.2, ADR 0004).
 *
 * Alur (urutan & guard WAJIB sesuai spec):
 *   kill switch / budget → buildContext → 4 analyst paralel →
 *   (≥3 sukses) → debat → pilih lessons → assessor → simpan → emit Signal.
 *
 * Jika kill switch mati, budget habis, < 3 analyst sukses, atau assessor null:
 * TIDAK ada report & TIDAK ada sinyal; fusion tetap jalan (invariant I6).
 */

import type { LlmProvider } from "../llm/provider.ts";
import { budget as defaultBudget, type Budget } from "../llm/budget.ts";
import { env, config, type ResearchTrigger } from "../config.ts";
import { ANALYSTS, runAnalyst } from "./analysts.ts";
import { runDebate } from "./debate.ts";
import { runAssessor } from "./assessor.ts";
import { toSignal } from "./to-signal.ts";
import { buildContext } from "./context.ts";
import { selectLessons } from "../reflection/lessons.ts";
import type { ResearchReport } from "./schemas.ts";

export interface RunParams {
  trigger: ResearchTrigger;
  chainId: number;
  assets: string[];
  provider: LlmProvider;
  budget?: Budget;
}

/**
 * Jalankan satu run. Mengembalikan ResearchReport jika sukses, atau null bila
 * di-skip/gagal (bukan error — kegagalan lapis riset tidak boleh menjatuhkan engine).
 */
export async function runResearch(params: RunParams): Promise<ResearchReport | null> {
  const { trigger, chainId, assets, provider } = params;
  const budget = params.budget ?? defaultBudget;

  // Guard 1: kill switch (default false) & budget harian.
  if (!env.researchEnabled() || budget.exceeded()) {
    // TODO(dev): jika budget habis, kirim alert sekali ke tim (spec §3.4).
    return null;
  }

  // Semua data dari DB; LLM tanpa tools (ADR 0004 §6).
  const ctx = await buildContext({ chainId, assets });

  // 4 analyst paralel; satu gagal tidak membatalkan yang lain.
  const settled = await Promise.allSettled(
    ANALYSTS.map((domain) => runAnalyst(provider, domain, ctx)),
  );
  const reports = settled.flatMap((r) =>
    r.status === "fulfilled" && r.value ? [r.value] : [],
  );

  // Guard 2: terlalu banyak gagal → jangan menilai (spec §3.2).
  if (reports.length < config.minAnalystsRequired) return null;

  const debate = await runDebate(provider, reports, { rounds: config.debateRounds });
  const lessons = await selectLessons(reports);
  const report = await runAssessor(provider, { ctx, reports, debate, lessons });

  // Guard 3: assessor gagal (refusal/schema) → tidak ada sinyal.
  if (!report) return null;

  // TODO(dev): persist ke research_reports (report, analyst_reports, debate,
  // prompt_version, models, usage, horizon_ends_at). Lihat lib/schema.ts.
  await saveReport({ trigger, chainId, report, reports, debate });

  // Emit satu Signal RESEARCH; fusion yang memutuskan (ADR 0002).
  const signal = toSignal(report);
  // TODO(dev): tulis signal ke tabel signals (module RESEARCH, expiresAt).
  await emitSignal(signal);

  return report;
}

/** TODO(dev): simpan hasil run ke research_reports. */
async function saveReport(_args: {
  trigger: ResearchTrigger;
  chainId: number;
  report: ResearchReport;
  reports: unknown;
  debate: unknown;
}): Promise<void> {
  throw new Error("[engine/agents/run] saveReport belum diimplementasikan (spec §3.8).");
}

/** TODO(dev): tulis Signal RESEARCH ke tabel signals untuk dikonsumsi fusion. */
async function emitSignal(_signal: unknown): Promise<void> {
  throw new Error("[engine/agents/run] emitSignal belum diimplementasikan (PRD §6.3).");
}
