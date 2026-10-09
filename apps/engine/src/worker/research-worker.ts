/**
 * Scheduled Research Worker (spec m3-research-agents.md §3.2, m2-engine-skeleton.md §3.2).
 *
 * Worker background yang menjalankan research agent secara otomatis dan terjadwal:
 *  - Single-instance enforcement via Postgres advisory lock (pg_try_advisory_lock).
 *  - Menjalankan run pertama segera saat start.
 *  - Penjadwalan adaptif berdasarkan regime hasil terakhir:
 *      CALM -> tiap 2 jam (atau RESEARCH_INTERVAL_CALM_MIN)
 *      ELEVATED/STRESSED/CRISIS -> tiap 1 jam (atau RESEARCH_INTERVAL_ALERT_MIN)
 *  - Anti-overlap guard (tidak pernah ada 2 run berjalan bersamaan).
 *  - Kill switch (RESEARCH_ENABLED=false) -> worker hidup tapi lewati run.
 *  - Budget limit -> lewati sampai pergantian hari UTC (00:00 UTC).
 *  - Ketahanan: error per run dicatat dan tidak mematikan worker.
 *  - Shutdown bersih saat SIGINT/SIGTERM (lepas lock & akhiri proses).
 *  - Log satu baris per run: waktu, regime, durasi, token, reportId, interval berikutnya.
 */

import { pathToFileURL } from "node:url";
import type { Regime } from "@tahansoe/domain";
import type { ResearchTrigger } from "../config.ts";
import { runResearch, type RunResult } from "../agents/run.ts";
import { budget } from "../llm/budget.ts";
import {
  acquireAdvisoryLock,
  createNeonLockClient,
  createPgliteLockClient,
  releaseAdvisoryLock,
  unwrapError,
  type AdvisoryLockClient,
} from "./lock.ts";
import {
  formatIntervalMinutes,
  getIntervalMs,
  msUntilNextUtcMidnight,
} from "./schedule.ts";

export interface ResearchWorkerClock {
  now: () => Date;
  setTimeout: (fn: () => void, ms: number) => any;
  clearTimeout: (timerId: any) => void;
}

export interface ResearchWorkerLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface ResearchWorkerOptions {
  /** Klien advisory lock yang sudah ada atau mock untuk test. */
  lockClient?: AdvisoryLockClient | null;
  /** Fungsi eksekusi research (default: runResearch dari src/agents/run.ts). */
  runner?: (params: {
    trigger: ResearchTrigger;
    chainId: number;
    assets: string[];
  }) => Promise<RunResult>;
  /** Abstraksi waktu untuk unit test deterministik. */
  clock?: ResearchWorkerClock;
  /** Override variabel lingkungan untuk pengujian isolasi. */
  envOverrides?: Record<string, string | undefined>;
  chainId?: number;
  assets?: string[];
  logger?: ResearchWorkerLogger;
  exitFn?: (code: number) => void;
  onRunCompleted?: (result: RunResult | null) => void;
  makeLockClient?: (dbUrl: string, opts?: import("./lock.ts").OpenLockOptions) => Promise<AdvisoryLockClient>;
}

export class ResearchWorker {
  private lockClient: AdvisoryLockClient | null = null;
  private runner: (params: {
    trigger: ResearchTrigger;
    chainId: number;
    assets: string[];
  }) => Promise<RunResult>;
  private clock: ResearchWorkerClock;
  private env: Record<string, string | undefined>;
  private chainId: number;
  private assets: string[];
  private logger: ResearchWorkerLogger;
  private exitFn: (code: number) => void;
  private onRunCompleted?: (result: RunResult | null) => void;
  private makeLockClient?: (dbUrl: string, opts?: import("./lock.ts").OpenLockOptions) => Promise<AdvisoryLockClient>;

  private isRunning = false;
  private isExecuting = false;
  private isLockLost = false;
  private scheduledTimer: any = null;
  private lastRegime: Regime = "CALM";

