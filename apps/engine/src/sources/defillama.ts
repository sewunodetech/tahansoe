/**
 * Adapter DefiLlama (spec §3.10).
 *
 * Mengumpulkan data risiko on-chain dan protokol dari DefiLlama:
 *  - Pemantauan kestabilan pasak (peg) stablecoin utama (USDT, USDC, DAI, USDS, USDe) -> Jalur T4
 *  - Pemantauan insiden peretasan/exploit 7 hari terakhir -> Jalur T9
 *
 * Invarian:
 *  - Endpoint publik DefiLlama tidak memerlukan API key.
 *  - Sinyal depeg dinormalisasi ke ContextSignal dengan module "ONCHAIN", paths ["T4"].
 *  - Sinyal hack dinormalisasi ke ContextSignal dengan module "ONCHAIN", paths ["T9"].
 *  - Tidak pernah melempar error (graceful degradation).
 */

import type { ContextSignal } from "../agents/context.ts";

export const MONITORED_STABLECOINS = [
  "USDT",
  "USDC",
  "DAI",
  "USDS",
  "USDe",
] as const;

export interface DefiLlamaOptions {
  timeoutMs?: number;
  now?: Date;
  fetchFn?: typeof fetch;
  stablecoinsUrl?: string;
  hacksUrl?: string;
}

export interface DefiLlamaPeggedAsset {
  id: string;
  name: string;
  symbol: string;
  price?: number | null;
  circulating?: {
    peggedUSD?: number;
  };
}

export interface DefiLlamaStablecoinsResponse {
  peggedAssets?: DefiLlamaPeggedAsset[];
}

export interface DefiLlamaHackEntry {
  date: number; // Unix timestamp dalam detik
  name: string;
  amount?: number; // USD
  chain?: string[];
  classification?: string;
  technique?: string;
}

/**
 * Ambang batas nominal USD untuk pengelompokan exploit DefiLlama.
 */
export const HACK_AMOUNT_THRESHOLDS = {
  LARGE_USD: 50_000_000, // >= $50M
  MEDIUM_USD: 1_000_000, // $1M - $50M
  SMALL_USD: 100_000, // $100k - $1M
} as const;

/**
 * Nilai severity dasar exploit DefiLlama untuk protokol umum.
 */
export const HACK_BASE_SEVERITIES = {
  TIER_LARGE: 0.7,
  TIER_MEDIUM: 0.4,
  TIER_SMALL: 0.15,
  TIER_MINOR: 0.05,
} as const;

/**
 * Nilai severity yang dinaikkan satu tingkat (maks 0.9) jika menyangkut posisi user Tahansoe
 * (Aave, Arbitrum, atau stablecoin utama).
 */
export const HACK_BOOSTED_SEVERITIES = {
  TIER_LARGE: 0.9,
  TIER_MEDIUM: 0.7,
  TIER_SMALL: 0.4,
  TIER_MINOR: 0.15,
} as const;

/**
 * Memeriksa apakah exploit menyangkut komponen kritis Tahansoe:
 *  - Chain: Arbitrum
 *  - Lending Protocol: Aave
 *  - Stablecoin utama: USDT, USDC, DAI, USDS, USDe (serta MakerDAO, Ethena, Tether)
 */
export function isTahansoeRelevantHack(hack: DefiLlamaHackEntry): boolean {
  const chains = (hack.chain || []).map((c) => c.toLowerCase());
  if (chains.some((c) => c.includes("arbitrum"))) {
    return true;
  }

  const textToCheck = `${hack.name} ${hack.classification || ""} ${hack.technique || ""}`.toLowerCase();

  if (/\baave\b/i.test(textToCheck)) return true;
  if (/\barbitrum\b/i.test(textToCheck)) return true;

  const stableKeywords = [
    "usdt",
    "usdc",
    "dai",
    "usds",
    "usde",
    "tether",
    "makerdao",
    "ethena",
  ];
  return stableKeywords.some((kw) => {
    return new RegExp(`\\b${kw}\\b`, "i").test(textToCheck);
  });
}

/**
 * Hitung severity exploit berdasarkan jumlah nominal dan relevansinya terhadap Tahansoe.
 */
