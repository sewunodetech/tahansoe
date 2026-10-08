/**
 * Penyimpanan hasil research ke DB (ADR 0004/0005, spec §3.8).
 *
 * Dipakai run NON-DRY: menyimpan satu baris `research_reports` dan satu `signals`
 * (module RESEARCH). Mode --dry tidak memanggil modul ini (tanpa DB).
 *
 * JANGAN pernah log DATABASE_URL / secret (I8). `@tahansoe/db` hanya di server.
 */

import { getDb, researchReports, signals } from "@tahansoe/db";
import type { ResearchReport, ResearchSignal } from "../agents/schemas.ts";
import type { RunDiagnostics } from "../agents/run.ts";
import type { AnalystReport } from "../agents/schemas.ts";
import type { DebateResult } from "../agents/debate.ts";
import type { ResearchTrigger } from "../config.ts";
import { config } from "../config.ts";

export interface SaveResearchArgs {
  trigger: ResearchTrigger;
  chainId: number;
  report: ResearchReport;
  analystReports: AnalystReport[];
  debate: DebateResult;
  signal: ResearchSignal;
  diagnostics: RunDiagnostics;
  /** Peta peran → model terpakai (dari diagnostics). */
  models: Record<string, string>;
}

export interface SaveResearchResult {
  reportId: string;
  signalId: string;
}

/**
 * Simpan report + signal dalam satu alur. Mengembalikan id keduanya.
 * horizon_ends_at = signal.expiresAt (createdAt + horizonHours).
 */
export async function saveResearch(args: SaveResearchArgs): Promise<SaveResearchResult> {
  const db = getDb();

  const [reportRow] = await db
    .insert(researchReports)
    .values({
      chainId: args.chainId,
      trigger: args.trigger,
      report: args.report,
      analystReports: args.analystReports,
      debate: args.debate,
      promptVersion: config.promptVersion,
      models: args.models,
      usage: {
        totalInputTokens: args.diagnostics.totalInputTokens,
        totalOutputTokens: args.diagnostics.totalOutputTokens,
        roles: args.diagnostics.roles,
      },
      diagnostics: args.diagnostics,
      horizonEndsAt: args.signal.expiresAt,
    })
    .returning({ id: researchReports.id });

  const [signalRow] = await db
    .insert(signals)
    .values({
      chainId: args.chainId,
      module: "RESEARCH",
      paths: args.report.paths.map((p) => p.path),
      assets: args.signal.assets,
      direction: args.report.direction,
      // numeric → string agar presisi tidak hilang (drizzle numeric terima string).
      severity: args.signal.severity.toFixed(4),
      confidence: args.signal.confidence.toFixed(4),
      horizonHours: args.report.horizonHours,
      observedAt: args.signal.createdAt,
      expiresAt: args.signal.expiresAt,
      evidence: args.signal.evidence,
    })
    .returning({ id: signals.id });

  return { reportId: reportRow!.id, signalId: signalRow!.id };
}
