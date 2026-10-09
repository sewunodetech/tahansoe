/**
 * Titik Masuk Utama Channel Gateway Tahansoe (spec m3-channel-gateway-telegram §7).
 *
 * Menghubungkan adapter kanal (Telegram), router perintah, penanganan Q&A,
 * mesin alert proaktif, dan manajer pairing ke dalam satu lifecycle gateway mandiri.
 */

import { TelegramAdapter } from "./telegram/adapter.ts";
import { PairingManager, type PairingApi } from "./pairing.ts";
import { CommandRouter } from "./core/router.ts";
import { AlertPoller, type AlertEngineLoaders } from "./alerts.ts";
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
  logger?: GatewayLogger;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  settingsPath?: string;
  statePath?: string;
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
  const pairing = new PairingManager();

  // 3. Inisialisasi adapter Telegram jika token tersedia
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  let adapter: TelegramAdapter | undefined;
  let poller: AlertPoller | undefined;

  if (token) {
    adapter = new TelegramAdapter({
      token,
      fetchFn: options.fetchFn,
      logger,
      state,
      onStateUpdate: async (updatedState) => {
        await saveGatewayState(updatedState, stPath);
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

    // 4. Inisialisasi alert poller proaktif
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
  } else {
    logger("[Gateway] TELEGRAM_BOT_TOKEN not found in env; Telegram channel inactive.");
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
  };
}

export * from "./core/adapter.ts";
export * from "./core/formatter.ts";
export * from "./core/state.ts";
export * from "./core/router.ts";
export * from "./pairing.ts";
export * from "./alerts.ts";
export * from "./telegram/api.ts";
export * from "./telegram/adapter.ts";
export * from "./telegram/queue.ts";
