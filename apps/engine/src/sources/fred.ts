/**
 * Adapter FRED (Federal Reserve Economic Data) API untuk indikator makroekonomi utama.
 *
 * Mengambil observasi terbaru untuk:
 *  - FEDFUNDS (Federal Funds Effective Rate)
 *  - CPIAUCSL (Consumer Price Index for All Urban Consumers)
 *  - DGS10 (10-Year Treasury Constant Maturity Rate)
 *  - T10Y2Y (10-Year Treasury Minus 2-Year Yield Spread — indikator inversi kurva)
 *
 * Invarian:
 *  - FRED_API_KEY opsional: jika tidak tersedia di env, sumber dilewati dengan warning (I6).
 *  - Output dinormalisasi ke ContextSignal dengan module "MACRO".
 *  - Confidence sinyal di-cap ke 0.6.
 *  - Tidak pernah melempar error (graceful degradation).
 */

import type { ContextSignal } from "../agents/context.ts";

export interface FredOptions {
  /** API key FRED (default: process.env.FRED_API_KEY). */
  apiKey?: string;
  /** Batas waktu pemanggilan dalam ms (default: 10_000). */
  timeoutMs?: number;
  /** Custom fetch function untuk pengujian dengan fixture. */
  fetchFn?: typeof fetch;
  now?: Date;
}

export interface FredObservationRaw {
  date?: string;
  value?: string;
}

export interface FredSeriesResponse {
  observations?: FredObservationRaw[];
}

export const FRED_SERIES_METADATA: Record<
  string,
  { name: string; description: string }
> = {
  FEDFUNDS: {
    name: "Federal Funds Effective Rate",
    description: "Suku bunga acuan The Fed",
  },
  CPIAUCSL: {
    name: "Consumer Price Index (CPI)",
    description: "Indeks harga konsumen perkotaan AS",
  },
  DGS10: {
    name: "10-Year Treasury Rate",
    description: "Imbal hasil obligasi pemerintah AS tenor 10 tahun",
  },
  T10Y2Y: {
    name: "10Y-2Y Treasury Yield Spread",
    description: "Selisih yield 10 tahun vs 2 tahun (inversi kurva)",
  },
};

/**
 * Hitung severity indikator makro.
 */
function evaluateFredSeverity(seriesId: string, value: number, delta: number): number {
  if (seriesId === "T10Y2Y") {
    // Kurva imbal hasil terbalik (spread negatif) merupakan sinyal risiko resesi historis
    if (value < 0) return 0.5;
    if (value < 0.2) return 0.25;
    return 0.1;
  }

  if (seriesId === "FEDFUNDS") {
    // Kenaikan suku bunga menekan likuiditas pasar aset berisiko
    if (delta > 0.2) return 0.45;
    if (value > 5.0) return 0.3;
    return 0.15;
  }

  if (seriesId === "CPIAUCSL") {
    // Percepatan inflasi
    if (delta > 1.0) return 0.35;
    return 0.15;
  }

  return 0.15;
}

/**
 * Normalisasi data satu seri FRED menjadi ContextSignal.
 */
export function normalizeFredSeries(
  seriesId: string,
  observations: FredObservationRaw[],
  now: Date = new Date(),
): ContextSignal | null {
  // Ambil nilai valid (abaikan value "." yang menandakan hari libur bursa)
  const validObs = observations.filter(
    (o) => o.value && o.value.trim() !== "." && !isNaN(parseFloat(o.value)),
  );
  if (validObs.length === 0) return null;

  const first = validObs[0];
  if (!first || !first.value) return null;
  const latestVal = parseFloat(first.value);
  const latestDate = first.date || now.toISOString().slice(0, 10);

  let delta = 0;
  const second = validObs[1];
  if (second && second.value) {
    const prevVal = parseFloat(second.value);
    if (!isNaN(prevVal)) {
      delta = latestVal - prevVal;
    }
  }

  const meta = FRED_SERIES_METADATA[seriesId] || {
    name: seriesId,
    description: "FRED Series",
  };
  const severity = evaluateFredSeverity(seriesId, latestVal, delta);
  const sign = delta >= 0 ? "+" : "";
  const deltaStr = delta !== 0 ? ` (Δ ${sign}${delta.toFixed(2)} vs prev)` : "";

  return {
    id: `fred-${seriesId.toLowerCase()}`,
    module: "MACRO",
    severity,
    confidence: 0.6,
    summary: `FRED ${seriesId} (${meta.name}): ${latestVal.toFixed(2)}${deltaStr}, date ${latestDate}`,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 24 * 3600 * 1000),
  };
}

/**
 * Fetch observasi untuk seri FRED yang ditentukan.
 */
export async function fetchFredSignals(
  options: FredOptions = {},
): Promise<{ signals: ContextSignal[]; warning?: string }> {
  const apiKey = options.apiKey ?? process.env.FRED_API_KEY;
  if (!apiKey) {
    return {
      signals: [],
      warning: "FRED: FRED_API_KEY tidak dikonfigurasi, sumber dilewati",
    };
  }

  const {
    timeoutMs = 10_000,
    fetchFn = fetch,
    now = new Date(),
  } = options;

  const seriesIds = Object.keys(FRED_SERIES_METADATA);
  const signals: ContextSignal[] = [];
  const errors: string[] = [];

  for (const seriesId of seriesIds) {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=5`;

    try {
      const res = await fetchFn(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        errors.push(`${seriesId}: HTTP ${res.status}`);
        continue;
      }

      const data = (await res.json()) as FredSeriesResponse;
      if (data && Array.isArray(data.observations)) {
        const sig = normalizeFredSeries(seriesId, data.observations, now);
        if (sig) signals.push(sig);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${seriesId}: ${msg}`);
    }
  }

  let warning: string | undefined;
  if (errors.length > 0) {
    warning = `FRED parsial error: ${errors.join(", ")}`;
  }

  return { signals, warning };
}
