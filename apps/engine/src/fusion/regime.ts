/**
 * Keputusan regime deterministik (spec §3.5). Fungsi MURNI.
 *
 * Alur: floor rules (§3.5.1) ∪ skor agregat (§3.5.2) → regime kandidat =
 * MAX(floor, skor). Lalu guardrail konfirmasi (§3.5.3) dan hysteresis (§3.5.4).
 * Setiap aturan yang menyala tercatat di `reasons[]` (audit & test).
 */

import { REGIMES, type Regime, type Signal } from "@tahansoe/domain";
import { effectiveWeight, decayFactor } from "./decay.ts";
import {
  REGIME_THRESHOLDS,
  MULTI_PATH_MIN,
  MULTI_PATH_BONUS,
  MACRO_SOON_HOURS,
  DEPEG_CRISIS_SEVERITY,
  ORACLE_DEVIATION_MIN_SEVERITY,
  CONFIRMING_MODULES,
  HYSTERESIS_COOLDOWN_MIN,
  HYSTERESIS_MARGIN,
} from "./config.ts";

const rank = (r: Regime): number => REGIMES.indexOf(r);
const maxRegime = (a: Regime, b: Regime): Regime => (rank(a) >= rank(b) ? a : b);

/** Prior assessment minimal yang dibutuhkan hysteresis. */
export interface PriorRegime {
  regime: Regime;
  createdAt: Date;
}

export interface DecideRegimeInput {
  signals: Signal[];
  now: Date;
  prior?: PriorRegime | null;
}

export interface DecideRegimeResult {
  /** Regime final (setelah guardrail + hysteresis). */
  regime: Regime;
  /** Regime sebelum hysteresis (hasil floor+skor+guardrail). */
  candidateRegime: Regime;
  /** Skor agregat (§3.5.2) untuk aset ini. */
  aggregateScore: number;
  /** Sinyal paling berpengaruh (terurut bobot menurun). */
  drivers: Signal[];
  /** Nama aturan yang menyala + penanda guardrail/hysteresis. */
  reasons: string[];
}

/** Jam dari `now` sampai sinyal MACRO terjadwal (pakai horizonHours sinyal). */
function macroHorizon(signal: Signal): number {
  return signal.horizonHours;
}

/** True bila sinyal masih aktif (belum kedaluwarsa & punya bobot umur > 0). */
function isActive(signal: Signal, now: Date): boolean {
  return decayFactor(signal, now) > 0;
}

/** Himpunan jalur transmisi unik dari sinyal DOWN/VOLATILITY aktif. */
function activePaths(signals: Signal[]): Set<string> {
  const set = new Set<string>();
  for (const s of signals) for (const p of s.paths ?? []) set.add(p);
  return set;
}

/**
 * Evaluasi aturan floor (§3.5.1). Mengembalikan regime floor + reasons yang menyala.
 * Hanya sinyal aktif yang dipertimbangkan.
 */
export function evaluateFloors(
  active: Signal[],
): { floor: Regime; reasons: string[] } {
  let floor: Regime = "CALM";
  const reasons: string[] = [];

  const hasNews = active.some((s) => s.module === "NEWS");

  for (const s of active) {
    // R-MACRO-SOON: MACRO terjadwal ≤ MACRO_SOON_HOURS → ELEVATED.
    if (s.module === "MACRO" && macroHorizon(s) <= MACRO_SOON_HOURS) {
      floor = maxRegime(floor, "ELEVATED");
      if (!reasons.includes("R-MACRO-SOON")) reasons.push("R-MACRO-SOON");
    }
    const paths = new Set(s.paths ?? []);
    // R-SEQUENCER-DOWN: ORACLE T10 → STRESSED.
    if (s.module === "ORACLE" && paths.has("T10")) {
      floor = maxRegime(floor, "STRESSED");
      if (!reasons.includes("R-SEQUENCER-DOWN")) reasons.push("R-SEQUENCER-DOWN");
    }
    // R-DEPEG-CONFIRMED: ONCHAIN T4 → STRESSED (CRISIS bila severity besar).
    if (s.module === "ONCHAIN" && paths.has("T4")) {
      const level: Regime = s.severity >= DEPEG_CRISIS_SEVERITY ? "CRISIS" : "STRESSED";
      floor = maxRegime(floor, level);
      if (!reasons.includes("R-DEPEG-CONFIRMED")) reasons.push("R-DEPEG-CONFIRMED");
    }
    // R-EXPLOIT-CONFIRMED: ONCHAIN T9 + konfirmasi NEWS → STRESSED.
    if (s.module === "ONCHAIN" && paths.has("T9") && hasNews) {
      floor = maxRegime(floor, "STRESSED");
      if (!reasons.includes("R-EXPLOIT-CONFIRMED")) reasons.push("R-EXPLOIT-CONFIRMED");
    }
    // R-ORACLE-DEVIATION: ORACLE T8 dengan severity tinggi → STRESSED.
    if (s.module === "ORACLE" && paths.has("T8") && s.severity >= ORACLE_DEVIATION_MIN_SEVERITY) {
      floor = maxRegime(floor, "STRESSED");
      if (!reasons.includes("R-ORACLE-DEVIATION")) reasons.push("R-ORACLE-DEVIATION");
    }
  }
  return { floor, reasons };
}

