import { parseArgs } from "node:util";
import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { getDb, isDbConfigured } from "@tahansoe/db";
import { ARBITRUM_SEPOLIA } from "@tahansoe/domain";
import { env } from "../../config.ts";
import { DrizzleSentinelDatabase } from "../../sentinel/db-adapter.ts";
import { SentinelWorker } from "../../sentinel/sentinel-worker.ts";
import { syncGuardianEvents } from "../../sentinel/event-sync.ts";
import { Keeper } from "../../sentinel/keeper.ts";
import { EXIT_OK, EXIT_ERROR, flagOrNpm } from "./args.ts";

export const SENTINEL_HELP = `tahansoe sentinel — Health Factor Sentinel & Keeper for Guardian policies

Usage:
  tahansoe sentinel [run|once|sync] [options]

Subcommands:
  run     Start the Sentinel & Keeper background loop (~60s interval)
  once    Run a single sync + HF check + keeper cycle then exit
  sync    Run event sync once to mirror on-chain events into the database

Options:
  --rpc <url>      Arbitrum RPC URL (defaults to ARB_SEPOLIA_RPC_URL)
  --interval <sec> Loop interval in seconds (default: 60)
  --json           Output results as JSON
  --help           Show this help message`;

export interface SentinelCommandDeps {
  worker?: SentinelWorker;
  db?: import("../../sentinel/db-adapter.ts").SentinelDatabase;
  stdout?: (msg: string) => void;
  stderr?: (msg: string) => void;
  syncEvents?: typeof syncGuardianEvents;
}

export async function sentinelCommand(
  argv: string[],
  deps: SentinelCommandDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? ((m: string) => process.stdout.write(m + "\n"));
  const stderr = deps.stderr ?? ((m: string) => process.stderr.write(m + "\n"));

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        rpc: { type: "string" },
        interval: { type: "string" },
        json: { type: "boolean" },
      },
      allowPositionals: true,
    });
  } catch (err) {
    stderr(`[sentinel] argumen tidak valid: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_ERROR;
  }

  if (Boolean(parsed.values.help)) {
    stdout(SENTINEL_HELP);
    return EXIT_OK;
  }

  const sub = parsed.positionals[0] ?? "run";

  if (sub === "help" || sub === "--help" || sub === "-h") {
    stdout(SENTINEL_HELP);
    return EXIT_OK;
  }

  if (!["run", "once", "sync"].includes(sub)) {
    stderr(`subcommand sentinel tidak dikenal: ${sub} (pilihan: run, once, sync)`);
    return EXIT_ERROR;
  }

  // Setup Database
  let db = deps.db;
  if (!db) {
    if (!isDbConfigured()) {
      stderr("[sentinel] DATABASE_URL wajib diisi untuk menjalankan sentinel.");
      return EXIT_ERROR;
    }
    db = new DrizzleSentinelDatabase(getDb());
  }
  const rpcArg = typeof parsed.values.rpc === "string" ? parsed.values.rpc : undefined;
  const rpcUrl = rpcArg ?? (env.arbitrumSepoliaRpcUrl() || "https://sepolia-rollup.arbitrum.io/rpc");
  const client = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(rpcUrl),
  });

  const chainId = ARBITRUM_SEPOLIA.chainId;

  if (sub === "sync") {
    stdout(`[sentinel] Menjalankan event sync untuk Arbitrum Sepolia (${chainId})...`);
    const syncFn = deps.syncEvents ?? syncGuardianEvents;
    const res = await syncFn({
      client,
      db,
      chainId,
      logger: {
        info: (m) => stdout(`[sentinel] ${m}`),
        warn: (m) => stderr(`[sentinel/warn] ${m}`),
        error: (m) => stderr(`[sentinel/err] ${m}`),
      },
    });

    if (parsed.values.json) {
      stdout(JSON.stringify(res, null, 2));
    } else {
      stdout(`[sentinel] Sync selesai: ${res.logsProcessed} log diproses [blok ${res.fromBlock}..${res.toBlock}].`);
    }
    return EXIT_OK;
  }

  // Keeper setup
  const keeperKey = env.keeperPrivateKey();
  const keeper = new Keeper({
    privateKey: keeperKey,
    publicClient: client,
    rpcUrl,
    logger: {
      info: (m) => stdout(m),
      warn: (m) => stderr(m),
      error: (m) => stderr(m),
    },
  });

  const intervalArg = typeof parsed.values.interval === "string" ? parsed.values.interval : undefined;
  const intervalSec = intervalArg
    ? Number.parseInt(intervalArg, 10)
    : env.sentinelPollIntervalSec();

  const worker =
    deps.worker ??
    new SentinelWorker({
      client,
      db,
      chainId,
      intervalSec,
      keeper,
      logger: {
        info: (m) => stdout(m),
        warn: (m) => stderr(m),
        error: (m) => stderr(m),
      },
    });

  if (sub === "once") {
    stdout("[sentinel] Menjalankan satu siklus pemeriksaan HF Sentinel...");
    const res = await worker.tick();
    if (parsed.values.json) {
      stdout(JSON.stringify(res, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    } else {
      stdout(
        `[sentinel] Hasil pemeriksaan: ${res.checkedUsers} user diperiksa, ${res.transitions.length} transisi zona, ${res.alertsSent} alert dikirim, ${res.keeperActions.length} aksi keeper dievaluasi.`,
      );
    }
    return EXIT_OK;
  }

  // sub === "run"
  stdout(`[sentinel] Memulai Sentinel & Keeper worker (interval ${intervalSec}s, mode: ${keeper.isDryRun() ? "DRY-RUN (no private key)" : "LIVE"})...`);
  await worker.start();

  const shutdown = async () => {
    stdout("\n[sentinel] Menerima sinyal shutdown, menghentikan worker...");
    await worker.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return EXIT_OK;
}
