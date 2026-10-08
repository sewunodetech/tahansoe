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
 * laporan analyst + giliran sebelumnya.
 *
 * TODO(dev):
 *  - rounds = min(opts.rounds ?? config.debateRounds, config.debateRoundsMax).
 *  - Bangun ringkasan analystReports sebagai data.
 *  - Tiap giliran: provider.structured({ system: loadPrompt("hawk"|"dove"),
 *    effort: config.effort.hawkDove, output: DebateTurn }).
 *  - Sisipkan giliran sebelumnya ke messages agar ada rebuttal.
 *  - stopReason != "ok" → tandai degraded, lanjutkan dengan giliran yang ada.
 */
export async function runDebate(
  _provider: LlmProvider,
  _analystReports: AnalystReport[],
  _opts: { rounds: number } = { rounds: config.debateRounds },
): Promise<DebateResult> {
  void loadPrompt;
  void DebateTurn;
  throw new Error(
    "[engine/agents/debate] runDebate belum diimplementasikan — lihat TODO (spec §3.4).",
  );
}
