/**
 * `tahansoe start [--no-gateway] [--no-research] [--once]` (spec m3-channel-gateway-telegram §1–§4, §7).
 *
 * Menjalankan agent mandiri penuh dalam satu proses jangka panjang:
 *  - Research worker (jadwal adaptif 1-2 jam)
 *  - Price sampler (tiap 60s) & rate sampler Aave V3 T11 (tiap 15m) via PriceWorker
 *  - Risk Fusion v1 ticker (tiap 15m & pemicu setelah research run)
 *  - Settlement job ticker (tiap 60m)
 *  - Channel Gateway (Telegram) bila terkonfigurasi (startGateway)
 *
 * Independensi (I6): kegagalan gateway tidak pernah mematikan riset/fusi dan sebaliknya.
 * Shutdown bersih: SIGINT / SIGTERM menghentikan seluruh layanan & melepas semua advisory lock.
 * TTY dashboard: status settlement, fusi, dan gateway. Non-TTY: one-line log format.
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
import { loadSettingsSync, settingsPath } from "../../settings/settings.ts";

export const START_HELP = `tahansoe start — run the standalone risk agent in one process

Usage:
  tahansoe start [options]

Options:
  --no-gateway   Do not start the channel gateway (Telegram)
  --no-research  Do not start the LLM research worker
  --once         Run a single cycle across components then exit
  --no-settle    Disable the periodic settlement job
  --no-fusion    Disable the periodic risk-fusion job
  --no-color     Disable ANSI colors
  --help         Show this help message`;

export interface GatewayStatusResult {
  configured: boolean;
  channels: string[];
  botUsername?: string;
  botName?: string;
  allowedChatsCount?: number;
  lastAlertAt?: Date | null;
}

export interface PairingApi {
  createPairingCode(channel: string): { code: string; expiresAt: Date | number };
  pairingStatus(code: string): { status: "pending" | "paired" | "expired"; chatId?: string | number };
}

export interface StartDeps extends ScheduleDeps {
  /** Memulai channel gateway. Injectable untuk test isolasi. */
  startGateway?: (opts?: {
    logger?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
    signal?: AbortSignal;
  }) => Promise<{ stop: () => Promise<void>; pairing?: PairingApi }>;
  /** Memeriksa konfigurasi status gateway. */
  gatewayStatus?: (env?: NodeJS.ProcessEnv, settings?: unknown) => GatewayStatusResult | Promise<GatewayStatusResult>;
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
}

/** Format baris dashboard status gateway. */
export function formatGatewayDashboardLine(
  status: GatewayStatusResult | null,
  opts: { noGateway?: boolean; isRunning?: boolean; webhookHost?: string; isWebhookActive?: boolean } = {},
): string {
  if (opts.noGateway) return "Gateway: (disabled)";
  if (!status || !status.configured) return "Gateway: (not configured)";
  if (opts.isWebhookActive || (status as any)?.status === "webhook_active") {
    const host = opts.webhookHost ?? (status as any)?.webhookHost ?? "external";
    return `Gateway: (webhook to ${host})`;
  }
  if (opts.isRunning === false) return "Gateway: (failed to start)";

  const channel = status.channels?.[0] || "telegram";
  let botPart = "@bot";
  if (status.botUsername) {
    botPart = `@${status.botUsername.replace(/^@/, "")}`;
  } else if (status.botName) {
    botPart = `@${status.botName.replace(/^@/, "")}`;
  }

  const chatsCount = status.allowedChatsCount ?? 0;
  const lastAlertStr = status.lastAlertAt
    ? status.lastAlertAt.toISOString().slice(11, 16)
    : "—";

  return `Gateway: ${channel} ${botPart}, ${chatsCount} chats, last alert ${lastAlertStr}`;
}

async function defaultGatewayStatus(
  env: NodeJS.ProcessEnv = process.env,
  settingsInput?: unknown,
): Promise<GatewayStatusResult> {
  let settings = settingsInput;
  if (!settings) {
    try {
      const { settings: s } = loadSettingsSync(settingsPath(env));
      settings = s;
    } catch {
      settings = undefined;
    }
  }

  try {
    // @ts-ignore - concurrently built by Antigravity #1
    const { gatewayStatus } = await import("../../gateway/index.ts");
    const res = await gatewayStatus(env, settings);
    return {
      configured: Boolean(res?.configured),
      channels: Array.isArray(res?.channels) ? res.channels : ["telegram"],
      botUsername: res?.botUsername,
      botName: res?.botName,
      allowedChatsCount: res?.allowedChatsCount,
      lastAlertAt: res?.lastAlertAt,
    };
  } catch {
    // Fallback deteksi via env/settings bila modul gateway belum ada
    const hasToken = Boolean(env.TELEGRAM_BOT_TOKEN?.trim());
    const tgSettings = (settings as any)?.gateway?.channels?.telegram;
    const allowed = tgSettings?.allowedChats;
    const allowedChatsCount = Array.isArray(allowed) ? allowed.length : 0;
    const botUsername = tgSettings?.botUsername;
    return {
      configured: hasToken,
      channels: hasToken ? ["telegram"] : [],
      botUsername,
      allowedChatsCount,
      lastAlertAt: null,
    };
  }
}

