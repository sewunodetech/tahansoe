/**
 * Riwayat research: N laporan terakhir dari DB (research:history).
 */

import { desc } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { getDb, researchReports } from "@tahansoe/db";

export interface HistoryRow {
  id: string;
  createdAt: Date;
  regime: string;
  direction: string;
  confidence: number;
  totalTokens: number;
  assessorModel: string;
}

/** Ambil N laporan terakhir (default 10), diurutkan terbaru dulu. */
export async function recentReports(limit = 10): Promise<HistoryRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(researchReports)
    .orderBy(desc(researchReports.createdAt))
    .limit(limit);

  return rows.map((r) => mapRow(r));
}

/** Konversi baris DB → HistoryRow (fungsi murni untuk test). */
export function mapRow(r: {
  id: string;
  createdAt: Date;
  report: unknown;
  usage: unknown;
}): HistoryRow {
  const report = (r.report ?? {}) as {
    proposedRegime?: string;
    direction?: string;
    confidence?: number;
  };
  const usage = (r.usage ?? {}) as {
    totalInputTokens?: number;
    totalOutputTokens?: number;
    roles?: Array<{ role: string; usedModel?: string }>;
  };
  const assessor = usage.roles?.find((x) => x.role === "assessor");
  const totalTokens =
    (usage.totalInputTokens ?? 0) + (usage.totalOutputTokens ?? 0);
  return {
    id: r.id,
    createdAt: r.createdAt,
    regime: report.proposedRegime ?? "?",
    direction: report.direction ?? "?",
    confidence: report.confidence ?? 0,
    totalTokens,
    assessorModel: assessor?.usedModel ?? "?",
  };
}

/** Format tabel teks untuk CLI. */
export function formatHistory(rows: HistoryRow[]): string {
  if (rows.length === 0) return "(no research reports in DB)";
  const header = "created_at           | regime   | dir  | conf | tokens | assessor model";
  const sep = "-".repeat(header.length);
  const lines = rows.map((r) => {
    const ts = r.createdAt.toISOString().slice(0, 19).replace("T", " ");
    const regime = r.regime.padEnd(8);
    const dir = r.direction.padEnd(4);
    const conf = r.confidence.toFixed(2);
    const toks = String(r.totalTokens).padStart(6);
    return `${ts} | ${regime} | ${dir} | ${conf} | ${toks} | ${r.assessorModel}`;
  });
  return [header, sep, ...lines].join("\n");
}

// CLI: `tsx src/db/history.ts [N]`
async function main(argv: string[]): Promise<void> {
  const n = Number(argv[0] ?? "10");
  const rows = await recentReports(Number.isFinite(n) && n > 0 ? n : 10);
  console.log(formatHistory(rows));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error("[engine] research:history gagal:", err);
    process.exitCode = 1;
  });
}
