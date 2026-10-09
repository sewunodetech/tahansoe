/**
 * `tahansoe report <id|latest>` — laporan lengkap (ringkasan, jalur, bukti, debat).
 * Flags: --json · --md · --no-color. Butuh DATABASE_URL (read-only).
 */

import { parseArgs } from "node:util";
import { detectTheme, renderReportCard, sanitizeExternal } from "../render.ts";
import { toReportCardData } from "../report-card-data.ts";
import { EXIT_OK, EXIT_ERROR } from "./args.ts";
import type { ResearchReport } from "../../agents/schemas.ts";
import type { RunDiagnostics } from "../../agents/run.ts";

export const REPORT_HELP = `tahansoe report <id|latest> — full research report

Usage: tahansoe report <id|latest> [--json] [--md] [--no-color]`;

interface Fetched {
  id: string;
  createdAt: Date;
  report: ResearchReport;
  diagnostics?: RunDiagnostics;
}

/** Ambil satu baris research_reports (by id atau terbaru). Read-only. */
async function fetchReport(idOrLatest: string): Promise<Fetched | null> {
  const { getDb, researchReports } = await import("@tahansoe/db");
  const { desc, eq } = await import("drizzle-orm");
  const db = getDb();
  const rows =
    idOrLatest === "latest"
      ? await db.select().from(researchReports).orderBy(desc(researchReports.createdAt)).limit(1)
      : await db.select().from(researchReports).where(eq(researchReports.id, idOrLatest)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id as string,
    createdAt: row.createdAt as Date,
    report: row.report as ResearchReport,
    diagnostics: (row.diagnostics ?? undefined) as RunDiagnostics | undefined,
  };
}

function renderMarkdown(f: Fetched): string {
  const r = f.report;
  const lines: string[] = [];
  lines.push(`# Research Report ${f.id}`);
  lines.push("");
  lines.push(`- Created: ${f.createdAt.toISOString()}`);
  lines.push(`- Regime: ${r.proposedRegime} · Direction: ${r.direction} · Confidence: ${r.confidence.toFixed(2)}`);
  lines.push(`- Horizon: ${r.horizonHours}h`);
  lines.push("");
  lines.push(`## Transmission paths`);
  for (const p of [...r.paths].sort((a, b) => b.severity - a.severity)) {
    lines.push(`- **${p.path}** (sev ${p.severity.toFixed(2)}): ${sanitizeExternal(p.rationale, 300)}`);
  }
  lines.push("");
  lines.push(`## Key developments`);
  for (const d of r.keyDevelopments) {
    lines.push(`- ${sanitizeExternal(d.summary, 300)}`);
    for (const e of d.evidence) lines.push(`  - (${sanitizeExternal(e.source, 20)}) ${sanitizeExternal(e.summary, 240)}`);
  }
  lines.push("");
  lines.push(`## Hawk vs Dove`);
  lines.push(`**Hawk:** ${sanitizeExternal(r.hawkCase, 800)}`);
  lines.push("");
  lines.push(`**Dove:** ${sanitizeExternal(r.doveCase, 800)}`);
  lines.push("");
  lines.push(`_not a trading signal_`);
  return lines.join("\n") + "\n";
}

export async function reportCommand(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { json: { type: "boolean" }, md: { type: "boolean" }, "no-color": { type: "boolean" }, help: { type: "boolean" } },
      allowPositionals: true,
    });
  } catch (err) {
    process.stderr.write(`argumen tidak valid: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }
  if (parsed.values.help) {
    process.stdout.write(REPORT_HELP + "\n");
    return EXIT_OK;
  }
  const target = parsed.positionals[0];
  if (!target) {
    process.stderr.write("pakai: tahansoe report <id|latest>\n");
    return EXIT_ERROR;
  }
  if (!process.env.DATABASE_URL) {
    process.stderr.write("DATABASE_URL belum diset — report butuh koneksi DB.\n");
    return EXIT_ERROR;
  }

  let f: Fetched | null;
  try {
    f = await fetchReport(target);
  } catch (err) {
    process.stderr.write(`gagal membaca report: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }
  if (!f) {
    process.stderr.write(`report tidak ditemukan: ${sanitizeExternal(target, 60)}\n`);
    return EXIT_ERROR;
  }

  if (parsed.values.json) {
    const { toJson } = await import("../report-card-data.ts");
    process.stdout.write(JSON.stringify(toJson(f.report, { reportId: f.id, diagnostics: f.diagnostics, now: f.createdAt })) + "\n");
    return EXIT_OK;
  }
  if (parsed.values.md) {
    process.stdout.write(renderMarkdown(f));
    return EXIT_OK;
  }
  const theme = detectTheme(argv, process.env, process.stdout);
  const card = toReportCardData(f.report, { reportId: f.id, diagnostics: f.diagnostics, now: f.createdAt });
  process.stdout.write(renderReportCard(theme, card) + "\n");
  return EXIT_OK;
}
