/**
 * 4 analyst paralel (spec §3.1/§3.4, ADR 0004).
 *
 * Masing-masing membaca konteks yang sama lalu menghasilkan AnalystReport.
 * Dijalankan dengan Promise.allSettled oleh run.ts; satu analyst gagal/refusal
 * tidak membatalkan yang lain. Run butuh ≥ minAnalystsRequired sukses.
 */

import type { LlmProvider } from "../llm/provider.ts";
import { loadPrompt, type PromptRole } from "../llm/prompts/index.ts";
import { AnalystReport } from "./schemas.ts";
import type { ResearchContext } from "./context.ts";
import { renderContextAsData } from "./context.ts";
import { config } from "../config.ts";

export type AnalystDomain = "GEOPOLITICS" | "MACRO" | "MARKET" | "ONCHAIN";

/** Pemetaan domain → peran prompt. */
const PROMPT_BY_DOMAIN: Record<AnalystDomain, PromptRole> = {
  GEOPOLITICS: "analyst-geopolitics",
  MACRO: "analyst-macro",
  MARKET: "analyst-market",
  ONCHAIN: "analyst-onchain",
};

/** Daftar analyst yang dijalankan tiap run (spec §3.2 ANALYSTS). */
export const ANALYSTS: AnalystDomain[] = [
  "GEOPOLITICS",
  "MACRO",
  "MARKET",
  "ONCHAIN",
];

/** Hasil satu analyst: report bila sukses, atau alasan + status bila gagal. */
export interface AnalystOutcome {
  domain: AnalystDomain;
  report: AnalystReport | null;
  /** Alasan gagal (stopReason/error) untuk audit. Kosong bila sukses. */
  reason?: string;
  /** Status HTTP bila kegagalan dari API (400/401/403 = non-retryable). */
  status?: number;
  /** Pemakaian token (audit G7). */
  usage?: { inputTokens: number; outputTokens: number };
  /** "provider:model" yang akhirnya dipakai (setelah fallback), bila diketahui. */
  usedModel?: string;
}

/**
 * Jalankan satu analyst. Mengembalikan `AnalystOutcome`: `report` terisi jika
 * sukses; bila gagal (refusal / schema invalid / error), `report` null dan
 * `reason` (+ `status`) menjelaskan penyebabnya untuk audit dan deteksi fail-fast.
 */
export async function runAnalyst(
  provider: LlmProvider,
  domain: AnalystDomain,
  ctx: ResearchContext,
): Promise<AnalystOutcome> {
  const system = loadPrompt(PROMPT_BY_DOMAIN[domain]);
  const data = renderContextAsData(ctx);
  const result = await provider.structured({
    model: config.models.analyst,
    effort: config.effort.analyst,
    system,
    messages: [{ role: "user", content: data }],
    output: AnalystReport,
    outputName: "AnalystReport",
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
    return { domain, report: null, reason, status: result.status, usage, usedModel };
  }
  return { domain, report: result.data, usage, usedModel };
}
