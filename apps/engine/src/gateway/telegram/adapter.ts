/**
 * Adapter Telegram Bot API (spec m3-channel-gateway-telegram §2, §3).
 *
 * Mengimplementasikan ChannelAdapter via long polling `getUpdates` (timeout 50s)
 * dan pengiriman pesan berbatas kecepatan dengan retry 429.
 */

import type { ChannelAdapter, InboundMessage, SendOptions } from "../core/adapter.ts";
import { TelegramMessageQueue } from "./queue.ts";
import {
  maskUrl,
  sanitizeError,
  DEFAULT_TELEGRAM_BASE_URL,
  telegramSetMyCommands,
  telegramSetChatMenuButton,
  telegramAnswerCallbackQuery,
  telegramGetWebhookInfo,
  DEFAULT_COMMANDS_ID,
  DEFAULT_COMMANDS_EN,
} from "./api.ts";
import type { GatewayRuntimeState } from "../core/state.ts";
import { acquireBotLock } from "../core/lock.ts";

export type ChannelStatus = "active" | "inactive" | "conflict" | "webhook_active" | "stopped";

export interface TelegramAdapterOptions {
  token: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  logger?: (msg: string) => void;
  pollTimeoutSec?: number; // default 50
  state?: GatewayRuntimeState;
  statePath?: string;
  lockDir?: string;
  onStateUpdate?: (state: GatewayRuntimeState) => Promise<void>;
  onPollCycle?: () => void;
  minChatIntervalMs?: number;
  minGlobalIntervalMs?: number;
  startupTimeSec?: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot?: boolean;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number | string;
      type: string;
      title?: string;
      username?: string;
      first_name?: string;
    };
    date: number;
    text?: string;
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      is_bot?: boolean;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    message?: {
      message_id: number;
      chat: {
        id: number | string;
      };
      date?: number;
    };
    data?: string;
  };
}

export class TelegramAdapter implements ChannelAdapter {
  public readonly channelName = "telegram";
  public status: ChannelStatus = "inactive";
  public webhookHost?: string;
  public holderPid?: number;

  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly logger: (msg: string) => void;
  private readonly pollTimeoutSec: number;
  private readonly queue: TelegramMessageQueue;
  private readonly state?: GatewayRuntimeState;
  private readonly statePath?: string;
  private readonly lockDir?: string;
  private readonly onStateUpdate?: (state: GatewayRuntimeState) => Promise<void>;
  private readonly onPollCycle?: () => void;
  private readonly startupTimeSec: number;

  private lockRelease?: () => void;
  private messageHandler?: (msg: InboundMessage) => Promise<void>;
  private running = false;
  private abortController?: AbortController;
  private pollPromise?: Promise<void>;

  constructor(options: TelegramAdapterOptions) {
    this.token = options.token.trim();
    this.baseUrl = options.baseUrl ?? DEFAULT_TELEGRAM_BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
    this.logger = options.logger ?? (() => {});
    this.pollTimeoutSec = options.pollTimeoutSec ?? 50;
    this.state = options.state;
    this.statePath = options.statePath;
    this.lockDir = options.lockDir;
    this.onStateUpdate = options.onStateUpdate;
    this.onPollCycle = options.onPollCycle;
    this.startupTimeSec = options.startupTimeSec ?? Math.floor(Date.now() / 1000);

    this.queue = new TelegramMessageQueue({
      token: this.token,
      baseUrl: this.baseUrl,
      fetchFn: this.fetchFn,
      logger: this.logger,
      minChatIntervalMs: options.minChatIntervalMs,
      minGlobalIntervalMs: options.minGlobalIntervalMs,
    });
  }

  public onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  public async send(chatId: string, message: string, options?: SendOptions): Promise<void> {
    await this.queue.enqueue(chatId, message, {
      replyMarkup: options?.replyMarkup,
    });
  }

  public async answerCallback(callbackQueryId: string, text?: string): Promise<void> {
    try {
      await telegramAnswerCallbackQuery(this.token, callbackQueryId, text, {
        baseUrl: this.baseUrl,
        fetchFn: this.fetchFn,
      });
    } catch (err) {
      this.logger(`[Telegram] answerCallbackQuery error: ${sanitizeError(err, this.token)}`);
    }
  }

