/**
 * Deterministic Context Builder untuk REPL & Q&A CLI Tahansoe (spec m3-cli §3.5).
 *
 * Mengumpulkan data dari database secara deterministik:
 *  1. Laporan riset terbaru (research_reports) + ringkasan 24 jam terakhir
 *  2. Assessment risiko terbaru per aset (risk_assessments)
 *  3. Sinyal aktif (signals dengan expires_at > now, dideduplikasi berdasarkan judul bukti)
 *  4. Sampel suku bunga & carry Aave V3 (rate_samples)
 *  5. Ringkasan harga & volatilitas (price_samples)
 *  6. Kalender makro terjadwal (FOMC, CPI, NFP)
 *
 * Data > 6 jam ditandai STALE.
 * Bila DB kosong / tidak tersedia / basi, konteks menandai status ini agar model
 * memberi tahu user untuk menjalankan /analyze.
 *
 * Semua I/O dapat di-inject (ReplContextLoaders) agar murni & dapat diuji offline.
 */

import { desc, eq, gt, and } from "drizzle-orm";
import type { Signal, RiskAssessment, Regime } from "@tahansoe/domain";
import type { ResearchReport } from "../../agents/schemas.ts";
import { netCarry, daysUntilHf } from "../../sources/aave-rates.ts";
import { REPRESENTATIVE_PAIRS } from "../../signals/carry.ts";
import { fetchMacroCalendarEvents } from "../../sources/macro-calendar.ts";
import type { ContextMacroEvent } from "../../agents/context.ts";
import { regimeColor, fmtTime, type Theme } from "../render.ts";

export const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 jam

export interface FetchedReport {
  id: string;
  createdAt: Date;
  report: ResearchReport;
}

export interface FetchedAssessment {
  asset: string;
  regime: Regime;
  riskScore: number;
  recommendedTriggerHf: number;
  recommendedTargetHf: number;
  reasons: string[];
  explanation: string;
  validUntil: Date;
  createdAt: Date;
}

export interface FetchedRateSample {
  asset: string;
  supplyApy: number;
  borrowApr: number;
  borrowApy: number;
  utilization: number;
  optimalUtilization: number | null;
  sampledAt: Date;
}

export interface PriceSummary {
  asset: string;
  latestPrice: number;
  sampledAt: Date;
  min24h?: number;
  max24h?: number;
  change24hPct?: number;
}

export interface CarryPairSummary {
  collateral: string;
  debt: string;
  supplyApy: number;
  borrowApr: number;
  netCarryPct: number;
  daysToDrift: number | null;
}

export type SourceName = "report" | "assessments" | "signals" | "rate_samples" | "price_samples";

export interface SourceFreshness {
  source: SourceName;
  label: string;
  hasData: boolean;
  latestTimestamp: Date | null;
  ageMs: number | null;
  ageHours: number | null;
  isStale: boolean;
  refreshHint: string;
}

export function computeSourceFreshness(
  source: SourceName,
  label: string,
  timestamp: Date | null | undefined,
  now: Date,
  refreshHint: string,
): SourceFreshness {
  if (!timestamp) {
    return {
      source,
      label,
      hasData: false,
      latestTimestamp: null,
      ageMs: null,
      ageHours: null,
      isStale: false,
      refreshHint,
    };
  }
  const ageMs = Math.max(0, now.getTime() - timestamp.getTime());
  const ageHours = ageMs / (1000 * 60 * 60);
  const isStale = ageMs > STALE_THRESHOLD_MS;
  return {
    source,
    label,
    hasData: true,
    latestTimestamp: timestamp,
    ageMs,
    ageHours,
    isStale,
    refreshHint,
  };
}

