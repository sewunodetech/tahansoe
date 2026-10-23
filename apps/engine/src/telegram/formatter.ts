/**
 * Formatter Pesan Aman untuk Kanal Telegram Outbound (spec m3-research-broadcast).
 *
 * Mencegah injeksi format MarkdownV2/HTML, escape sequence ANSI, kontrol karakter berbahaya.
 */

import { redactInstructions } from "../llm/redact.ts";

/**
 * Karakter khusus Telegram MarkdownV2 yang wajib di-escape jika bukan bagian dari format sah:
 * _ * [ ] ( ) ~ ` > # + - = | { } . ! \
 */
const MARKDOWN_V2_RESERVED = /[_*[\]()~`>#+\-=|{}.!\\]/g;

/** ANSI escape codes */
const ANSI_OSC = /\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g;
const ANSI_CSI = /\x1b\[[0-9:;<=>?]*[ -/]*[@-~]/g;
const ANSI_ST = /\x1b[\\^_]/g;
const CTRL_EXCEPT_NL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * Escape teks untuk HTML Telegram (hanya karakter sensitif HTML: &, <, >).
 */
export function escapeHtml(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Escape semua karakter khusus Telegram MarkdownV2.
 */
export function escapeMarkdownV2(text: unknown): string {
  const str = String(text ?? "");
  return str.replace(MARKDOWN_V2_RESERVED, "\\$&");
}

/**
 * Hapus escape ANSI & kontrol karakter.
 */
export function stripAnsiAndControl(text: unknown): string {
  let s = String(text ?? "");
  s = s.replace(ANSI_OSC, "").replace(ANSI_CSI, "").replace(ANSI_ST, "");
  s = s.replace(CTRL_EXCEPT_NL, "");
  return s;
}

/**
 * Format string menjadi plain text aman:
 * 1. Sanitasi ANSI & kontrol karakter
 * 2. Redaksi instruksi model tersisip (security I5)
 */
export function formatSafePlainText(text: unknown): string {
  const sanitized = stripAnsiAndControl(text);
  const redacted = redactInstructions(sanitized);
  return redacted.trim();
}

/**
 * Format string menjadi MarkdownV2 aman.
 */
export function formatSafeMarkdownV2(text: unknown): string {
  const plain = formatSafePlainText(text);
  return escapeMarkdownV2(plain);
}

/**
 * Potong teks menjadi potongan pesan dengan panjang maksimal aman untuk Telegram (maks 4096 char).
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
      splitIdx = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIdx === -1 || splitIdx < maxLength * 0.4) {
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