  public async start(): Promise<void> {
    if (this.running) return;

    // 1. Ambil lock eksklusif untuk bot ini (Single Poller per Bot)
    const lockRes = acquireBotLock({
      token: this.token,
      lockDir: this.lockDir,
      statePath: this.statePath,
      logger: this.logger,
    });

    if (!lockRes.acquired) {
      this.status = "conflict";
      this.holderPid = lockRes.holderPid;
      this.running = false;
      this.logger(`[Telegram] another Tahansoe agent is already serving this bot (pid ${lockRes.holderPid ?? "unknown"})`);
      return;
    }
    this.lockRelease = lockRes.release;

    this.running = true;
    this.status = "active";
    this.abortController = new AbortController();

    // Daftarkan menu perintah Telegram dan tombol menu chat secara idempoten
    await this.setupMenuCommands().catch((err) => {
      this.logger(`[Telegram] setupMenuCommands warning: ${sanitizeError(err, this.token)}`);
    });

    this.logger(`[Telegram] Adapter started (polling getUpdates timeout ${this.pollTimeoutSec}s)`);
    this.pollPromise = this.pollLoop();
  }

  public async stop(): Promise<void> {
    if (!this.running && this.status !== "conflict" && this.status !== "webhook_active") return;
    this.running = false;
    if (this.status !== "conflict" && this.status !== "webhook_active") {
      this.status = "stopped";
    }

    if (this.lockRelease) {
      try {
        this.lockRelease();
      } catch {
        // Abaikan
      }
      this.lockRelease = undefined;
    }

    if (this.abortController) {
      this.abortController.abort();
    }
    this.queue.stop();

    try {
      await this.pollPromise;
    } catch {
      // Abaikan abort error saat stop
    }
    this.logger("[Telegram] Adapter stopped");
  }

  private async setupMenuCommands(): Promise<void> {
    // 1. setMyCommands default (Bahasa Indonesia)
    const resId = await telegramSetMyCommands(this.token, {
      baseUrl: this.baseUrl,
      fetchFn: this.fetchFn,
      commands: DEFAULT_COMMANDS_ID,
    });
    if (!resId.ok) {
      this.logger(`[Telegram] setMyCommands (id) note: ${resId.error}`);
    }

    // 2. setMyCommands bahasa Inggris (language_code: "en")
    const resEn = await telegramSetMyCommands(this.token, {
      baseUrl: this.baseUrl,
      fetchFn: this.fetchFn,
      commands: DEFAULT_COMMANDS_EN,
      languageCode: "en",
    });
    if (!resEn.ok) {
      this.logger(`[Telegram] setMyCommands (en) note: ${resEn.error}`);
    }

    // 3. setChatMenuButton type: commands
    const resBtn = await telegramSetChatMenuButton(this.token, {
      baseUrl: this.baseUrl,
      fetchFn: this.fetchFn,
    });
    if (!resBtn.ok) {
      this.logger(`[Telegram] setChatMenuButton note: ${resBtn.error}`);
    }
  }

