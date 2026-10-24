/**
 * Historical replay scenario fixture builder for Tahansoe simulation network.
 *
 * Downloads public historical ETH/USD (or ETHUSDT) candles from free, no-key
 * public endpoints (Binance public klines API with Coinbase Exchange public candles
 * as fallback), downsamples each dataset to <= 600 points, validates strict schema
 * compliance, and writes compact JSON fixtures to apps/simnet/scenarios/*.json.
 *
 * Usage:
 *   npx tsx apps/simnet/scripts/build-scenarios.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface ScenarioPoint {
  t: number;     // unix seconds
  price: number; // ETH price in USD
}

export interface ScenarioFixture {
  id: string;
  title: string;
  description: string;
  source: string;
  normalized: boolean;
  points: ScenarioPoint[];
}

export interface ScenarioDefinition {
  id: string;
  title: string;
  description: string;
  startIso: string;
  endIso: string;
  normalized: boolean;
}

export const SCENARIO_DEFINITIONS: ScenarioDefinition[] = [
  {
    id: "aug-2024-yen-carry",
    title: "August 2024 Yen Carry Trade Unwind",
    description:
      "Bank of Japan interest rate hikes sparked an unwind of global yen carry trades, triggering severe risk-off crypto spot selloffs and perp liquidation cascades.",
    startIso: "2024-08-04T00:00:00Z",
    endIso: "2024-08-06T00:00:00Z",
    normalized: false,
  },
  {
    id: "oct-2025-tariff-crash",
    title: "October 2025 US-China Tariff Announcement Crash",
    description:
      "Sudden US-China trade tariff announcements sparked massive CEX perpetual liquidations and network gas spikes, causing a rapid collateral price collapse.",
    startIso: "2025-10-10T12:00:00Z",
    endIso: "2025-10-11T12:00:00Z",
    normalized: false,
  },
  {
    id: "mar-2020-black-thursday",
    title: "March 2020 COVID Black Thursday Crash",
    description:
      "Global pandemic panic caused a historic ETH market crash and extreme network congestion that stalled liquidation keepers. Historical ETH prices are normalized and scaled to the fork's starting price for simulation.",
    startIso: "2020-03-11T00:00:00Z",
    endIso: "2020-03-13T23:59:00Z",
    normalized: true,
  },
];

const MAX_POINTS = 600;

/**
 * Fetch candles from Binance public API.
 * Returns array of { t: unixSeconds, price: number } sorted by t ascending.
 */
async function fetchBinanceKlines(
  startMs: number,
  endMs: number,
  interval = "5m"
): Promise<ScenarioPoint[]> {
  const points: ScenarioPoint[] = [];
  let currentStart = startMs;
  const limit = 1000;

  while (currentStart < endMs) {
    const url = new URL("https://api.binance.com/api/v3/klines");
    url.searchParams.set("symbol", "ETHUSDT");
    url.searchParams.set("interval", interval);
    url.searchParams.set("startTime", String(currentStart));
    url.searchParams.set("endTime", String(endMs));
    url.searchParams.set("limit", String(limit));

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      throw new Error(
        `Binance API error: HTTP ${res.status} ${res.statusText} (${await res.text()})`
      );
    }

    const data = (await res.json()) as Array<
      [number, string, string, string, string, ...unknown[]]
    >;

    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    for (const candle of data) {
      const openTimeMs = candle[0];
      const closePrice = Number(parseFloat(candle[4]).toFixed(2));
      const t = Math.floor(openTimeMs / 1000);

      // Only include points within the requested window
      if (openTimeMs >= startMs && openTimeMs <= endMs) {
        points.push({ t, price: closePrice });
      }
    }

    const lastOpenTime = data[data.length - 1][0];
    if (lastOpenTime <= currentStart || data.length < limit) {
      break;
    }
    // Advance start time past the last received candle
    currentStart = lastOpenTime + 1;
  }

  // Deduplicate and sort
  const map = new Map<number, number>();
  for (const p of points) {
    map.set(p.t, p.price);
  }
  return Array.from(map.entries())
    .map(([t, price]) => ({ t, price }))
    .sort((a, b) => a.t - b.t);
}

/**
 * Fetch candles from Coinbase public API as a fallback.
 * Coinbase returns [ [ time, low, high, open, close, volume ], ... ]
 * with time in unix seconds. Granularity 300 = 5 minutes.
 */
