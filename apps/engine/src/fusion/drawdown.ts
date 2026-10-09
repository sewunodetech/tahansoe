/**
 * Estimasi drawdown dari volatilitas realized (spec §3.6). Fungsi MURNI.
 *
 * Input harga adalah deret {price, sampledAt} (sumber: AaveOracle, I5 — dikumpulkan
 * di luar modul ini). Fusion v1 TIDAK mengimpor price-sampler; deret diterima
 * sebagai argumen agar pure & offline.
 *
 *   realizedVolPerHour  = stdev(log returns) dinormalisasi ke per-jam
 *   sigma_h             = volPerHour × sqrt(h)
 *   d_h                 = clamp(Z99 × sigma_h × regimeMultiplier, 0, D_MAX)
 */

import type { Regime } from "@tahansoe/domain";
import { Z99, D_MAX, REGIME_MULTIPLIER } from "./config.ts";

/** Satu sampel harga (dari AaveOracle). */
export interface PriceSample {
  price: number;
  sampledAt: Date;
}

export interface DrawdownEstimate {
  h4: number;
  h24: number;
}

/** Minimal sampel untuk menghitung volatilitas yang berarti. */
export const MIN_PRICE_SAMPLES = 10;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Volatilitas realized per JAM dari deret harga. Mengembalikan null bila sampel
 * tak cukup / tidak valid (pemanggil pakai estimasi konservatif berbasis regime).
 *
 * Metode: stdev dari log-return antar sampel berurutan, dinormalisasi ke per-jam
 * memakai jarak waktu rata-rata antar sampel (akar waktu).
 */
export function realizedVolPerHour(samples: PriceSample[]): number | null {
  if (!Array.isArray(samples) || samples.length < MIN_PRICE_SAMPLES) return null;
  // Urutkan menaik waktu; buang sampel non-positif / waktu tak valid.
  const sorted = [...samples]
    .filter((s) => Number.isFinite(s.price) && s.price > 0 && Number.isFinite(s.sampledAt.getTime()))
    .sort((a, b) => a.sampledAt.getTime() - b.sampledAt.getTime());
  if (sorted.length < MIN_PRICE_SAMPLES) return null;

  const returns: number[] = [];
  let totalDtHours = 0;
  let steps = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const dtHours = (cur.sampledAt.getTime() - prev.sampledAt.getTime()) / 3_600_000;
    if (dtHours <= 0) continue;
    returns.push(Math.log(cur.price / prev.price));
    totalDtHours += dtHours;
    steps += 1;
  }
  if (returns.length < MIN_PRICE_SAMPLES - 1 || steps === 0) return null;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length;
  const stdevPerStep = Math.sqrt(variance);
  const avgDtHours = totalDtHours / steps;
  if (avgDtHours <= 0) return null;
  // Normalisasi stdev per-langkah ke per-jam via akar waktu.
  return stdevPerStep / Math.sqrt(avgDtHours);
}

/**
 * Estimasi drawdown kuantil p99 untuk h4 & h24 (§3.6). `volPerHour` dari
 * realizedVolPerHour; bila null (data kurang), gunakan `fallbackVolPerHour`
 * konservatif berbasis regime (pemanggil menyediakan).
 */
export function estimateDrawdown(
  volPerHour: number,
  regime: Regime,
): DrawdownEstimate {
  const mult = REGIME_MULTIPLIER[regime];
  const dAt = (h: number): number => {
    const sigmaH = volPerHour * Math.sqrt(h);
    return clamp(Z99 * sigmaH * mult, 0, D_MAX);
  };
  return { h4: dAt(4), h24: dAt(24) };
}

/**
 * Volatilitas fallback per-jam berbasis regime ketika data harga tidak cukup
 * (§4 degradasi). Konservatif: naik seiring regime. Nilai awal, dikalibrasi.
 */
export const FALLBACK_VOL_PER_HOUR: Record<Regime, number> = {
  CALM: 0.004, // ~0.4%/jam
  ELEVATED: 0.008,
  STRESSED: 0.015,
  CRISIS: 0.025,
};