export function createDefaultSourceFreshness(now: Date = new Date()): Record<SourceName, SourceFreshness> {
  return {
    report: computeSourceFreshness("report", "Report", now, now, "/analyze"),
    assessments: computeSourceFreshness("assessments", "Risk assessments", now, now, "/analyze"),
    signals: computeSourceFreshness("signals", "Signals", now, now, "/analyze"),
    rate_samples: computeSourceFreshness("rate_samples", "Rate samples", now, now, "`schedule run` or /analyze"),
    price_samples: computeSourceFreshness("price_samples", "Price samples", now, now, "`schedule run --with-price` or /analyze"),
  };
}

export function formatStaleClosingLine(staleSources: SourceFreshness[]): string {
  if (!staleSources || staleSources.length === 0) return "";
  const parts = staleSources.map((s) => {
    const ageStr = s.ageHours !== null ? `${Math.round(s.ageHours)}h old` : "stale";
    return `${s.label} are ${ageStr} — run ${s.refreshHint}`;
  });
  return parts.join(" · ");
}

export interface ReplContext {
  chainId: number;
  now: Date;
  hasData: boolean;
  isStale: boolean;
  staleReason?: string;
  sourceFreshness: Record<SourceName, SourceFreshness>;
  staleSources: SourceFreshness[];
  latestReport: FetchedReport | null;
  reportsLast24h: FetchedReport[];
  assessments: FetchedAssessment[];
  activeSignals: Signal[];
  rateSamples: FetchedRateSample[];
  carryPairs: CarryPairSummary[];
  priceSummaries: PriceSummary[];
  macroEvents: ContextMacroEvent[];
}

export interface ReplContextLoaders {
  loadLatestReports?: (chainId: number, now: Date) => Promise<{ latest: FetchedReport | null; last24h: FetchedReport[] }>;
  loadAssessments?: (chainId: number, now: Date) => Promise<FetchedAssessment[]>;
  loadActiveSignals?: (chainId: number, now: Date) => Promise<Signal[]>;
  loadRateSamples?: (chainId: number, now: Date) => Promise<FetchedRateSample[]>;
  loadPriceSamples?: (chainId: number, now: Date) => Promise<PriceSummary[]>;
  loadMacroEvents?: (now: Date) => Promise<ContextMacroEvent[]>;
}

/**
 * Deduplikasi sinyal aktif berdasarkan judul bukti (evidence title).
 * Bila beberapa sinyal memiliki bukti dengan judul sama, ambil yang paling baru.
 */
export function dedupeSignalsByEvidence(signals: Signal[]): Signal[] {
  const seenTitles = new Map<string, Signal>();
  const outWithoutEvidenceTitle: Signal[] = [];

  for (const s of signals) {
    // Ambil bukti pertama yang memiliki title
    const firstTitle = s.evidence?.find((e) => e && typeof e.title === "string" && e.title.trim().length > 0)?.title.trim().toLowerCase();
    if (!firstTitle) {
      outWithoutEvidenceTitle.push(s);
      continue;
    }

    const existing = seenTitles.get(firstTitle);
    if (!existing) {
      seenTitles.set(firstTitle, s);
    } else {
      // Ambil yang paling baru (observedAt lebih besar), atau yang severity-nya lebih tinggi
      const existingTime = existing.observedAt ? new Date(existing.observedAt).getTime() : 0;
      const curTime = s.observedAt ? new Date(s.observedAt).getTime() : 0;
      if (curTime > existingTime || (curTime === existingTime && s.severity > existing.severity)) {
        seenTitles.set(firstTitle, s);
      }
    }
  }

  return [...seenTitles.values(), ...outWithoutEvidenceTitle];
}

/**
 * Hitung pasangan carry representatif dari sampel bunga yang ada.
 */
export function computeCarryPairs(rates: FetchedRateSample[]): CarryPairSummary[] {
  const byAsset = new Map<string, FetchedRateSample>();
  for (const r of rates) {
    byAsset.set(r.asset.toUpperCase(), r);
  }

  const out: CarryPairSummary[] = [];
  for (const p of REPRESENTATIVE_PAIRS) {
    const colRate = byAsset.get(p.collateral.toUpperCase());
    const debtRate = byAsset.get(p.debt.toUpperCase());
    if (colRate && debtRate) {
      const net = netCarry(colRate.supplyApy, debtRate.borrowApr);
      const days = daysUntilHf(1.50, 1.45, net);
      out.push({
        collateral: p.collateral,
        debt: p.debt,
        supplyApy: colRate.supplyApy,
        borrowApr: debtRate.borrowApr,
        netCarryPct: net * 100,
        daysToDrift: days,
      });
    }
  }
  return out;
}