async function fetchCoinbaseCandles(
  startIso: string,
  endIso: string,
  granularity = 300
): Promise<ScenarioPoint[]> {
  const points: ScenarioPoint[] = [];
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);

  // Coinbase limits to 300 candles per request: 300 * 300s = 90,000s = 25 hours
  const chunkSeconds = 300 * granularity;
  let chunkStart = Math.floor(startMs / 1000);
  const totalEnd = Math.floor(endMs / 1000);

  while (chunkStart < totalEnd) {
    const chunkEnd = Math.min(chunkStart + chunkSeconds, totalEnd);
    const url = new URL(
      "https://api.exchange.coinbase.com/products/ETH-USD/candles"
    );
    url.searchParams.set("granularity", String(granularity));
    url.searchParams.set("start", new Date(chunkStart * 1000).toISOString());
    url.searchParams.set("end", new Date(chunkEnd * 1000).toISOString());

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "tahansoe-scenario-builder/1.0",
      },
    });

    if (!res.ok) {
      throw new Error(
        `Coinbase API error: HTTP ${res.status} ${res.statusText} (${await res.text()})`
      );
    }

    const data = (await res.json()) as Array<
      [number, number, number, number, number, number]
    >;

    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    for (const candle of data) {
      const t = candle[0];
      const closePrice = Number(candle[4].toFixed(2));
      if (t >= chunkStart && t <= chunkEnd) {
        points.push({ t, price: closePrice });
      }
    }

    chunkStart = chunkEnd;
  }

  // Deduplicate and sort ascending (Coinbase returns descending)
  const map = new Map<number, number>();
  for (const p of points) {
    map.set(p.t, p.price);
  }
  return Array.from(map.entries())
    .map(([t, price]) => ({ t, price }))
    .sort((a, b) => a.t - b.t);
}

/**
 * Fetch scenario points with Binance as primary and Coinbase as fallback.
 */
export async function downloadScenarioPoints(
  def: ScenarioDefinition
): Promise<{ points: ScenarioPoint[]; source: string }> {
  const startMs = Date.parse(def.startIso);
  const endMs = Date.parse(def.endIso);

  try {
    console.log(`[build-scenarios] Fetching ${def.id} from Binance (ETHUSDT 5m)...`);
    const points = await fetchBinanceKlines(startMs, endMs, "5m");
    if (points.length > 0) {
      return { points, source: "binance:ETHUSDT" };
    }
    console.warn(`[build-scenarios] Binance returned 0 points for ${def.id}, trying fallback...`);
  } catch (err) {
    console.warn(
      `[build-scenarios] Binance failed for ${def.id}: ${(err as Error).message}. Falling back to Coinbase...`
    );
  }

  try {
    console.log(`[build-scenarios] Fetching ${def.id} from Coinbase (ETH-USD 300s)...`);
    const points = await fetchCoinbaseCandles(def.startIso, def.endIso, 300);
    if (points.length > 0) {
      return { points, source: "coinbase:ETH-USD" };
    }
  } catch (err) {
    throw new Error(
      `All sources failed for ${def.id}: ${(err as Error).message}`
    );
  }

  throw new Error(`No data retrieved from any source for scenario ${def.id}`);
}

/**
 * Downsample points to at most maxPoints while preserving:
 * 1. First and last points
 * 2. Monotonic ascending order by t
 * 3. Uniform stride
 */
export function downsamplePoints(
  points: ScenarioPoint[],
  maxPoints = MAX_POINTS
): ScenarioPoint[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const factor = Math.ceil(points.length / maxPoints);
  const sampled: ScenarioPoint[] = [];

  for (let i = 0; i < points.length; i += factor) {
    sampled.push(points[i]);
  }

  // Ensure the final point is included
  const lastPoint = points[points.length - 1];
  if (sampled[sampled.length - 1].t !== lastPoint.t) {
    if (sampled.length < maxPoints) {
      sampled.push(lastPoint);
    } else {
      sampled[sampled.length - 1] = lastPoint;
    }
  }

  return sampled;
}

/**
 * Strict validator asserting format requirements:
 * {"id": string, "title": string, "description": string, "source": string, "normalized": boolean, "points": [{"t": unixSeconds, "price": number}]}
 * At most 600 points per file (downsample), sorted by t.
 */
