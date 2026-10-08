/**
 * Adapter GDELT DOC 2.0 API untuk mengumpulkan berita geopolitik dan makro.
 *
 * Mengambil artikel 24 jam terakhir yang berkaitan dengan kata kunci risiko crypto:
 * war, missile, sanctions, tariff, Federal Reserve, bank collapse, stablecoin depeg, exchange hack.
 *
 * Invarian:
 *  - Konten berita eksternal diperlakukan sebagai DATA, bukan instruksi (Invariant #5).
 *  - Graceful degradation: timeout / rate limit menghasilkan warning tanpa throw (I6).
 *  - Timeout minimal 30 detik (default 35 detik) untuk mengakomodasi latensi GDELT.
 *  - Deteksi respons teks rate limit ("Please limit requests to one every 5 seconds").
 *  - Maksimal satu retry setelah jeda >= 6 detik jika terkena timeout atau rate limit.
 */

import { createHash } from "node:crypto";
import { Agent, setGlobalDispatcher } from "undici";
import type { ContextMarketEvent } from "../agents/context.ts";

/** Timeout default untuk pemanggilan GDELT DOC 2.0 API (minimal 30s). */
export const DEFAULT_GDELT_TIMEOUT_MS = 35_000;

/** Jeda retry jika terkena rate limit (minimal 6s). */
export const GDELT_RATE_LIMIT_DELAY_MS = 6_500;

let dispatcherConfigured = false;
function ensureUndiciConnectTimeout(): void {
  if (!dispatcherConfigured && typeof setGlobalDispatcher === "function") {
    try {
      setGlobalDispatcher(new Agent({ connect: { timeout: 40_000 } }));
      dispatcherConfigured = true;
    } catch {
      // Abaikan jika env melarang override dispatcher
    }
  }
}

export interface GdeltOptions {
  /** Jendela waktu ke belakang dalam jam (default: 24). */
  lookbackHours?: number;
  /** Batas waktu pemanggilan dalam ms (default: DEFAULT_GDELT_TIMEOUT_MS = 35_000). */
  timeoutMs?: number;
  /** Custom fetch function untuk pengujian dengan fixture. */
  fetchFn?: typeof fetch;
  /** Query kustom jika diperlukan override. */
  query?: string;
  now?: Date;
}

export interface GdeltArticleRaw {
  url?: string;
  url_mobile?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
}

export interface GdeltApiResponse {
  articles?: GdeltArticleRaw[];
}

const DEFAULT_KEYWORDS = [
  "war",
  "missile",
  "sanctions",
  "tariff",
  '"Federal Reserve"',
  '"bank collapse"',
  '"stablecoin depeg"',
  '"exchange hack"',
];

/**
 * Normalisasi judul untuk perbandingan deduplikasi.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse timestamp format GDELT: YYYYMMDDTHHMMSSZ ke Date.
 */
