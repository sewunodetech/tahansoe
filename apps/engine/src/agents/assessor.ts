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
import { renderContextAsData } from "./context.ts";
import { config } from "../config.ts";

export interface AssessorInput {
  ctx: ResearchContext;
  reports: AnalystReport[];
  debate: DebateResult;
  lessons: Lesson[];
}

/** Hasil assessor: report bila sukses + diagnostik (usage/model/reason). */
export interface AssessorOutcome {
  report: ResearchReport | null;
  reason?: string;
  usage?: { inputTokens: number; outputTokens: number };
  usedModel?: string;
}

/**
 * Hasilkan ResearchReport. `report` null jika refusal / schema invalid / error
 * (run dibatalkan tanpa sinyal, spec §3.2); diagnostik selalu diisi (audit G7).
 *
 * Lesson disisipkan sebagai DATA (≤5); confidence TIDAK dipaksa di sini — cap 0.6
 * dilakukan di to-signal.ts.
 */
export async function runAssessor(
  provider: LlmProvider,
  input: AssessorInput,
): Promise<AssessorOutcome> {
  const { ctx, reports, debate, lessons } = input;

  const analystBlock = reports
    .map((r) => {
      const findings = r.findings
        .map((f) => `  - ${f.path} severity=${f.severity.toFixed(2)}: ${f.rationale}`)
        .join("\n");
      return `### ${r.domain}\n${r.summary}\n${findings}`;
    })
    .join("\n\n");

  const debateBlock = debate.turns.length
    ? debate.turns
        .map((t) => {
          const paths = t.pathsHighlighted.length
            ? ` [${t.pathsHighlighted.join(",")}]`
            : "";
          return `- ${t.side}${paths}: ${t.argument}`;
        })
        .join("\n")
    : "(no debate turns)";

  const lessonsBlock = lessons.length
    ? lessons.map((l) => `- [${l.paths.join(",")}] ${l.lesson}`).join("\n")
    : "(no lessons)";

  const content = [
    renderContextAsData(ctx),
    "",
    "## Analyst reports",
    analystBlock,
    "",
    "## Debate (Hawk vs Dove)",
    debateBlock,
    "",
    "## Lessons (context only; do not change rules)",
    lessonsBlock,
  ].join("\n");

  const result = await provider.structured({
    model: config.models.assessor,
    effort: config.effort.assessor,
    system: loadPrompt("assessor"),
    messages: [{ role: "user", content }],
    output: ResearchReport,
    outputName: "ResearchReport",
  });

  const usage = {
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  };
  const usedModel = result.providerUsed ?? result.usage.model;
  if (result.stopReason !== "ok" || !result.data) {
    const reason = result.error
      ? `${result.stopReason}: ${result.error}`
      : result.stopReason;
    return { report: null, reason, usage, usedModel };
  }
  return { report: result.data, usage, usedModel };
}
