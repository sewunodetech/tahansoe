/**
 * Scheduled Price Sampler Worker (ADR 0005, spec §3.8).
 *
 * Worker background yang mengambil sampel harga AaveOracle & Chainlink secara periodik (default 60s):
 *  - Single-instance enforcement via Postgres advisory lock key 42161002.
 *  - Menjalankan sample pertama segera saat start.
 *  - Loop interval setiap 60 detik (dapat diubah via env PRICE_SAMPLE_INTERVAL_SEC).
 *  - Anti-overlap guard (tidak pernah ada 2 sample run berjalan bersamaan).
 *  - Ketahanan: error per run dicatat dan tidak mematikan worker loop.
 *  - Shutdown bersih saat SIGINT/SIGTERM (lepas lock & akhiri proses).
 *  - Log satu baris ringkas per run.
 */

import { pathToFileURL } from "node:url";
import type { PublicClient } from "viem";
import type { Db } from "@tahansoe/db";
import {
  acquireAdvisoryLock,
  createNeonLockClient,
  releaseAdvisoryLock,
  type AdvisoryLockClient,
} from "./lock.ts";
import { sampleOnce, type SampledPrice } from "../sources/price-sampler.ts";

/** Key advisory lock unik untuk price worker (Arbitrum One + price suffix). */
export const PRICE_WORKER_ADVISORY_LOCK_KEY = 42161002;

/** Interval sampling harga standar: 60 detik. */
export const DEFAULT_PRICE_SAMPLE_INTERVAL_SEC = 60;

export interface PriceWorkerClock {
  now: () => Date;
  setTimeout: (fn: () => void, ms: number) => any;
  clearTimeout: (timerId: any) => void;
}

export interface PriceWorkerLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface PriceWorkerOptions {
  databaseUrl?: string;
  rpcUrl?: string;
  chainId?: number;
  intervalSec?: number;
  client?: PublicClient;
  db?: Db;
  lockClient?: AdvisoryLockClient | null;
  clock?: PriceWorkerClock;
  logger?: PriceWorkerLogger;
  exitFn?: (code: number) => void;
  onSampleCompleted?: (samples: SampledPrice[] | null) => void;
  envOverrides?: Record<string, string | undefined>;
}

export class PriceWorker {
  private isRunning = false;
  private isExecuting = false;
  private scheduledTimer: any = null;
  private lockClient: AdvisoryLockClient | null | undefined;
  private readonly clock: PriceWorkerClock;
  private readonly env: Record<string, string | undefined>;
  private readonly chainId: number;
  private readonly rpcUrl?: string;
  private readonly intervalSec: number;
  private readonly logger: PriceWorkerLogger;
  private readonly exitFn: (code: number) => void;
  private readonly client?: PublicClient;
  private readonly db?: Db;
  private readonly onSampleCompleted?: (samples: SampledPrice[] | null) => void;
  private signalCleanupRegistered = false;

