/**
 * Antrean Pengiriman Pesan Telegram Berbatas Kecepatan Outbound (spec m3-research-broadcast).
 *
 * Batasan Telegram:
 *  - Maksimal 1 pesan / detik per chat (spacing >= 1000ms)
 *  - Maksimal 25 pesan / detik global (spacing >= 40ms)
 *  - Tangani HTTP 429 dengan backoff sesuai parameters.retry_after
 *  - Deteksi 403 / "chat not found" -> tolak dengan isBlockedOrNotFound = true
 *  - Potong otomatis pesan panjang menjadi potongan aman
 */

import { maskUrl, sanitizeError, DEFAULT_TELEGRAM_BASE_URL } from "./api.ts";
import { chunkMessage, stripAnsiAndControl } from "./formatter.ts";
import { TelegramApiError, type SendOptions } from "./types.ts";

interface QueuedItem {
  chatId: string;
  text: string;
  options?: SendOptions;
  resolve: () => void;
  reject: (err: Error) => void;
  retries: number;
}

export interface TelegramMessageQueueOptions {
  token: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  logger?: (msg: string) => void;
  minChatIntervalMs?: number; // default 1000ms
  minGlobalIntervalMs?: number; // default 40ms (25 msgs/sec global)
  maxRetries?: number; // default 1
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

  private chatPausedUntil: Map<string, number> = new Map();
  private globalPausedUntil = 0;

  constructor(options: TelegramMessageQueueOptions) {
    this.token = options.token.trim();
    this.baseUrl = options.baseUrl ?? DEFAULT_TELEGRAM_BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
    this.logger = options.logger ?? (() => {});
    this.minChatIntervalMs = options.minChatIntervalMs ?? 1000;
    this.minGlobalIntervalMs = options.minGlobalIntervalMs ?? 40; // 25 msg/s
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
   * Kirim pesan ke antrean secara aman sesuai rate limit.
   */
  public async enqueue(
    chatId: string | number | bigint,
    text: string,
    options?: SendOptions,
  ): Promise<void> {
    if (this.stopped) {
      throw new Error("Telegram queue is stopped");
    }

    const cleanedText = stripAnsiAndControl(text).trim();
    if (!cleanedText) return;

    const idStr = String(chatId).trim();
    const chunks = chunkMessage(cleanedText, 4000);

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
        const now = Date.now();

        // Cek apakah ada pause global karena 429
        if (now < this.globalPausedUntil) {
          const waitTime = Math.min(this.globalPausedUntil - now, 5000);
          await this.delay(Math.max(10, waitTime));
          continue;
        }

        // Cari item yang siap dikirim
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
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        description?: string;
        error_code?: number;
        parameters?: { retry_after?: number };
      };

      const statusCode = res.status;
      const errorCode = data.error_code ?? statusCode;
      const desc = data.description ? maskUrl(data.description, this.token) : `HTTP ${statusCode}`;

      // Deteksi 429 Too Many Requests
      if (statusCode === 429 || errorCode === 429) {
        const retryAfterSec = data.parameters?.retry_after ?? 1;
        const pauseUntil = Date.now() + retryAfterSec * 1000;
        this.chatPausedUntil.set(item.chatId, pauseUntil);
        this.globalPausedUntil = Math.max(this.globalPausedUntil, Date.now() + 500);
        this.logger(`[Telegram] Rate limited (429), pausing chat ${item.chatId} for ${retryAfterSec}s`);

        if (item.retries < this.maxRetries) {
          item.retries += 1;
          this.queue.unshift(item);
          return;
        } else {
          item.reject(new TelegramApiError(`Telegram rate limit exceeded after ${this.maxRetries} retries`, statusCode, errorCode, desc, false));
          return;
        }
      }

      // Deteksi 403 / blocked / chat not found
      const isBlockedOrNotFound =
        statusCode === 403 ||
        errorCode === 403 ||
        /chat not found|bot was blocked|user is deactivated|bot can't initiate conversation/i.test(desc);

      if (!res.ok || !data.ok) {
        item.reject(new TelegramApiError(`Telegram sendMessage failed: ${desc}`, statusCode, errorCode, desc, isBlockedOrNotFound));
        return;
      }

      this.lastChatSendTime.set(item.chatId, Date.now());
      this.lastGlobalSendTime = Date.now();
      item.resolve();
    } catch (err) {
      if (err instanceof TelegramApiError) {
        item.reject(err);
        return;
      }
      const maskedErr = sanitizeError(err, this.token);
      if (item.retries < this.maxRetries) {
        item.retries += 1;
        this.logger(`[Telegram] Network error sending to ${item.chatId}: ${maskedErr}, retrying...`);
        await this.delay(500);
        this.queue.unshift(item);
      } else {
        item.reject(new TelegramApiError(`Failed to send message: ${maskedErr}`));
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
