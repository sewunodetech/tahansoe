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

try {
  const { setGlobalDispatcher, Agent } = await import("undici");
  if (setGlobalDispatcher && Agent) {
    setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }));
  }
} catch {
  // undici opsional
}

export async function runScorecardCli(args: string[] = process.argv.slice(2)): Promise<void> {
  // Delegasi ke `tahansoe scorecard` (satu jalur render). Teruskan --days apa adanya.
  // (cli-settle-scorecard task: scorecard.ts jadi alias tipis.)
  const { scorecardCommand } = await import("./commands/scorecard-settle.ts");
  const code = await scorecardCommand(args);
  if (code !== 0) process.exit(code);
}

if (
  typeof process !== "undefined" &&
  process.argv?.[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runScorecardCli();
}
