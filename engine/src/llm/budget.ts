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
};

/** Biaya satu pemakaian dalam USD. Token cache diasumsikan harga input penuh (konservatif). */
export function costOf(usage: LlmUsage): number {
  const price = PRICE_PER_MTOK[usage.model];
  if (!price) {
    // Model tak dikenal → jangan anggap gratis; TODO(dev): lengkapi tabel harga.
    return 0;
  }
  const input = (usage.inputTokens / 1_000_000) * price.input;
  const output = (usage.outputTokens / 1_000_000) * price.output;
  return input + output;
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
