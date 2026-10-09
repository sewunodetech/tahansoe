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
import type { SettleJobResult } from "../../reflection/settle-job.ts";
import type { FusionRunResult, RunFusionOptions } from "../../fusion/run.ts";
import { EXIT_OK, EXIT_ERROR, EXIT_CONFIG, flagOrNpm } from "./args.ts";
import { isGatewayConfigured, gatewayError } from "../../llm/registry.ts";

export const SCHEDULE_HELP = `tahansoe schedule — run the research scheduler (foreground)

Usage:
  tahansoe schedule run [--once] [--with-price] [--no-settle] [--no-fusion]
  tahansoe schedule status
Options:
  --once         Run a single cycle then exit
  --with-price   Also start the price worker in-process
  --no-settle    Disable the periodic settlement job
  --no-fusion    Disable the periodic risk-fusion job`;

/** Lock key settlement — BERBEDA dari research worker (42161001) agar independen. */
export const SETTLE_ADVISORY_LOCK_KEY = 42161002;
/** Lock key fusion — BERBEDA dari research (42161001) & settle (42161002). */
export const FUSION_ADVISORY_LOCK_KEY = 42161003;

/** Interval settlement default (menit); override via SETTLE_INTERVAL_MIN. */
export function settleIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SETTLE_INTERVAL_MIN;
  const min = raw ? parseInt(raw, 10) : NaN;
  const mins = Number.isFinite(min) && min > 0 ? min : 60;
  return mins * 60 * 1000;
}

/** Interval fusion default (menit); override via FUSION_INTERVAL_MIN (default 15). */
export function fusionIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.FUSION_INTERVAL_MIN;
  const min = raw ? parseInt(raw, 10) : NaN;
  const mins = Number.isFinite(min) && min > 0 ? min : 15;
  return mins * 60 * 1000;
}

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
  /** Job settlement (default: runSettlementJob). Injectable untuk test. */
  settleJob?: (opts: { now?: Date }) => Promise<SettleJobResult>;
  /**
   * Factory lock settlement (default: Neon advisory lock pada SETTLE key). Harus
   * mengembalikan { acquired, release }. Kontensi lock (acquired=false) → skip tick.
   */
  makeSettleLock?: () => Promise<{ acquired: boolean; release: () => Promise<void> }>;
  /** Clock untuk settle ticker (test). */
  settleClock?: { setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (id: unknown) => void };
  /** Interval settlement (ms). Default dari SETTLE_INTERVAL_MIN. */
  settleIntervalMs?: number;
  /** Jalur fusion (default: runFusion). Injectable untuk test. */
  fusionRun?: (opts: RunFusionOptions) => Promise<FusionRunResult>;
  /** Factory lock fusion (default: Neon advisory lock pada FUSION key). */
  makeFusionLock?: () => Promise<{ acquired: boolean; release: () => Promise<void> }>;
  /** Clock untuk fusion ticker (test). */
  fusionClock?: { setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (id: unknown) => void };
  /** Interval fusion (ms). Default dari FUSION_INTERVAL_MIN. */
  fusionIntervalMs?: number;
}

/** Status ringkas settlement terakhir untuk dashboard. */
export interface SettleStatus {
  lastAt: Date | null;
  settled: number;
  insufficient: number;
  heldLock: boolean;
}

/**
 * Ticker settlement: ambil lock settlement sendiri, jalankan job segera + tiap
 * interval. Kontensi lock → skip (instance lain yang menyelesaikan). Error job
 * di-log, TIDAK pernah meng-crash scheduler. Dipakai oleh `schedule run`.
 */
export class SettleTicker {
  private timer: unknown = null;
  private release: (() => Promise<void>) | null = null;
  private running = false;
  readonly status: SettleStatus = { lastAt: null, settled: 0, insufficient: 0, heldLock: false };

