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
 * Deteksi error koneksi Neon yang bersifat SEMENTARA (compute auto-suspend / cold
 * start / terminasi 57P01). Query pertama ke compute yang suspend sering gagal
 * ("fetch failed" / 57P01), lalu berhasil setelah compute bangun. Retry singkat
 * menutup celah ini (invariant #4: graceful degradation), tanpa menyembunyikan
 * error logis (constraint/validation).
 */
export function isTransientDbError(err: unknown): boolean {
  if (!err) return false;
  const parts: string[] = [];
  const codes: string[] = [];

  const visit = (obj: any, depth = 0) => {
    if (!obj || depth > 6) return;
    if (typeof obj.message === "string") parts.push(obj.message);
    if (typeof obj.reason === "string") parts.push(obj.reason);
    if (typeof obj.code === "string") codes.push(obj.code);
    if (typeof obj.status === "number" && (obj.status === 503 || obj.status === 504 || obj.status === 502)) {
      parts.push("service unavailable");
    }
    if (obj.cause) visit(obj.cause, depth + 1);
    if (obj.sourceError) visit(obj.sourceError, depth + 1);
    if (obj.error) visit(obj.error, depth + 1);
  };

  visit(err);

  const combined = (parts.join(" ") + " " + String(err)).toLowerCase();
  const allCodes = codes.map((c) => c.toUpperCase());

  return (
    allCodes.includes("57P01") ||
    allCodes.some((c) => c.includes("TIMEOUT") || c.includes("CONNRESET") || c.includes("57P01") || c.includes("UND_ERR")) ||
    combined.includes("fetch failed") ||
    combined.includes("57p01") ||
    combined.includes("und_err") ||
    combined.includes("terminating connection") ||
    combined.includes("connection terminated") ||
    combined.includes("connect timeout") ||
    combined.includes("service unavailable") ||
    combined.includes("sent before connected") ||
    combined.includes("websocket") ||
    combined.includes("timeout") ||
    combined.includes("econnreset")
  );
}

/** Jalankan `fn`, ulang pada error koneksi Neon sementara (backoff 0.5,1,2,4s). */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const baseMs = opts.baseMs ?? 500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || i === attempts - 1) throw err;
      await sleep(baseMs * 2 ** i);
    }
  }
  throw lastErr;
}

/**
 * Simpan report + signal dalam satu alur. Mengembalikan id keduanya.
 * horizon_ends_at = signal.expiresAt (createdAt + horizonHours).
 *
 * Insert dibungkus retry transient: compute Neon bisa suspend selama fase LLM yang
 * panjang; query pertama membangunkannya, retry memastikan penulisan tetap berhasil.
 */
export async function saveResearch(args: SaveResearchArgs): Promise<SaveResearchResult> {
  const db = getDb();

  const [reportRow] = await withTransientRetry(() =>
    db
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
      .returning({ id: researchReports.id }),
  );

  const [signalRow] = await withTransientRetry(() =>
    db
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
      .returning({ id: signals.id }),
  );

  return { reportId: reportRow!.id, signalId: signalRow!.id };
}
