/**
 * Implementasi LlmProvider memakai Anthropic SDK (ADR 0004 §5, spec §3.4).
 *
 * STATUS: stub boilerplate. Alur dan invariant sudah dijabarkan sebagai TODO,
 * tetapi pemanggilan SDK sengaja belum diisi supaya typecheck tidak butuh network.
 *
 * Yang WAJIB diterapkan saat mengisi (spec §3.4):
 *  - Structured output pakai `messages.parse` + `zodOutputFormat` (schema zod).
 *  - Prompt caching: system prompt statis di depan, konten eksternal (data) di akhir.
 *  - Cek `stop_reason`. Topik perang/serangan/exploit bisa memicu `refusal`;
 *    aktifkan server-side fallback (`fallbacks: "default"`, beta
 *    `server-side-fallback-2026-07-01`). Jika tetap refusal → kembalikan
 *    stopReason "refusal" dan data null (analyst dianggap gagal untuk run itu).
 *  - Output gagal validasi schema → data null + error, JANGAN diperbaiki.
 *  - Catat usage ke Budget setelah tiap call.
 *  - JANGAN pernah log `apiKey` (security.md I8).
 */

import type { LlmProvider, LlmRequest, LlmResult } from "./provider.ts";
import { budget as defaultBudget, type Budget } from "./budget.ts";
import { env } from "../config.ts";

/** Peta effort engine → parameter thinking/effort SDK. TODO(dev): sesuaikan ke API final. */
const EFFORT_BUDGET_TOKENS = {
  low: 1_000,
  medium: 4_000,
  high: 12_000,
} as const;

export class AnthropicProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly budget: Budget;

  constructor(budget: Budget = defaultBudget) {
    this.budget = budget;
    // Lazy: hanya butuh key saat provider dibuat untuk run nyata.
    this.apiKey = env.anthropicApiKey();
    void this.apiKey; // dipakai saat SDK diisi
    void this.budget;
    void EFFORT_BUDGET_TOKENS;
  }

  async structured<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    // TODO(dev): inisialisasi `new Anthropic({ apiKey: this.apiKey })` (sekali, modul-level).
    // TODO(dev): bangun params:
    //   - system: req.system  (cache_control: ephemeral di blok statis)
    //   - messages: req.messages
    //   - response_format / tool via zodOutputFormat(req.output, req.outputName)
    //   - thinking budget dari EFFORT_BUDGET_TOKENS[req.effort]
    //   - betas: ["server-side-fallback-2026-07-01"], fallbacks: "default"
    // TODO(dev): panggil client.messages.parse(...).
    // TODO(dev): map stop_reason → StopReason; jika "refusal" → data null.
    // TODO(dev): validasi hasil dengan req.output.safeParse; jika gagal → data null + error.
    // TODO(dev): rakit LlmUsage dari response.usage; panggil this.budget.record(usage).
    throw new Error(
      "[engine/llm/anthropic] AnthropicProvider.structured belum diimplementasikan — lihat TODO di file ini (spec §3.4).",
    );
  }
}
