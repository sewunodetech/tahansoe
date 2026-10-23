/**
 * Implementasi TelegramSender menggunakan antrean pesan rate-limited.
 */

import { TelegramMessageQueue, type TelegramMessageQueueOptions } from "./queue.ts";
import type { TelegramSender, SendOptions } from "./types.ts";

export interface CreateTelegramSenderOptions extends Partial<TelegramMessageQueueOptions> {
  token: string;
}

export class QueueTelegramSender implements TelegramSender {
  private readonly queue: TelegramMessageQueue;

  constructor(options: CreateTelegramSenderOptions) {
    this.queue = new TelegramMessageQueue({
      token: options.token,
      baseUrl: options.baseUrl,
      fetchFn: options.fetchFn,
      logger: options.logger,
      minChatIntervalMs: options.minChatIntervalMs,
      minGlobalIntervalMs: options.minGlobalIntervalMs,
      maxRetries: options.maxRetries,
    });
  }

  public async send(
    chatId: string | number | bigint,
    html: string,
    options?: SendOptions,
  ): Promise<void> {
    await this.queue.enqueue(chatId, html, {
      parseMode: options?.parseMode ?? "HTML",
      disableNotification: options?.disableNotification,
      replyMarkup: options?.replyMarkup,
    });
  }

  public stop(): void {
    this.queue.stop();
  }
}

export function createTelegramSender(options: CreateTelegramSenderOptions): QueueTelegramSender {
  return new QueueTelegramSender(options);
}
