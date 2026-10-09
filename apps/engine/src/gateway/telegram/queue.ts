/**
 * Antrean Pengiriman Pesan Telegram Berbatas Kecepatan (Rate-Limited Message Queue).
 *
 * Batasan Telegram:
 *  - Maksimal 1 pesan / detik per chat (spacing >= 1000ms)
 *  - Maksimal 25-30 pesan / detik global (spacing >= 40ms)
 *  - Tangani HTTP 429 dengan backoff sesuai `parameters.retry_after`
 *  - Potong otomatis pesan > 4000 karakter menjadi potongan aman
 */

import { maskUrl, sanitizeError, DEFAULT_TELEGRAM_BASE_URL } from "./api.ts";
import { chunkMessage, formatSafePlainText } from "../core/formatter.ts";

export const SLOW_DOWN_NOTICE = "Slow down: rate limit reached. Please wait a moment.";
export const MAX_REPLIES_PER_10S = 5;
export const REPLY_CAP_WINDOW_MS = 10_000;
export const SLOW_DOWN_NOTICE_COOLDOWN_MS = 60_000;

export interface SendMessageOptions {
  parseMode?: "MarkdownV2" | "HTML";
  disableNotification?: boolean;
  replyMarkup?: unknown;
}

interface QueuedItem {
  chatId: string;
  text: string;
  options?: SendMessageOptions;
  resolve: () => void;
  reject: (err: Error) => void;
  retries: number;
}

export interface TelegramMessageQueueOptions {
  token: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  logger?: (msg: string) => void;
  minChatIntervalMs?: number; // default 1000ms (1 msg/sec per chat)
  minGlobalIntervalMs?: number; // default 40ms (25 msgs/sec global)
  maxRetries?: number; // default 1 (never retry loop)
}

export class TelegramMessageQueue {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly logger: (msg: string) => void;
  private readonly minChatIntervalMs: number;
  private readonly minGlobalIntervalMs: number;
  private readonly maxRetries: number;

  private queue: QueuedItem[] = [];
  private lastChatSendTime: Map<string, number> = new Map();
  private lastGlobalSendTime = 0;
  private processing = false;
  private stopped = false;

  private chatRecentSends: Map<string, number[]> = new Map();
  private lastSlowDownNotice: Map<string, number> = new Map();
  private chatPausedUntil: Map<string, number> = new Map();

  constructor(options: TelegramMessageQueueOptions) {
    this.token = options.token.trim();
    this.baseUrl = options.baseUrl ?? DEFAULT_TELEGRAM_BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
    this.logger = options.logger ?? (() => {});
    this.minChatIntervalMs = options.minChatIntervalMs ?? 1000;
    this.minGlobalIntervalMs = options.minGlobalIntervalMs ?? 40;
    this.maxRetries = options.maxRetries ?? 1;
  }

