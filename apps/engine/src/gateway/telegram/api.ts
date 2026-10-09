/**
 * Klien Telegram Bot API HTTP langsung & fungsi pembantu keamanan (spec m3-channel-gateway §2, §7).
 *
 * Invarian Keamanan (security.md I8):
 *  - Token bot TIDAK PERNAH dicetak ke log atau error.
 *  - URL Bot API yang memuat token disamarkan (maskUrl / maskToken).
 */

export const DEFAULT_TELEGRAM_BASE_URL = "https://api.telegram.org";

/**
 * Samarkan token bot (hanya menampilkan penanda aman atau sedikit awalan/akhiran bila perlu).
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
  // Ganti pola api.telegram.org/bot<TOKEN>
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

export interface TelegramGetMeResult {
  ok: boolean;
  username?: string;
  error?: string;
}

export interface TelegramApiOptions {
  fetchFn?: typeof fetch;
  baseUrl?: string;
}

/**
 * Panggil getMe Telegram Bot API untuk memverifikasi token bot (dipakai setup & gateway).
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

export interface TelegramBotCommand {
  command: string;
  description: string;
}

export const DEFAULT_COMMANDS_ID: TelegramBotCommand[] = [
  { command: "status", description: "Status regime pasar & sinyal aktif" },
  { command: "fuse", description: "Jalankan satu putaran Risk Fusion" },
  { command: "carry", description: "Monitor suku bunga & carry Aave V3" },
  { command: "report", description: "Lihat kartu laporan riset terbaru" },
  { command: "history", description: "Riwayat laporan riset risiko" },
  { command: "alerts", description: "Atur preferensi jenis notifikasi alert" },
  { command: "subscribe", description: "Aktifkan notifikasi alert proaktif" },
  { command: "unsubscribe", description: "Nonaktifkan notifikasi alert proaktif" },
  { command: "help", description: "Bantuan dan panduan perintah" },
];

export const DEFAULT_COMMANDS_EN: TelegramBotCommand[] = [
  { command: "status", description: "Market regime & active risk signals" },
  { command: "fuse", description: "Run one Risk Fusion pass" },
  { command: "carry", description: "Aave V3 carry & interest monitor" },
  { command: "report", description: "View latest research report card" },
  { command: "history", description: "Recent research reports table" },
  { command: "alerts", description: "Configure proactive alert preferences" },
  { command: "subscribe", description: "Enable proactive risk notifications" },
  { command: "unsubscribe", description: "Mute proactive risk notifications" },
  { command: "help", description: "Command manual and guide" },
];

/**
 * Daftarkan daftar perintah bot ke Telegram (setMyCommands).
 * Idempoten; kegagalan tidak memblokir gateway.
 */
export async function telegramSetMyCommands(
  token: string,
  options: TelegramApiOptions & { commands?: TelegramBotCommand[]; languageCode?: string } = {},
): Promise<{ ok: boolean; error?: string }> {
  const fetchFn = options.fetchFn ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_TELEGRAM_BASE_URL;
  const cleanToken = token.trim();
  if (!cleanToken) return { ok: false, error: "Empty token" };

  const endpoint = `${baseUrl}/bot${cleanToken}/setMyCommands`;
  const body: Record<string, unknown> = {
    commands: options.commands ?? DEFAULT_COMMANDS_ID,
  };
  if (options.languageCode) {
    body.language_code = options.languageCode;
  }

  try {
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.description ? maskUrl(data.description, cleanToken) : `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: sanitizeError(err, cleanToken) };
  }
}

/**
 * Set tombol menu chat menjadi daftar perintah (setChatMenuButton type: commands).
 * Idempoten.
 */
export async function telegramSetChatMenuButton(
  token: string,
  options: TelegramApiOptions = {},
): Promise<{ ok: boolean; error?: string }> {
  const fetchFn = options.fetchFn ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_TELEGRAM_BASE_URL;
  const cleanToken = token.trim();
  if (!cleanToken) return { ok: false, error: "Empty token" };

  const endpoint = `${baseUrl}/bot${cleanToken}/setChatMenuButton`;
  const body = {
    menu_button: { type: "commands" },
  };

  try {
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.description ? maskUrl(data.description, cleanToken) : `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: sanitizeError(err, cleanToken) };
  }
}

/**
 * Jawab callback query dari tombol inline (answerCallbackQuery).
 */
export async function telegramAnswerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  options: TelegramApiOptions = {},
): Promise<{ ok: boolean; error?: string }> {
  const fetchFn = options.fetchFn ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_TELEGRAM_BASE_URL;
  const cleanToken = token.trim();
  if (!cleanToken) return { ok: false, error: "Empty token" };

  const endpoint = `${baseUrl}/bot${cleanToken}/answerCallbackQuery`;
  const body: Record<string, unknown> = {
    callback_query_id: callbackQueryId,
  };
  if (text) {
    body.text = text;
  }

  try {
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.description ? maskUrl(data.description, cleanToken) : `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: sanitizeError(err, cleanToken) };
  }
}