export function evaluateHackSeverity(
  amount: number,
  isRelevant: boolean,
): { severity: number; tier: "LARGE" | "MEDIUM" | "SMALL" | "MINOR" } {
  if (amount >= HACK_AMOUNT_THRESHOLDS.LARGE_USD) {
    return {
      severity: isRelevant
        ? HACK_BOOSTED_SEVERITIES.TIER_LARGE
        : HACK_BASE_SEVERITIES.TIER_LARGE,
      tier: "LARGE",
    };
  }
  if (amount >= HACK_AMOUNT_THRESHOLDS.MEDIUM_USD) {
    return {
      severity: isRelevant
        ? HACK_BOOSTED_SEVERITIES.TIER_MEDIUM
        : HACK_BASE_SEVERITIES.TIER_MEDIUM,
      tier: "MEDIUM",
    };
  }
  if (amount >= HACK_AMOUNT_THRESHOLDS.SMALL_USD) {
    return {
      severity: isRelevant
        ? HACK_BOOSTED_SEVERITIES.TIER_SMALL
        : HACK_BASE_SEVERITIES.TIER_SMALL,
      tier: "SMALL",
    };
  }
  return {
    severity: isRelevant
      ? HACK_BOOSTED_SEVERITIES.TIER_MINOR
      : HACK_BASE_SEVERITIES.TIER_MINOR,
    tier: "MINOR",
  };
}

/**
 * Evaluasi deviasi harga terhadap target $1.00 dan kembalikan tingkat keparahan (severity).
 */
export function evaluateStablecoinDeviation(price: number): number {
  const diff = Math.abs(1 - price);
  if (diff >= 0.03) return 1.0;
  if (diff >= 0.01) return 0.7;
  if (diff >= 0.005) return 0.4;
  return 0.05;
}

/**
 * Fetch dan pantau deviasi harga stablecoin utama dari DefiLlama.
 */
export async function fetchDefiLlamaStablecoins(
  opts: DefiLlamaOptions = {},
): Promise<{ signals: ContextSignal[]; warnings: string[] }> {
  const {
    timeoutMs = 10_000,
    now = new Date(),
    fetchFn = fetch,
    stablecoinsUrl = "https://stablecoins.llama.fi/stablecoins?includePrices=true",
  } = opts;

  const warnings: string[] = [];
  const signals: ContextSignal[] = [];

  try {
    const res = await fetchFn(stablecoinsUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      warnings.push(`DefiLlama stablecoins: HTTP ${res.status}`);
      return { signals, warnings };
    }

    const data = (await res.json()) as DefiLlamaStablecoinsResponse;
    const assets = data.peggedAssets ?? [];

    // Cari aset yang cocok dengan target yang dipantau
    const targetSet = new Set<string>(
      MONITORED_STABLECOINS.map((s) => s.toUpperCase()),
    );
    const depeggedSignals: ContextSignal[] = [];
    const foundSymbols = new Set<string>();

    for (const asset of assets) {
      const sym = (asset.symbol || "").toUpperCase();
      if (!targetSet.has(sym)) continue;
      foundSymbols.add(sym);

      if (asset.price == null || typeof asset.price !== "number") continue;

      const price = asset.price;
      const diff = Math.abs(1 - price);

      // Jika deviasi >= 0.5%, tandai sebagai anomali depeg
      if (diff >= 0.005) {
        const severity = evaluateStablecoinDeviation(price);
        const displaySym = asset.symbol || sym;
        depeggedSignals.push({
          id: `defillama-depeg-${sym.toLowerCase()}`,
          module: "ONCHAIN",
          severity,
          confidence: 0.95,
          paths: ["T4"],
          summary: `DefiLlama: ${displaySym} depeg detected at $${price.toFixed(4)} (diff ${(diff * 100).toFixed(2)}%)`,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 6 * 3600 * 1000),
        });
      }
    }

    if (depeggedSignals.length > 0) {
      signals.push(...depeggedSignals);
    } else {
      // Jika semua stablecoin berada dalam batas normal, buat 1 sinyal ringkas baseline
      signals.push({
        id: "defillama-stablecoin-pegs",
        module: "ONCHAIN",
        severity: 0.05,
        confidence: 0.9,
        paths: ["T4"],
        summary:
          "DefiLlama: Major stablecoins (USDT, USDC, DAI, USDS, USDe) trading within normal peg band (<0.5% deviation)",
        createdAt: now,
        expiresAt: new Date(now.getTime() + 6 * 3600 * 1000),
      });
    }

    return { signals, warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`DefiLlama stablecoins error: ${msg}`);
    return { signals, warnings };
  }
}

/**
 * Fetch dan pantau exploit protokol DeFi dalam 7 hari terakhir dari DefiLlama.
 */
