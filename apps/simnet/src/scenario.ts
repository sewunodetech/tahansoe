/**
 * Price scenarios (spec §3.3): historical replay fixtures and stress crashes.
 * Pure functions of elapsed time so they are deterministic and testable.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const ScenarioSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_][a-z0-9_-]*$/i),
    title: z.string().min(1),
    description: z.string(),
    source: z.string(),
    normalized: z.boolean(),
    points: z
      .array(z.object({ t: z.number().int().nonnegative(), price: z.number().positive().finite() }))
      .min(2),
  })
  .refine((s) => s.points.every((p, i) => i === 0 || p.t > s.points[i - 1]!.t), {
    message: "points must be strictly increasing in t",
    path: ["points"],
  });

export type Scenario = z.infer<typeof ScenarioSchema>;

export function parseScenario(json: unknown): Scenario {
  return ScenarioSchema.parse(json);
}

/**
 * Loads every `*.json` in `dir`. Invalid files are reported, not fatal. Files starting
 * with `_` (test fixtures) are skipped unless `includeHidden` is set.
 */
export function loadScenarios(
  dir: string,
  onError: (file: string, err: unknown) => void = () => {},
  includeHidden = false,
) {
  const out = new Map<string, Scenario>();
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json") && (includeHidden || !f.startsWith("_")));
  } catch (e) {
    onError(dir, e);
  }
  for (const file of files) {
    try {
      const s = parseScenario(JSON.parse(readFileSync(join(dir, file), "utf8")));
      out.set(s.id, s);
    } catch (e) {
      onError(file, e);
    }
  }
  return out;
}

export interface ReplayOptions {
  /** Scenario seconds per wall-clock second (default 480: 24 h → 3 min). */
  compression: number;
  /** Fork price when the replay started; normalized scenarios scale to it. */
  startPrice: number;
}

export interface ReplaySample {
  price: number;
  /** 0..1 */
  progress: number;
  done: boolean;
}

/** Wall-clock length of a replay in ms. */
export function replayDurationMs(s: Scenario, compression: number): number {
  const span = s.points[s.points.length - 1]!.t - s.points[0]!.t;
  return (span / compression) * 1000;
}

/** Linear interpolation of the scenario at `elapsedMs` of wall-clock time. */
export function replayPriceAt(s: Scenario, elapsedMs: number, opts: ReplayOptions): ReplaySample {
  const pts = s.points;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const scale = s.normalized ? opts.startPrice / first.price : 1;
  const span = last.t - first.t;
  const t = first.t + (Math.max(0, elapsedMs) / 1000) * opts.compression;

  if (t >= last.t) return { price: last.price * scale, progress: 1, done: true };

  // Binary search for the segment [lo, lo+1] containing t.
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = pts[lo]!;
  const b = pts[hi]!;
  const f = (t - a.t) / (b.t - a.t);
  return { price: (a.price + (b.price - a.price) * f) * scale, progress: (t - first.t) / span, done: false };
}

export const CRASH_PCTS = [10, 30, 50] as const;
export type CrashPct = (typeof CRASH_PCTS)[number];

/** Linear ramp from `startPrice` down by `pct`% over `rampMs`, then holds. */
export function crashPriceAt(startPrice: number, pct: CrashPct, elapsedMs: number, rampMs: number): ReplaySample {
  const target = startPrice * (1 - pct / 100);
  const progress = rampMs <= 0 ? 1 : Math.min(1, Math.max(0, elapsedMs / rampMs));
  return { price: startPrice + (target - startPrice) * progress, progress, done: progress >= 1 };
}
