/**
 * `tahansoe settle [--now ISO] [--json]` — jalankan settlement job (ADR 0005).
 *
 * Membungkus runSettlementJob (src/reflection/settle-job.ts) — logika TIDAK diubah.
 * Menampilkan tabel: report id (pendek), label, lead time, alasan insufficient.
 * --json: hanya JSON di stdout. Butuh DATABASE_URL (job membaca/menulis settlements).
 */

import { parseArgs } from "node:util";
import type { SettleJobResult } from "../../reflection/settle-job.ts";
import type { DetailedScorecard } from "../../reflection/scorecard.ts";
import { detectTheme, table, dim, sanitizeExternal, box, type Theme } from "../render.ts";
import { EXIT_OK, EXIT_ERROR, flagOrNpm } from "./args.ts";

export const SETTLE_HELP = `tahansoe settle — settle due research reports (ADR 0005)

Usage: tahansoe settle [--now <ISO>] [--json] [--no-color]
  --now <ISO>   Evaluate as of this timestamp (default: now)
  --json        Emit JSON only on stdout`;

export interface SettleDeps {
  /** Job settlement (default: runSettlementJob asli). Injectable untuk test. */
  runJob?: (opts: { now?: Date }) => Promise<SettleJobResult>;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

export async function settleCommand(argv: string[], deps: SettleDeps = {}): Promise<number> {
  const writeOut = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s: string) => void process.stderr.write(s));

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { now: { type: "string" }, json: { type: "boolean" }, "no-color": { type: "boolean" }, help: { type: "boolean" } },
      allowPositionals: false,
    });
  } catch (err) {
    writeErr(`argumen tidak valid: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }
  if (parsed.values.help) {
    writeOut(SETTLE_HELP + "\n");
    return EXIT_OK;
  }
  const json = flagOrNpm(parsed.values.json, "json");

  if (!deps.runJob && !process.env.DATABASE_URL) {
    if (json) writeOut(JSON.stringify({ ok: false, reason: "DATABASE_URL not set" }) + "\n");
    else writeErr("DATABASE_URL belum diset — settlement butuh koneksi DB.\n");
    return EXIT_ERROR;
  }

  let now: Date | undefined;
  if (parsed.values.now) {
    const d = new Date(parsed.values.now);
    if (Number.isNaN(d.getTime())) {
      writeErr(`--now bukan tanggal valid: ${sanitizeExternal(parsed.values.now, 40)}\n`);
      return EXIT_ERROR;
    }
    now = d;
  }

  let result: SettleJobResult;
  try {
    const runJob = deps.runJob ?? (await import("../../reflection/settle-job.ts")).runSettlementJob;
    result = await runJob({ now });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (json) writeOut(JSON.stringify({ ok: false, reason: msg }) + "\n");
    else writeErr(`settlement gagal: ${msg}\n`);
    return EXIT_ERROR;
  }

  if (json) {
    writeOut(JSON.stringify({
      ok: true,
      totalEvaluated: result.totalEvaluated,
      settled: result.settled,
      insufficientData: result.insufficientData,
    }) + "\n");
    return EXIT_OK;
  }

  const theme = detectTheme(argv, process.env, process.stdout);
  const short = (id: string) => `${id.slice(0, 8)}…`;
  writeOut(
    dim(theme, `Settlement — evaluated ${result.totalEvaluated} · settled ${result.settled.length} · insufficient ${result.insufficientData.length}`) + "\n\n",
  );

  if (result.settled.length === 0 && result.insufficientData.length === 0) {
    writeOut("(no due reports)\n");
    return EXIT_OK;
  }

  if (result.settled.length > 0) {
    const out = table(
      theme,
      [
        { key: "id", header: "report" },
        { key: "label", header: "label" },
        { key: "lead", header: "lead time", align: "right" },
      ],
      result.settled.map((s) => ({
        id: short(s.reportId),
        label: s.label,
        lead: s.leadTimeMinutes != null ? `${s.leadTimeMinutes}m` : "-",
      })),
    );
    writeOut(out + "\n");
  }

  if (result.insufficientData.length > 0) {
    writeOut("\n" + dim(theme, "insufficient data (skipped, not mislabeled):") + "\n");
    const out = table(
      theme,
      [
        { key: "id", header: "report" },
        { key: "reason", header: "reason" },
      ],
      result.insufficientData.map((i) => ({ id: short(i.reportId), reason: sanitizeExternal(i.reason, 60) })),
    );
    writeOut(out + "\n");
  }
  return EXIT_OK;
}


// ---------------------------------------------------------------------------
// `tahansoe scorecard [--days N] [--json]`
// ---------------------------------------------------------------------------

export const SCORECARD_HELP = `tahansoe scorecard — research-agent accuracy scorecard (ADR 0005)

Usage: tahansoe scorecard [--days 30] [--json] [--no-color]
  --days <N>    Window in days (default: 30)
  --json        Emit JSON only on stdout`;

export interface ScorecardDeps {
  /** Generator scorecard (default: generateScorecard asli). Injectable untuk test. */
  generate?: (params: { from: Date; to: Date }) => Promise<DetailedScorecard>;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  now?: Date;
}

function pct(v: number | null): string {
  return v === null ? "N/A" : `${(v * 100).toFixed(1)}%`;
}

/** Render scorecard sebagai box ringkas (deterministik, non-color aman). */
export function renderScorecardBox(_theme: Theme, sc: DetailedScorecard): string {
  const lines = [
    `Period     ${sc.from.toISOString().slice(0, 10)} → ${sc.to.toISOString().slice(0, 10)}`,
    `Settled    ${sc.totalSettled}   insufficient ${sc.insufficientDataCount}`,
    "",
    `Recall (TP/[TP+MISSED])     ${pct(sc.recall)}   target ≥ 70%`,
    `Precision ≥ STRESSED         ${pct(sc.precision)}   target ≥ 50%`,
    `Median lead time (TP)        ${sc.medianLeadTimeMinutes != null ? `${sc.medianLeadTimeMinutes}m` : "N/A"}   target ≥ 360m`,
    `Time in regime ≥ STRESSED    ${pct(sc.timeInStressedFraction)}   target < 10%`,
    "",
    `Labels  TP ${sc.counts.truePositive} · FP ${sc.counts.falsePositive} · MISSED ${sc.counts.missed} · TN ${sc.counts.trueNegative}`,
  ];
  return lines.join("\n");
}

export async function scorecardCommand(argv: string[], deps: ScorecardDeps = {}): Promise<number> {
  const writeOut = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s: string) => void process.stderr.write(s));

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { days: { type: "string" }, json: { type: "boolean" }, "no-color": { type: "boolean" }, help: { type: "boolean" } },
      allowPositionals: false,
    });
  } catch (err) {
    writeErr(`argumen tidak valid: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }
  if (parsed.values.help) {
    writeOut(SCORECARD_HELP + "\n");
    return EXIT_OK;
  }
  const json = flagOrNpm(parsed.values.json, "json");
  const days = Math.max(1, Math.min(365, Number(parsed.values.days ?? "30") || 30));

  if (!deps.generate && !process.env.DATABASE_URL) {
    if (json) writeOut(JSON.stringify({ ok: false, reason: "DATABASE_URL not set" }) + "\n");
    else writeErr("DATABASE_URL belum diset — scorecard butuh koneksi DB.\n");
    return EXIT_ERROR;
  }

  const to = deps.now ?? new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  let sc: DetailedScorecard;
  try {
    const generate = deps.generate ?? (await import("../../reflection/scorecard.ts")).generateScorecard;
    sc = await generate({ from, to });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (json) writeOut(JSON.stringify({ ok: false, reason: msg }) + "\n");
    else writeErr(`scorecard gagal: ${msg}\n`);
    return EXIT_ERROR;
  }

  if (json) {
    writeOut(JSON.stringify({
      ok: true,
      from: sc.from.toISOString(),
      to: sc.to.toISOString(),
      recall: sc.recall,
      precision: sc.precision,
      medianLeadTimeMinutes: sc.medianLeadTimeMinutes,
      timeInStressedFraction: sc.timeInStressedFraction,
      totalSettled: sc.totalSettled,
      insufficientDataCount: sc.insufficientDataCount,
      counts: sc.counts,
    }) + "\n");
    return EXIT_OK;
  }

  const theme = detectTheme(argv, process.env, process.stdout);
  const ts = `${sc.to.toISOString().slice(0, 10)} (${days}d)`;
  writeOut(box(theme, `SCORECARD · ${ts}`, renderScorecardBox(theme, sc).split("\n"), Math.min(theme.width, 70)) + "\n");
  return EXIT_OK;
}