export async function fetchDefiLlamaHacks(
  opts: DefiLlamaOptions = {},
): Promise<{ signals: ContextSignal[]; warnings: string[] }> {
  const {
    timeoutMs = 10_000,
    now = new Date(),
    fetchFn = fetch,
    hacksUrl = "https://api.llama.fi/hacks",
  } = opts;

  const warnings: string[] = [];
  const signals: ContextSignal[] = [];

  try {
    const res = await fetchFn(hacksUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      warnings.push(`DefiLlama hacks: HTTP ${res.status}`);
      return { signals, warnings };
    }

    const hacks = (await res.json()) as DefiLlamaHackEntry[];
    if (!Array.isArray(hacks)) {
      warnings.push("DefiLlama hacks: Format respons tidak valid");
      return { signals, warnings };
    }

    const sevenDaysAgoMs = now.getTime() - 7 * 24 * 3600 * 1000;
    const unrelatedMinorHacks: DefiLlamaHackEntry[] = [];

    for (const hack of hacks) {
      if (!hack.date || !hack.name) continue;
      const hackMs = hack.date * 1000;

      // Filter insiden dalam 7 hari terakhir
      if (hackMs >= sevenDaysAgoMs && hackMs <= now.getTime()) {
        const amount = hack.amount ?? 0;
        const isRelevant = isTahansoeRelevantHack(hack);
        const { severity, tier } = evaluateHackSeverity(amount, isRelevant);

        // Exploit kecil (<$100k) di protokol tak terkait dikumpulkan untuk diringkas menjadi 1 sinyal agregat
        if (tier === "MINOR" && !isRelevant) {
          unrelatedMinorHacks.push(hack);
          continue;
        }

        const safeSlug = hack.name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "");

        const chains = (hack.chain || []).join(", ") || "unknown";
        const amountStr =
          amount >= 1_000_000
            ? `$${(amount / 1_000_000).toFixed(1)}M`
            : amount > 0
              ? `$${Math.round(amount).toLocaleString()}`
              : "undisclosed";

        const relevanceBadge = isRelevant ? " [Tahansoe-relevant]" : "";

        signals.push({
          id: `defillama-hack-${safeSlug}-${hack.date}`,
          module: "ONCHAIN",
          severity,
          confidence: isRelevant ? 0.95 : 0.9,
          paths: ["T9"],
          summary: `DefiLlama: Exploit on ${hack.name} (~${amountStr}, chains: ${chains})${relevanceBadge}`,
          createdAt: new Date(hackMs),
          expiresAt: new Date(hackMs + 7 * 24 * 3600 * 1000),
        });
      }
    }

    // Buat satu sinyal agregat untuk exploit kecil yang tidak relevan langsung
    if (unrelatedMinorHacks.length > 0) {
      const totalAmount = unrelatedMinorHacks.reduce(
        (acc, h) => acc + (h.amount ?? 0),
        0,
      );
      const totalStr =
        totalAmount >= 1_000_000
          ? `$${(totalAmount / 1_000_000).toFixed(2)}M`
          : `$${Math.round(totalAmount).toLocaleString()}`;

      signals.push({
        id: "defillama-hacks-minor-aggregate",
        module: "ONCHAIN",
        severity: HACK_BASE_SEVERITIES.TIER_MINOR,
        confidence: 0.85,
        paths: ["T9"],
        summary: `DefiLlama: ${unrelatedMinorHacks.length} minor exploit(s) (<$100k) on unrelated protocols in past 7 days (total ~${totalStr})`,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 7 * 24 * 3600 * 1000),
      });
    }

    return { signals, warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`DefiLlama hacks error: ${msg}`);
    return { signals, warnings };
  }
}

/**
 * Kumpulkan seluruh sinyal risiko dari DefiLlama (depeg T4 dan exploit T9).
 */
export async function fetchDefiLlamaSignals(
  opts: DefiLlamaOptions = {},
): Promise<{ signals: ContextSignal[]; warnings: string[] }> {
  const warnings: string[] = [];
  const signals: ContextSignal[] = [];

  const [stablecoinsRes, hacksRes] = await Promise.allSettled([
    fetchDefiLlamaStablecoins(opts),
    fetchDefiLlamaHacks(opts),
  ]);

  if (stablecoinsRes.status === "fulfilled") {
    signals.push(...stablecoinsRes.value.signals);
    warnings.push(...stablecoinsRes.value.warnings);
  } else {
    warnings.push(`DefiLlama stablecoins crash: ${String(stablecoinsRes.reason)}`);
  }

  if (hacksRes.status === "fulfilled") {
    signals.push(...hacksRes.value.signals);
    warnings.push(...hacksRes.value.warnings);
  } else {
    warnings.push(`DefiLlama hacks crash: ${String(hacksRes.reason)}`);
  }

  return { signals, warnings };
}
