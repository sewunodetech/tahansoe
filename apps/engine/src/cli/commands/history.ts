/**
 * `tahansoe history` — tabel riwayat laporan + sparkline regime (spec §3.1).
 * Flags: --limit N · --json · --no-color. Butuh DATABASE_URL; tanpa DB → pesan jelas.
 */

import { parseArgs } from "node:util";
import { detectTheme, table, sparkline, dim } from "../render.ts";
import { EXIT_OK, EXIT_ERROR } from "./args.ts";

export const HISTORY_HELP = `tahansoe history — recent research reports

Usage: tahansoe history [--limit 20] [--json] [--no-color]`;

export async function historyCommand(
  argv: string[],
  deps: { stdout?: (s: string) => void; stderr?: (s: string) => void } = {},
): Promise<number> {
  const writeOut = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s: string) => void process.stderr.write(s));
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        limit: { type: "string" },
        json: { type: "boolean" },
        "no-color": { type: "boolean" },
        help: { type: "boolean" },
      },
      allowPositionals: false,
    });
  } catch (err) {
    writeErr(`argumen tidak valid: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }
  if (parsed.values.help) {
    writeOut(HISTORY_HELP + "\n");
    return EXIT_OK;
  }
  const limit = Math.max(1, Math.min(200, Number(parsed.values.limit ?? "20") || 20));
  const json = Boolean(parsed.values.json);

  if (!process.env.DATABASE_URL) {
    if (json) writeOut(JSON.stringify({ ok: false, reason: "DATABASE_URL not set" }) + "\n");
    else writeErr("DATABASE_URL belum diset — riwayat butuh koneksi DB.\n");
    return EXIT_ERROR;
  }

  let rows;
  try {
    const { recentReports } = await import("../../db/history.ts");
    rows = await recentReports(limit);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (json) writeOut(JSON.stringify({ ok: false, reason: msg }) + "\n");
    else writeErr(`gagal membaca riwayat: ${msg}\n`);
    return EXIT_ERROR;
  }

  if (json) {
    writeOut(
      JSON.stringify(
        rows.map((r) => ({
          id: r.id,
          createdAt: r.createdAt.toISOString(),
          regime: r.regime,
          direction: r.direction,
          confidence: r.confidence,
          totalTokens: r.totalTokens,
          assessorModel: r.assessorModel,
        })),
      ) + "\n",
    );
    return EXIT_OK;
  }

  const theme = detectTheme(argv, process.env, process.stdout);
  if (rows.length === 0) {
    writeOut("(no research reports in DB)\n");
    return EXIT_OK;
  }
  // Sparkline: dari lama → baru (rows terbaru dulu, jadi dibalik).
  const regimes = [...rows].reverse().map((r) => r.regime);
  writeOut(dim(theme, "Regime 24h  ") + sparkline(theme, regimes) + "\n\n");
  const out = table(
    theme,
    [
      { key: "ts", header: "created (UTC)" },
      { key: "regime", header: "regime" },
      { key: "dir", header: "dir" },
      { key: "conf", header: "conf", align: "right" },
      { key: "tok", header: "tokens", align: "right" },
      { key: "model", header: "assessor model" },
    ],
    rows.map((r) => ({
      ts: r.createdAt.toISOString().slice(0, 16).replace("T", " "),
      regime: r.regime,
      dir: r.direction,
      conf: r.confidence.toFixed(2),
      tok: String(r.totalTokens),
      model: r.assessorModel,
    })),
  );
  writeOut(out + "\n");
  return EXIT_OK;
}