// Default loaders menggunakan DB nyata (@tahansoe/db) bila DATABASE_URL tersedia.
async function defaultLoadReports(chainId: number, now: Date): Promise<{ latest: FetchedReport | null; last24h: FetchedReport[] }> {
  if (!process.env.DATABASE_URL) return { latest: null, last24h: [] };
  try {
    const { getDb, researchReports } = await import("@tahansoe/db");
    const db = getDb();
    const rows = await db
      .select()
      .from(researchReports)
      .where(eq(researchReports.chainId, chainId))
      .orderBy(desc(researchReports.createdAt))
      .limit(10);

    if (rows.length === 0) return { latest: null, last24h: [] };

    const parsed: FetchedReport[] = rows.map((r) => ({
      id: r.id as string,
      createdAt: r.createdAt as Date,
      report: r.report as ResearchReport,
    }));

    const latest = parsed[0] ?? null;
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last24h = parsed.filter((r) => r.createdAt >= oneDayAgo);
    return { latest, last24h };
  } catch {
    return { latest: null, last24h: [] };
  }
}

async function defaultLoadAssessments(chainId: number): Promise<FetchedAssessment[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const { getDb, riskAssessments } = await import("@tahansoe/db");
    const db = getDb();
    const rows = await db
      .select()
      .from(riskAssessments)
      .where(eq(riskAssessments.chainId, chainId))
      .orderBy(desc(riskAssessments.createdAt))
      .limit(20);

    // Ambil baris terbaru per aset
    const byAsset = new Map<string, FetchedAssessment>();
    for (const r of rows) {
      if (!byAsset.has(r.asset)) {
        byAsset.set(r.asset, {
          asset: r.asset,
          regime: r.regime as Regime,
          riskScore: Number(r.riskScore),
          recommendedTriggerHf: Number(r.recommendedTriggerHf),
          recommendedTargetHf: Number(r.recommendedTargetHf),
          reasons: (r.reasons as string[]) ?? [],
          explanation: r.explanation,
          validUntil: r.validUntil,
          createdAt: r.createdAt,
        });
      }
    }
    return Array.from(byAsset.values());
  } catch {
    return [];
  }
}

async function defaultLoadActiveSignals(chainId: number, now: Date): Promise<Signal[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const { getDb, signals } = await import("@tahansoe/db");
    const db = getDb();
    const rows = await db
      .select()
      .from(signals)
      .where(and(eq(signals.chainId, chainId), gt(signals.expiresAt, now)))
      .orderBy(desc(signals.observedAt))
      .limit(50);

    return rows.map((r) => ({
      id: r.id,
      module: r.module as Signal["module"],
      paths: (r.paths as Signal["paths"]) ?? undefined,
      assets: (r.assets as string[]) ?? [],
      direction: r.direction as Signal["direction"],
      severity: Number(r.severity),
      confidence: Number(r.confidence),
      horizonHours: r.horizonHours,
      observedAt: r.observedAt,
      expiresAt: r.expiresAt,
      evidence: (r.evidence as Signal["evidence"]) ?? [],
    }));
  } catch {
    return [];
  }
}

