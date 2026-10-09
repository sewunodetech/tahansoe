/**
 * Pemetaan MURNI dari ResearchReport (schemas) + diagnostics → ReportCardData
 * (render.ts). Dipisah agar bisa diuji tanpa I/O. Teks eksternal disanitasi di
 * renderer; di sini hanya memilih field.
 */

import type { ResearchReport } from "../agents/schemas.ts";
import type { RunDiagnostics } from "../agents/run.ts";
import type { ReportCardData } from "./render.ts";
import { config } from "../config.ts";

/** Label ramah-manusia untuk jalur transmisi T1..T10 (knowledge/risk-transmission §1). */
export const PATH_LABEL: Record<string, string> = {
  T1: "Collateral price drop",
  T2: "Volatility spike",
  T3: "Leverage cascade",
  T4: "Stablecoin depeg",
  T5: "LST/LRT depeg",
  T6: "Gas / congestion",
  T7: "Reserve liquidity dry",
  T8: "Oracle lag / anomaly",
  T9: "Protocol incident",
  T10: "L2 sequencer down",
};

export interface ToCardOpts {
  reportId?: string;
  diagnostics?: RunDiagnostics;
  costUsd?: number;
  costIdr?: number;
  now?: Date;
}

/** Bangun ReportCardData dari report + opsi (biaya/diagnostik). Pure. */
export function toReportCardData(report: ResearchReport, opts: ToCardOpts = {}): ReportCardData {
  const tokens = opts.diagnostics
    ? opts.diagnostics.totalInputTokens + opts.diagnostics.totalOutputTokens
    : undefined;
  return {
    createdAt: opts.now ?? new Date(),
    regime: report.proposedRegime,
    direction: report.direction,
    confidence: report.confidence,
    confidenceCap: config.confidenceCap,
    horizonHours: report.horizonHours,
    paths: report.paths.map((p) => ({
      code: p.path,
      label: PATH_LABEL[p.path] ?? p.path,
      severity: p.severity,
    })),
    evidence: report.keyDevelopments.flatMap((d) =>
      d.evidence.map((e) => ({ text: e.summary, source: e.source })),
    ),
    suggestion: "Suggested buffer: raise trigger HF within your approved band",
    reportId: opts.reportId,
    tokens,
    costUsd: opts.costUsd,
    costIdr: opts.costIdr,
    durationMs: opts.diagnostics?.durationMs,
  };
}

/** Objek JSON ringkas untuk mode --json (deterministik, tanpa secret). */
export function toJson(report: ResearchReport, opts: ToCardOpts = {}): Record<string, unknown> {
  return {
    reportId: opts.reportId ?? null,
    createdAt: (opts.now ?? new Date()).toISOString(),
    regime: report.proposedRegime,
    direction: report.direction,
    confidence: report.confidence,
    confidenceCap: config.confidenceCap,
    horizonHours: report.horizonHours,
    assets: report.assets,
    paths: report.paths.map((p) => ({ path: p.path, severity: p.severity, rationale: p.rationale })),
    keyDevelopments: report.keyDevelopments.map((d) => ({
      summary: d.summary,
      evidence: d.evidence.map((e) => ({ summary: e.summary, source: e.source })),
    })),
    hawkCase: report.hawkCase,
    doveCase: report.doveCase,
    diagnostics: opts.diagnostics
      ? {
          totalInputTokens: opts.diagnostics.totalInputTokens,
          totalOutputTokens: opts.diagnostics.totalOutputTokens,
          durationMs: opts.diagnostics.durationMs,
          roles: opts.diagnostics.roles,
        }
      : null,
    disclaimer: "not a trading signal",
  };
}
