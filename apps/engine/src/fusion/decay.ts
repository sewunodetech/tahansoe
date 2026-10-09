/**
 * Peluruhan (decay) & bobot efektif sinyal (spec §3.3–§3.4). Fungsi MURNI.
 *
 *   effectiveWeight = moduleWeight × clampConfidence × severity × decayFactor
 *
 * Sinyal baru berbobot penuh; mendekati `expiresAt` meluruh mulus ke ~0.
 */

import type { Signal } from "@tahansoe/domain";
import {
  MODULE_WEIGHT,
  DECAY_LAMBDA,
  RESEARCH_CONFIDENCE_CAP,
  NEWS_CONFIDENCE_CAP,
} from "./config.ts";

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/**
 * Confidence setelah jepitan per module (§3.4): RESEARCH ≤ 0.6, NEWS/SOCIAL ≤ 0.6,
 * module terkonfirmasi tidak dijepit. Nilai di luar [0,1] di-clamp dulu.
 */
export function clampConfidence(signal: Pick<Signal, "module" | "confidence">): number {
  const c = clamp01(signal.confidence);
  if (signal.module === "RESEARCH") return Math.min(c, RESEARCH_CONFIDENCE_CAP);
  if (signal.module === "NEWS" || signal.module === "SOCIAL") return Math.min(c, NEWS_CONFIDENCE_CAP);
  return c;
}

/**
 * Faktor peluruhan umur ∈ [0,1] (§3.3). 0 bila sudah kedaluwarsa (now ≥ expiresAt)
 * atau rentang hidup tidak valid. Eksponensial: exp(-λ × umur/hidup).
 */
export function decayFactor(
  signal: Pick<Signal, "observedAt" | "expiresAt">,
  now: Date,
): number {
  const observed = signal.observedAt.getTime();
  const expires = signal.expiresAt.getTime();
  const t = now.getTime();
  if (!Number.isFinite(observed) || !Number.isFinite(expires)) return 0;
  if (t >= expires) return 0;
  const life = expires - observed;
  if (life <= 0) return 0; // rentang hidup tidak valid
  const age = t - observed;
  const frac = clamp01(age / life);
  return Math.exp(-DECAY_LAMBDA * frac);
}

/**
 * Bobot efektif satu sinyal pada waktu `now` (§3.3). Sinyal kedaluwarsa → 0.
 * Module tak dikenal → bobot 0 (diabaikan, bukan crash).
 */
export function effectiveWeight(signal: Signal, now: Date): number {
  const moduleWeight = MODULE_WEIGHT[signal.module] ?? 0;
  if (moduleWeight === 0) return 0;
  const severity = clamp01(signal.severity);
  const confidence = clampConfidence(signal);
  const decay = decayFactor(signal, now);
  return moduleWeight * confidence * severity * decay;
}