async function defaultLoadRateSamples(chainId: number): Promise<FetchedRateSample[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const { getDb, rateSamples } = await import("@tahansoe/db");
    const db = getDb();
    const rows = await db
      .select()
      .from(rateSamples)
      .where(eq(rateSamples.chainId, chainId))
      .orderBy(desc(rateSamples.sampledAt))
      .limit(20);

    const byAsset = new Map<string, FetchedRateSample>();
    for (const r of rows) {
      if (!byAsset.has(r.asset.toUpperCase())) {
        byAsset.set(r.asset.toUpperCase(), {
          asset: r.asset,
          supplyApy: Number(r.supplyApy),
          borrowApr: Number(r.borrowApr),
          borrowApy: Number(r.borrowApy),
          utilization: Number(r.utilization),
          optimalUtilization: r.optimalUtilization !== null ? Number(r.optimalUtilization) : null,
          sampledAt: r.sampledAt,
        });
      }
    }
    return Array.from(byAsset.values());
  } catch {
    return [];
  }
}

async function defaultLoadPriceSamples(chainId: number, now: Date): Promise<PriceSummary[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const { getDb, priceSamples } = await import("@tahansoe/db");
    const db = getDb();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const rows = await db
      .select()
      .from(priceSamples)
      .where(and(eq(priceSamples.chainId, chainId), gt(priceSamples.sampledAt, oneDayAgo)))
      .orderBy(desc(priceSamples.sampledAt))
      .limit(100);

    const byAsset = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = byAsset.get(r.asset) ?? [];
      arr.push(r);
      byAsset.set(r.asset, arr);
    }

    const summaries: PriceSummary[] = [];
    for (const [asset, items] of byAsset.entries()) {
      if (items.length === 0) continue;
      const latest = items[0]!;
      const prices = items.map((x) => Number(x.priceUsd));
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const oldest = items[items.length - 1]!;
      const oldPrice = Number(oldest.priceUsd);
      const curPrice = Number(latest.priceUsd);
      const changePct = oldPrice > 0 ? ((curPrice - oldPrice) / oldPrice) * 100 : 0;
      summaries.push({
        asset,
        latestPrice: curPrice,
        sampledAt: latest.sampledAt,
        min24h: min,
        max24h: max,
        change24hPct: changePct,
      });
    }
    return summaries;
  } catch {
    return [];
  }
}

async function defaultLoadMacroEvents(now: Date): Promise<ContextMacroEvent[]> {
  try {
    const { events } = await fetchMacroCalendarEvents({ now });
    return events;
  } catch {
    return [];
  }
}

/**
 * Bangun seluruh konteks REPL secara deterministik.
 */
