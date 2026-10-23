/**
 * Klien Telegram Bot API HTTP outbound-only & helper keamanan (spec m3-research-broadcast).
 *
 * Invarian Keamanan (security.md I8):
 *  - Token bot TIDAK PERNAH dicetak ke log atau error.
 *  - URL Bot API yang memuat token disamarkan (maskUrl / maskToken).
 *
 * Batasan:
 *  - OUTBOUND ONLY: tidak ada getUpdates, setWebhook, deleteWebhook.
 */

import { TelegramApiError, type SendOptions } from "./types.ts";

export const DEFAULT_TELEGRAM_BASE_URL = "https://api.telegram.org";

/**
 * Samarkan token bot (hanya menampilkan penanda aman atau sedikit awalan/akhiran).
 * Tidak pernah membocorkan token rahasia.
 */
export function maskToken(token: string): string {
  const trimmed = String(token ?? "").trim();
  if (!trimmed) return "(empty token)";
  if (trimmed.length <= 8) return "[REDACTED]";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-3)}`;
}

/**
 * Samarkan token dalam URL Telegram Bot API (ganti /bot<token>/ menjadi /bot[REDACTED]/).
 */
export function maskUrl(url: string, knownToken?: string): string {
  let s = String(url ?? "");
  if (knownToken && knownToken.length > 4) {
    s = s.replaceAll(knownToken, "[REDACTED_TOKEN]");
  }
  s = s.replace(/\/bot[^/]+/gi, "/bot[REDACTED]");
  return s;
}

/**
 * Bersihkan string error agar tidak memuat token dalam bentuk apa pun.
 */
export function sanitizeError(err: unknown, token?: string): string {
  const msg = err instanceof Error ? err.message : String(err ?? "Unknown error");
  return maskUrl(msg, token);
}

export interface TelegramApiOptions {
  fetchFn?: typeof fetch;
  baseUrl?: string;
}

export interface TelegramGetMeResult {
  ok: boolean;
  username?: string;
  error?: string;
}

/**
 * Panggil getMe Telegram Bot API untuk memverifikasi token bot secara aman.
 */
export async function telegramGetMe(
  token: string,
  options: TelegramApiOptions = {},
): Promise<TelegramGetMeResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_TELEGRAM_BASE_URL;

  const cleanToken = token.trim();
  if (!cleanToken) {
    return { ok: false, error: "Telegram bot token is empty" };
  }

  const endpoint = `${baseUrl}/bot${cleanToken}/getMe`;

  try {
    const res = await fetchFn(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: { username?: string };
    };

    if (!res.ok || !data.ok) {
      const desc = data.description ? maskUrl(data.description, cleanToken) : `HTTP ${res.status}`;
      return { ok: false, error: `getMe failed: ${desc}` };
    }

    return {
      ok: true,
      username: data.result?.username,
    };
  } catch (err) {
    return {
      ok: false,
      error: `getMe connection error: ${sanitizeError(err, cleanToken)}`,
    };
  }
}

export interface SendMessageResult {
  ok: boolean;
  messageId?: number;
  error?: string;
  errorCode?: number;
  retryAfter?: number;
  isBlockedOrNotFound?: boolean;
}

/**
 * Kirim pesan teks / HTML ke Telegram Bot API (sendMessage).
 */
export async function telegramSendMessage(
  token: string,
  chatId: string | number | bigint,
  text: string,
  sendOpts?: SendOptions,
  apiOpts: TelegramApiOptions = {},
): Promise<SendMessageResult> {
  const fetchFn = apiOpts.fetchFn ?? fetch;
  const baseUrl = apiOpts.baseUrl ?? DEFAULT_TELEGRAM_BASE_URL;
  const cleanToken = token.trim();

  if (!cleanToken) {
    throw new TelegramApiError("Telegram bot token is empty");
  }

  const endpoint = `${baseUrl}/bot${cleanToken}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: String(chatId),
    text,
  };
  if (sendOpts?.parseMode) {
    body.parse_mode = sendOpts.parseMode;
  }
  if (sendOpts?.disableNotification) {
    body.disable_notification = true;
  }
  if (sendOpts?.replyMarkup) {
    body.reply_markup = sendOpts.replyMarkup;
  }

  try {
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      error_code?: number;
      parameters?: { retry_after?: number };
      result?: { message_id?: number };
    };

    const status = res.status;
    const errorCode = data.error_code ?? status;
    const desc = data.description ? maskUrl(data.description, cleanToken) : `HTTP ${status}`;

    // Deteksi blocked atau chat not found: 403 atau description relevan
    const isBlockedOrNotFound =
      status === 403 ||
      errorCode === 403 ||
      /chat not found|bot was blocked|user is deactivated|bot can't initiate conversation/i.test(desc);

    if (status === 429 || errorCode === 429) {
      return {
        ok: false,
        error: desc,
        errorCode: 429,
        retryAfter: data.parameters?.retry_after ?? 1,
      };
    }

    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: desc,
        errorCode,
        isBlockedOrNotFound,
      };
    }

    return {
      ok: true,
      messageId: data.result?.message_id,
    };
  } catch (err) {
    const masked = sanitizeError(err, cleanToken);
    return {
      ok: false,
      error: masked,
    };
  }
}
