/**
 * `tahansoe fuse [--json] [--dry]` — satu siklus Risk Fusion v1 (spec §3.2).
 *
 * Membaca signals aktif + prior + price_samples, memanggil fuse(), menulis
 * risk_assessments (kecuali --dry). Render per-aset: regime + penjelasan.
 * --json: JSON saja di stdout. Butuh DATABASE_URL (kecuali deps di-inject di test).
 *
 * KEAMANAN: tanpa aksi on-chain; teks eksternal lewat sanitize; tidak cetak secret.
 */

import { parseArgs } from "node:util";
import type { FusionRunResult, RunFusionOptions } from "../../fusion/run.ts";
import { detectTheme, box, dim, regimeColor, sanitizeExternal, fmtTime } from "../render.ts";
import { EXIT_OK, EXIT_ERROR, flagOrNpm } from "./args.ts";

export const FUSE_HELP = `tahansoe fuse — run one Risk Fusion v1 pass (deterministic)

Usage: tahansoe fuse [--json] [--dry] [--no-color]
  --dry    Compute and print only; do NOT write risk_assessments
  --json   Emit JSON only on stdout`;

export interface FuseDeps {
  /** Jalur fusion (default: runFusion asli). Injectable untuk test. */
  run?: (opts: RunFusionOptions) => Promise<FusionRunResult>;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

export async function fuseCommand(argv: string[], deps: FuseDeps = {}): Promise<number> {
  const writeOut = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s: string) => void process.stderr.write(s));

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { json: { type: "boolean" }, dry: { type: "boolean" }, "no-color": { type: "boolean" }, help: { type: "boolean" } },
      allowPositionals: false,
    });
  } catch (err) {
    writeErr(`argumen tidak valid: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }
  if (parsed.values.help) {
    writeOut(FUSE_HELP + "\n");
    return EXIT_OK;
  }
  const json = flagOrNpm(parsed.values.json, "json");
  // npm/PowerShell: --dry sering dibaca sebagai --dry-run.
  const dry = flagOrNpm(parsed.values.dry, "dry", ["dry_run"]);

  if (!deps.run && !process.env.DATABASE_URL) {
    if (json) writeOut(JSON.stringify({ ok: false, reason: "DATABASE_URL not set" }) + "\n");
    else writeErr("DATABASE_URL belum diset — fusion butuh koneksi DB (atau pakai --dry setelah set DB).\n");
    return EXIT_ERROR;
  }

  const run = deps.run ?? (await import("../../fusion/run.ts")).runFusion;
  let result: FusionRunResult;
  try {
    result = await run({ dry });
  } catch (err) {
    // runFusion dirancang tidak melempar; ini jaring pengaman tambahan.
    const msg = err instanceof Error ? err.message : String(err);
    if (json) writeOut(JSON.stringify({ ok: false, reason: msg }) + "\n");
    else writeErr(`fusion gagal: ${msg}\n`);
    return EXIT_ERROR;
  }

  if (json) {
    writeOut(JSON.stringify({
      ok: true,
      chainId: result.chainId,
      now: result.now.toISOString(),
      dry: result.dry,
      assets: result.results.map((r) => ({
        asset: r.asset,
        regime: r.assessment?.regime ?? null,
        riskScore: r.assessment?.riskScore ?? null,
        recommendedTriggerHF: r.assessment?.recommendedTriggerHF ?? null,
        recommendedTargetHF: r.assessment?.recommendedTargetHF ?? null,
        drawdown: r.assessment ? r.assessment.drawdownEstimate : null,
        reasons: r.reasons,
        assessmentId: r.assessmentId ?? null,
        note: r.note ?? null,
      })),
      disclaimer: "not a trading signal",
    }) + "\n");
    return EXIT_OK;
  }

  const theme = detectTheme(argv, process.env, process.stdout);
  const lines: string[] = [];
  lines.push(`Chain ${result.chainId} · ${fmtTime(result.now)} UTC${result.dry ? " · DRY (not written)" : ""}`);
  lines.push("");
  for (const r of result.results) {
    if (!r.assessment) {
      lines.push(`${r.asset.padEnd(6)} —  ${dim(theme, sanitizeExternal(r.note ?? "no assessment", 50))}`);
      continue;
    }
    const a = r.assessment;
    const regimeTxt = regimeColor(theme, a.regime, `● ${a.regime}`);
    lines.push(`${r.asset.padEnd(6)} ${regimeTxt}  rec. trigger HF ${a.recommendedTriggerHF.toFixed(2)} (pre-band; rules clamp to your band, default 1.25-1.60)`);
    lines.push(dim(theme, `       d4 ${(a.drawdownEstimate.h4 * 100).toFixed(1)}% · d24 ${(a.drawdownEstimate.h24 * 100).toFixed(1)}% · score ${a.riskScore.toFixed(0)}`));
    if (r.reasons.length > 0) lines.push(dim(theme, `       reasons: ${r.reasons.join(", ")}`));
    // Penjelasan (deterministik, sudah tersanitasi di renderer) — baris pertama saja.
    const firstExplainLine = a.explanation.split("\n")[0] ?? "";
    lines.push(dim(theme, `       ${sanitizeExternal(firstExplainLine, 60)}`));
  }
  writeOut(box(theme, "RISK FUSION", lines, Math.min(theme.width, 74)) + "\n");
  writeOut(dim(theme, " not a trading signal\n"));
  return EXIT_OK;
}
