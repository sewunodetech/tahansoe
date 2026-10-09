/**
 * Konstanta aturan Risk Fusion v1 (deterministik). Semua BERVERSI lewat
 * `FUSION_VERSION`; nilai awal di sini dikalibrasi lewat PR + backtest (PRD §6.4),
 * TIDAK PERNAH otomatis (ADR 0005 §4).
 *
 * Spec: docs/specs/m2-risk-fusion-v1.md (§3.3–§3.6 + "Keputusan atas pertanyaan
 * terbuka"). Modul MURNI tanpa I/O.
 */

import type { Regime } from "@tahansoe/domain";

/** Versi aturan fusion → disimpan sebagai `modelVersion` pada RiskAssessment. */
export const FUSION_VERSION = "fusion-v1-2026.10.1";

/**
 * Bobot per module (§3.4). Module terkonfirmasi (ORACLE/ONCHAIN/MACRO/TECHNICAL)
 * berbobot lebih tinggi daripada yang tak tepercaya (NEWS/RESEARCH/SOCIAL).
 */
export const MODULE_WEIGHT: Record<string, number> = {
  ORACLE: 1.0,
  ONCHAIN: 1.0,
  MACRO: 0.7,
  TECHNICAL: 0.7,
  NEWS: 0.35,
  RESEARCH: 0.35,
  SOCIAL: 0.2,
};

/** Module yang dianggap "konfirmasi" untuk guardrail (§3.5.3). */
export const CONFIRMING_MODULES = new Set(["ORACLE", "ONCHAIN", "MACRO", "TECHNICAL"]);
/** Module "tak tepercaya sendirian" (butuh konfirmasi untuk ≥ STRESSED). */
export const UNCONFIRMED_MODULES = new Set(["NEWS", "RESEARCH", "SOCIAL"]);

/** Cap confidence (§3.4). RESEARCH & NEWS/SOCIAL dijepit; module lain tidak. */
export const RESEARCH_CONFIDENCE_CAP = 0.6;
export const NEWS_CONFIDENCE_CAP = 0.6;

/** Peluruhan umur sinyal (§3.3): exp(-DECAY_LAMBDA × frac_umur). */
export const DECAY_LAMBDA = 1.5;

/**
 * Ambang skor agregat → regime kandidat (§3.5.2). Dikalibrasi lewat backtest.
 * aggregateScore = Σ effectiveWeight sinyal DOWN/VOLATILITY (0..~beberapa).
 */
export const REGIME_THRESHOLDS = {
  elevated: 0.3,
  stressed: 0.9,
  crisis: 1.6,
} as const;

/** Kombinasi jalur transmisi (§3.5.2): ≥ MULTI_PATH_MIN jalur → pengali bonus. */
export const MULTI_PATH_MIN = 3;
export const MULTI_PATH_BONUS = 1.25;

/** Event makro terjadwal dengan horizon ≤ ini (jam) → floor ELEVATED (§3.5.1). */
export const MACRO_SOON_HOURS = 18;

/** Depeg stablecoin: deviasi (bps dari $1) ≥ ini → CRISIS, selain itu STRESSED. */
export const DEPEG_CRISIS_BPS = 500; // 5% (mis. USDC 0.95)

/** Severity ONCHAIN depeg (T4) ≥ ini → perlakukan sebagai CRISIS (proksi deviasi besar). */
export const DEPEG_CRISIS_SEVERITY = 0.9;

/** Severity minimum sinyal ORACLE deviasi (T8) agar memicu floor R-ORACLE-DEVIATION. */
export const ORACLE_DEVIATION_MIN_SEVERITY = 0.6;

/** Hysteresis (§3.5.4): turun regime tertahan sampai cooldown + margin terpenuhi. */
export const HYSTERESIS_COOLDOWN_MIN = 60;
/** Skor harus turun di bawah ambang regime saat ini DIKURANGI margin ini untuk turun. */
export const HYSTERESIS_MARGIN = 0.15;

/** Drawdown (§3.6): z-score kuantil p99 untuk estimasi tail. */
export const Z99 = 2.33;
/** Batas atas drawdown agar hfRequired = 1/(1-d) tetap aman (d < 1). */
export const D_MAX = 0.6;

/** Multiplier drawdown per regime (fat tail saat regime naik). */
export const REGIME_MULTIPLIER: Record<Regime, number> = {
  CALM: 1.0,
  ELEVATED: 1.3,
  STRESSED: 1.8,
  CRISIS: 2.5,
};

/** Buffer target di atas trigger HF (§3.6): recommendedTargetHF = trigger + ini. */
export const TARGET_BUFFER = 0.3;

/** Horizon reaksi untuk recommendedTriggerHF (§3.6, keputusan: h4 di v1). */
export const REACTION_HORIZON: "h4" | "h24" = "h4";

/** Interval fusion terjadwal (menit) — dipakai Tahap 2 (worker); validUntil = ini + margin. */
export const FUSION_INTERVAL_MIN = 15;
/** Umur assessment valid (menit): sedikit di atas interval agar tidak ada celah. */
export const ASSESSMENT_TTL_MIN = 20;

/** riskScore maksimum (0..100). */
export const RISK_SCORE_MAX = 100;
