/**
 * `tahansoe start [--no-broadcast] [--no-research] [--once]` (spec m3-research-broadcast).
 *
 * Menjalankan agent mandiri penuh dalam satu proses jangka panjang:
 *  - Research worker (jadwal adaptif 1-2 jam)
 *  - Price sampler (tiap 60s) & rate sampler Aave V3 T11 (tiap 15m) via PriceWorker
 *  - Risk Fusion v1 ticker (tiap 15m & pemicu setelah research run)
 *  - Settlement job ticker (tiap 60m)
 *  - Risk Broadcaster (Telegram) bila terkonfigurasi (BroadcastWorker)
 *
 * Independensi (I4): kegagalan broadcaster tidak pernah mematikan riset/fusi dan sebaliknya.
 * Shutdown bersih: SIGINT / SIGTERM menghentikan seluruh layanan & melepas semua advisory lock.
 * TTY dashboard: status settlement dan fusi. Non-TTY: one-line log format.
 */

import { parseArgs } from "node:util";
import { EXIT_OK, EXIT_ERROR, flagOrNpm } from "./args.ts";
import { isGatewayConfigured, gatewayError } from "../../llm/registry.ts";
import { detectTheme, banner, dim, bold, type Theme } from "../render.ts";
import {
  SettleTicker,
  FusionTicker,
  defaultSettleLock,
  defaultFusionLock,
  defaultMakeWorker,
  settleIntervalMs,
  fusionIntervalMs,
  runFusionOnce,
  runSettleOnce,
  noTimerClock,
  attachNeonTransientGuards,
  type ScheduleDeps,
} from "./schedule.ts";

export const START_HELP = `tahansoe start — run the standalone risk agent in one process

Usage:
  tahansoe start [options]

Options:
  --no-broadcast Do not start the risk broadcaster (Telegram)
  --no-research  Do not start the LLM research worker
  --once         Run a single cycle across components then exit
  --detach       Run in the background (see: tahansoe status | logs | stop)
  --no-settle    Disable the periodic settlement job
  --no-fusion    Disable the periodic risk-fusion job
  --no-color     Disable ANSI colors
  --help         Show this help message`;

export interface StartDeps extends ScheduleDeps {
  /** Factory broadcaster worker (default: BroadcastWorker dari src/broadcast/worker.ts). */
  broadcastWorker?: any;
  startBroadcastWorker?: () => Promise<{ stop: () => Promise<void>; onRunCompleted?: (r: any) => Promise<void> }>;
  /** Factory price worker (default: startPriceWorker dari src/worker/price-worker.ts). */
  startPriceWorker?: (opts?: unknown) => Promise<() => Promise<void>>;
  /** One-shot price sampler untuk --once. */
  sampleOnce?: () => Promise<unknown>;
  /** One-shot rate sampler untuk --once. */
  sampleRatesOnce?: () => Promise<unknown>;
  stdout?: (m: string) => void;
  stderr?: (m: string) => void;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  shutdownSignal?: AbortSignal;
  /** Lokasi pid/stop file daemon (test). Default: apps/engine/.data. */
  daemonPaths?: import("./daemon.ts").DaemonPaths;
  /** Keluar paksa setelah shutdown daemon (test meng-inject no-op). Default: process.exit. */
  exitFn?: (code: number) => void;
}

