/**
 * Titik Masuk Utama Channel Gateway Tahansoe (spec m3-channel-gateway-telegram §7).
 *
 * Menghubungkan adapter kanal (Telegram), router perintah, penanganan Q&A,
 * mesin alert proaktif, dan manajer pairing ke dalam satu lifecycle gateway mandiri.
 */

import { TelegramAdapter, type ChannelStatus } from "./telegram/adapter.ts";
import { PairingManager, type PairingApi } from "./pairing.ts";
import { CommandRouter } from "./core/router.ts";
import { AlertPoller, type AlertEngineLoaders } from "./alerts.ts";
import { telegramDeleteWebhook } from "./telegram/api.ts";
import {
  loadGatewayState,
  saveGatewayState,
  defaultStatePath,
  type GatewayRuntimeState,
} from "./core/state.ts";
import { loadSettings, settingsPath as defaultSettingsPath, type Settings } from "../settings/settings.ts";
import type { ReplContextLoaders } from "../cli/repl/context.ts";
import type { ChatOptions } from "../cli/repl/chat.ts";

export type GatewayLogger =
  | ((msg: string) => void)
  | {
      info?: (m: string) => void;
      warn?: (m: string) => void;
      error?: (m: string) => void;
    };

export interface StartGatewayOptions {
  telegramToken?: string;
  deleteWebhook?: boolean;
  logger?: GatewayLogger;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  settingsPath?: string;
  statePath?: string;
  lockDir?: string;
  startupTimeSec?: number;
  fetchFn?: typeof fetch;
  loaders?: ReplContextLoaders & AlertEngineLoaders;
  chatOptions?: ChatOptions;
  pollIntervalSec?: number;
  minChatIntervalMs?: number;
  minGlobalIntervalMs?: number;
}

export interface GatewayInstance {
  stop(): Promise<void>;
  pairing: PairingApi;
  status: {
    telegram: ChannelStatus;
    [channel: string]: ChannelStatus;
  };
  listening?: boolean;
  webhookHost?: string;
}

export interface GatewayStatusResult {
  configured: boolean;
  channels: string[];
  botUsername?: string;
  botName?: string;
  allowedChatsCount?: number;
  lastAlertAt?: Date | null;
}

/**
 * Cek apakah instance gateway sedang aktif mendengarkan pesan masuk.
 */
export function gatewayListening(gw: GatewayInstance | unknown): boolean {
  if (!gw || typeof gw !== "object") return false;
  const g = gw as any;
  if (typeof g.listening === "boolean") {
    return g.listening;
  }
  if (g.status && typeof g.status === "object") {
    return g.status.telegram === "active";
  }
  return false;
}

/**
 * Cek status konfigurasi gateway (apakah token kanal diset dan diaktifkan).
 */
export function gatewayStatus(
  env: NodeJS.ProcessEnv = process.env,
  settings?: Settings | unknown,
): GatewayStatusResult {
  const channels: string[] = [];
  const telegramToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const s = settings as Settings | undefined;
  const telegramEnabled = s?.gateway?.channels?.telegram?.enabled !== false;

  if (telegramToken && telegramEnabled) {
    channels.push("telegram");
  }

  const allowedChats = s?.gateway?.channels?.telegram?.allowedChats;
  const allowedChatsCount = Array.isArray(allowedChats) ? allowedChats.length : 0;
  const botUsername = (s?.gateway?.channels?.telegram as unknown as { botUsername?: string } | undefined)?.botUsername;

  return {
    configured: channels.length > 0,
    channels,
    botUsername,
    allowedChatsCount,
    lastAlertAt: null,
  };
}

/**
 * Jalankan Gateway Kanal Core Risk Engine.
 */
