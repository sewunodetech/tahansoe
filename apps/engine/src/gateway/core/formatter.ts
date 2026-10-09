/**
 * Formatter Pesan Aman untuk Kanal Chat (Telegram / dApp).
 *
 * Mencegah injeksi format MarkdownV2, escape sequence terminal ANSI,
 * kontrol karakter berbahaya, dan instruksi tersisip (prompt injection redaction).
 */

import { redactInstructions } from "../../llm/redact.ts";
import { sanitizeChatOutput } from "../../cli/repl/chat.ts";

/**
 * Karakter khusus Telegram MarkdownV2 yang wajib di-escape jika bukan bagian dari format sah:
 * _ * [ ] ( ) ~ ` > # + - = | { } . ! \
 */
const MARKDOWN_V2_RESERVED = /[_*[\]()~`>#+\-=|{}.!\\]/g;

/**
 * Escape semua karakter khusus Telegram MarkdownV2 agar tidak memicu error parsing atau injeksi format.
 */
export function escapeMarkdownV2(text: unknown): string {
  const str = String(text ?? "");
  return str.replace(MARKDOWN_V2_RESERVED, "\\$&");
}

/**
 * Format string menjadi plain text yang aman untuk dikirim tanpa parse_mode:
 * 1. Sanitasi ANSI & kontrol karakter (kecuali \n \t)
 * 2. Redaksi instruksi model tersisip (security I5/I7)
 */
export function formatSafePlainText(text: unknown): string {
  const sanitized = sanitizeChatOutput(text);
  const redacted = redactInstructions(sanitized);
  return redacted.trim();
}

/**
 * Format string menjadi MarkdownV2 aman (semua karakter khusus di-escape setelah disanitasi).
 */
export function formatSafeMarkdownV2(text: unknown): string {
  const plain = formatSafePlainText(text);
  return escapeMarkdownV2(plain);
}

/**
 * Potong teks menjadi potongan pesan dengan panjang maksimal yang aman untuk Telegram (maks 4096 char).
 * Pemotongan dilakukan pada batas newline jika memungkinkan.
 */
export function chunkMessage(text: string, maxLength = 4000): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Cari batas baris terdekat sebelum batas maxLength
    let splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx === -1 || splitIdx < maxLength * 0.4) {
      // Jika tidak ada newline yang wajar, coba spasi
      splitIdx = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIdx === -1 || splitIdx < maxLength * 0.4) {
      // Jika tetap tidak ada, potong tepat di maxLength
      splitIdx = maxLength;
    }

    const chunk = remaining.slice(0, splitIdx).trimEnd();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}