  constructor(opts: ResearchWorkerOptions = {}) {
    this.lockClient = opts.lockClient ?? null;
    this.runner = opts.runner ?? runResearch;
    this.clock = opts.clock ?? {
      now: () => new Date(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
    };
    this.env = opts.envOverrides ?? process.env;
    this.chainId = opts.chainId ?? 42161;
    this.assets = opts.assets ?? ["ETH", "USDC"];
    this.logger = opts.logger ?? {
      info: (msg) => console.log(msg),
      warn: (msg) => console.warn(msg),
      error: (msg) => console.error(msg),
    };
    this.exitFn = opts.exitFn ?? ((code) => process.exit(code));
    this.onRunCompleted = opts.onRunCompleted;
    this.makeLockClient = opts.makeLockClient;
  }

  /**
   * Mulai worker: ambil advisory lock, jalankan run pertama, lalu jadwalkan run berikutnya.
   */
  async start(): Promise<boolean> {
    if (this.isRunning) return true;

    // 1. Ambil Postgres advisory lock jika belum disediakan
    if (this.lockClient === undefined || this.lockClient === null) {
      const dbUrl = this.env.DATABASE_URL;
      const driver = (this.env.DB_DRIVER as any) || (dbUrl ? "neon" : "pglite");
      if (driver === "pglite") {
        this.lockClient = createPgliteLockClient(this.env.PGLITE_DATA_DIR);
      } else if (dbUrl) {
        try {
          const makeLock = this.makeLockClient ?? createNeonLockClient;
          this.lockClient = await makeLock(dbUrl, {
            onError: (message) => {
              this.isLockLost = true;
              this.logger.warn(`[worker] koneksi lock hilang (${message}) — akan dicoba reconnect pada tick berikutnya.`);
            },
          });
        } catch (err) {
          this.logger.error(`[worker] gagal membuka koneksi lock: ${unwrapError(err)}`);
          this.exitFn(1);
          return false;
        }
      }
    } else if (typeof (this.lockClient as any).on === "function") {
      (this.lockClient as any).on("error", (err: unknown) => {
        this.isLockLost = true;
        this.logger.warn(`[worker] koneksi lock hilang (${unwrapError(err)}) — akan dicoba reconnect pada tick berikutnya.`);
      });
    }

    if (this.lockClient) {
      let locked = false;
      try {
        locked = await acquireAdvisoryLock(this.lockClient);
      } catch (err) {
        this.logger.error(`[worker] gagal mengambil advisory lock: ${unwrapError(err)}`);
        this.exitFn(1);
        return false;
      }
      if (!locked) {
        this.logger.info(
          "[worker] another research worker is running; exiting cleanly",
        );
        this.exitFn(0);
        return false;
      }
      this.logger.info("[worker] postgres advisory lock acquired successfully");
    }

    this.isRunning = true;

    // Pasang handler sinyal shutdown jika berjalan di runtime proses nyata
    this.setupProcessSignals();

    // Jalankan run pertama segera
    await this.executeRun("SCHEDULED");

    return true;
  }

  /** Status apakah koneksi advisory lock saat ini terputus/hilang. */
  getIsLockLost(): boolean {
    return this.isLockLost;
  }

  /**
   * Coba pulihkan koneksi advisory lock yang putus.
   * Mengembalikan true jika lock berhasil diambil kembali, false jika gagal atau dipegang instance lain.
   */
  async tryReacquireLock(): Promise<boolean> {
    const dbUrl = this.env.DATABASE_URL;
    const driver = (this.env.DB_DRIVER as any) || (dbUrl ? "neon" : "pglite");

    if (this.lockClient) {
      try {
        await this.lockClient.end?.();
      } catch {
        /* abaikan */
      }
      this.lockClient = null;
    }

    if (driver === "pglite") {
      this.lockClient = createPgliteLockClient(this.env.PGLITE_DATA_DIR);
      let locked = false;
      try {
        locked = await acquireAdvisoryLock(this.lockClient);
      } catch (err) {
        this.logger.warn(`[worker] gagal re-acquire lock: ${unwrapError(err)} — coba lagi tick berikutnya.`);
        return false;
      }
      if (!locked) {
        this.logger.info("[worker] lock dipegang instance lain — tetap pasif hingga tick berikutnya.");
        return false;
      }
      this.isLockLost = false;
      this.logger.info("[worker] pglite advisory lock berhasil diambil kembali.");
      return true;
    }

    if (!dbUrl) return false;

    try {
      this.logger.info("[worker] mencoba membuka kembali koneksi lock yang putus...");
      const makeLock = this.makeLockClient ?? createNeonLockClient;
      const client = await makeLock(dbUrl, {
        onError: (message) => {
          this.isLockLost = true;
          this.logger.warn(`[worker] koneksi lock hilang (${message}) — akan dicoba reconnect pada tick berikutnya.`);
        },
      });
      const locked = await acquireAdvisoryLock(client);
      if (!locked) {
        this.logger.info("[worker] lock dipegang instance lain — tetap pasif hingga tick berikutnya.");
        try {
          await client.end?.();
        } catch {
          /* abaikan */
        }
        return false;
      }
      this.lockClient = client;
      this.isLockLost = false;
      this.logger.info("[worker] postgres advisory lock berhasil diambil kembali.");
      return true;
    } catch (err) {
      this.logger.warn(`[worker] gagal re-acquire lock: ${unwrapError(err)} — coba lagi tick berikutnya.`);
      return false;
    }
  }

  /**
   * Hentikan worker dan lepaskan lock Postgres secara bersih.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.scheduledTimer) {
      this.clock.clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }

    if (this.lockClient) {
      try {
        if (!this.isLockLost) {
          await releaseAdvisoryLock(this.lockClient);
        }
        await this.lockClient.end?.();
      } catch (err) {
        this.logger.warn(`[worker] error saat melepaskan lock: ${unwrapError(err)}`);
      }
      this.lockClient = null;
    }

    this.logger.info("[worker] worker stopped cleanly");
  }

  /**
   * Eksekusi satu research run dengan guard anti-overlap, kill switch, dan ketahanan error.
   */
  async executeRun(trigger: ResearchTrigger = "SCHEDULED"): Promise<void> {
    if (!this.isRunning) return;

    // Guard Anti-overlap: jangan jalankan jika run sebelumnya masih aktif
    if (this.isExecuting) {
      this.logger.warn(
        "[worker] run skipped: previous run is still in progress (anti-overlap guard)",
      );
      return;
    }

    this.isExecuting = true;
    const startTime = this.clock.now();
    let nextDelayMs = getIntervalMs(this.lastRegime, this.env);

    try {
      // Guard Lock Lost: jika koneksi lock terputus (57P01 dsb.), jangan mulai run baru.
      // Coba reconnect dan re-acquire lock. Jika instance lain yang memegang, tetap pasif.
      if (this.isLockLost) {
        const reacquired = await this.tryReacquireLock();
        if (!reacquired) {
          this.scheduleNext(nextDelayMs);
          return;
        }
      }
      // 1. Guard Kill Switch (RESEARCH_ENABLED=false)
      const isEnabled = this.env.RESEARCH_ENABLED !== "false";
      if (!isEnabled) {
        const durationSec = (
          (this.clock.now().getTime() - startTime.getTime()) /
          1000
        ).toFixed(1);
        this.logRunLine({
          timestamp: startTime.toISOString(),
          regime: "SKIP",
          durationSec,
          tokens: 0,
          reportId: "-",
          nextRunIn: formatIntervalMinutes(nextDelayMs),
          note: 'RESEARCH_ENABLED=false (kill switch)',
        });
        this.onRunCompleted?.(null);
        return;
      }

      // 2. Guard Budget Harian
      const isBudgetExceeded = budget.exceeded();
      if (isBudgetExceeded) {
        nextDelayMs = msUntilNextUtcMidnight(this.clock.now());
        const durationSec = (
          (this.clock.now().getTime() - startTime.getTime()) /
          1000
        ).toFixed(1);
        this.logRunLine({
          timestamp: startTime.toISOString(),
          regime: "SKIP",
          durationSec,
          tokens: 0,
          reportId: "-",
          nextRunIn: formatIntervalMinutes(nextDelayMs),
          note: `daily budget exceeded ($${budget.spentToday().toFixed(4)}), waiting until UTC midnight`,
        });
        this.onRunCompleted?.(null);
        return;
      }

      // 3. Eksekusi Runner Utama
      const result = await this.runner({
        trigger,
        chainId: this.chainId,
        assets: this.assets,
      });

      const endTime = this.clock.now();
      const durationSec = (
        (endTime.getTime() - startTime.getTime()) /
        1000
      ).toFixed(1);

      if (result && result.report) {
        this.lastRegime = result.report.proposedRegime;
        nextDelayMs = getIntervalMs(this.lastRegime, this.env);
        const tokens =
          (result.diagnostics?.totalInputTokens ?? 0) +
          (result.diagnostics?.totalOutputTokens ?? 0);

        this.logRunLine({
          timestamp: startTime.toISOString(),
          regime: result.report.proposedRegime,
          durationSec,
          tokens,
          reportId: result.reportId ?? "dry-run",
          nextRunIn: formatIntervalMinutes(nextDelayMs),
        });
      } else {
        // Run menghasilkan null / skip internal
        const reason = result?.reason ?? "unknown reason";
        if (reason.toLowerCase().includes("budget")) {
          nextDelayMs = msUntilNextUtcMidnight(this.clock.now());
        }

        this.logRunLine({
          timestamp: startTime.toISOString(),
          regime: "NULL",
          durationSec,
          tokens: 0,
          reportId: "-",
          nextRunIn: formatIntervalMinutes(nextDelayMs),
          note: reason,
        });
      }

      this.onRunCompleted?.(result);
    } catch (err) {
      // Ketahanan: error dicatat dan tidak membunuh worker loop
      const durationSec = (
        (this.clock.now().getTime() - startTime.getTime()) /
        1000
      ).toFixed(1);
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[worker] run error: ${errMsg}`);

      this.logRunLine({
        timestamp: startTime.toISOString(),
        regime: "ERROR",
        durationSec,
        tokens: 0,
        reportId: "-",
        nextRunIn: formatIntervalMinutes(nextDelayMs),
        note: errMsg,
      });

      this.onRunCompleted?.(null);
    } finally {
      this.isExecuting = false;
      this.scheduleNext(nextDelayMs);
    }
  }

  /**
   * Jadwalkan run berikutnya setelah delay tertentu.
   */
  private scheduleNext(delayMs: number): void {
    if (!this.isRunning) return;

    if (this.scheduledTimer) {
      this.clock.clearTimeout(this.scheduledTimer);
    }

    this.scheduledTimer = this.clock.setTimeout(() => {
      this.executeRun("SCHEDULED").catch((err) => {
        this.logger.error(`[worker] uncaught loop error: ${String(err)}`);
      });
    }, delayMs);
  }

  /**
   * Format log satu baris per run sesuai spesifikasi:
   * waktu, regime, durasi, token, id report di DB, interval berikutnya.
   */
  private logRunLine(params: {
    timestamp: string;
    regime: string;
    durationSec: string;
    tokens: number;
    reportId: string;
    nextRunIn: string;
    note?: string;
  }): void {
    let line =
      `[worker] ${params.timestamp} | regime=${params.regime} | ` +
      `duration=${params.durationSec}s | tokens=${params.tokens} | ` +
      `reportId=${params.reportId} | nextRunIn=${params.nextRunIn}`;

    if (params.note) {
      line += ` | note="${params.note}"`;
    }

    this.logger.info(line);
  }

  private setupProcessSignals(): void {
    if (typeof process !== "undefined" && typeof process.on === "function") {
      const shutdown = async () => {
        this.logger.info("[worker] signal received, shutting down gracefully...");
        await this.stop();
        this.exitFn(0);
      };

      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    }
  }
}

/**
 * Entrypoint CLI mandiri.
 */
async function main(): Promise<void> {
  const worker = new ResearchWorker();
  await worker.start();
}

const invokedPath = process.argv[1];
const isMain = invokedPath
  ? import.meta.url === pathToFileURL(invokedPath).href
  : false;

if (isMain) {
  main().catch((err) => {
    console.error("[worker] fatal error:", err);
    process.exit(1);
  });
}
