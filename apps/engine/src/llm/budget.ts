/**
 * Akuntansi biaya LLM harian + hard stop (spec §3.4).
 *
 * Saat `exceeded()` true, lapis riset berhenti sampai besok (reset per hari UTC),
 * tim diberi alert, tetapi modul sinyal & fusion TETAP jalan (invariant I6).
 *
 * Boilerplate: perhitungan dari `usage` + tabel harga. Persistensi lintas proses
 * (mis. ke tabel DB usage harian) ditandai TODO — penting agar budget tidak
 * ter-reset saat worker restart.
 */

import type { LlmUsage } from "./provider.ts";
import { env } from "../config.ts";

/**
 * Harga per 1 juta token (USD), asumsi Okt 2026 (spec §3.4).
 * TODO(dev): verifikasi ulang dari dashboard billing; pindah ke config bila berubah.
 */
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  // Gemini free tier (R&D, ADR 0008 §5): biaya $0, tetapi token tetap DICATAT
  // (inputTokens/outputTokens di usage) agar pemakaian terlihat di scorecard.
  // Model tak dikenal tetap konservatif memakai harga opus (lihat costOf).
  "gemini-flash-lite-latest": { input: 0, output: 0 },
  "gemini-flash-latest": { input: 0, output: 0 },
  "gemini-pro-latest": { input: 0, output: 0 },
  "gemini-2.5-flash": { input: 0, output: 0 },
  "gemini-2.5-flash-lite": { input: 0, output: 0 },
};

/**
 * Multiplier harga token cache relatif terhadap harga input (Anthropic):
 *  - cache WRITE (creation) ditagih ~1.25x harga input.
 *  - cache READ ditagih ~0.1x harga input.
 * `usage.input_tokens` dari API TIDAK termasuk token cache, jadi ketiganya
 * dijumlahkan terpisah.
 */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/** Harga fallback untuk model tak dikenal: pakai tier termahal (opus), bukan gratis. */
const FALLBACK_PRICE = PRICE_PER_MTOK["claude-opus-5-5"]!;

/** Model tak dikenal yang sudah di-warning (agar warning hanya sekali per model). */
const warnedUnknownModels = new Set<string>();

/**
 * Biaya satu pemakaian dalam USD.
 *
 * Memperhitungkan token cache secara terpisah: input non-cache pada harga penuh,
 * cache write ~1.25x, cache read ~0.1x, output pada harga output. Model yang tidak
 * ada di tabel harga diperlakukan konservatif memakai harga tier termahal (opus)
 * dan dicatat sebagai warning sekali — tidak pernah dianggap gratis.
 */
export function costOf(usage: LlmUsage): number {
  let price = PRICE_PER_MTOK[usage.model];
  if (!price) {
    if (!warnedUnknownModels.has(usage.model)) {
      warnedUnknownModels.add(usage.model);
      console.warn(
        `[engine/llm/budget] model tak dikenal "${usage.model}" — memakai harga opus (konservatif). Lengkapi PRICE_PER_MTOK.`,
      );
    }
    price = FALLBACK_PRICE;
  }
  const input = (usage.inputTokens / 1_000_000) * price.input;
  const cacheWrite =
    ((usage.cacheWriteTokens ?? 0) / 1_000_000) * price.input * CACHE_WRITE_MULTIPLIER;
  const cacheRead =
    ((usage.cacheReadTokens ?? 0) / 1_000_000) * price.input * CACHE_READ_MULTIPLIER;
  const output = (usage.outputTokens / 1_000_000) * price.output;
  return input + cacheWrite + cacheRead + output;
}

/** Kunci hari UTC untuk reset harian. */
function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Akumulator biaya harian.
 *
 * TODO(dev): ganti penyimpanan in-memory ini dengan baca/tulis ke DB (mis. tabel
 * `llm_usage_daily` per modelVersion/role) agar persist lintas restart dan bisa
 * dilaporkan di scorecard (spec §3.6: "Biaya harian tercatat per peran").
 */
export class Budget {
  private day = todayKey();
  private spentUsd = 0;
  private readonly limitUsd: number;

  constructor(limitUsd: number = env.llmDailyBudgetUsd()) {
    this.limitUsd = limitUsd;
  }

  private rolloverIfNeeded(now?: Date): void {
    const key = todayKey(now);
    if (key !== this.day) {
      this.day = key;
      this.spentUsd = 0;
    }
  }

  /** Catat biaya satu pemakaian. Dipanggil provider setelah tiap call. */
  record(usage: LlmUsage, now?: Date): void {
    this.rolloverIfNeeded(now);
    this.spentUsd += costOf(usage);
    // TODO(dev): persist ke DB + emit metrik per peran.
  }

  /** True jika budget hari ini sudah terlampaui → lapis riset berhenti. */
  exceeded(now?: Date): boolean {
    this.rolloverIfNeeded(now);
    return this.spentUsd >= this.limitUsd;
  }

  spentToday(now?: Date): number {
    this.rolloverIfNeeded(now);
    return this.spentUsd;
  }
}

/** Instance default dipakai orkestrasi run. */
export const budget = new Budget();