  public stop(): void {
    this.stopped = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      item?.reject(new Error("Telegram queue stopped"));
    }
  }

  /**
   * Kirim pesan teks ke sebuah chat (antre & kirim secara aman sesuai batas rate limit).
   */
  public async enqueue(
    chatId: string,
    text: string,
    options?: SendMessageOptions,
    isInternalNotice = false,
  ): Promise<void> {
    if (this.stopped) {
      throw new Error("Telegram queue is stopped");
    }

    const safeText = formatSafePlainText(text);
    if (!safeText) return;

    const idStr = String(chatId).trim();
    const now = Date.now();

    // Per-chat reply cap: max 5 replies per chat per 10s (kecuali pesan notice internal)
    if (!isInternalNotice) {
      const sends = (this.chatRecentSends.get(idStr) ?? []).filter((t) => now - t < REPLY_CAP_WINDOW_MS);
      this.chatRecentSends.set(idStr, sends);

      if (sends.length >= MAX_REPLIES_PER_10S) {
        this.logger?.(
          `[Telegram] Rate cap reached for chat ${idStr} (${MAX_REPLIES_PER_10S} replies in 10s). Dropping message.`,
        );
        const lastNotice = this.lastSlowDownNotice.get(idStr) ?? 0;
        if (now - lastNotice >= SLOW_DOWN_NOTICE_COOLDOWN_MS) {
          this.lastSlowDownNotice.set(idStr, now);
          void this.enqueue(idStr, SLOW_DOWN_NOTICE, undefined, true);
        }
        return;
      }
      sends.push(now);
    }

    const chunks = chunkMessage(safeText, 4000);

    for (const chunk of chunks) {
      await new Promise<void>((resolve, reject) => {
        this.queue.push({
          chatId: idStr,
          text: chunk,
          options,
          resolve,
          reject,
          retries: 0,
        });
        void this.processNext();
      });
    }
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.stopped || this.queue.length === 0) {
      return;
    }
    this.processing = true;

    try {
      while (this.queue.length > 0 && !this.stopped) {
        // Cari item pertama yang siap dikirim menurut batas chat rate limit dan status pause 429
        const now = Date.now();
        let targetIdx = -1;
        let earliestWait = this.minChatIntervalMs;

        for (let i = 0; i < this.queue.length; i++) {
          const item = this.queue[i]!;
          const pausedUntil = this.chatPausedUntil.get(item.chatId) ?? 0;
          if (now < pausedUntil) {
            earliestWait = Math.min(earliestWait, pausedUntil - now);
            continue;
          }

          const lastChat = this.lastChatSendTime.get(item.chatId) ?? 0;
          if (now - lastChat >= this.minChatIntervalMs) {
            targetIdx = i;
            break;
          } else {
            earliestWait = Math.min(earliestWait, this.minChatIntervalMs - (now - lastChat));
          }
        }

        if (targetIdx === -1) {
          // Semua item yang ada masih tertahan per-chat rate limit / pause 429
          await this.delay(Math.max(10, earliestWait));
          continue;
        }

        // Cek batas rate limit global
        const globalElapsed = Date.now() - this.lastGlobalSendTime;
        if (globalElapsed < this.minGlobalIntervalMs) {
          await this.delay(this.minGlobalIntervalMs - globalElapsed);
        }

        const item = this.queue.splice(targetIdx, 1)[0]!;
        await this.dispatchItem(item);
      }
    } finally {
      this.processing = false;
    }
  }

  private async dispatchItem(item: QueuedItem): Promise<void> {
    const endpoint = `${this.baseUrl}/bot${this.token}/sendMessage`;

    const body: Record<string, unknown> = {
      chat_id: item.chatId,
      text: item.text,
    };
    if (item.options?.parseMode) {
      body.parse_mode = item.options.parseMode;
    }
    if (item.options?.disableNotification) {
      body.disable_notification = true;
    }
    if (item.options?.replyMarkup) {
      body.reply_markup = item.options.replyMarkup;
    }

    try {
      const res = await this.fetchFn(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        description?: string;
        error_code?: number;
        parameters?: { retry_after?: number };
      };

      if (res.status === 429 || data.error_code === 429) {
        const retryAfterSec = data.parameters?.retry_after ?? 1;
        const pauseUntil = Date.now() + retryAfterSec * 1000;
        this.chatPausedUntil.set(item.chatId, pauseUntil);
        this.logger(`[Telegram] Rate limited (429), pausing chat ${item.chatId} for ${retryAfterSec}s`);

        if (item.retries < this.maxRetries) {
          item.retries += 1;
          this.queue.unshift(item);
          return;
        } else {
          item.reject(new Error(`Telegram rate limit exceeded after ${this.maxRetries} retries`));
          return;
        }
      }

      if (!res.ok || !data.ok) {
        const desc = data.description ? maskUrl(data.description, this.token) : `HTTP ${res.status}`;
        item.reject(new Error(`Telegram sendMessage failed: ${desc}`));
        return;
      }

      this.lastChatSendTime.set(item.chatId, Date.now());
      this.lastGlobalSendTime = Date.now();
      item.resolve();
    } catch (err) {
      const maskedErr = sanitizeError(err, this.token);
      if (item.retries < this.maxRetries) {
        item.retries += 1;
        this.logger(`[Telegram] Network error sending to ${item.chatId}: ${maskedErr}, retrying...`);
        await this.delay(1000);
        this.queue.unshift(item);
      } else {
        item.reject(new Error(`Failed to send message: ${maskedErr}`));
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