export async function startGateway(opts: StartGatewayOptions | unknown = {}): Promise<GatewayInstance> {
  const options = (opts && typeof opts === "object" ? opts : {}) as StartGatewayOptions;
  const rawLogger = options.logger;
  const logger =
    typeof rawLogger === "function"
      ? rawLogger
      : (msg: string) => {
          rawLogger?.info?.(msg);
        };
  const env = options.env ?? process.env;
  const sPath = options.settingsPath ?? defaultSettingsPath(env);
  const stPath = options.statePath ?? defaultStatePath();

  // 1. Muat settings & state runtime
  const { settings } = await loadSettings(sPath);
  const state: GatewayRuntimeState = await loadGatewayState(stPath);

  // 2. Inisialisasi pairing manager
  const pairing = new PairingManager(stPath, state);

  // 3. Resolusi token Telegram: options.telegramToken > options.env > process.env
  const token = (options.telegramToken?.trim() || env.TELEGRAM_BOT_TOKEN?.trim() || "");
  let adapter: TelegramAdapter | undefined;
  let poller: AlertPoller | undefined;

  if (token) {
    if (options.deleteWebhook) {
      try {
        const delRes = await telegramDeleteWebhook(token, {
          fetchFn: options.fetchFn,
          dropPendingUpdates: true,
        });
        if (delRes.ok) {
          logger("[Gateway] Existing Telegram webhook deleted as requested.");
        } else {
          logger(`[Gateway] Failed to delete existing webhook: ${delRes.error}`);
        }
      } catch (err) {
        logger(`[Gateway] Failed to delete existing webhook: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    adapter = new TelegramAdapter({
      token,
      fetchFn: options.fetchFn,
      logger,
      state,
      statePath: stPath,
      lockDir: options.lockDir,
      startupTimeSec: options.startupTimeSec,
      onStateUpdate: async (updatedState) => {
        await saveGatewayState(updatedState, stPath);
      },
      onPollCycle: () => {
        pairing.reloadPendingCodes();
      },
      minChatIntervalMs: options.minChatIntervalMs,
      minGlobalIntervalMs: options.minGlobalIntervalMs,
    });

    const router = new CommandRouter({
      adapter,
      pairing,
      state,
      statePath: stPath,
      settingsPath: sPath,
      env,
      chatOptions: options.chatOptions,
      loaders: options.loaders,
      logger,
    });

    adapter.onMessage(async (msg) => {
      await router.handleMessage(msg);
    });

    await adapter.start();

    // 4. Inisialisasi alert poller proaktif (hanya jika adapter tidak dalam status conflict)
    if (adapter.status === "conflict") {
      logger("[Gateway] Another Tahansoe agent holds the bot lock; alert poller not started.");
    } else {
      const pollSec = options.pollIntervalSec ?? settings.gateway?.alertPollSec;
      poller = new AlertPoller({
        adapter,
        state,
        statePath: stPath,
        settingsPath: sPath,
        env,
        pollIntervalSec: pollSec,
        loaders: options.loaders,
        logger,
      });

      poller.start();
    }
  } else {
    logger("[Gateway] TELEGRAM_BOT_TOKEN not provided; Telegram channel inactive.");
  }

  // 5. Tangani abort signal eksternal jika diberikan
  const stopFn = async (): Promise<void> => {
    logger("[Gateway] Stopping gateway...");
    if (poller) poller.stop();
    if (adapter) await adapter.stop();
    await saveGatewayState(state, stPath).catch(() => {});
    logger("[Gateway] Gateway stopped.");
  };

  if (options.signal) {
    options.signal.addEventListener("abort", () => {
      void stopFn();
    });
  }

  return {
    stop: stopFn,
    pairing,
    get status() {
      return {
        telegram: adapter ? adapter.status : "inactive",
      };
    },
    get listening() {
      return adapter ? adapter.status === "active" : false;
    },
    get webhookHost() {
      return adapter?.webhookHost;
    },
  };
}

export * from "./core/adapter.ts";
export * from "./core/formatter.ts";
export * from "./core/state.ts";
export * from "./core/router.ts";
export * from "./pairing.ts";
export * from "./alerts.ts";
export * from "./core/lock.ts";
export * from "./telegram/api.ts";
export * from "./telegram/adapter.ts";
export * from "./telegram/queue.ts";
