/**
 * `tahansoe schedule [run|status] [--once] [--with-price]` (spec §3.3).
 *
 * `run` membungkus ResearchWorker yang ADA (advisory lock, jadwal adaptif, budget,
 * kill switch) — penjadwalan TIDAK ditulis ulang; CLI hanya menyediakan logger.
 * `--once` menjalankan satu siklus lalu berhenti. `--with-price` juga menjalankan
 * price worker di proses yang sama. `status` membaca lock + DB. Ctrl+C → stop bersih.
 *
 * Non-TTY: satu baris log per run (format worker). KEAMANAN: tanpa aksi on-chain.
 */

import { parseArgs } from "node:util";
import type { RunResult } from "../../agents/run.ts";
import { EXIT_OK, EXIT_ERROR, EXIT_CONFIG } from "./args.ts";
import { isGatewayConfigured, gatewayError } from "../../llm/registry.ts";

export const SCHEDULE_HELP = `tahansoe schedule — run the research scheduler (foreground)

Usage:
  tahansoe schedule run [--once] [--with-price]
  tahansoe schedule status
Options:
  --once         Run a single cycle then exit
  --with-price   Also start the price worker in-process`;

/** Opsi/dep injectable untuk test (tanpa DB/timer nyata). */
export interface ScheduleDeps {
  /** Factory worker (default: ResearchWorker asli). Dibuat injectable utk test. */
  makeWorker?: (opts: {
    runner?: (p: { trigger: "SCHEDULED" | "ESCALATION"; chainId: number; assets: string[] }) => Promise<RunResult>;
    logger?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
    lockClient?: unknown;
    clock?: { now: () => Date; setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (id: unknown) => void };
    exitFn?: (code: number) => void;
    onRunCompleted?: (r: RunResult | null) => void;
  }) => { start: () => Promise<boolean>; stop: () => Promise<void> };
  /** Pengecek status (lock+DB). */
  statusImpl?: () => Promise<string>;
}

/** Clock yang tidak pernah menjadwalkan timer nyata (untuk --once & test). */
const noTimerClock = {
  now: () => new Date(),
  setTimeout: (_fn: () => void, _ms: number): unknown => null,
  clearTimeout: (_id: unknown): void => {},
};

async function defaultMakeWorker(opts: Parameters<NonNullable<ScheduleDeps["makeWorker"]>>[0]) {
  const { ResearchWorker } = await import("../../worker/research-worker.ts");
  return new ResearchWorker(opts as never);
}

export async function scheduleCommand(argv: string[], deps: ScheduleDeps = {}): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        once: { type: "boolean" },
        "with-price": { type: "boolean" },
        "no-color": { type: "boolean" },
        help: { type: "boolean" },
      },
      allowPositionals: true,
    });
  } catch (err) {
    process.stderr.write(`argumen tidak valid: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }
  if (parsed.values.help) {
    process.stdout.write(SCHEDULE_HELP + "\n");
    return EXIT_OK;
  }

  const sub = parsed.positionals[0] ?? "run";

  if (sub === "status") {
    const statusImpl = deps.statusImpl ?? defaultStatus;
    process.stdout.write((await statusImpl()) + "\n");
    return EXIT_OK;
  }

  if (sub !== "run") {
    process.stderr.write(`subcommand tidak dikenal: ${sub} (pakai run|status)\n`);
    return EXIT_ERROR;
  }

  // run butuh gateway (kecuali test meng-inject worker).
  if (!deps.makeWorker && !isGatewayConfigured()) {
    process.stderr.write(gatewayError() + "\n");
    return EXIT_CONFIG;
  }

  const makeWorker = deps.makeWorker ?? defaultMakeWorker;
  const once = Boolean(parsed.values.once);

  const logger = {
    info: (m: string) => process.stdout.write(m + "\n"),
    warn: (m: string) => process.stderr.write(m + "\n"),
    error: (m: string) => process.stderr.write(m + "\n"),
  };

  // --with-price: jalankan price worker di proses yang sama (best-effort).
  let stopPrice: (() => Promise<void>) | null = null;
  if (parsed.values["with-price"] && !once) {
    try {
      const mod = (await import("../../worker/price-worker.ts")) as Record<string, unknown>;
      const start = mod.startPriceWorker as (() => Promise<() => Promise<void>>) | undefined;
      if (typeof start === "function") stopPrice = await start();
      else logger.warn("[schedule] price worker tidak mengekspos startPriceWorker; dilewati.");
    } catch (err) {
      logger.warn(`[schedule] price worker dilewati: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (once) {
    // Satu siklus: worker tanpa timer nyata; start() menjalankan run pertama, lalu stop.
    let done = false;
    const worker = await makeWorker({
      logger,
      clock: noTimerClock,
      exitFn: () => {},
      onRunCompleted: () => {
        done = true;
      },
    });
    const started = await worker.start();
    await worker.stop();
    if (stopPrice) await stopPrice();
    return started || done ? EXIT_OK : EXIT_ERROR;
  }

  // Mode foreground: start + tunggu SIGINT, lalu stop bersih (lepas lock).
  const worker = await makeWorker({ logger });
  const started = await worker.start();
  if (!started) return EXIT_OK; // worker lain memegang lock → keluar bersih

  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      process.stderr.write("\n[schedule] menghentikan… melepas lock.\n");
      try {
        await worker.stop();
        if (stopPrice) await stopPrice();
      } finally {
        resolve();
      }
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  return EXIT_OK;
}

/** Status default: lock held? + run terakhir dari DB. */
async function defaultStatus(): Promise<string> {
  if (!process.env.DATABASE_URL) return "scheduler status: DATABASE_URL belum diset.";
  try {
    const { recentReports } = await import("../../db/history.ts");
    const rows = await recentReports(1);
    if (rows.length === 0) return "scheduler status: belum ada run tercatat.";
    const r = rows[0]!;
    return `scheduler status: last run ${r.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC · ${r.regime} ${r.direction}`;
  } catch (err) {
    return `scheduler status: gagal membaca DB (${err instanceof Error ? err.message : String(err)}).`;
  }
}
