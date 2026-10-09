/**
 * Risk Fusion v1 — lapisan I/O & orkestrasi (Tahap 2, spec §3.2/§3.7/§3.9).
 *
 * Membaca `signals` aktif (belum kedaluwarsa) untuk chain, prior assessment per
 * aset (hysteresis), dan `price_samples` AaveOracle (I5) untuk volatilitas; lalu
 * memanggil `fuse()` (logika murni Tahap 1) dan menulis satu baris `risk_assessments`
 * per aset per run (kecuali mode dry / tidak ada sinyal aktif).
 *
 * GRACEFUL DEGRADATION (I6): error DB/harga di-LOG dan di-SKIP; TIDAK pernah
 * melempar keluar dari scheduler. Tanpa sinyal aktif untuk aset → tidak ada
 * assessment (rule engine jatuh ke policy statis).
 *
 * Dependensi I/O di-inject (deps) agar bisa diuji dengan DB palsu (guardrail test).
 */

import type { RiskAssessment, Signal } from "@tahansoe/domain";
import { fuseWithReasons, type PriceSample, type PriorRegime } from "./index.ts";
import { ASSESSMENT_TTL_MIN, FUSION_VERSION } from "./config.ts";
import { dedupeSignals, rowToSignal } from "../signals/dedupe.ts";

/** Aset default yang dinilai per run (chain Arbitrum One). */
export const DEFAULT_FUSION_ASSETS = ["ETH", "USDC"] as const;
export const DEFAULT_FUSION_CHAIN_ID = 42161;

/** Hasil fusion satu aset. */
export interface AssetFusionResult {
  asset: string;
  assessment: RiskAssessment | null;
  reasons: string[];
  /** Id baris tersimpan (non-dry, bila ditulis). */
  assessmentId?: string;
  /** Alasan tidak ada assessment / error (untuk log). */
  note?: string;
}

export interface FusionRunResult {
  chainId: number;
  now: Date;
  dry: boolean;
  results: AssetFusionResult[];
  activeSignals?: Signal[];
}

/** Dependensi I/O injectable (default: DB nyata). */
export interface FusionDeps {
  /** Pancarkan sinyal deterministik (mis. carry T11) sebelum fusion tick. */
  emitSignals: (opts: { chainId: number; now: Date; dry: boolean }) => Promise<Signal[]>;
  /** Sinyal aktif (expires_at > now) untuk chain, sebagai Signal domain. */
  loadActiveSignals: (chainId: number, now: Date) => Promise<Signal[]>;
  /** Prior assessment per aset (hysteresis). */
  loadPrior: (chainId: number, asset: string) => Promise<PriorRegime | null>;
  /** Deret harga AaveOracle (asc waktu) untuk volatilitas. */
  loadPriceSamples: (chainId: number, asset: string, now: Date) => Promise<PriceSample[]>;
  /** Tulis assessment (non-dry). Mengembalikan id baris. */
  writeAssessment: (assessment: RiskAssessment, reasons: string[]) => Promise<string>;
  /** Logger (default: console.error ke stderr). */
  logger?: { warn: (m: string) => void };
}

export interface RunFusionOptions {
  chainId?: number;
  assets?: string[];
  now?: Date;
  /** Dry: hitung & kembalikan, TANPA menulis DB. */
  dry?: boolean;
  deps?: Partial<FusionDeps>;
}

/** Jendela harga untuk volatilitas: dari ~24 jam lalu sampai now (cukup untuk h4/h24). */
const PRICE_WINDOW_HOURS = 24;

/**
 * Jalankan satu siklus fusion. TIDAK pernah melempar (degradasi §4/I6): kegagalan
 * memuat sinyal → kembalikan hasil kosong + note; kegagalan tulis per aset → note.
 */
