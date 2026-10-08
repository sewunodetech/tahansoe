/**
 * Nilai awal ambang settlement (spec §3.5). Berversi lewat PR + review mingguan
 * (ADR 0005 §4); jangan diubah oleh reflection otomatis.
 *
 * "Outcome buruk" per jalur transmisi menentukan apakah suatu penilaian benar.
 */

import type { TransmissionPath } from "../agents/schemas.ts";

/** Ambang outcome buruk per jalur (spec §3.5 tabel). */
export const BAD_OUTCOME_THRESHOLDS = {
  /** T1: drawdown harga AaveOracle dari puncak dalam horizon. */
  priceDrawdownPct: 0.1, // ≥ 10%
  /** T2: realized vol 24j di atas persentil ini. */
  realizedVolPercentile: 0.95,
  /** T3: volume likuidasi 1j sebagai kelipatan median 30 hari. */
  liquidationVolMultiple: 10,
  /** T4: stablecoin di bawah nilai ini dianggap depeg. */
  stablecoinFloor: 0.99,
  /** T5: diskon LST di atas nilai ini dianggap depeg. */
  lstDiscountPct: 0.015, // > 1.5%
  /** T6: base fee kelipatan median 7 hari selama durasi minimum. */
  gasBaseFeeMultiple: 20,
  gasSustainedMinutes: 15,
  /** T7: utilization reserve di atas nilai ini selama durasi minimum. */
  reserveUtilization: 0.98,
  reserveSustainedMinutes: 30,
  // T9/T10: insiden protokol / sequencer down → event boolean terkonfirmasi.
} as const;

/** Regime minimal yang dianggap "menilai bahaya" (≥ STRESSED). */
export const POSITIVE_REGIME_FLOOR = "STRESSED" as const;

/** Jendela look-back untuk MISSED: regime < STRESSED selama jam ini sebelum outcome. */
export const MISSED_LOOKBACK_HOURS = 6;

/** Jalur yang outcome-nya berupa event boolean (bukan ambang numerik). */
export const BOOLEAN_PATHS: readonly TransmissionPath[] = ["T9", "T10"];