  private async pollLoop(): Promise<void> {
    let offset = this.state?.offset ?? 0;
    let isFirstPoll = true;

    while (this.running) {
      if (this.onPollCycle) {
        try {
          this.onPollCycle();
        } catch {
          // Abaikan
        }
      }

      try {
        const url = new URL(`${this.baseUrl}/bot${this.token}/getUpdates`);
        if (offset > 0) {
          url.searchParams.set("offset", String(offset));
        }
        url.searchParams.set("timeout", String(this.pollTimeoutSec));
        url.searchParams.set("allowed_updates", JSON.stringify(["message", "callback_query"]));

        const res = await this.fetchFn(url.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: this.abortController?.signal,
        });

        if (!this.running) break;

        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error_code?: number;
          description?: string;
          result?: TelegramUpdate[];
        };

        // Penanganan HTTP 409 Conflict: webhook aktif atau getUpdates ganda
        if (res.status === 409 || data.error_code === 409) {
          const desc = String(data.description ?? "").toLowerCase();
          if (desc.includes("webhook is active") || desc.includes("webhook")) {
            this.status = "webhook_active";
            this.running = false;
            let host = "";
            try {
              const info = await telegramGetWebhookInfo(this.token, {
                baseUrl: this.baseUrl,
                fetchFn: this.fetchFn,
              });
              if (info.ok && info.host) {
                host = info.host;
              }
            } catch {
              // Abaikan
            }
            this.webhookHost = host;
            const targetHost = host || "external host";
            this.logger(`[Telegram] This bot uses a webhook to <${targetHost}>. Use a dedicated bot, or run tahansoe gateway pair --delete-webhook`);
            break;
          }

          this.status = "conflict";
          this.running = false;
          this.logger("[Telegram] another Tahansoe agent is already polling this bot; pairing will be handled by it");
          break;
        }

        if (!res.ok || !data.ok) {
          const desc = data.description ? maskUrl(data.description, this.token) : `HTTP ${res.status}`;
          this.logger(`[Telegram] getUpdates error: ${desc}`);
          await this.delay(3000);
          continue;
        }

        const updates = data.result ?? [];
        if (updates.length === 0) {
          await this.delay(50);
        }
        for (const update of updates) {
          if (!this.running) break;

          // Perbarui offset agar update tidak terambil ulang
          offset = Math.max(offset, update.update_id + 1);
          if (this.state) {
            this.state.offset = offset;
            if (this.onStateUpdate) {
              await this.onStateUpdate(this.state).catch(() => {});
            }
          }

          // Abaikan update backlog dari sebelum startup (update.message.date < startup - 30s) pada poll pertama
          const msgDateSec = update.message?.date ?? update.callback_query?.message?.date;
          if (isFirstPoll && typeof msgDateSec === "number" && msgDateSec < this.startupTimeSec - 30) {
            this.logger(
              `[Telegram] Skipping backlog update ${update.update_id} (msg date ${msgDateSec} < startup ${this.startupTimeSec} - 30s)`,
            );
            continue;
          }

          // 1. Pesan chat biasa
          if (update.message && typeof update.message.text === "string" && this.messageHandler) {
            const inbound: InboundMessage = {
              channel: "telegram",
              chatId: String(update.message.chat.id),
              text: update.message.text,
              messageId: update.message.message_id,
              from: update.message.from
                ? {
                    id: update.message.from.id,
                    username: update.message.from.username,
                    firstName: update.message.from.first_name,
                    lastName: update.message.from.last_name,
                  }
                : undefined,
              date: update.message.date ? new Date(update.message.date * 1000) : new Date(),
            };

            this.messageHandler(inbound).catch((err) => {
              this.logger(`[Telegram] Message handling error: ${sanitizeError(err, this.token)}`);
            });
          }

          // 2. Callback query dari inline buttons
          if (update.callback_query && this.messageHandler) {
            const cq = update.callback_query;
            const chatId = String(cq.message?.chat.id ?? cq.from.id);
            const inbound: InboundMessage = {
              channel: "telegram",
              chatId,
              text: cq.data ?? "",
              messageId: cq.message?.message_id,
              from: {
                id: cq.from.id,
                username: cq.from.username,
                firstName: cq.from.first_name,
                lastName: cq.from.last_name,
              },
              date: new Date(),
              callbackQueryId: cq.id,
              callbackData: cq.data,
            };

            this.messageHandler(inbound).catch((err) => {
              this.logger(`[Telegram] Callback handling error: ${sanitizeError(err, this.token)}`);
            });
          }
        }
        isFirstPoll = false;
      } catch (err) {
        if (!this.running) break;
        const msg = sanitizeError(err, this.token);
        if (msg.includes("abort") || msg.includes("AbortError")) {
          break;
        }
        if ((err as any)?.status === 409 || (err as any)?.statusCode === 409 || msg.includes("409")) {
          const desc = msg.toLowerCase();
          if (desc.includes("webhook is active") || desc.includes("webhook")) {
            this.status = "webhook_active";
            this.running = false;
            let host = "";
            try {
              const info = await telegramGetWebhookInfo(this.token, {
                baseUrl: this.baseUrl,
                fetchFn: this.fetchFn,
              });
              if (info.ok && info.host) {
                host = info.host;
              }
            } catch {
              // Abaikan
            }
            this.webhookHost = host;
            const targetHost = host || "external host";
            this.logger(`[Telegram] This bot uses a webhook to <${targetHost}>. Use a dedicated bot, or run tahansoe gateway pair --delete-webhook`);
            break;
          }

          this.status = "conflict";
          this.running = false;
          this.logger("[Telegram] another Tahansoe agent is already polling this bot; pairing will be handled by it");
          break;
        }
        this.logger(`[Telegram] Polling connection error: ${msg}`);
        await this.delay(3000);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Tombol aksi cepat untuk /start dan /help.
 */
export function quickActionKeyboard(): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  return {
    inline_keyboard: [
      [
        { text: "Status", callback_data: "cmd:status" },
        { text: "Fuse", callback_data: "cmd:fuse" },
      ],
      [
        { text: "Carry", callback_data: "cmd:carry" },
        { text: "Alerts", callback_data: "cmd:alerts" },
      ],
    ],
  };
}

/**
 * Tombol aksi cepat untuk pesan alert proaktif (Detail & Bisukan 6 jam).
 */
export function alertActionKeyboard(alertType: string): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  return {
    inline_keyboard: [
      [
        { text: "Detail", callback_data: `detail:${alertType}` },
        { text: "Bisukan 6 jam", callback_data: `mute:${alertType}` },
      ],
    ],
  };
}
