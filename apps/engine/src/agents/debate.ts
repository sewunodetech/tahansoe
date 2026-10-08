/**
 * Debat Hawk ⇄ Dove (spec §3.1/§3.4, ADR 0004).
 *
 * Hawk berargumen risiko naik; Dove berargumen noise / sudah ter-price-in.
 * Default 1 ronde, maksimal 2 (config.debateRounds / debateRoundsMax).
 * Argumen adalah bahan pertimbangan, bukan keputusan (ADR 0002).
 */

import type { LlmProvider } from "../llm/provider.ts";
import { loadPrompt } from "../llm/prompts/index.ts";
import { DebateTurn } from "./schemas.ts";
import type { AnalystReport } from "./schemas.ts";
import { config } from "../config.ts";

export interface DebateResult {
  turns: DebateTurn[];
  /** True jika ada ronde yang gagal (refusal/schema) — assessor tetap bisa jalan. */
  degraded: boolean;
}

/**
 * Jalankan debat N ronde. Setiap ronde: Hawk lalu Dove, masing-masing melihat
 * ringkasan laporan analyst + giliran sebelumnya (untuk rebuttal).
 *
 * Giliran yang gagal (stopReason != "ok") ditandai `degraded` dan dilewati;
 * assessor tetap bisa jalan dengan giliran yang ada (I6).
 */
export async function runDebate(
  provider: LlmProvider,
  analystReports: AnalystReport[],
  opts: { rounds: number } = { rounds: config.debateRounds },
): Promise<DebateResult> {
  const rounds = Math.min(
    Math.max(opts.rounds, 1),
    config.debateRoundsMax,
  );
  const analystData = renderAnalystReports(analystReports);
  const turns: DebateTurn[] = [];
  let degraded = false;

  for (let round = 0; round < rounds; round++) {
    for (const side of ["hawk", "dove"] as const) {
      const priorTurns = turns.length
        ? `\n\n## Debate so far\n${renderDebateTurns(turns)}`
        : "";
      const result = await provider.structured({
        model: config.models.hawkDove,
        effort: config.effort.hawkDove,
        system: loadPrompt(side),
        messages: [
          {
            role: "user",
            content: `## Analyst reports\n${analystData}${priorTurns}`,
          },
        ],
        output: DebateTurn,
        outputName: "DebateTurn",
      });
      if (result.stopReason !== "ok" || !result.data) {
        degraded = true;
        continue;
      }
      turns.push(result.data);
    }
  }

  return { turns, degraded };
}

/** Ringkasan laporan analyst untuk disisipkan sebagai data. */
function renderAnalystReports(reports: AnalystReport[]): string {
  return reports
    .map((r) => {
      const findings = r.findings
        .map((f) => `  - ${f.path} severity=${f.severity.toFixed(2)}: ${f.rationale}`)
        .join("\n");
      return `### ${r.domain}\n${r.summary}\n${findings}`;
    })
    .join("\n\n");
}

/** Ringkasan giliran debat sebelumnya. */
function renderDebateTurns(turns: DebateTurn[]): string {
  return turns
    .map((t) => {
      const paths = t.pathsHighlighted.length
        ? ` [${t.pathsHighlighted.join(",")}]`
        : "";
      const reb = t.rebuttal ? `\n  rebuttal: ${t.rebuttal}` : "";
      return `- ${t.side}${paths}: ${t.argument}${reb}`;
    })
    .join("\n");
}
