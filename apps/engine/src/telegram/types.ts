/**
 * Tipe & antarmuka pengiriman Telegram outbound (spec m3-research-broadcast).
 */

export interface SendOptions {
  parseMode?: "HTML" | "MarkdownV2";
  disableNotification?: boolean;
  replyMarkup?: unknown;
}

export class TelegramApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly errorCode?: number,
    public readonly description?: string,
    public readonly isBlockedOrNotFound: boolean = false,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

export interface TelegramSender {
  /**
   * Kirim pesan HTML atau format lain ke chat tertentu.
   */
  send(
    chatId: string | number | bigint,
    html: string,
    options?: SendOptions,
  ): Promise<void>;
}
