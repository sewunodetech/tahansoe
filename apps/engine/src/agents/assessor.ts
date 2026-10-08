/**
 * Risk Assessor: sintesis akhir → ResearchReport (spec §3.1/§3.4, ADR 0004).
 *
 * Input: konteks + laporan analyst + hasil debat + ≤5 lesson.
 * Lesson HANYA sebagai data konteks; tidak mengubah format/aturan (ADR 0005 §3).
 */

import type { LlmProvider } from "../llm/provider.ts";
import { loadPrompt } from "../llm/prompts/index.ts";
import { ResearchReport } from "./schemas.ts";
import type { AnalystReport, Lesson } from "./schemas.ts";
import type { DebateResult } from "./debate.ts";
import type { ResearchContext } from "./context.ts";
import { config } from "../config.ts";

export interface AssessorInput {
  ctx: ResearchContext;
  reports: AnalystReport[];
  debate: DebateResult;
  lessons: Lesson[];
}

/**
 * Hasilkan ResearchReport. Mengembalikan null jika refusal / schema invalid
 * (run dibatalkan tanpa sinyal, spec §3.2).
 *
 * TODO(dev):
 *  - system = loadPrompt("assessor"); effort = config.effort.assessor ("high").
 *  - Rakit data: ringkasan analyst + debat + lessons (≤5, sebagai DATA) + konteks.
 *  - provider.structured({ model: config.models.assessor, output: ResearchReport }).
 *  - Cek stopReason; hanya kembalikan data jika "ok".
 *  - JANGAN memaksa confidence di sini; cap 0.6 dilakukan di to-signal.ts.
 */
export async function runAssessor(
  _provider: LlmProvider,
  _input: AssessorInput,
): Promise<ResearchReport | null> {
  void loadPrompt;
  void ResearchReport;
  void config;
  throw new Error(
    "[engine/agents/assessor] runAssessor belum diimplementasikan — lihat TODO (spec §3.4).",
  );
}