  constructor(opts: PriceWorkerOptions = {}) {
    this.lockClient = opts.lockClient;
    this.client = opts.client;
    this.db = opts.db;
    this.clock = opts.clock ?? {
      now: () => new Date(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
    };
    this.env = opts.envOverrides ?? process.env;
    this.chainId = opts.chainId ?? 42161;
    this.rpcUrl = opts.rpcUrl ?? this.env.ARBITRUM_RPC_URL;

    const envInterval = Number(this.env.PRICE_SAMPLE_INTERVAL_SEC);
    this.intervalSec =
      opts.intervalSec ??
      (!isNaN(envInterval) && envInterval > 0
        ? envInterval
        : DEFAULT_PRICE_SAMPLE_INTERVAL_SEC);

    this.logger = opts.logger ?? {
      info: (msg) => console.log(msg),
      warn: (msg) => console.warn(msg),
      error: (msg) => console.error(msg),
    };
    this.exitFn = opts.exitFn ?? ((code) => process.exit(code));
    this.onSampleCompleted = opts.onSampleCompleted;
  }

  /**
   * Mulai worker: ambil Postgres advisory lock, jalankan sampling pertama, jadwalkan interval.
   */
  async start(): Promise<boolean> {
    if (this.isRunning) return true;

    // 1. Ambil Postgres advisory lock jika belum disediakan
    if (this.lockClient === undefined || this.lockClient === null) {
      const dbUrl = this.env.DATABASE_URL;
      if (dbUrl) {
        try {
          this.lockClient = await createNeonLockClient(dbUrl);
        } catch (err) {
          this.logger.error(`[price-worker] gagal membuka koneksi lock: ${String(err)}`);
          this.exitFn(1);
          return false;
        }
      }
    }

    if (this.lockClient) {
      const locked = await acquireAdvisoryLock(
        this.lockClient,
        PRICE_WORKER_ADVISORY_LOCK_KEY,
      );
      if (!locked) {
        this.logger.info(
          "[price-worker] another price worker is running; exiting cleanly",
        );
        this.exitFn(0);
        return false;
      }
      this.logger.info("[price-worker] postgres advisory lock acquired successfully");
    }

    this.isRunning = true;

    // Pasang handler sinyal shutdown jika berjalan di runtime proses
    this.setupProcessSignals();

    // Jalankan sample pertama segera
    await this.executeSample();

    return true;
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
        await releaseAdvisoryLock(
          this.lockClient,
          PRICE_WORKER_ADVISORY_LOCK_KEY,
        );
        await this.lockClient.end?.();
      } catch (err) {
        this.logger.warn(`[price-worker] error saat melepaskan lock: ${String(err)}`);
      }
      this.lockClient = null;
    }

    this.logger.info("[price-worker] price worker stopped cleanly");
  }

  /**
   * Eksekusi satu kali sampling dengan anti-overlap guard dan ketahanan error.
   */
  async executeSample(): Promise<void> {
    if (!this.isRunning) return;

    if (this.isExecuting) {
      this.logger.warn(
        "[price-worker] sampling skipped: previous sample is still running (anti-overlap guard)",
      );
      return;
    }

    this.isExecuting = true;
    const now = this.clock.now();

    try {
      const samples = await sampleOnce({
        chainId: this.chainId,
        rpcUrl: this.rpcUrl,
        client: this.client,
        db: this.db,
        now,
      });

      const wethSample = samples.find((s) => s.asset === "WETH" && s.source === "aave_oracle");
      const usdcSample = samples.find((s) => s.asset === "USDC" && s.source === "aave_oracle");
      const block = samples[0]?.blockNumber?.toString() ?? "unknown";

      this.logger.info(
        `[price-worker] ${now.toISOString()} | block #${block} | ` +
          `WETH: $${wethSample?.priceUsd ?? "-"} | ` +
          `USDC: $${usdcSample?.priceUsd ?? "-"} | ` +
          `sampled ${samples.length} items (next in ${this.intervalSec}s)`,
      );

      this.onSampleCompleted?.(samples);
    } catch (err) {
      this.logger.error(
        `[price-worker] error saat sampling harga: ${String(err)} (will retry in ${this.intervalSec}s)`,
      );
      this.onSampleCompleted?.(null);
    } finally {
      this.isExecuting = false;

      // Jadwalkan run berikutnya jika worker masih aktif
      if (this.isRunning) {
        this.scheduledTimer = this.clock.setTimeout(
          () => void this.executeSample(),
          this.intervalSec * 1000,
        );
      }
    }
  }

  private setupProcessSignals(): void {
    if (this.signalCleanupRegistered) return;
    if (typeof process === "undefined" || !process.on) return;

    const shutdownHandler = async (sig: string) => {
      this.logger.info(`[price-worker] received ${sig}, shutting down...`);
      await this.stop();
      this.exitFn(0);
    };

    process.once("SIGINT", () => void shutdownHandler("SIGINT"));
    process.once("SIGTERM", () => void shutdownHandler("SIGTERM"));
    this.signalCleanupRegistered = true;
  }
}

// Entry point CLI jika dieksekusi langsung
if (
  typeof process !== "undefined" &&
  process.argv?.[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const worker = new PriceWorker();
  worker.start().catch((err) => {
    console.error("[price-worker] Fatal error:", err);
    process.exit(1);
  });
}