export function assertScenarioFixture(fixture: unknown): asserts fixture is ScenarioFixture {
  if (typeof fixture !== "object" || fixture === null) {
    throw new Error("Fixture must be a non-null object");
  }

  const f = fixture as Record<string, unknown>;

  if (typeof f.id !== "string" || f.id.trim().length === 0) {
    throw new Error("Fixture 'id' must be a non-empty string");
  }
  if (typeof f.title !== "string" || f.title.trim().length === 0) {
    throw new Error("Fixture 'title' must be a non-empty string");
  }
  if (typeof f.description !== "string" || f.description.trim().length === 0) {
    throw new Error("Fixture 'description' must be a non-empty string");
  }
  if (typeof f.source !== "string" || f.source.trim().length === 0) {
    throw new Error("Fixture 'source' must be a non-empty string");
  }
  if (typeof f.normalized !== "boolean") {
    throw new Error("Fixture 'normalized' must be a boolean");
  }

  if (!Array.isArray(f.points)) {
    throw new Error("Fixture 'points' must be an array");
  }
  if (f.points.length === 0) {
    throw new Error("Fixture 'points' cannot be empty");
  }
  if (f.points.length > MAX_POINTS) {
    throw new Error(
      `Fixture 'points' exceeds maximum allowed (${f.points.length} > ${MAX_POINTS})`
    );
  }

  // Check allowed keys only
  const allowedKeys = new Set(["id", "title", "description", "source", "normalized", "points"]);
  for (const k of Object.keys(f)) {
    if (!allowedKeys.has(k)) {
      throw new Error(`Unexpected property '${k}' in fixture`);
    }
  }

  for (let i = 0; i < f.points.length; i++) {
    const pt = f.points[i] as Record<string, unknown>;
    if (typeof pt !== "object" || pt === null) {
      throw new Error(`Point at index ${i} must be a non-null object`);
    }
    if (typeof pt.t !== "number" || !Number.isInteger(pt.t) || pt.t <= 0) {
      throw new Error(`Point at index ${i} has invalid 't': ${pt.t}`);
    }
    if (typeof pt.price !== "number" || Number.isNaN(pt.price) || pt.price <= 0) {
      throw new Error(`Point at index ${i} has invalid 'price': ${pt.price}`);
    }
    const ptKeys = Object.keys(pt);
    if (ptKeys.length !== 2 || !ptKeys.includes("t") || !ptKeys.includes("price")) {
      throw new Error(`Point at index ${i} must have exact keys 't' and 'price'`);
    }
    if (i > 0) {
      const prev = f.points[i - 1] as ScenarioPoint;
      if (pt.t <= prev.t) {
        throw new Error(
          `Points must be strictly sorted by t ascending: point[${i}].t (${pt.t}) <= point[${i - 1}].t (${prev.t})`
        );
      }
    }
  }
}

/**
 * Format fixture into compact, human-readable JSON with one line per point.
 */
export function formatCompactFixture(fixture: ScenarioFixture): string {
  const pointsLines = fixture.points
    .map((p) => `    { "t": ${p.t}, "price": ${p.price} }`)
    .join(",\n");

  return `{\n  "id": ${JSON.stringify(fixture.id)},\n  "title": ${JSON.stringify(fixture.title)},\n  "description": ${JSON.stringify(fixture.description)},\n  "source": ${JSON.stringify(fixture.source)},\n  "normalized": ${fixture.normalized},\n  "points": [\n${pointsLines}\n  ]\n}\n`;
}

/**
 * Main script runner
 */
export async function buildScenarios(): Promise<void> {
  const repoRoot = process.cwd();
  const scenariosDir = path.resolve(repoRoot, "apps/simnet/scenarios");

  if (!fs.existsSync(scenariosDir)) {
    fs.mkdirSync(scenariosDir, { recursive: true });
  }

  console.log(`[build-scenarios] Building fixtures in ${scenariosDir}...`);

  for (const def of SCENARIO_DEFINITIONS) {
    console.log(`\n--- Scenario: ${def.id} ---`);
    const { points: rawPoints, source } = await downloadScenarioPoints(def);
    console.log(`[build-scenarios] Downloaded ${rawPoints.length} raw points from ${source}`);

    const points = downsamplePoints(rawPoints, MAX_POINTS);
    console.log(`[build-scenarios] Points after downsampling: ${points.length} (max: ${MAX_POINTS})`);

    const fixture: ScenarioFixture = {
      id: def.id,
      title: def.title,
      description: def.description,
      source,
      normalized: def.normalized,
      points,
    };

    // Strict validation
    assertScenarioFixture(fixture);
    console.log(`[build-scenarios] Format assertion passed for ${def.id}`);

    const filePath = path.join(scenariosDir, `${def.id}.json`);
    const content = formatCompactFixture(fixture);
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`[build-scenarios] Wrote ${filePath} (${Buffer.byteLength(content, "utf8")} bytes)`);

    // Output summary metrics
    const prices = points.map((p) => p.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    console.log(
      `[build-scenarios] Summary for ${def.id}:\n  Points: ${points.length}\n  Min price: $${minPrice}\n  Max price: $${maxPrice}\n  Start price: $${points[0].price} (${new Date(points[0].t * 1000).toISOString()})\n  End price: $${points[points.length - 1].price} (${new Date(points[points.length - 1].t * 1000).toISOString()})`
    );
  }

  console.log("\n[build-scenarios] All scenario fixtures successfully built and verified.");
}

// Execute when run
buildScenarios()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[build-scenarios] Fatal error:", err);
    process.exit(1);
  });
