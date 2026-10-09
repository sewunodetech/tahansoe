/**
 * Risk Fusion v1 — lapisan deterministik (spec docs/specs/m2-risk-fusion-v1.md).
 * Barrel ekspor API publik Tahap 1 (logika murni). Tahap 2 (penyimpanan +
 * integrasi worker) menambah `run.ts` yang mengimpor `fuse` dari sini.
 */

export * from "./config.ts";
export { decayFactor, effectiveWeight, clampConfidence } from "./decay.ts";
export {
  decideRegime,
  evaluateFloors,
  aggregateScore,
  type DecideRegimeInput,
  type DecideRegimeResult,
  type PriorRegime,
} from "./regime.ts";
export {
  estimateDrawdown,
  realizedVolPerHour,
  FALLBACK_VOL_PER_HOUR,
  MIN_PRICE_SAMPLES,
  type PriceSample,
  type DrawdownEstimate,
} from "./drawdown.ts";
export { renderExplanation, type ExplanationInput } from "./explain.ts";
export { fuse, fuseWithReasons, type FuseInput } from "./fuse.ts";