export async function startCommand(argv: string[], deps: StartDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const writeOut = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s: string) => void process.stderr.write(s));

  const logger = {
    info: (m: string) => writeOut(`${m}\n`),
    warn: (m: string) => writeErr(`[WARN] ${m}\n`),
    error: (m: string) => writeErr(`[ERROR] ${m}\n`),
  };

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        "no-broadcast": { type: "boolean" },
        "no-research": { type: "boolean" },
        once: { type: "boolean" },
        detach: { type: "boolean" },
        "no-settle": { type: "boolean" },
        "no-fusion": { type: "boolean" },
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
    writeOut(START_HELP + "\n");
    return EXIT_OK;
  }

  const isDetach = Boolean(parsed.values.detach);
  if (isDetach) {
    const { startDetached } = await import("./daemon.ts");
    // Forward argv tanpa --detach
    const forwardedArgs = argv.filter((a) => a !== "--detach" && !a.startsWith("--detach="));
    return startDetached(forwardedArgs, {
      env,
      stdout: writeOut,
      stderr: writeErr,
      paths: deps.daemonPaths,
    });
  }

  const noResearch = Boolean(flagOrNpm(parsed.values["no-research"], "no_research", ["no-research"]));
  const noBroadcast = Boolean(flagOrNpm(parsed.values["no-broadcast"], "no_broadcast", ["no-broadcast"]));
  const once = Boolean(flagOrNpm(parsed.values.once, "once", ["once"]));
  const noSettle = Boolean(flagOrNpm(parsed.values["no-settle"], "no_settle", ["no-settle"]));
  const noFusion = Boolean(flagOrNpm(parsed.values["no-fusion"], "no_fusion", ["no-fusion"]));

  const theme = detectTheme(argv, env, process.stdout);
  const isTTY = deps.isTTY ?? (Boolean(process.stdout.isTTY) && !process.env.CI);

  // Inisialisasi status daemon bila berjalan sebagai background worker
  let daemon: { signal: AbortSignal; cleanup: () => void } | undefined;
  if (env.TAHANSOE_DAEMON === "1" && !once) {
    try {
      const { attachDaemonRuntime } = await import("./daemon.ts");
      daemon = attachDaemonRuntime(argv, deps.daemonPaths);
    } catch {
      /* abaikan */
    }
  }

  // Tampilkan Startup Banner yang menyatakan komponen apa saja yang berjalan
  writeOut(banner(theme, "standalone risk agent · Arbitrum One") + "\n");
  writeOut(bold(theme, "Components:\n"));
  writeOut(`  ${noResearch ? dim(theme, "○ research worker  [OFF: --no-research]") : "✔ research worker  [ON: adaptive 1-2h]"}\n`);
  writeOut("  ✔ price sampler    [ON: 60s]\n");
  writeOut("  ✔ rate sampler     [ON: 15m]\n");
  writeOut(`  ${noFusion ? dim(theme, "○ risk fusion      [OFF: --no-fusion]") : "✔ risk fusion      [ON: 15m + event-driven]"}\n`);
  writeOut(`  ${noSettle ? dim(theme, "○ settle job       [OFF: --no-settle]") : "✔ settle job       [ON: 60m]"}\n`);
  if (noBroadcast) {
    writeOut(`  ${dim(theme, "○ broadcaster      [OFF: --no-broadcast]")}\n`);
  } else if (env.BROADCAST_ENABLED === "false") {
    writeOut(`  ${dim(theme, "○ broadcaster      [OFF: BROADCAST_ENABLED=false]")}\n`);
  } else {
    writeOut("  ✔ broadcaster      [ON: digest 08:00/20:00 + proactive alerts]\n");
  }
  writeOut("\n");
  if (!env.DATABASE_URL?.trim()) {
    writeErr(
      "⚠ DATABASE_URL belum diset (ADR 0011: Postgres server wajib) — hasil tidak tersimpan; " +
        "research, fusion, dan settle membutuhkan DB. Jalankan 'tahansoe setup'.\n\n",
    );
  }

  // Jaring pengaman Neon serverless transient error
  if (!deps.makeWorker) {
    attachNeonTransientGuards(logger, "start");
  }

  // -------------------------------------------------------------------------
  // MODE ONCE: Eksekusi satu siklus berurutan lalu selesai
  // -------------------------------------------------------------------------
  if (once) {
    writeOut(bold(theme, "Running single cycle (--once)...\n"));
    let code = EXIT_OK;

    // 1. Price sampler & rate sampler once
    try {
      if (deps.sampleOnce) {
        await deps.sampleOnce();
      } else {
        const { sampleOnce } = await import("../../sources/price-sampler.ts");
        await sampleOnce();
      }
      if (deps.sampleRatesOnce) {
        await deps.sampleRatesOnce();
      } else {
        const { sampleRatesOnce } = await import("../../sources/rate-sampler.ts");
        await sampleRatesOnce();
      }
      writeOut("  ✔ price & rate samples captured\n");
    } catch (err) {
      writeErr(`  ✖ price/rate sampling error: ${err instanceof Error ? err.message : String(err)}\n`);
      code = EXIT_ERROR;
    }

    // 2. Research worker once
    let reportProduced = false;
    if (!noResearch) {
      if (!deps.makeWorker && !isGatewayConfigured()) {
        logger.warn(`[research] ${gatewayError()} — riset dilewati.`);
      } else {
        const makeWorker = deps.makeWorker ?? defaultMakeWorker;
        const worker = await makeWorker({
          ...deps,
          logger,
          clock: noTimerClock,
          exitFn: () => {},
          onRunCompleted: (r: any) => {
            if (r && r.report) reportProduced = true;
          },
        });
        try {
          await worker.start();
        } catch (err) {
          logger.error(`[worker] error saat start: ${String(err)}`);
          code = EXIT_ERROR;
        }
        await worker.stop();
        writeOut("  ✔ research cycle complete\n");
      }
    }

    // 3. Risk Fusion once
    if (!noFusion) {
      if (reportProduced || noResearch) {
        try {
          await runFusionOnce(deps, logger, true);
          writeOut("  ✔ risk fusion cycle complete\n");
        } catch (err) {
          writeErr(`  ✖ risk fusion error: ${err instanceof Error ? err.message : String(err)}\n`);
          code = EXIT_ERROR;
        }
      } else {
        logger.info("[fusion] skipped (no research report this cycle)");
      }
    }

    // 4. Settle job once
    if (!noSettle) {
      try {
        await runSettleOnce(deps, logger);
        writeOut("  ✔ settlement cycle complete\n");
      } catch (err) {
        writeErr(`  ✖ settlement error: ${err instanceof Error ? err.message : String(err)}\n`);
        code = EXIT_ERROR;
      }
    }

    // 5. Broadcaster once
    if (!noBroadcast && env.BROADCAST_ENABLED !== "false") {
      try {
        const { BroadcastWorker } = await import("../../broadcast/worker.ts");
        const bw = new BroadcastWorker({ env, logger });
        const sent = await bw.pollOnce();
        writeOut(`  ✔ broadcast poll complete (${sent} messages sent)\n`);
      } catch (err) {
        writeErr(`  ✖ broadcast error: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }

    writeOut(bold(theme, "Single cycle finished.\n"));
    return code;
  }

  // -------------------------------------------------------------------------
  // MODE DAEMON / PERSISTENT RUN
  // -------------------------------------------------------------------------

  // 1. Risk Fusion ticker
  let fusionTicker: FusionTicker | null = null;
  if (!noFusion) {
    const runFn = deps.fusionRun ?? (await import("../../fusion/run.ts")).runFusion;
    const makeLock = deps.makeFusionLock ?? defaultFusionLock;
    fusionTicker = new FusionTicker(
      runFn,
      makeLock,
      logger,
      deps.fusionIntervalMs ?? fusionIntervalMs(env),
      deps.fusionClock,
    );
    await fusionTicker.start();
  }

  // 2. Settlement ticker
  let settleTicker: SettleTicker | null = null;
  if (!noSettle) {
    const job = deps.settleJob ?? (await import("../../reflection/settle-job.ts")).runSettlementJob;
    const makeLock = deps.makeSettleLock ?? defaultSettleLock;
    settleTicker = new SettleTicker(
      job,
      makeLock,
      logger,
      deps.settleIntervalMs ?? settleIntervalMs(env),
      deps.settleClock,
    );
    await settleTicker.start();
  }

  // Dideklarasikan sebelum research worker: callback onRunCompleted bisa terpanggil
  // saat worker.start() menjalankan run pertama, sebelum broadcaster dibuat (blok 4b).
  let broadcastWorkerInstance: { stop: () => Promise<void>; onRunCompleted?: (r: any) => Promise<void> } | null = null;

  // 3. Scheduled Research Worker
  let worker: { start: () => void | Promise<unknown>; stop: () => Promise<void> } | null = null;
  if (!noResearch && !daemon?.signal.aborted) {
    if (!deps.makeWorker && !isGatewayConfigured()) {
      logger.warn(`[research] LLM gateway belum dikonfigurasi — research worker dilewati. Jalankan 'tahansoe setup'.`);
    } else {
      const makeW = deps.makeWorker ?? defaultMakeWorker;
      worker = await makeW({
        ...deps,
        logger,
        onRunCompleted: async (report) => {
          // Kegagalan fusion/broadcaster tidak boleh mematikan proses (I4).
          try {
            if (fusionTicker && report && (report as any).report) {
              void fusionTicker.tick();
            }
            if (broadcastWorkerInstance?.onRunCompleted) {
              broadcastWorkerInstance.onRunCompleted(report).catch((err) =>
                logger.warn(`[broadcast] onRunCompleted gagal: ${err instanceof Error ? err.message : String(err)}`),
              );
            }
          } catch (err) {
            logger.warn(`[start] onRunCompleted gagal: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      });
      daemon?.signal.addEventListener("abort", () => void worker?.stop(), { once: true });
      await worker.start();
    }
  }

  // 4a. Price worker (Aave price + rates)
  let stopPrice: (() => Promise<void>) | null = null;
  if (deps.startPriceWorker) {
    stopPrice = await deps.startPriceWorker({ logger, envOverrides: env });
  } else {
    try {
      const { startPriceWorker } = await import("../../worker/price-worker.ts");
      stopPrice = await startPriceWorker({ logger, envOverrides: env });
    } catch (err) {
      logger.warn(`[price-worker] gagal start: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4b. Broadcaster (Telegram Outbound & Digest) — Independen (I4)
  if (!noBroadcast && env.BROADCAST_ENABLED !== "false") {
    try {
      if (deps.broadcastWorker) {
        broadcastWorkerInstance = deps.broadcastWorker;
        await deps.broadcastWorker.start();
      } else if (deps.startBroadcastWorker) {
        broadcastWorkerInstance = await deps.startBroadcastWorker();
      } else {
        const { BroadcastWorker } = await import("../../broadcast/worker.ts");
        const bw = new BroadcastWorker({ env, logger });
        await bw.start();
        broadcastWorkerInstance = bw;
      }
    } catch (err) {
      logger.warn(`[broadcast] worker gagal dimulai: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 5. TTY Dashboard lines awal
  if (isTTY) {
    if (settleTicker) logger.info(settleTicker.dashboardLine());
    if (fusionTicker) logger.info(fusionTicker.dashboardLine());
  }

  // 6. Tunggu shutdown bersih (SIGINT / SIGTERM / deps.shutdownSignal / file stop daemon)
  await new Promise<void>((resolve) => {
    let resolved = false;
    const shutdown = async () => {
      if (resolved) return;
      resolved = true;
      writeErr("\n[start] menghentikan seluruh layanan… melepas lock.\n");
      try {
        if (broadcastWorkerInstance) {
          try {
            await broadcastWorkerInstance.stop();
          } catch (e) {
            writeErr(`[start] error stop broadcaster: ${String(e)}\n`);
          }
        }
        if (fusionTicker) {
          try {
            await fusionTicker.stop();
          } catch (e) {
            writeErr(`[start] error stop fusion: ${String(e)}\n`);
          }
        }
        if (settleTicker) {
          try {
            await settleTicker.stop();
          } catch (e) {
            writeErr(`[start] error stop settle: ${String(e)}\n`);
          }
        }
        if (worker) {
          try {
            await worker.stop();
          } catch (e) {
            writeErr(`[start] error stop worker: ${String(e)}\n`);
          }
        }
        if (stopPrice) {
          try {
            await stopPrice();
          } catch (e) {
            writeErr(`[start] error stop price worker: ${String(e)}\n`);
          }
        }
      } finally {
        resolve();
      }
    };

    if (deps.shutdownSignal) {
      deps.shutdownSignal.addEventListener("abort", () => void shutdown());
    }
    if (daemon) {
      // Stop bisa sudah diminta selama startup (listener abort tidak terpicu ulang).
      if (daemon.signal.aborted) void shutdown();
      else daemon.signal.addEventListener("abort", () => void shutdown());
    }

    const onSigint = () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      void shutdown();
    };
    const onSigterm = () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      void shutdown();
    };
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
  });

  // Bersihkan file runtime daemon bila ada
  if (daemon) {
    daemon.cleanup();
    const exit = deps.exitFn ?? ((code: number) => process.exit(code));
    setTimeout(() => exit(0), 3000).unref();
  }

  writeErr("[start] selesai.\n");
  return EXIT_OK;
}
