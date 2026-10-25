/**
 * `tahansoe strategy mine` — Penambang playbook proteksi dari data historis on-chain (spec §3.4).
 *
 * Menganalisis event Aave V3 Arbitrum One pada jendela crash historis:
 * mendeteksi wallet at-risk (HF < 1.15), mengklasifikasikan survivor vs liquidated,
 * mengekstrak fitur aksi proteksi, dan menerbitkan candidate Playbook[]
 * dengan bukti statistik agregat tanpa membocorkan daftar alamat wallet.
 */

import { parseArgs } from "node:util";
import { runSurvivorMiner, type MineOptions } from "../../strategy/miner/miner.ts";
import { HISTORICAL_CRASH_WINDOWS } from "../../strategy/miner/windows.ts";
import { detectTheme, box, dim, bold, sanitizeExternal } from "../render.ts";
import { EXIT_OK, EXIT_ERROR, flagOrNpm } from "./args.ts";
import type { MinerRunReport } from "../../strategy/miner/types.ts";

export const STRATEGY_HELP = `tahansoe strategy — Protection strategy management and mining

Usage:
  tahansoe strategy mine [options]
  tahansoe strategy list-windows

Options:
  --windows <ids>    Comma-separated crash window IDs to mine (default: all)
  --rpc-url <url>    Archive Arbitrum One RPC URL (defaults to env ARB_ONE_RPC_URL)
  --fixtures         Use recorded fixture events instead of fetching live/archive RPC
  --out <path>       Custom output path for generated playbooks JSON
  --json             Emit structured JSON result on stdout
  --no-color         Disable ANSI colors
  --help             Show this help message`;

export interface StrategyDeps {
  runMiner?: (opts: MineOptions) => Promise<MinerRunReport>;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

export async function strategyCommand(
  argv: string[],
  deps: StrategyDeps = {},
): Promise<number> {
  const writeOut = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s: string) => void process.stderr.write(s));

  const sub = argv[0];
  const rest = argv.slice(1);

  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    writeOut(STRATEGY_HELP + "\n");
    return EXIT_OK;
  }

  if (sub === "list-windows") {
    writeOut("Available Historical Crash Windows (Arbitrum One):\n");
    for (const win of HISTORICAL_CRASH_WINDOWS) {
      writeOut(`- ${win.id}: ${win.name}\n`);
      writeOut(`  Blocks: ${win.startBlock} .. ${win.endBlock} (Drawdown: ${win.drawdownStartBlock})\n`);
      writeOut(`  Dominant Paths: ${win.dominantPaths.join(", ")} | Asset: ${win.referenceAsset}\n`);
      writeOut(`  ${win.description}\n\n`);
    }
    return EXIT_OK;
  }

  if (sub !== "mine") {
    writeErr(`subcommand tidak dikenal: 'strategy ${sub}'\n\n${STRATEGY_HELP}\n`);
    return EXIT_ERROR;
  }

  // Parse opsi untuk subcommand `mine`
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: {
        windows: { type: "string" },
        "rpc-url": { type: "string" },
        fixtures: { type: "boolean" },
        out: { type: "string" },
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
    writeOut(STRATEGY_HELP + "\n");
    return EXIT_OK;
  }

  const json = flagOrNpm(parsed.values.json, "json");
  const useFixtures = flagOrNpm(parsed.values.fixtures, "fixtures");
  const rpcUrl = parsed.values["rpc-url"];
  const outPath = parsed.values.out;
  const windowsArg = parsed.values.windows;
  const windowIds = windowsArg ? windowsArg.split(",").map((s) => s.trim()) : undefined;

  const runMiner = deps.runMiner ?? runSurvivorMiner;

  let report: MinerRunReport;
  try {
    report = await runMiner({
      windowIds,
      rpcUrl,
      useFixtures,
      outputPath: outPath,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (json) {
      writeOut(JSON.stringify({ ok: false, error: msg }) + "\n");
    } else {
      writeErr(`gagal menjalankan survivor miner: ${msg}\n`);
    }
    return EXIT_ERROR;
  }

  if (json) {
    writeOut(
      JSON.stringify(
        { ok: true, report },
        (_key, value) => (typeof value === "bigint" ? value.toString() : value),
        2,
      ) + "\n",
    );
    return EXIT_OK;
  }

  const theme = detectTheme(argv, process.env, process.stdout);

  const headerLines = [
    bold(theme, "Tahansoe Survivor Playbook Miner") + dim(theme, " · Arbitrum One · Aave V3"),
    "",
    `Jendela ditambang: ${report.summary.totalWindowsMined} | Total posisi at-risk: ${report.summary.totalAtRiskAnalyzed}`,
    `Survivor: ${report.summary.totalSurvivors} (${(report.summary.overallSurvivalRate * 100).toFixed(1)}%) | Terlikuidasi: ${report.summary.totalLiquidated}`,
  ];

  writeOut(box(theme, "STRATEGY MINING", headerLines, Math.min(theme.width, 74)) + "\n\n");

  writeOut(bold(theme, "Hasil Per Jendela Crash:\n"));
  for (const w of report.windows) {
    writeOut(`- ${bold(theme, w.windowName)} (${dim(theme, w.windowId)})\n`);
    writeOut(
      `  Blok: ${w.startBlock}..${w.endBlock} | Event: ${w.totalEvents} | Wallet: ${w.totalWallets}\n`,
    );
    writeOut(
      `  At-Risk (< 1.15): ${w.atRiskWallets} -> Selamat: ${w.survivedWallets} (${(w.survivalRate * 100).toFixed(1)}%) | Likuidasi: ${w.liquidatedWallets}\n`,
    );
    writeOut(
      `  Aksi Survivor: Repay Wallet: ${w.actionDistribution.repayWallet} | Deleverage: ${w.actionDistribution.withdrawAndRepay} | Topup: ${w.actionDistribution.collateralTopup}\n`,
    );
    writeOut(
      `  Lead time median: ${w.medianLeadBlocks} blok | HF tercapai median: ${w.medianHfAfter} | Ukuran repay: ${(w.medianRelativeSize * 100).toFixed(1)}% utang\n\n`,
    );
  }

  writeOut(bold(theme, `Kandidat Playbook Dihasilkan (${report.candidatePlaybooks.length}):\n`));
  for (const pb of report.candidatePlaybooks) {
    writeOut(`* [${bold(theme, pb.id)}] Aksi: ${bold(theme, pb.action)} -> Target HF: ${pb.targetHf}\n`);
    writeOut(`  Kondisi: regime >= ${pb.when.regimeAtLeast ?? "ANY"}, HF < ${pb.when.hfBelow ?? "N/A"}\n`);
    writeOut(`  Bukti: Sampel ${pb.evidence?.sampleSize} wallet, Survival Rate ${(Number(pb.evidence?.survivalRate ?? 0) * 100).toFixed(1)}%\n`);
    writeOut(`  Deskripsi: ${sanitizeExternal(pb.description)}\n\n`);
  }

  writeOut(dim(theme, `Tersimpan di: apps/engine/data/playbooks/survivor-playbooks.json\n`));
  writeOut(dim(theme, `Data privasi: 100% agregat, tanpa alamat wallet on-chain.\n`));

  return EXIT_OK;
}