export async function runFusion(options: RunFusionOptions = {}): Promise<FusionRunResult> {
  const chainId = options.chainId ?? DEFAULT_FUSION_CHAIN_ID;
  const assets = options.assets ?? [...DEFAULT_FUSION_ASSETS];
  const now = options.now ?? new Date();
  const dry = Boolean(options.dry);
  const deps = await resolveDeps(options.deps);
  const warn = deps.logger?.warn ?? ((m: string) => process.stderr.write(`[fusion] ${m}\n`));

  const out: FusionRunResult = { chainId, now, dry, results: [] };

  // Pancarkan sinyal deterministik (mis. carry T11, oracle, depeg, macro) sebelum membaca sinyal aktif
  let dryEmittedSignals: Signal[] = [];
  try {
    const emitted = await deps.emitSignals({ chainId, now, dry });
    if (dry && emitted.length > 0) {
      dryEmittedSignals = emitted;
    }
  } catch (err) {
    warn(`gagal memancarkan sinyal deterministik: ${errMsg(err)} — lanjut dengan sinyal yang ada.`);
  }

  // Muat sinyal aktif sekali untuk semua aset. Gagal → degradasi: tanpa assessment.
  let allSignals: Signal[];
  try {
    allSignals = await deps.loadActiveSignals(chainId, now);
    if (dry && dryEmittedSignals.length > 0) {
      allSignals = [...allSignals, ...dryEmittedSignals];
    }
  } catch (err) {
    warn(`gagal memuat signals: ${errMsg(err)} — fusion dilewati (policy statis berlaku).`);
    return out;
  }

  // Defensif: deduplikasi sinyal aktif berdasarkan stable key, simpan yang terbaru
  allSignals = dedupeSignals(allSignals);
  out.activeSignals = allSignals;

  for (const asset of assets) {
    const signalsForAsset = allSignals.filter((s) => s.assets.includes(asset));

    // Prior & price samples: kegagalan tidak fatal — lanjut tanpa (fallback vol/no hysteresis).
    let prior: PriorRegime | null = null;
    try {
      prior = await deps.loadPrior(chainId, asset);
    } catch (err) {
      warn(`gagal memuat prior ${asset}: ${errMsg(err)} — lanjut tanpa hysteresis.`);
    }
    let priceSamples: PriceSample[] = [];
    try {
      priceSamples = await deps.loadPriceSamples(chainId, asset, now);
    } catch (err) {
      warn(`gagal memuat price_samples ${asset}: ${errMsg(err)} — pakai fallback volatilitas.`);
    }

    const { assessment, reasons } = fuseWithReasons({
      asset,
      chainId,
      signals: signalsForAsset,
      prior,
      priceSamples,
      now,
    });

    if (!assessment) {
      out.results.push({ asset, assessment: null, reasons, note: "no active signals (no assessment)" });
      continue;
    }

    if (dry) {
      out.results.push({ asset, assessment, reasons, note: "dry (not written)" });
      continue;
    }

    try {
      const id = await deps.writeAssessment(assessment, reasons);
      out.results.push({ asset, assessment, reasons, assessmentId: id });
    } catch (err) {
      warn(`gagal menulis risk_assessments ${asset}: ${errMsg(err)} — assessment tidak tersimpan.`);
      out.results.push({ asset, assessment, reasons, note: `write failed: ${errMsg(err)}` });
    }
  }

  return out;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Lengkapi deps yang tidak di-inject dengan implementasi DB nyata (impor dinamis). */
async function resolveDeps(partial?: Partial<FusionDeps>): Promise<FusionDeps> {
  const p = partial ?? {};
  return {
    emitSignals:
      p.emitSignals ??
      (async (opts) => (await import("../signals/emit.ts")).emitDeterministicSignals(opts)),
    loadActiveSignals: p.loadActiveSignals ?? defaultLoadActiveSignals,
    loadPrior: p.loadPrior ?? (async (chainId, asset) => (await import("../db/assessments.ts")).latestAssessment(chainId, asset)),
    loadPriceSamples: p.loadPriceSamples ?? defaultLoadPriceSamples,
    writeAssessment: p.writeAssessment ?? (async (a, r) => (await import("../db/assessments.ts")).insertAssessment(a, r)),
    logger: p.logger,
  };
}

/** Default: baca signals aktif dari DB → Signal domain (dideduplikasi). */
async function defaultLoadActiveSignals(chainId: number, now: Date): Promise<Signal[]> {
  const { getDb, signals } = await import("@tahansoe/db");
  const { and, eq, gt, desc } = await import("drizzle-orm");
  const db = getDb();
  const rows = await db
    .select()
    .from(signals)
    .where(and(eq(signals.chainId, chainId), gt(signals.expiresAt, now)))
    .orderBy(desc(signals.observedAt));
  return dedupeSignals(rows.map(rowToSignal));
}

/** Default: baca price_samples AaveOracle (I5) dalam jendela 24 jam. */
async function defaultLoadPriceSamples(chainId: number, asset: string, now: Date): Promise<PriceSample[]> {
  const { getDb, priceSamples } = await import("@tahansoe/db");
  const { and, eq, gte, lte, asc } = await import("drizzle-orm");
  const db = getDb();
  const windowStart = new Date(now.getTime() - PRICE_WINDOW_HOURS * 3_600_000);
  const rows = await db
    .select({ priceUsd: priceSamples.priceUsd, sampledAt: priceSamples.sampledAt })
    .from(priceSamples)
    .where(
      and(
        eq(priceSamples.chainId, chainId),
        eq(priceSamples.asset, asset),
        eq(priceSamples.source, "aave_oracle"),
        gte(priceSamples.sampledAt, windowStart),
        lte(priceSamples.sampledAt, now),
      ),
    )
    .orderBy(asc(priceSamples.sampledAt));
  return rows.map((r) => ({ price: Number(r.priceUsd), sampledAt: r.sampledAt }));
}

/** Ringkasan satu baris per-aset untuk dashboard/log. */
export function summarizeFusion(result: FusionRunResult): string {
  const parts = result.results.map((r) => `${r.asset} ${r.assessment ? r.assessment.regime : "—"}`);
  return parts.join(" · ");
}

// Re-export agar konsumen (CLI/worker) tidak perlu impor config langsung.
export { ASSESSMENT_TTL_MIN, FUSION_VERSION };