export async function buildReplContext(options: {
  now?: Date;
  chainId?: number;
  loaders?: ReplContextLoaders;
} = {}): Promise<ReplContext> {
  const now = options.now ?? new Date();
  const chainId = options.chainId ?? 42161; // Arbitrum One
  const loaders = options.loaders ?? {};

  const loadReportsFn = loaders.loadLatestReports ?? defaultLoadReports;
  const loadAssessmentsFn = loaders.loadAssessments ?? defaultLoadAssessments;
  const loadSignalsFn = loaders.loadActiveSignals ?? defaultLoadActiveSignals;
  const loadRatesFn = loaders.loadRateSamples ?? defaultLoadRateSamples;
  const loadPricesFn = loaders.loadPriceSamples ?? defaultLoadPriceSamples;
  const loadMacroFn = loaders.loadMacroEvents ?? defaultLoadMacroEvents;

  const [reportsRes, assessmentsRes, signalsRes, ratesRes, pricesRes, macroRes] = await Promise.all([
    loadReportsFn(chainId, now),
    loadAssessmentsFn(chainId, now),
    loadSignalsFn(chainId, now),
    loadRatesFn(chainId, now),
    loadPricesFn(chainId, now),
    loadMacroFn(now),
  ]);

  const activeSignals = dedupeSignalsByEvidence(signalsRes);
  const carryPairs = computeCarryPairs(ratesRes);

  const hasData = Boolean(
    reportsRes.latest ||
    assessmentsRes.length > 0 ||
    activeSignals.length > 0 ||
    ratesRes.length > 0 ||
    pricesRes.length > 0,
  );

  // Compute freshness per source (6h threshold)
  const maxAssessmentDate =
    assessmentsRes.length > 0
      ? new Date(Math.max(...assessmentsRes.map((a) => new Date(a.createdAt).getTime())))
      : null;
  const maxSignalDate =
    activeSignals.length > 0
      ? new Date(Math.max(...activeSignals.map((s) => new Date(s.observedAt).getTime())))
      : null;
  const maxRateDate =
    ratesRes.length > 0
      ? new Date(Math.max(...ratesRes.map((r) => new Date(r.sampledAt).getTime())))
      : null;
  const maxPriceDate =
    pricesRes.length > 0
      ? new Date(Math.max(...pricesRes.map((p) => new Date(p.sampledAt).getTime())))
      : null;

  const sourceFreshness: Record<SourceName, SourceFreshness> = {
    report: computeSourceFreshness(
      "report",
      "Report",
      reportsRes.latest ? new Date(reportsRes.latest.createdAt) : null,
      now,
      "/analyze",
    ),
    assessments: computeSourceFreshness(
      "assessments",
      "Risk assessments",
      maxAssessmentDate,
      now,
      "/analyze",
    ),
    signals: computeSourceFreshness(
      "signals",
      "Signals",
      maxSignalDate,
      now,
      "/analyze",
    ),
    rate_samples: computeSourceFreshness(
      "rate_samples",
      "Rate samples",
      maxRateDate,
      now,
      "`schedule run` or /analyze",
    ),
    price_samples: computeSourceFreshness(
      "price_samples",
      "Price samples",
      maxPriceDate,
      now,
      "`schedule run --with-price` or /analyze",
    ),
  };

  const staleSources = Object.values(sourceFreshness).filter((s) => s.hasData && s.isStale);

  let isStale = false;
  let staleReason: string | undefined;

  if (!hasData) {
    isStale = true;
    staleReason = "Database has no research or risk assessment records.";
  } else if (staleSources.length > 0) {
    isStale = true;
    staleReason = staleSources
      .map((s) => `${s.label} (${s.ageHours !== null ? s.ageHours.toFixed(1) + "h old" : "stale"})`)
      .join(", ");
  }

  return {
    chainId,
    now,
    hasData,
    isStale,
    staleReason,
    sourceFreshness,
    staleSources,
    latestReport: reportsRes.latest,
    reportsLast24h: reportsRes.last24h,
    assessments: assessmentsRes,
    activeSignals,
    rateSamples: ratesRes,
    carryPairs,
    priceSummaries: pricesRes,
    macroEvents: macroRes,
  };
}

/**
 * Format string konteks deterministik yang disematkan ke dalam prompt LLM.
 */