  constructor(
    private readonly job: (opts: { now?: Date }) => Promise<SettleJobResult>,
    private readonly makeLock: () => Promise<{ acquired: boolean; release: () => Promise<void> }>,
    private readonly logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void },
    private readonly intervalMs: number,
    private readonly clock: { setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (id: unknown) => void } = {
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
    },
  ) {}

  /** Mulai: ambil lock, tick pertama segera, lalu jadwalkan interval. */
  async start(): Promise<void> {
    try {
      const lock = await this.makeLock();
      this.status.heldLock = lock.acquired;
      if (!lock.acquired) {
        this.logger.info("[settle] lock dipegang instance lain — settlement dilewati di proses ini.");
        return;
      }
      this.release = lock.release;
    } catch (err) {
      this.logger.warn(`[settle] gagal ambil lock: ${err instanceof Error ? err.message : String(err)} — settlement nonaktif.`);
      return;
    }
    await this.tick();
    this.timer = this.clock.setInterval(() => void this.tick(), this.intervalMs);
  }

  /** Satu tick settlement. Error di-log, tidak melempar. */
  async tick(): Promise<void> {
    if (this.running) return; // anti-overlap
    this.running = true;
    try {
      const result = await this.job({});
      this.status.lastAt = new Date();
      this.status.settled = result.settled.length;
      this.status.insufficient = result.insufficientData.length;
      this.logger.info(
        `[settle] ${this.status.lastAt.toISOString().slice(11, 16)} UTC · ${result.settled.length} settled / ${result.insufficientData.length} insufficient (evaluated ${result.totalEvaluated})`,
      );
    } catch (err) {
      this.logger.error(`[settle] job gagal: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  /** Baris dashboard. */
  dashboardLine(): string {
    if (!this.status.heldLock) return "Last settle: (handled by another instance)";
    if (!this.status.lastAt) return "Last settle: (pending)";
    return `Last settle: ${this.status.lastAt.toISOString().slice(11, 16)} UTC, ${this.status.settled} settled / ${this.status.insufficient} insufficient`;
  }

  async stop(): Promise<void> {
    if (this.timer) {
      this.clock.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.release) {
      try {
        await this.release();
      } catch {
        /* abaikan */
      }
      this.release = null;
    }
  }
}

/** Lock settlement default via Neon advisory lock (key berbeda dari research). */
async function defaultSettleLock(): Promise<{ acquired: boolean; release: () => Promise<void> }> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return { acquired: false, release: async () => {} };
  const { createNeonLockClient, acquireAdvisoryLock, releaseAdvisoryLock } = await import("../../worker/lock.ts");
  const client = await createNeonLockClient(dbUrl);
  const acquired = await acquireAdvisoryLock(client, SETTLE_ADVISORY_LOCK_KEY);
  return {
    acquired,
    release: async () => {
      try {
        await releaseAdvisoryLock(client, SETTLE_ADVISORY_LOCK_KEY);
        await client.end?.();
      } catch {
        /* abaikan */
      }
    },
  };
}

/** Status ringkas fusion terakhir untuk dashboard. */
export interface FusionTickStatus {
  lastAt: Date | null;
  perAsset: string; // "ETH ELEVATED · USDC CALM"
  heldLock: boolean;
}

/**
 * Ticker Risk Fusion v1: lock sendiri (FUSION key), jalankan runFusion segera +
 * tiap interval, DAN dapat dipicu setelah research run (fireNow). runFusion sudah
 * tidak pernah melempar (degradasi I6); error di sini tetap di-log, tidak crash.
 */
export class FusionTicker {
  private timer: unknown = null;
  private release: (() => Promise<void>) | null = null;
  private running = false;
  readonly status: FusionTickStatus = { lastAt: null, perAsset: "—", heldLock: false };

  constructor(
    private readonly runFn: (opts: RunFusionOptions) => Promise<FusionRunResult>,
    private readonly makeLock: () => Promise<{ acquired: boolean; release: () => Promise<void> }>,
    private readonly logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void },
    private readonly intervalMs: number,
    private readonly clock: { setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (id: unknown) => void } = {
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
    },
  ) {}

  async start(): Promise<void> {
    try {
      const lock = await this.makeLock();
      this.status.heldLock = lock.acquired;
      if (!lock.acquired) {
        this.logger.info("[fusion] lock dipegang instance lain — fusion dilewati di proses ini.");
        return;
      }
      this.release = lock.release;
    } catch (err) {
      this.logger.warn(`[fusion] gagal ambil lock: ${err instanceof Error ? err.message : String(err)} — fusion nonaktif.`);
      return;
    }
    await this.tick();
    this.timer = this.clock.setInterval(() => void this.tick(), this.intervalMs);
  }

  /** Jalankan satu siklus fusion (dipakai interval & setelah research run). */
  async tick(): Promise<void> {
    if (!this.status.heldLock) return; // tanpa lock → biar instance lain yang fusion
    if (this.running) return; // anti-overlap
    this.running = true;
    try {
      const result = await this.runFn({});
      this.status.lastAt = new Date();
      this.status.perAsset =
        result.results.map((r) => `${r.asset} ${r.assessment ? r.assessment.regime : "—"}`).join(" · ") || "—";
      this.logger.info(`[fusion] ${this.status.lastAt.toISOString().slice(11, 16)} UTC · ${this.status.perAsset}`);
    } catch (err) {
      this.logger.error(`[fusion] job gagal: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  /** Baris dashboard "Fusion: REGIME per asset, HH:MM UTC". */
  dashboardLine(): string {
    if (!this.status.heldLock) return "Fusion: (handled by another instance)";
    if (!this.status.lastAt) return "Fusion: (pending)";
    return `Fusion: ${this.status.perAsset}, ${this.status.lastAt.toISOString().slice(11, 16)} UTC`;
  }

  async stop(): Promise<void> {
    if (this.timer) {
      this.clock.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.release) {
      try {
        await this.release();
      } catch {
        /* abaikan */
      }
      this.release = null;
    }
  }
}

/** Lock fusion default via Neon advisory lock (key berbeda dari research & settle). */
async function defaultFusionLock(): Promise<{ acquired: boolean; release: () => Promise<void> }> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return { acquired: false, release: async () => {} };
  const { createNeonLockClient, acquireAdvisoryLock, releaseAdvisoryLock } = await import("../../worker/lock.ts");
  const client = await createNeonLockClient(dbUrl);
  const acquired = await acquireAdvisoryLock(client, FUSION_ADVISORY_LOCK_KEY);
  return {
    acquired,
    release: async () => {
      try {
        await releaseAdvisoryLock(client, FUSION_ADVISORY_LOCK_KEY);
        await client.end?.();
      } catch {
        /* abaikan */
      }
    },
  };
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
        "no-settle": { type: "boolean" },
        "no-fusion": { type: "boolean" },
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
  const once = flagOrNpm(parsed.values.once, "once");
  const withPrice = flagOrNpm(parsed.values["with-price"], "with_price", ["with-price"]);

  const logger = {
    info: (m: string) => process.stdout.write(m + "\n"),
    warn: (m: string) => process.stderr.write(m + "\n"),
    error: (m: string) => process.stderr.write(m + "\n"),
  };

  // --with-price: jalankan price worker di proses yang sama (best-effort).
  let stopPrice: (() => Promise<void>) | null = null;
  if (withPrice && !once) {
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

  // Risk Fusion v1 periodik (lock sendiri FUSION key) + dipicu setelah tiap research
  // run. --no-fusion untuk disable. runFusion tidak pernah melempar (I6).
  const fusionEnabled = !flagOrNpm(parsed.values["no-fusion"], "no_fusion", ["no-fusion"]);
  let fusionTicker: FusionTicker | null = null;
  if (fusionEnabled) {
    const runFn = deps.fusionRun ?? (await import("../../fusion/run.ts")).runFusion;
    const makeLock = deps.makeFusionLock ?? defaultFusionLock;
    fusionTicker = new FusionTicker(
      runFn,
      makeLock,
      logger,
      deps.fusionIntervalMs ?? fusionIntervalMs(),
      deps.fusionClock,
    );
  }

  // Mode foreground: start worker (fusion dipicu setelah tiap run sukses) + tunggu
  // SIGINT, lalu stop bersih (lepas semua lock).
  const worker = await makeWorker({
    logger,
    onRunCompleted: (r: RunResult | null) => {
      // Setelah research run (sinyal RESEARCH tertulis), perbarui fusion.
      if (fusionTicker && r && r.report) void fusionTicker.tick();
    },
  });
  const started = await worker.start();
  if (!started) return EXIT_OK; // worker lain memegang lock → keluar bersih

  // Settlement job periodik di proses yang sama (lock sendiri). --no-settle utk disable.
  const settleEnabled = !flagOrNpm(parsed.values["no-settle"], "no_settle", ["no-settle"]);
  let ticker: SettleTicker | null = null;
  if (settleEnabled) {
    const job = deps.settleJob ?? (await import("../../reflection/settle-job.ts")).runSettlementJob;
    const makeLock = deps.makeSettleLock ?? defaultSettleLock;
    ticker = new SettleTicker(
      job,
      makeLock,
      logger,
      deps.settleIntervalMs ?? settleIntervalMs(),
      deps.settleClock,
    );
    await ticker.start();
    logger.info(ticker.dashboardLine());
  }

  if (fusionTicker) {
    await fusionTicker.start();
    logger.info(fusionTicker.dashboardLine());
  }

  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      process.stderr.write("\n[schedule] menghentikan… melepas lock.\n");
      try {
        if (fusionTicker) await fusionTicker.stop();
        if (ticker) await ticker.stop();
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