function parseGdeltDate(seendate?: string): Date {
  if (!seendate || seendate.length < 15) return new Date();
  const year = seendate.slice(0, 4);
  const month = seendate.slice(4, 6);
  const day = seendate.slice(6, 8);
  const hour = seendate.slice(9, 11);
  const min = seendate.slice(11, 13);
  const sec = seendate.slice(13, 15);
  const iso = `${year}-${month}-${day}T${hour}:${min}:${sec}Z`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Klasifikasi kategori event dari kata kunci dalam judul.
 */
function inferCategory(title: string): string {
  const lower = title.toLowerCase();
  if (
    /\b(wars?|missiles?|military|strikes?|conflicts?|attacks?|troops|gaza|israel|iran|russia|ukraine)\b/.test(
      lower,
    )
  ) {
    return "GEOPOLITICS";
  }
  if (/\b(tariffs?|trades?|sanctions?|embargo(es)?)\b/.test(lower)) {
    return "TRADE_POLICY";
  }
  if (
    /\b(federal reserve|fed|inflation|rate cuts?|rate hikes?|cpi|central banks?)\b/.test(
      lower,
    )
  ) {
    return "MACRO";
  }
  if (/\b(stablecoins?|depeg|usdc|usdt|tether)\b/.test(lower)) {
    return "STABLECOIN";
  }
  if (
    /\b(hacks?|exploits?|collapse|bankrupt|insolvent|exchanges?)\b/.test(lower)
  ) {
    return "PROTOCOL_RISK";
  }
  return "GENERAL_NEWS";
}

/**
 * Normalisasi artikel mentah GDELT ke ContextMarketEvent dengan deduplikasi URL dan judul.
 */
export function normalizeGdeltArticles(
  articles: GdeltArticleRaw[],
): ContextMarketEvent[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const events: ContextMarketEvent[] = [];

  for (const art of articles) {
    const rawUrl = art.url?.trim();
    const rawTitle = art.title?.trim();
    if (!rawUrl || !rawTitle) continue;

    // Dedup URL
    if (seenUrls.has(rawUrl)) continue;
    seenUrls.add(rawUrl);

    // Dedup judul yang serupa
    const normTitle = normalizeTitle(rawTitle);
    if (normTitle.length < 5 || seenTitles.has(normTitle)) continue;
    seenTitles.add(normTitle);

    const id = `gdelt-${createHash("sha256").update(rawUrl).digest("hex").slice(0, 12)}`;
    const category = inferCategory(rawTitle);
    const publishedAt = parseGdeltDate(art.seendate);
    const excerpt = `Source: ${art.domain || "unknown"} (${art.sourcecountry || "global"}). Language: ${art.language || "en"}`;

    events.push({
      id,
      headline: rawTitle,
      category,
      publishedAt,
      excerpt,
    });
  }

  return events;
}

type SingleFetchResult =
  | { kind: "ok"; data: GdeltApiResponse }
  | { kind: "rate_limited"; text: string }
  | { kind: "non_json"; text: string; status: number }
  | { kind: "error"; message: string; isTimeout: boolean };

async function performSingleFetch(
  url: string,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<SingleFetchResult> {
  ensureUndiciConnectTimeout();

  try {
    const res = await fetchFn(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: "application/json",
        "User-Agent":
          "TahansoeRiskEngine/0.1 (+https://github.com/tahansoe/engine)",
      },
    });

    const rawText = await res.text();

    // Deteksi pesan rate limit khas GDELT
    if (
      res.status === 429 ||
      rawText.includes("Please limit requests to one every 5 seconds") ||
      rawText.toLowerCase().includes("rate limit")
    ) {
      return { kind: "rate_limited", text: rawText };
    }

    if (!res.ok) {
      return {
        kind: "non_json",
        text: `HTTP ${res.status}: ${res.statusText}`,
        status: res.status,
      };
    }

    // Deteksi jika respon bukan JSON (mis. teks peringatan lain)
    if (!rawText.trim().startsWith("{")) {
      return {
        kind: "non_json",
        text: rawText.slice(0, 150),
        status: res.status,
      };
    }

    try {
      const data = JSON.parse(rawText) as GdeltApiResponse;
      return { kind: "ok", data };
    } catch {
      return {
        kind: "non_json",
        text: rawText.slice(0, 150),
        status: res.status,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout =
      message.includes("timeout") ||
      message.includes("aborted") ||
      message.includes("Connect Timeout");
    return { kind: "error", message, isTimeout };
  }
}

/**
 * Fetch berita dari GDELT DOC 2.0 API.
 * Menerapkan batas timeout >= 30s, deteksi rate limit, dan maksimal 1 kali retry setelah jeda >= 6s.
 */
export async function fetchGdeltEvents(
  options: GdeltOptions = {},
): Promise<{ events: ContextMarketEvent[]; warning?: string }> {
  const {
    lookbackHours = 24,
    timeoutMs = DEFAULT_GDELT_TIMEOUT_MS,
    fetchFn = fetch,
    query = `(${DEFAULT_KEYWORDS.join(" OR ")})`,
  } = options;

  // GDELT mewajibkan query dengan operator OR dibungkus dalam tanda kurung ()
  const formattedQuery =
    query.includes(" OR ") && !query.startsWith("(") ? `(${query})` : query;

  const timespan = `${lookbackHours}h`;
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(formattedQuery)}&mode=artlist&format=json&maxrecords=50&timespan=${timespan}&sort=datedesc`;

  // Request pertama
  let result = await performSingleFetch(url, timeoutMs, fetchFn);

  // Jika terkena rate limit atau timeout, lakukan maksimal satu kali retry setelah jeda >= 6 detik
  if (
    result.kind === "rate_limited" ||
    (result.kind === "error" && result.isTimeout)
  ) {
    await new Promise((resolve) =>
      setTimeout(resolve, GDELT_RATE_LIMIT_DELAY_MS),
    );
    result = await performSingleFetch(url, timeoutMs, fetchFn);
  }

  // Evaluasi hasil akhir
  if (result.kind === "ok") {
    if (!result.data || !Array.isArray(result.data.articles)) {
      return {
        events: [],
        warning: "GDELT API mengembalikan respons tanpa daftar artikel",
      };
    }
    const events = normalizeGdeltArticles(result.data.articles);
    return { events };
  }

  if (result.kind === "rate_limited") {
    return {
      events: [],
      warning:
        "GDELT rate limited: server membatasi 1 request per 5 detik, coba beberapa saat lagi",
    };
  }

  if (result.kind === "non_json") {
    return {
      events: [],
      warning: `GDELT API mengembalikan respons non-JSON: ${result.text}`,
    };
  }

  return {
    events: [],
    warning: `GDELT fetch gagal (${result.message})`,
  };
}