export function formatContextForPrompt(ctx: ReplContext, now: Date = ctx.now): string {
  const lines: string[] = [];

  lines.push("### RECENT RISK ENGINE CONTEXT (ARBITRUM ONE)");
  lines.push(`Current Time (UTC): ${now.toISOString()}`);
  lines.push("");

  // Peringatan status
  if (!ctx.hasData) {
    lines.push("⚠️ STATUS: EMPTY DATABASE");
    lines.push("No research reports, risk assessments, or rate samples are stored yet.");
    lines.push("INSTRUCTION: You must advise the user to run `/analyze` to produce live research. Answer any theoretical questions accurately while clarifying that live position data is missing.");
    lines.push("");
    return lines.join("\n");
  }

  const staleList = ctx.staleSources ?? [];
  if (staleList.length > 0) {
    lines.push(`⚠️ STATUS: STALE DATA DETECTED (${ctx.staleReason ?? "Sources older than 6 hours"})`);
    lines.push("Stale sources breakdown (> 6h threshold):");
    for (const s of staleList) {
      const timeStr = s.latestTimestamp ? `${fmtTime(s.latestTimestamp)} UTC` : "(unknown)";
      const ageStr = s.ageHours !== null ? `${s.ageHours.toFixed(1)}h old` : "stale";
      lines.push(`  - ${s.label}: STALE since ${timeStr} (${ageStr}) — run ${s.refreshHint}`);
    }
    lines.push("");
    lines.push("MANDATORY STALENESS INSTRUCTIONS:");
    lines.push("1. DO NOT claim all data is fresh! Clearly state which sources are fresh and explicitly warn about the stale sources.");
    lines.push("2. Any citations from stale sources must be explicitly flagged as historical/stale.");
    lines.push(`3. The closing line of your answer MUST list the stale sources and command to refresh:`);
    lines.push(`   "${formatStaleClosingLine(staleList)}"`);
    lines.push("");
  } else {
    lines.push("STATUS: FRESH DATA (Within last 6 hours)");
    lines.push("");
  }

  // 1. Laporan Riset Terbaru
  const repFresh = ctx.sourceFreshness?.report;
  const repHeader = repFresh?.isStale && repFresh.latestTimestamp
    ? ` [STATUS: STALE since ${fmtTime(repFresh.latestTimestamp)} UTC (${repFresh.ageHours?.toFixed(1)}h old) — run /analyze]`
    : repFresh?.latestTimestamp
      ? ` [STATUS: FRESH (${repFresh.ageHours?.toFixed(1)}h old)]`
      : "";
  lines.push(`#### 1. LATEST RESEARCH REPORT${repHeader}`);
  if (ctx.latestReport) {
    const r = ctx.latestReport.report;
    const timeStr = fmtTime(ctx.latestReport.createdAt);
    const staleTag = repFresh?.isStale ? ` - STALE (${repFresh.ageHours?.toFixed(1)}h old)` : "";
    lines.push(`Report ID: #${ctx.latestReport.id.slice(0, 8)} (Created: ${timeStr} UTC${staleTag}, ${ctx.latestReport.createdAt.toISOString()})`);
    lines.push(`Proposed Regime: ${r.proposedRegime} · Direction: ${r.direction} · Confidence: ${r.confidence.toFixed(2)} (cap: 0.60)`);
    lines.push(`Horizon: ${r.horizonHours}h`);
    if (r.paths && r.paths.length > 0) {
      lines.push("Transmission Paths:");
      for (const p of r.paths) {
        lines.push(`  - [path ${p.path}, ${timeStr}${staleTag}] sev ${p.severity.toFixed(2)}: ${p.rationale}`);
      }
    }
    if (r.keyDevelopments && r.keyDevelopments.length > 0) {
      lines.push("Key Developments:");
      for (const d of r.keyDevelopments) {
        lines.push(`  - ${d.summary}`);
        for (const e of d.evidence ?? []) {
          lines.push(`    • (${e.source}) ${e.summary}`);
        }
      }
    }
    if (r.hawkCase) lines.push(`Hawk Case: ${r.hawkCase}`);
    if (r.doveCase) lines.push(`Dove Case: ${r.doveCase}`);
  } else {
    lines.push("No research report available.");
  }
  lines.push("");

  // 2. Risk Assessments Per Asset
  const assFresh = ctx.sourceFreshness?.assessments;
  const assHeader = assFresh?.isStale && assFresh.latestTimestamp
    ? ` [STATUS: STALE since ${fmtTime(assFresh.latestTimestamp)} UTC (${assFresh.ageHours?.toFixed(1)}h old) — run /analyze]`
    : assFresh?.latestTimestamp
      ? ` [STATUS: FRESH (${assFresh.ageHours?.toFixed(1)}h old)]`
      : "";
  lines.push(`#### 2. LATEST RISK ASSESSMENTS PER ASSET${assHeader}`);
  if (ctx.assessments.length > 0) {
    for (const a of ctx.assessments) {
      const timeStr = fmtTime(a.createdAt);
      const staleTag = assFresh?.isStale ? ` - STALE (${assFresh.ageHours?.toFixed(1)}h old)` : "";
      lines.push(
        `- Asset: ${a.asset} | Regime: ${a.regime} | Risk Score: ${a.riskScore} | Rec Trigger HF: ${a.recommendedTriggerHf.toFixed(2)} | Rec Target HF: ${a.recommendedTargetHf.toFixed(2)} [assessment ${timeStr}${staleTag}]`,
      );
      if (a.reasons && a.reasons.length > 0) {
        lines.push(`  Reasons: ${a.reasons.join(", ")}`);
      }
      if (a.explanation) {
        lines.push(`  Explanation: ${a.explanation}`);
      }
    }
  } else {
    lines.push("No active assessments stored.");
  }
  lines.push("");

  // 3. Sinyal Aktif
  const sigFresh = ctx.sourceFreshness?.signals;
  const sigHeader = sigFresh?.isStale && sigFresh.latestTimestamp
    ? ` [STATUS: STALE since ${fmtTime(sigFresh.latestTimestamp)} UTC (${sigFresh.ageHours?.toFixed(1)}h old) — run /analyze]`
    : sigFresh?.latestTimestamp
      ? ` [STATUS: FRESH (${sigFresh.ageHours?.toFixed(1)}h old)]`
      : "";
  lines.push(`#### 3. ACTIVE RISK SIGNALS${sigHeader}`);
  if (ctx.activeSignals.length > 0) {
    for (const s of ctx.activeSignals) {
      const timeStr = fmtTime(s.observedAt);
      const staleTag = sigFresh?.isStale ? ` - STALE (${sigFresh.ageHours?.toFixed(1)}h old)` : "";
      const pathsStr = s.paths && s.paths.length ? s.paths.join(",") : "N/A";
      const assetsStr = s.assets.join(",");
      lines.push(
        `- [signal ${s.module} ${pathsStr}, ${timeStr}${staleTag}] Assets: ${assetsStr} | Sev: ${s.severity.toFixed(2)} | Conf: ${s.confidence.toFixed(2)} | Dir: ${s.direction}`,
      );
      for (const ev of s.evidence ?? []) {
        lines.push(`  Evidence: ${ev.title} (Source: ${ev.source})`);
      }
    }
  } else {
    lines.push("No active signals currently detected.");
  }
  lines.push("");

  // 4. Rate Samples & Carry
  const rateFresh = ctx.sourceFreshness?.rate_samples;
  const rateHeader = rateFresh?.isStale && rateFresh.latestTimestamp
    ? ` [STATUS: STALE since ${fmtTime(rateFresh.latestTimestamp)} UTC (${rateFresh.ageHours?.toFixed(1)}h old) — run \`schedule run\` or /analyze]`
    : rateFresh?.latestTimestamp
      ? ` [STATUS: FRESH (${rateFresh.ageHours?.toFixed(1)}h old)]`
      : "";
  lines.push(`#### 4. AAVE V3 RATES & CARRY MONITOR (ARBITRUM)${rateHeader}`);
  if (ctx.rateSamples.length > 0) {
    lines.push("Reserves:");
    for (const r of ctx.rateSamples) {
      const timeStr = fmtTime(r.sampledAt);
      const staleTag = rateFresh?.isStale ? ` - STALE (${rateFresh.ageHours?.toFixed(1)}h old)` : "";
      const optStr = r.optimalUtilization !== null ? `(kink: ${(r.optimalUtilization * 100).toFixed(0)}%)` : "";
      lines.push(
        `- ${r.asset}: Util ${(r.utilization * 100).toFixed(1)}% ${optStr} | Supply APY ${(r.supplyApy * 100).toFixed(2)}% | Borrow APR ${(r.borrowApr * 100).toFixed(2)}% [rate_samples ${timeStr}${staleTag}]`,
      );
    }
    if (ctx.carryPairs.length > 0) {
      lines.push("Representative Pairs:");
      for (const cp of ctx.carryPairs) {
        const driftStr = cp.daysToDrift !== null ? `HF 1.50→1.45 in ~${cp.daysToDrift} days` : "positive/zero carry";
        lines.push(
          `- ${cp.collateral}→${cp.debt}: Net carry ${cp.netCarryPct.toFixed(2)}%/yr → ${driftStr}`,
        );
      }
    }
  } else {
    lines.push("No rate samples available.");
  }
  lines.push("");

  // 5. Ringkasan Harga
  const priceFresh = ctx.sourceFreshness?.price_samples;
  const priceHeader = priceFresh?.isStale && priceFresh.latestTimestamp
    ? ` [STATUS: STALE since ${fmtTime(priceFresh.latestTimestamp)} UTC (${priceFresh.ageHours?.toFixed(1)}h old) — run \`schedule run --with-price\` or /analyze]`
    : priceFresh?.latestTimestamp
      ? ` [STATUS: FRESH (${priceFresh.ageHours?.toFixed(1)}h old)]`
      : "";
  lines.push(`#### 5. PRICE SAMPLES SUMMARY${priceHeader}`);
  if (ctx.priceSummaries.length > 0) {
    for (const ps of ctx.priceSummaries) {
      const timeStr = fmtTime(ps.sampledAt);
      const staleTag = priceFresh?.isStale ? ` - STALE (${priceFresh.ageHours?.toFixed(1)}h old)` : "";
      const chgStr = ps.change24hPct !== undefined ? `${ps.change24hPct >= 0 ? "+" : ""}${ps.change24hPct.toFixed(2)}%` : "N/A";
      const rangeStr = ps.min24h !== undefined && ps.max24h !== undefined ? `(24h low: $${ps.min24h.toFixed(2)}, high: $${ps.max24h.toFixed(2)})` : "";
      lines.push(
        `- ${ps.asset}: $${ps.latestPrice.toFixed(2)} (24h chg: ${chgStr}) ${rangeStr} [price_samples ${timeStr}${staleTag}]`,
      );
    }
  } else {
    lines.push("No price samples available.");
  }
  lines.push("");

  // 6. Upcoming Macro Events
  lines.push("#### 6. UPCOMING SCHEDULED MACRO EVENTS");
  if (ctx.macroEvents.length > 0) {
    for (const ev of ctx.macroEvents) {
      const dateStr = ev.scheduledAt.toISOString().slice(0, 10);
      const hoursUntil = ((ev.scheduledAt.getTime() - now.getTime()) / (1000 * 60 * 60)).toFixed(1);
      lines.push(`- [macro ${ev.importance}, ${dateStr}] ${ev.name} (in ~${hoursUntil}h)`);
    }
  } else {
    lines.push("No upcoming macro events in the immediate lookahead.");
  }

  return lines.join("\n");
}

