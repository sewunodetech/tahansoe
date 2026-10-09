/**
 * Interface ChannelAdapter & pesan masuk gateway kanal.
 *
 * Mendefinisikan antarmuka seragam untuk kanal chat (Telegram, lalu WhatsApp/Discord/dApp).
 * Logika router, command, dan alert tidak terikat pada kanal spesifik (spec §1, §2).
 */

export interface InboundMessage {
  /** Nama kanal (mis. "telegram"). */
  channel: string;
  /** ID chat tujuan/sumber unik dalam kanal. */
  chatId: string;
  /** Teks pesan masuk (atau callback_data bila callback query). */
  text: string;
  /** ID pesan internal dari platform bila ada. */
  messageId?: string | number;
  /** Data pengirim opsional. */
  from?: {
    id: string | number;
    username?: string;
    firstName?: string;
    lastName?: string;
  };
  /** Waktu pesan dikirim. */
  date?: Date;
  /** ID callback query jika pesan berasal dari klik tombol inline. */
  callbackQueryId?: string;
  /** Payload callback_data jika pesan berasal dari tombol inline. */
  callbackData?: string;
}

export interface SendOptions {
  replyMarkup?: unknown;
}

export interface ChannelAdapter {
  /** Nama kanal unik. */
  readonly channelName: string;
  /** Mulai adapter (mis. long polling / listener). */
  start(): Promise<void>;
  /** Hentikan adapter secara anggun. */
  stop(): Promise<void>;
  /** Kirim pesan teks ke chat tertentu. */
  send(chatId: string, message: string, options?: SendOptions): Promise<void>;
  /** Jawab callback query dari inline button bila didukung kanal. */
  answerCallback?(callbackQueryId: string, text?: string): Promise<void>;
  /** Daftarkan callback penanganan pesan masuk. */
  onMessage(handler: (msg: InboundMessage) => Promise<void>): void;
}
