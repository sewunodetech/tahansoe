/**
 * Builder sinyal domain untuk test fusion (offline). Tanpa I/O.
 */

import type { Signal } from "@tahansoe/domain";

export const NOW = new Date("2026-10-09T12:00:00.000Z");

let seq = 0;
export function resetSeq(): void {
  seq = 0;
}

export interface SignalOverrides {
  module?: Signal["module"];
  direction?: Signal["direction"];
  severity?: number;
  confidence?: number;
  paths?: Signal["paths"];
  horizonHours?: number;
  assets?: string[];
  /** Jam yang lalu untuk observedAt (default 1). */
  observedHoursAgo?: number;
  /** Jam ke depan untuk expiresAt (default 2). */
  expiresInHours?: number;
  now?: Date;
}

/** Buat satu Signal domain dengan default masuk akal. */
export function sig(o: SignalOverrides = {}): Signal {
  const now = o.now ?? NOW;
  const observedHoursAgo = o.observedHoursAgo ?? 1;
  const expiresInHours = o.expiresInHours ?? 2;
  return {
    id: `sig-${++seq}`,
    module: o.module ?? "TECHNICAL",
    paths: o.paths,
    assets: o.assets ?? ["ETH"],
    direction: o.direction ?? "DOWN",
    severity: o.severity ?? 0.5,
    confidence: o.confidence ?? 0.5,
    horizonHours: o.horizonHours ?? 4,
    observedAt: new Date(now.getTime() - observedHoursAgo * 3_600_000),
    expiresAt: new Date(now.getTime() + expiresInHours * 3_600_000),
    evidence: [{ title: "test evidence", source: "test" }],
  };
}

/** Deret harga sintetis dengan volatilitas per-langkah tertentu (deterministik). */
export function priceSeries(
  n: number,
  stepReturn: number,
  startPrice = 1000,
  stepMinutes = 60,
  now: Date = NOW,
): { price: number; sampledAt: Date }[] {
  const out: { price: number; sampledAt: Date }[] = [];
  let price = startPrice;
  for (let i = 0; i < n; i++) {
    // Return bergantian +/- agar stdev > 0 tapi mean ~0.
    const r = i % 2 === 0 ? stepReturn : -stepReturn;
    price = price * Math.exp(r);
    out.push({
      price,
      sampledAt: new Date(now.getTime() - (n - i) * stepMinutes * 60_000),
    });
  }
  return out;
}
