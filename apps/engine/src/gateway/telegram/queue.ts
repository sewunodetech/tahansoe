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
  maxRetries?: number; // default 5
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

  constructor(options: TelegramMessageQueueOptions) {
    this.token = options.token.trim();
    this.baseUrl = options.baseUrl ?? DEFAULT_TELEGRAM_BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
    this.logger = options.logger ?? (() => {});
    this.minChatIntervalMs = options.minChatIntervalMs ?? 1000;
    this.minGlobalIntervalMs = options.minGlobalIntervalMs ?? 40;
    this.maxRetries = options.maxRetries ?? 5;
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
  public async enqueue(chatId: string, text: string, options?: SendMessageOptions): Promise<void> {
    if (this.stopped) {
      throw new Error("Telegram queue is stopped");
    }

    const safeText = formatSafePlainText(text);
    if (!safeText) return;

    const chunks = chunkMessage(safeText, 4000);

    for (const chunk of chunks) {
      await new Promise<void>((resolve, reject) => {
        this.queue.push({
          chatId: String(chatId).trim(),
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
        // Cari item pertama yang siap dikirim menurut batas chat rate limit
        const now = Date.now();
        let targetIdx = -1;

        for (let i = 0; i < this.queue.length; i++) {
          const item = this.queue[i]!;
          const lastChat = this.lastChatSendTime.get(item.chatId) ?? 0;
          if (now - lastChat >= this.minChatIntervalMs) {
            targetIdx = i;
            break;
          }
        }

        if (targetIdx === -1) {
          // Semua item yang ada masih tertahan per-chat rate limit, tunggu item paling awal siap
          const earliestItem = this.queue[0]!;
          const lastTime = this.lastChatSendTime.get(earliestItem.chatId) ?? 0;
          const waitChat = Math.max(10, this.minChatIntervalMs - (Date.now() - lastTime));
          await this.delay(waitChat);
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
        this.logger(`[Telegram] Rate limited (429), retry after ${retryAfterSec}s for chat ${item.chatId}`);

        if (item.retries < this.maxRetries) {
          item.retries += 1;
          await this.delay(retryAfterSec * 1000);
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
