/**
 * Orkestrasi Risk Fusion v1 (spec §3.2, §3.6). Fungsi MURNI (tanpa I/O).
 *
 *   fuse(input) → RiskAssessment | null
 *
 * null = graceful degradation (§4, I6): tidak ada sinyal aktif untuk aset →
 * tidak ada assessment → rule engine jatuh ke policy statis user. Fusion TIDAK
 * meng-clamp trigger ke band user (itu rule engine).
 */

import { hfRequired, type RiskAssessment, type Regime, type Signal } from "@tahansoe/domain";
import { decideRegime, type PriorRegime } from "./regime.ts";
import { effectiveWeight } from "./decay.ts";
import {
  estimateDrawdown,
  realizedVolPerHour,
  FALLBACK_VOL_PER_HOUR,
  type PriceSample,
  type DrawdownEstimate,
} from "./drawdown.ts";
import { renderExplanation } from "./explain.ts";
import {
  FUSION_VERSION,
  TARGET_BUFFER,
  REACTION_HORIZON,
  ASSESSMENT_TTL_MIN,
  RISK_SCORE_MAX,
  REGIME_THRESHOLDS,
  D_MAX,
} from "./config.ts";
import { REGIMES } from "@tahansoe/domain";

export interface FuseInput {
  asset: string;
  chainId: number;
  /** Sinyal yang menyangkut aset ini (akan difilter aktif di dalam). */
  signals: Signal[];
  /** Prior assessment untuk hysteresis (opsional). */
  prior?: PriorRegime | null;
  /** Deret harga AaveOracle untuk volatilitas (opsional; kurang → fallback regime). */
  priceSamples?: PriceSample[];
  now: Date;
}

const rank = (r: Regime): number => REGIMES.indexOf(r);

/** riskScore 0..100: normalisasi aggregateScore terhadap ambang CRISIS, + lantai per regime. */
function computeRiskScore(aggregateScore: number, regime: Regime): number {
  // Normalisasi linier skor ke 0..100 memakai ambang CRISIS sebagai acuan "100".
  const byScore = Math.min(RISK_SCORE_MAX, (aggregateScore / REGIME_THRESHOLDS.crisis) * RISK_SCORE_MAX);
  // Lantai per regime agar regime tinggi tidak tampak "aman" karena skor rendah
  // (mis. floor STRESSED dari sequencer tanpa skor besar).
  const regimeFloor = [0, 40, 70, 90][rank(regime)] ?? 0;
  return Math.round(Math.max(byScore, regimeFloor) * 100) / 100;
}

/**
 * Hasilkan RiskAssessment untuk satu aset. Mengembalikan null bila tidak ada
 * sinyal aktif (graceful degradation).
 */
export function fuse(input: FuseInput): RiskAssessment | null {
  const { asset, chainId, signals, prior, priceSamples, now } = input;

  const decision = decideRegime({ signals, now, prior });

  // Graceful degradation: tanpa driver aktif → tidak ada assessment.
  if (decision.drivers.length === 0) {
    return null;
  }

  // Volatilitas: dari harga bila cukup, selain itu fallback konservatif per regime.
  const notes: string[] = [];
  let volPerHour = realizedVolPerHour(priceSamples ?? []);
  if (volPerHour === null) {
    volPerHour = FALLBACK_VOL_PER_HOUR[decision.regime];
    notes.push(
      "insufficient price history; drawdown uses a conservative regime-based volatility estimate",
    );
  }

  const drawdownEstimate: DrawdownEstimate = estimateDrawdown(volPerHour, decision.regime);

  // Horizon reaksi (v1: h4). hfRequired aman karena d di-clamp < 1 (D_MAX).
  const dReaction = REACTION_HORIZON === "h4" ? drawdownEstimate.h4 : drawdownEstimate.h24;
  const safeD = Math.min(dReaction, D_MAX);
  const recommendedTriggerHF = hfRequired(safeD);
  const recommendedTargetHF = recommendedTriggerHF + TARGET_BUFFER;

  const riskScore = computeRiskScore(decision.aggregateScore, decision.regime);

  const explanation = renderExplanation({
    asset,
    regime: decision.regime,
    drawdownEstimate,
    recommendedTriggerHF,
    reasons: decision.reasons,
    drivers: decision.drivers,
    notes,
  });

  const validUntil = new Date(now.getTime() + ASSESSMENT_TTL_MIN * 60_000);

  return {
    asset,
    chainId,
    regime: decision.regime,
    riskScore,
    drawdownEstimate,
    recommendedTriggerHF,
    recommendedTargetHF,
    drivers: decision.drivers,
    explanation,
    modelVersion: FUSION_VERSION,
    createdAt: now,
    validUntil,
  };
}

/** Ekspor reasons terpisah (tidak di tipe RiskAssessment kanonik) untuk audit/test. */
export function fuseWithReasons(input: FuseInput): { assessment: RiskAssessment | null; reasons: string[] } {
  const decision = decideRegime({ signals: input.signals, now: input.now, prior: input.prior });
  const assessment = fuse(input);
  return { assessment, reasons: decision.reasons };
}

export { effectiveWeight };
