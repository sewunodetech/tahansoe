/**
 * Kontrak antara sumber data (src/sources/**) dan context builder (src/agents/context.ts).
 *
 * Mengumpulkan input research dari sumber data yang kredibel:
 *  - GDELT DOC 2.0 (berita geopolitik & makro)
 *  - FRED API (indikator ekonomi makro AS)
 *  - Onchain snapshot via viem (AaveOracle, Chainlink, Sequencer feed)
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
import { fetchGdeltEvents, DEFAULT_GDELT_TIMEOUT_MS } from "./gdelt.ts";
import { fetchFredSignals } from "./fred.ts";
import { fetchOnchainSnapshot, ARBITRUM_STATIC_CHAIN_NOTES } from "./onchain.ts";

export interface CollectOptions {
  /** Chain untuk snapshot on-chain (default: Arbitrum One 42161). */
  chainId: number;
  /** Aset yang relevan, mis. ["ETH", "USDC"]. */
  assets: string[];
  /** Jendela berita/event ke belakang, dalam jam (default 24). */
  lookbackHours?: number;
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
  /** Observasi terukur (on-chain snapshot, makro FRED) dalam bentuk sinyal ringkas. */
  signals: ContextSignal[];
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

  // Jalankan ke-3 adapter secara paralel dan terisolasi dengan Promise.allSettled
  const results = await Promise.allSettled([
    fetchGdeltEvents({
      lookbackHours,
      timeoutMs: Math.max(timeoutMs, DEFAULT_GDELT_TIMEOUT_MS),
      now,
      fetchFn,
    }),
    fetchFredSignals({ timeoutMs, now, fetchFn }),
    fetchOnchainSnapshot({ timeoutMs, now }),
  ]);

  // 1. GDELT
  const gdeltRes = results[0];
  if (gdeltRes && gdeltRes.status === "fulfilled") {
    marketEvents.push(...gdeltRes.value.events);
    if (gdeltRes.value.warning) {
      warnings.push(gdeltRes.value.warning);
    }
  } else if (gdeltRes && gdeltRes.status === "rejected") {
    warnings.push(`GDELT adapter crash: ${String(gdeltRes.reason)}`);
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

  return {
    marketEvents,
    macroEvents,
    signals,
    chainNotes,
    warnings,
  };
}
