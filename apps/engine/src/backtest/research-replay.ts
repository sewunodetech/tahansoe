/**
 * Replay ResearchReport historis (spec §3.1 "research-replay").
 *
 * PERINGATAN (ADR 0005): backtest komponen LLM pada event lama cenderung
 * terlalu optimistis (lookahead). Hasil replay DILAPORKAN TERPISAH dari fusion
 * deterministik dan tidak dipakai sebagai klaim performa live.
 *
 * Cache per promptVersion agar replay reprodusibel & tidak membayar ulang.
 */

import type { LlmProvider } from "../llm/provider.ts";
import type { ResearchReport } from "../agents/schemas.ts";
import type { ResearchContext } from "../agents/context.ts";

/** Satu skenario replay: snapshot konteks historis + label yang disepakati. */
export interface ReplayScenario {
  id: string;
  label: string; // mis. "2023-03-SVB-USDC-depeg"
  context: ResearchContext;
  /** Regime yang disepakati tim sebagai ground truth (spec §3.1 eval/scenarios). */
  expectedRegimeAtLeast?: ResearchReport["proposedRegime"];
}

export interface ReplayResult {
  scenarioId: string;
  report: ResearchReport | null;
  /** True jika proposedRegime ≥ expected (bila expected diberikan). */
  met: boolean | null;
}

/**
 * Jalankan satu skenario lewat orkestrasi yang sama dengan live, tetapi dengan
 * konteks historis yang di-inject (bukan dari DB live).
 *
 * TODO(dev):
 *  - Hash konteks + promptVersion → cache key; kembalikan cache bila ada.
 *  - Jalankan analyst/debate/assessor memakai `provider` (bisa provider nyata
 *    atau rekaman) dengan ctx = scenario.context (JANGAN panggil buildContext).
 *  - Bandingkan proposedRegime dengan expectedRegimeAtLeast.
 *  - Simpan hasil ke cache per promptVersion.
 */
export async function replayScenario(
  _provider: LlmProvider,
  _scenario: ReplayScenario,
): Promise<ReplayResult> {
  throw new Error(
    "[engine/backtest/research-replay] replayScenario belum diimplementasikan — lihat TODO (spec §3.1, ADR 0005).",
  );
}