async function defaultStartGateway(opts?: {
  logger?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  signal?: AbortSignal;
}): Promise<{ stop: () => Promise<void>; pairing?: PairingApi }> {
  // @ts-ignore - concurrently built by Antigravity #1
  const { startGateway } = await import("../../gateway/index.ts");
  return startGateway(opts);
}

export async function startCommand(argv: string[], deps: StartDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const writeOut = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s: string) => void process.stderr.write(s));

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        "no-gateway": { type: "boolean" },
        "no-research": { type: "boolean" },
        once: { type: "boolean" },
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

  const noGateway = Boolean(flagOrNpm(parsed.values["no-gateway"], "no_gateway", ["no-gateway"]));
  const noResearch = Boolean(flagOrNpm(parsed.values["no-research"], "no_research", ["no-research"]));
  const once = Boolean(flagOrNpm(parsed.values.once, "once"));
  const noSettle = Boolean(flagOrNpm(parsed.values["no-settle"], "no_settle", ["no-settle"]));
  const noFusion = Boolean(flagOrNpm(parsed.values["no-fusion"], "no_fusion", ["no-fusion"]));

  const theme: Theme = detectTheme(argv, env, process.stdout);
  const isTTY = deps.isTTY ?? Boolean(process.stdout.isTTY && !parsed.values["no-color"]);

  const logger = {
    info: (m: string) => writeOut(m + "\n"),
    warn: (m: string) => writeErr(m + "\n"),
    error: (m: string) => writeErr(m + "\n"),
  };

  // Status gateway awal
  const statusCheck = deps.gatewayStatus ?? defaultGatewayStatus;
  let gwStatus: GatewayStatusResult = { configured: false, channels: [] };
  try {
    gwStatus = await statusCheck(env);
  } catch {
    /* abaikan */
  }

  // Tampilkan Startup Banner yang menyatakan komponen apa saja yang berjalan
  writeOut(banner(theme, "standalone risk agent · Arbitrum One") + "\n");
  writeOut(bold(theme, "Components:\n"));
  writeOut(`  ${noResearch ? dim(theme, "○ research worker  [OFF: --no-research]") : "✔ research worker  [ON: adaptive 1-2h]"}\n`);
  writeOut("  ✔ price sampler    [ON: 60s]\n");
  writeOut("  ✔ rate sampler     [ON: 15m]\n");
  writeOut(`  ${noFusion ? dim(theme, "○ risk fusion      [OFF: --no-fusion]") : "✔ risk fusion      [ON: 15m + event-driven]"}\n`);
  writeOut(`  ${noSettle ? dim(theme, "○ settle job       [OFF: --no-settle]") : "✔ settle job       [ON: 60m]"}\n`);
  if (noGateway) {
    writeOut(`  ${dim(theme, "○ channel gateway  [OFF: --no-gateway]")}\n`);
  } else if (gwStatus.configured) {
    const botName = gwStatus.botUsername ? `@${gwStatus.botUsername}` : "@bot";
    writeOut(`  ✔ channel gateway  [ON: telegram ${botName}]\n`);
  } else {
    writeOut(`  ${dim(theme, "○ channel gateway  [OFF: not configured]")}\n`);
  }
  writeOut("\n");

  // Jaring pengaman Neon serverless transient error
  if (!deps.makeWorker) {
    attachNeonTransientGuards(logger, "start");
  }

  // -------------------------------------------------------------------------
  // Mode --once: jalankan satu putaran seluruh komponen lalu keluar
  // -------------------------------------------------------------------------
  if (once) {
    logger.info("[start] running single cycle (--once)...");

    // 1. Price & rate sampling
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
    } catch (err) {
      logger.warn(`[start:price] sampling gagal: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. Research worker
    let reportProduced = false;
    if (!noResearch) {
      if (!deps.makeWorker && !isGatewayConfigured()) {
        logger.warn(`[research] ${gatewayError()} — riset dilewati.`);
      } else {
        const makeWorker = deps.makeWorker ?? defaultMakeWorker;
        const worker = await makeWorker({
          logger,
          clock: noTimerClock,
          exitFn: () => {},
          onRunCompleted: (r) => {
            if (r && r.report) reportProduced = true;
          },
        });
        try {
          await worker.start();
        } catch (err) {
          logger.error(`[worker] error saat start: ${err instanceof Error ? err.message : String(err)}`);
        }
        await worker.stop();
      }
    }

    // 3. Risk fusion
    if (!noFusion) {
      if (reportProduced || noResearch) {
        await runFusionOnce(deps, logger, true);
      } else {
        logger.info("[fusion] skipped (no research report this cycle)");
      }
    }

    // 4. Settle job
    if (!noSettle) {
      await runSettleOnce(deps, logger);
    }

    const { getDbDriver, resetDbClient } = await import("@tahansoe/db");
    if (getDbDriver() === "pglite") await resetDbClient();

    logger.info("[start] single cycle completed.");
    return EXIT_OK;
  }

  // -------------------------------------------------------------------------
  // Mode Foreground (Long-Running Agent):
  // -------------------------------------------------------------------------

  // 1. Price worker (harga 60s + bunga 15m)
  let stopPrice: (() => Promise<void>) | null = null;
  try {
    if (deps.startPriceWorker) {
      stopPrice = await deps.startPriceWorker();
    } else {
      const { startPriceWorker } = await import("../../worker/price-worker.ts");
      stopPrice = await startPriceWorker();
    }
  } catch (err) {
    logger.warn(`[start] price worker gagal dimulai: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Risk Fusion Ticker
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

  // 3. Settle Ticker
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

  // 4. Research Worker
  let worker: { start: () => Promise<boolean>; stop: () => Promise<void> } | null = null;
  if (!noResearch) {
    if (!deps.makeWorker && !isGatewayConfigured()) {
      logger.warn(`[research] LLM gateway belum dikonfigurasi — research worker dilewati. Jalankan 'tahansoe setup'.`);
    } else {
      const makeWorker = deps.makeWorker ?? defaultMakeWorker;
      worker = await makeWorker({
        logger,
        onRunCompleted: (r) => {
          if (fusionTicker && r && r.report) void fusionTicker.tick();
        },
      });
      await worker.start();
    }
  }

  // 5. Channel Gateway (Telegram) — Terisolasi (I6)
  let gatewayInstance: { stop: () => Promise<void>; pairing?: PairingApi } | null = null;
  let gatewayRunning = false;
  if (!noGateway && gwStatus.configured) {
    try {
      const startGw = deps.startGateway ?? defaultStartGateway;
      gatewayInstance = await startGw({ logger });
      const gwStatusStr =
        typeof (gatewayInstance as any)?.status === "string"
          ? (gatewayInstance as any).status
          : (gatewayInstance as any)?.status?.telegram;

      if (gwStatusStr === "webhook_active") {
        const host =
          (gatewayInstance as any)?.webhookHost ??
          (gatewayInstance as any)?.status?.webhookHost ??
          "external host";
        logger.warn(
          `This bot uses a webhook to ${host}. Messages go there, not to Tahansoe. Use a dedicated bot, or run: tahansoe gateway pair --delete-webhook`,
        );
      } else {
        gatewayRunning = true;
        logger.info("[gateway] telegram bot gateway berjalan.");
      }
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (
        err?.status === "webhook_active" ||
        msg.includes("webhook is active") ||
        msg.includes("webhook_active") ||
        msg.includes("webhook")
      ) {
        const host = err?.webhookHost ?? err?.host ?? "external host";
        logger.warn(
          `This bot uses a webhook to ${host}. Messages go there, not to Tahansoe. Use a dedicated bot, or run: tahansoe gateway pair --delete-webhook`,
        );
      } else {
        // Isolasi I6: kegagalan gateway TIDAK menghentikan riset / fusi
        logger.error(`[gateway] gagal start: ${err instanceof Error ? err.message : String(err)} (riset & fusi tetap berjalan)`);
      }
    }
  }

  // 6. TTY Dashboard lines awal
  if (isTTY) {
    if (settleTicker) logger.info(settleTicker.dashboardLine());
    if (fusionTicker) logger.info(fusionTicker.dashboardLine());
    logger.info(formatGatewayDashboardLine(gwStatus, { noGateway, isRunning: gatewayRunning }));
  }

  // 7. Tunggu shutdown bersih (SIGINT / SIGTERM / deps.shutdownSignal)
  await new Promise<void>((resolve) => {
    let resolved = false;
    const shutdown = async () => {
      if (resolved) return;
      resolved = true;
      writeErr("\n[start] menghentikan seluruh layanan… melepas lock.\n");
      try {
        if (gatewayInstance) {
          try {
            await gatewayInstance.stop();
          } catch (e) {
            writeErr(`[start] error stop gateway: ${String(e)}\n`);
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
        const { getDbDriver, resetDbClient } = await import("@tahansoe/db");
        if (getDbDriver() === "pglite") await resetDbClient();
      } finally {
        resolve();
      }
    };

    if (deps.shutdownSignal) {
      deps.shutdownSignal.addEventListener("abort", () => void shutdown());
    }
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });

  return EXIT_OK;
}
