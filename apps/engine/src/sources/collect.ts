/**
 * Kontrak antara sumber data (src/sources/**) dan context builder (src/agents/context.ts).
 *
 * Mengumpulkan input research dari sumber data yang kredibel:
 *  - RSS Feeds langsung dari outlet kredibel (BBC, Al Jazeera, Guardian, CNBC, Fed, CoinDesk, The Block)
 *  - FRED API (indikator ekonomi makro AS)
 *  - Onchain snapshot via viem (AaveOracle, Chainlink, Sequencer feed)
 *  - GDELT DOC 2.0 (opsional, dinonaktifkan secara default via RESEARCH_GDELT_ENABLED)
 *
 * Aturan & Invarian:
 *  - Semua fetch dilakukan KODE di sini; LLM tidak pernah fetch (ADR 0004 §6).
 *  - Satu sumber gagal / tanpa API key → sumber itu dilewati dan dicatat di
 *    `warnings`; fungsi TIDAK PERNAH melempar error (graceful degradation, I6).
 *  - Alamat on-chain dari `@tahansoe/domain`; RPC dari env (tanpa hardcode).
 *  - Teks eksternal disimpan apa adanya sebagai data; tidak pernah dieksekusi.
 */

import type {
  ContextMacroEvent,
  ContextMarketEvent,
  ContextSignal,
} from "../agents/context.ts";
import { fetchRssEvents } from "./rss.ts";
import { fetchGdeltEvents, DEFAULT_GDELT_TIMEOUT_MS } from "./gdelt.ts";
import { fetchFredSignals } from "./fred.ts";
import { fetchMacroCalendarEvents } from "./macro-calendar.ts";
import { fetchDefiLlamaSignals } from "./defillama.ts";
import { fetchOnchainSnapshot, ARBITRUM_STATIC_CHAIN_NOTES } from "./onchain.ts";
import { fetchAaveRates } from "./aave-rates.ts";

export interface CollectOptions {
  /** Chain untuk snapshot on-chain (default: Arbitrum One 42161). */
  chainId: number;
  /** Aset yang relevan, mis. ["ETH", "USDC"]. */
  assets: string[];
  /** Jendela berita/event ke belakang, dalam jam (default 24). */
  lookbackHours?: number;
  /** Horizon kalender FOMC ke depan, dalam hari (default: DEFAULT_FOMC_LOOKAHEAD_DAYS / 30). */
  fomcLookaheadDays?: number;
  /** Horizon kalender CPI/NFP ke depan, dalam hari (default: DEFAULT_BLS_LOOKAHEAD_DAYS / 14). */
  blsLookaheadDays?: number;
  /** Horizon kalender makro ke depan seragam (fallback opsional). */
  macroLookaheadDays?: number;
  /** Batas waktu per sumber, dalam ms (default 10_000). */
  timeoutMs?: number;
  now?: Date;
  /** Custom fetch function opsional untuk unit test atau mock. */
  fetchFn?: typeof fetch;
}

export interface ResearchInputs {
  /** Berita & event geopolitik/makro yang sudah dideduplikasi. */
  marketEvents: ContextMarketEvent[];
  /** Event makro terjadwal mendatang. */
  macroEvents: ContextMacroEvent[];
  /** Observasi terukur (on-chain snapshot, makro FRED, DefiLlama) dalam bentuk sinyal ringkas. */
  signals: ContextSignal[];
  /** Ringkasan bunga & utilitas Aave V3 Arbitrum on-chain. */
  ratesSummary?: string[];
  /** Catatan chain (mis. USDC capped, tanpa PriceOracleSentinel, status sequencer). */
  chainNotes: string[];
  /** Sumber yang dilewati / gagal, untuk audit. */
  warnings: string[];
}

/**
 * Kumpulkan semua input research dari sumber yang tersedia secara paralel.
 * Menjamin tidak pernah melempar error (graceful degradation).
 */