/** Skor agregat + regime dari skor (§3.5.2), dengan bonus multi-jalur. */
export function aggregateScore(active: Signal[], now: Date): { score: number; multiPath: boolean } {
  const downish = active.filter((s) => s.direction === "DOWN" || s.direction === "VOLATILITY");
  let score = downish.reduce((sum, s) => sum + effectiveWeight(s, now), 0);
  const multiPath = activePaths(downish).size >= MULTI_PATH_MIN;
  if (multiPath) score *= MULTI_PATH_BONUS;
  return { score, multiPath };
}

function regimeFromScore(score: number): Regime {
  if (score >= REGIME_THRESHOLDS.crisis) return "CRISIS";
  if (score >= REGIME_THRESHOLDS.stressed) return "STRESSED";
  if (score >= REGIME_THRESHOLDS.elevated) return "ELEVATED";
  return "CALM";
}

/** Ambang skor untuk sebuah regime (untuk margin hysteresis). */
function thresholdFor(regime: Regime): number {
  switch (regime) {
    case "CRISIS":
      return REGIME_THRESHOLDS.crisis;
    case "STRESSED":
      return REGIME_THRESHOLDS.stressed;
    case "ELEVATED":
      return REGIME_THRESHOLDS.elevated;
    default:
      return 0;
  }
}

/**
 * Keputusan regime lengkap (floor + skor → kandidat → guardrail → hysteresis).
 */
export function decideRegime(input: DecideRegimeInput): DecideRegimeResult {
  const { now, prior } = input;
  const active = input.signals.filter((s) => isActive(s, now));

  const reasons: string[] = [];

  // (1) Floor + (2) skor.
  const { floor, reasons: floorReasons } = evaluateFloors(active);
  reasons.push(...floorReasons);
  const { score, multiPath } = aggregateScore(active, now);
  if (multiPath) reasons.push("MULTI-PATH-BONUS");
  const scoreRegime = regimeFromScore(score);
  if (rank(scoreRegime) > 0) reasons.push(`SCORE-${scoreRegime}`);

  let candidate = maxRegime(floor, scoreRegime);

  // (3) GUARDRAIL konfirmasi (§3.5.3): bila kandidat ≥ STRESSED tetapi TIDAK ada
  // module konfirmasi (ORACLE/ONCHAIN/MACRO/TECHNICAL) aktif → turunkan ke ELEVATED.
  if (rank(candidate) >= rank("STRESSED")) {
    const hasConfirming = active.some((s) => CONFIRMING_MODULES.has(s.module));
    if (!hasConfirming) {
      candidate = "ELEVATED";
      reasons.push("GUARDRAIL-RESEARCH-UNCONFIRMED");
    }
  }

  // (4) Hysteresis (§3.5.4): naik segera; turun tertahan.
  let regime = candidate;
  if (prior && rank(candidate) < rank(prior.regime)) {
    const ageMin = (now.getTime() - prior.createdAt.getTime()) / 60000;
    const cooldownOk = ageMin >= HYSTERESIS_COOLDOWN_MIN;
    const marginOk = score < thresholdFor(prior.regime) - HYSTERESIS_MARGIN;
    if (!(cooldownOk && marginOk)) {
      regime = prior.regime; // tahan di regime lama
      reasons.push("HYSTERESIS-HOLD");
    }
  }

  // Drivers: sinyal aktif terurut bobot menurun (maks 6 agar ringkas).
  const drivers = [...active]
    .map((s) => ({ s, w: effectiveWeight(s, now) }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w)
    .slice(0, 6)
    .map((x) => x.s);

  return { regime, candidateRegime: candidate, aggregateScore: score, drivers, reasons };
}
