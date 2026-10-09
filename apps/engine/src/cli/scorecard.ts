/**
 * CLI Tool: Scorecard Research Agents (spec §3.6, ADR 0005).
 *
 * Menampilkan ringkasan scorecard akurasi prediksi risk agent:
 * Recall, Presisi (>= STRESSED), Median Lead Time, dan jumlah insufficient_data.
 *
 * Penggunaan:
 *   node ./node_modules/tsx/dist/cli.mjs apps/engine/src/cli/scorecard.ts [--days <N>]
 */

import { pathToFileURL } from "node:url";
import {
  generateScorecard,
  formatScorecardTable,
} from "../reflection/scorecard.ts";

try {
  const { setGlobalDispatcher, Agent } = await import("undici");
  if (setGlobalDispatcher && Agent) {
    setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }));
  }
} catch {
  // undici opsional
}

export async function runScorecardCli(args: string[] = process.argv.slice(2)): Promise<void> {
  let days = 30;
  const daysIdx = args.indexOf("--days");
  if (daysIdx !== -1 && args[daysIdx + 1]) {
    const parsed = parseInt(args[daysIdx + 1]!, 10);
    if (!isNaN(parsed) && parsed > 0) {
      days = parsed;
    }
  }

  const toIdx = args.indexOf("--to");
  const rawTo = toIdx !== -1 ? args[toIdx + 1] : undefined;
  const to = rawTo ? new Date(rawTo) : new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  try {
    const sc = await generateScorecard({ from, to });
    console.log(formatScorecardTable(sc));
  } catch (err) {
    console.error("[scorecard-cli] Gagal menghasilkan scorecard:", err);
    process.exit(1);
  }
}

if (
  typeof process !== "undefined" &&
  process.argv?.[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runScorecardCli();
}
