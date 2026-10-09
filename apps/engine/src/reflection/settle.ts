/**
 * Settlement: label TP/FP/MISSED/TN + lead time (spec §3.5, ADR 0005 §1).
 *
 * `labelOf` dan `leadTimeMinutes` adalah fungsi murni — DIIMPLEMENTASIKAN agar
 * bisa diuji unit (spec §6 "settle: keempat label dan lead time dari fixture").
 * Bagian yang menyentuh DB (ambil penilaian jatuh tempo, simpan risk_settlements)
 * ditandai TODO.
 */

import { REGIMES, type Regime } from "../config.ts";
import type { SettlementLabel } from "../agents/schemas.ts";
import type { Outcome } from "./outcomes.ts";
import { POSITIVE_REGIME_FLOOR } from "./config.ts";

/** Peringkat regime untuk perbandingan ≥. */
function regimeRank(r: Regime): number {
  return REGIMES.indexOf(r);
}

/** True jika regime ≥ STRESSED (dianggap "menilai bahaya"). */
export function isPositiveRegime(r: Regime): boolean {
  return regimeRank(r) >= regimeRank(POSITIVE_REGIME_FLOOR);
}

export interface SettleInput {
  /** Regime/proposal yang dinilai. */
  assessedRegime: Regime;
  /** Outcome aktual dalam horizon. */
  outcome: Outcome;
  /**
   * Apakah regime < STRESSED selama jendela look-back sebelum outcome buruk.
   * Dipakai untuk membedakan MISSED (spec §3.5): true berarti memang terlewat.
   */
  wasBelowFloorBeforeOutcome: boolean;
  /** Apakah penilaian ini bagian sampel TN (regime rendah tanpa outcome). */
  sampledForTrueNegative?: boolean;
}

/**
 * Tentukan label settlement (spec §3.5 tabel):
 *  - TP: regime ≥ STRESSED dan ada outcome buruk
 *  - FP: regime ≥ STRESSED tanpa outcome buruk
 *  - MISSED: ada outcome buruk tetapi regime < STRESSED selama look-back
 *  - TN: regime < STRESSED tanpa outcome buruk (disampel)
 * Mengembalikan null jika regime < STRESSED, ada... (kombinasi tak tersampel) →
 * caller boleh melewati (tidak semua TN diproses).
 */
export function labelOf(input: SettleInput): SettlementLabel | null {
  const positive = isPositiveRegime(input.assessedRegime);
  const bad = input.outcome.hadBadOutcome;

  if (positive && bad) return "TRUE_POSITIVE";
  if (positive && !bad) return "FALSE_POSITIVE";
  if (!positive && bad && input.wasBelowFloorBeforeOutcome) return "MISSED";
  if (!positive && !bad && input.sampledForTrueNegative) return "TRUE_NEGATIVE";
  return null;
}

/**
 * Lead time (menit): dari saat regime pertama kali ≥ STRESSED sampai titik
 * terburuk outcome. Mengembalikan null jika salah satu waktu tidak ada
 * (mis. MISSED tidak punya titik "pertama ≥ STRESSED").
 */
export function leadTimeMinutes(
  firstStressedAt: Date | null,
  worstOutcomeAt: Date | null,
): number | null {
  if (!firstStressedAt || !worstOutcomeAt) return null;
  const ms = worstOutcomeAt.getTime() - firstStressedAt.getTime();
  return Math.round(ms / 60_000);
}

import { runSettlementJob } from "./settle-job.ts";

/**
 * Entry point job settlement (tiap jam, spec §3.1).
 */
export async function runSettlement(now: Date = new Date()): Promise<void> {
  await runSettlementJob({ now });
}