export async function collectResearchInputs(
  opts: CollectOptions,
): Promise<ResearchInputs> {
  const {
    lookbackHours = 24,
    timeoutMs = 10_000,
    now = new Date(),
    fetchFn = fetch,
  } = opts;

  const warnings: string[] = [];
  const marketEvents: ContextMarketEvent[] = [];
  const macroEvents: ContextMacroEvent[] = [];
  const signals: ContextSignal[] = [];
  let chainNotes: string[] = [...ARBITRUM_STATIC_CHAIN_NOTES];

  const isGdeltEnabled = process.env.RESEARCH_GDELT_ENABLED === "true";

  // Jalankan adapter utama secara paralel dengan Promise.allSettled
  const mainPromises: [
    ReturnType<typeof fetchRssEvents>,
    ReturnType<typeof fetchFredSignals>,
    ReturnType<typeof fetchOnchainSnapshot>,
    ReturnType<typeof fetchMacroCalendarEvents>,
    ReturnType<typeof fetchDefiLlamaSignals>,
    ReturnType<typeof fetchAaveRates>,
  ] = [
    fetchRssEvents({ lookbackHours, timeoutMs, now, fetchFn }),
    fetchFredSignals({ timeoutMs, now, fetchFn }),
    fetchOnchainSnapshot({ timeoutMs, now }),
    fetchMacroCalendarEvents({
      timeoutMs,
      fomcLookaheadDays: opts.fomcLookaheadDays ?? opts.macroLookaheadDays,
      blsLookaheadDays: opts.blsLookaheadDays ?? opts.macroLookaheadDays,
      now,
      fetchFn,
    }),
    fetchDefiLlamaSignals({ timeoutMs, now, fetchFn }),
    fetchAaveRates({ timeoutMs, now }),
  ];

  const results = await Promise.allSettled(mainPromises);

  // 1. RSS (sumber berita utama)
  const rssRes = results[0];
  if (rssRes && rssRes.status === "fulfilled") {
    marketEvents.push(...rssRes.value.events);
    warnings.push(...rssRes.value.warnings);
  } else if (rssRes && rssRes.status === "rejected") {
    warnings.push(`RSS adapter crash: ${String(rssRes.reason)}`);
  }

  // 2. FRED
  const fredRes = results[1];
  if (fredRes && fredRes.status === "fulfilled") {
    signals.push(...fredRes.value.signals);
    if (fredRes.value.warning) {
      warnings.push(fredRes.value.warning);
    }
  } else if (fredRes && fredRes.status === "rejected") {
    warnings.push(`FRED adapter crash: ${String(fredRes.reason)}`);
  }

  // 3. Onchain
  const onchainRes = results[2];
  if (onchainRes && onchainRes.status === "fulfilled") {
    signals.push(...onchainRes.value.signals);
    if (onchainRes.value.chainNotes.length > 0) {
      chainNotes = onchainRes.value.chainNotes;
    }
    if (onchainRes.value.warning) {
      warnings.push(onchainRes.value.warning);
    }
  } else if (onchainRes && onchainRes.status === "rejected") {
    warnings.push(`Onchain adapter crash: ${String(onchainRes.reason)}`);
  }

  // 4. Macro Calendar (FOMC, CPI, NFP)
  const macroRes = results[3];
  if (macroRes && macroRes.status === "fulfilled") {
    macroEvents.push(...macroRes.value.events);
    warnings.push(...macroRes.value.warnings);
  } else if (macroRes && macroRes.status === "rejected") {
    warnings.push(`Macro calendar adapter crash: ${String(macroRes.reason)}`);
  }

  // 5. DefiLlama (Stablecoin depeg T4, Hack exploit T9)
  const defillamaRes = results[4];
  if (defillamaRes && defillamaRes.status === "fulfilled") {
    signals.push(...defillamaRes.value.signals);
    warnings.push(...defillamaRes.value.warnings);
  } else if (defillamaRes && defillamaRes.status === "rejected") {
    warnings.push(`DefiLlama adapter crash: ${String(defillamaRes.reason)}`);
  }

  // 6. Aave V3 Rates (bunga & carry on-chain)
  const ratesSummary: string[] = [];
  const ratesRes = results[5];
  if (ratesRes && ratesRes.status === "fulfilled") {
    warnings.push(...ratesRes.value.warnings);
    const priorityAssets = ["USDC", "WETH", "wstETH", "USDT", "WBTC", "USDC.e", "DAI", "GHO"];
    const sorted = [...ratesRes.value.reserves].sort((a, b) => {
      const ia = priorityAssets.indexOf(a.asset);
      const ib = priorityAssets.indexOf(b.asset);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.asset.localeCompare(b.asset);
    });
    for (const r of sorted.slice(0, 8)) {
      const kinkStr = r.curve ? `${(r.curve.optimalUtil * 100).toFixed(0)}%` : "—";
      ratesSummary.push(
        `- ${r.asset}: util ${(r.utilization * 100).toFixed(1)}% / kink ${kinkStr} · supply ${(r.supplyApy * 100).toFixed(1)}% APY · borrow ${(r.borrowApr * 100).toFixed(1)}% APR`,
      );
    }
  } else if (ratesRes && ratesRes.status === "rejected") {
    warnings.push(`Aave rates adapter crash: ${String(ratesRes.reason)}`);
  }

  // 7. GDELT (opsional, hanya dijalankan jika flag aktif)
  if (isGdeltEnabled) {
    try {
      const gdeltRes = await fetchGdeltEvents({
        lookbackHours,
        timeoutMs: Math.max(timeoutMs, DEFAULT_GDELT_TIMEOUT_MS),
        now,
        fetchFn,
      });
      marketEvents.push(...gdeltRes.events);
      if (gdeltRes.warning) {
        warnings.push(gdeltRes.warning);
      }
    } catch (err) {
      warnings.push(`GDELT adapter crash: ${String(err)}`);
    }
  }

  return {
    marketEvents,
    macroEvents,
    signals,
    ratesSummary,
    chainNotes,
    warnings,
  };
}