/**
 * Format status satu baris untuk banner REPL:
 * `Last: ELEVATED (ETH, USDC) · 14:06 UTC · 8 active signals`
 */
export function formatStatusLine(ctx: ReplContext, theme: Theme = { color: true, width: 80 }): string {
  if (!ctx.hasData) {
    return " Last: (no research yet) · run /analyze to start";
  }

  let regimePart = "CALM";
  if (ctx.assessments.length > 0) {
    const assetRegimes = ctx.assessments.map((a) => `${a.asset} ${regimeColor(theme, a.regime, a.regime)}`).join(", ");
    regimePart = assetRegimes;
  } else if (ctx.latestReport) {
    regimePart = regimeColor(theme, ctx.latestReport.report.proposedRegime, ctx.latestReport.report.proposedRegime);
  }

  let timePart = "(unknown)";
  if (ctx.latestReport) {
    timePart = `${fmtTime(ctx.latestReport.createdAt)} UTC`;
  } else if (ctx.assessments[0]) {
    timePart = `${fmtTime(ctx.assessments[0].createdAt)} UTC`;
  }

  const signalsPart = `${ctx.activeSignals.length} active signal${ctx.activeSignals.length === 1 ? "" : "s"}`;
  const staleTag = ctx.isStale ? " (stale)" : "";

  return ` Last: ${regimePart} · ${timePart} · ${signalsPart}${staleTag}`;
}
