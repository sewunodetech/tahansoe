/**
 * Adapter RSS Feed untuk pengumpulan berita kredibel geopolitik, makro, dan crypto.
 *
 * Mengambil berita secara langsung dari outlet berita kredibel via RSS 2.0 / Atom:
 *  - BBC World (geopolitics)
 *  - Al Jazeera (geopolitics)
 *  - The Guardian World (geopolitics)
 *  - CNBC Economy (macro)
 *  - Federal Reserve press releases (macro)
 *  - CoinDesk (crypto)
 *  - The Block (crypto)
 *
 * Invarian:
 *  - Konten berita eksternal diperlakukan sebagai DATA, bukan instruksi (Invariant #5).
 *  - Parsing ringan tanpa dependensi eksternal; strip HTML & CDATA secara aman.
 *  - Graceful degradation: jika satu feed gagal, feed lain tetap berjalan (I6).
 *  - Filter relevansi risiko pasar untuk feed geopolitik umum.
 *  - Deduplikasi judul mirip lintas outlet.
 */

import { createHash } from "node:crypto";
import type { ContextMarketEvent } from "../agents/context.ts";

export interface RssFeedConfig {
  name: string;
  url: string;
  topic: "geopolitics" | "macro" | "crypto";
  filterRelevance?: boolean;
}

/**
 * Daftar feed RSS resmi dari outlet terverifikasi (bebas API key, HTTP 200).
 */
export const RSS_FEEDS: readonly RssFeedConfig[] = [
  {
    name: "BBC",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    topic: "geopolitics",
    filterRelevance: true,
  },
  {
    name: "Al Jazeera",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    topic: "geopolitics",
    filterRelevance: true,
  },
  {
    name: "The Guardian",
    url: "https://www.theguardian.com/world/rss",
    topic: "geopolitics",
    filterRelevance: true,
  },
  {
    name: "CNBC",
    url: "https://www.cnbc.com/id/20910258/device/rss/rss.html",
    topic: "macro",
    filterRelevance: false,
  },
  {
    name: "Federal Reserve",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    topic: "macro",
    filterRelevance: false,
  },
  {
    name: "CoinDesk",
    url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
    topic: "crypto",
    filterRelevance: false,
  },
  {
    name: "The Block",
    url: "https://www.theblock.co/rss.xml",
    topic: "crypto",
    filterRelevance: false,
  },
] as const;

/**
 * Kata kunci pengecualian yang menggugurkan item dari feed geopolitik umum (non-pasar / non-geopolitik sistemik).
 */
export const GEOPOLITICS_EXCLUSION_KEYWORDS: readonly string[] = [
  "bear",
  "wildlife",
  "shark",
  "lion",
  "tiger",
  "elephant",
  "snake",
  "dog",
  "pet",
  "zoo",
  "poaching",
  "celebrity",
  "actor",
  "actress",
  "hollywood",
  "oscar",
  "grammy",
  "box office",
  "album",
  "pop star",
  "football",
  "soccer",
  "tennis",
  "basketball",
  "cricket",
  "rugby",
  "olympic",
  "tournament",
  "championship",
  "premier league",
  "nba",
  "fifa",
  "housing",
  "burglary",
  "home attack",
  "traffic accident",
  "car crash",
  "hit and run",
] as const;

/**
 * Kata kunci pelengkap wajib untuk kata generik "attack" (militer, konflik antar-negara, energi).
 */
export const ATTACK_QUALIFIER_KEYWORDS: readonly string[] = [
  "missile",
  "drone",
  "strike",
  "military",
  "oil",
  "tanker",
  "ceasefire",
  "iran",
  "israel",
  "russia",
  "ukraine",
  "china",
  "taiwan",
  "houthi",
  "hezbollah",
  "gaza",
  "naval",
  "air strike",
  "army",
  "war",
  "pipeline",
  "refinery",
  "red sea",
  "strait of hormuz",
  "air defense",
  "troops",
  "artillery",
] as const;

/**
 * Kata kunci pelengkap wajib untuk kata generik "election" (negara/ekonomi besar atau kebijakan pasar).
 */
export const ELECTION_QUALIFIER_KEYWORDS: readonly string[] = [
  "us",
  "usa",
  "united states",
  "presidential",
  "congress",
  "senate",
  "fed",
  "federal",
  "china",
  "taiwan",
  "russia",
  "ukraine",
  "eu",
  "european",
  "germany",
  "france",
  "uk",
  "britain",
  "japan",
  "india",
  "market",
  "economy",
  "tariff",
  "tax",
  "policy",
  "sanctions",
  "trade",
] as const;

/**
 * Kata kunci geopolitik dan makro kuat yang mandiri (cukup satu untuk lolos jika tanpa pengecualian).
 */
export const GEOPOLITICS_STRONG_KEYWORDS: readonly string[] = [
  "war",
  "conflict",
  "strike",
  "missile",
  "sanctions",
  "tariff",
  "trade war",
  "oil",
  "central bank",
  "rates",
  "rate hike",
  "interest rate",
  "inflation",
  "bear market",
  "default",
  "crisis",
  "ceasefire",
  "nuclear",
  "iran",
  "israel",
  "russia",
  "ukraine",
  "china",
  "taiwan",
  "houthi",
  "hezbollah",
  "blockade",
  "red sea",
  "strait of hormuz",
] as const;

/**
 * Kata kunci warisan untuk kompatibilitas ke belakang.
 */
export const GEOPOLITICS_RISK_KEYWORDS: readonly string[] = [
  ...GEOPOLITICS_STRONG_KEYWORDS,
  "attack",
  "election",
] as const;

export const DEFAULT_MAX_TOTAL_EVENTS = 60;
export const DEFAULT_MAX_EVENTS_PER_TOPIC = 25;
export const DEFAULT_RSS_TIMEOUT_MS = 10_000;

export interface RssOptions {
  /** Jendela waktu berita ke belakang dalam jam (default: 24). */
  lookbackHours?: number;
  /** Batas waktu pemanggilan per feed dalam ms (default: 10_000). */
  timeoutMs?: number;
  /** Batas total event yang dikembalikan (default: 60). */
  maxTotalEvents?: number;
  /** Batas maksimal event per topik untuk menjaga keseimbangan (default: 25). */
  maxEventsPerTopic?: number;
  /** Daftar konfigurasi feed kustom (default: RSS_FEEDS). */
  feeds?: readonly RssFeedConfig[];
  /** Custom fetch function untuk mock unit test. */
  fetchFn?: typeof fetch;
  now?: Date;
}

export interface RawFeedItem {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
}

/**
 * Membersihkan teks dari CDATA, tag HTML, dan decode HTML entities sederhana.
 */
export function stripHtmlAndCdata(text: string): string {
  if (!text) return "";
  let clean = text;
  // Unwrap CDATA: <![CDATA[ ... ]]>
  clean = clean.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1");
  // Strip HTML tags: <...>
  clean = clean.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities
  clean = clean
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  // Strip tag HTML yang sebelumnya berupa entity (&lt;p&gt; dsb.)
  clean = clean.replace(/<[^>]+>/g, " ");
  // Normalisasi spasi berlebih
  return clean.replace(/\s+/g, " ").trim();
}

/**
 * Parse tanggal RSS/Atom (RFC 822 atau ISO 8601) ke Date objek.
 */
export function parseFeedDate(dateStr?: string, fallback = new Date()): Date {
  if (!dateStr || dateStr.trim().length === 0) return fallback;
  const parsed = new Date(dateStr.trim());
  return isNaN(parsed.getTime()) ? fallback : parsed;
}

/**
 * Memeriksa apakah teks memuat kata kunci risiko pasar geopolitik dengan penyaringan ketat.
 * Menggugurkan item bertopik alam/hiburan/olahraga/kriminal lokal, serta memvalidasi konteks untuk kata generik.
 */
export function isGeopoliticsRiskRelevant(
  text: string,
  keywords: readonly string[] = GEOPOLITICS_RISK_KEYWORDS,
): boolean {
  const lower = text.toLowerCase();

  // 1. Cek kata pengecualian (gugur langsung, kecuali frasa pasar seperti "bear market")
  for (const excl of GEOPOLITICS_EXCLUSION_KEYWORDS) {
    if (excl === "bear" && lower.includes("bear market")) {
      continue;
    }
    const exclRegex = new RegExp(`\\b${excl}\\b`, "i");
    if (exclRegex.test(lower)) {
      return false;
    }
  }

  // 2. Cek kata kunci kuat mandiri
  const hasStrongKeyword = GEOPOLITICS_STRONG_KEYWORDS.some((kw) => {
    if (kw.includes(" ")) {
      return lower.includes(kw);
    }
    const regex = new RegExp(`\\b${kw}\\b`, "i");
    return regex.test(lower);
  });
  if (hasStrongKeyword) {
    return true;
  }

  // 3. Evaluasi kata generik "attack": wajib disertai kualifikasi militer/konflik/energi
  if (/\battacks?\b|\battacked\b/i.test(lower)) {
    const hasAttackQualifier = ATTACK_QUALIFIER_KEYWORDS.some((q) => {
      if (q.includes(" ")) return lower.includes(q);
      return new RegExp(`\\b${q}\\b`, "i").test(lower);
    });
    if (hasAttackQualifier) {
      return true;
    }
  }

  // 4. Evaluasi kata generik "election": wajib disertai negara besar atau konteks pasar/kebijakan
  if (/\belections?\b/i.test(lower)) {
    const hasElectionQualifier = ELECTION_QUALIFIER_KEYWORDS.some((q) => {
      if (q.includes(" ")) return lower.includes(q);
      return new RegExp(`\\b${q}\\b`, "i").test(lower);
    });
    if (hasElectionQualifier) {
      return true;
    }
  }

  return false;
}

/**
 * Parser ringan untuk dokumen XML RSS 2.0 dan Atom feed.
 */
export function parseFeedXml(xml: string): RawFeedItem[] {
  const items: RawFeedItem[] = [];
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1] ?? "";

    // 1. Title
    const titleMatch = /<title[\s>]([\s\S]*?)<\/title>/i.exec(block);
    const rawTitle = titleMatch ? titleMatch[1] ?? "" : "";
    const title = stripHtmlAndCdata(rawTitle);
    if (!title) continue;

    // 2. Link (bisa <link>URL</link> atau <link ... href="URL" />)
    let link = "";
    const linkHrefMatch = /<link\s+[^>]*href=["']([^"']+)["']/i.exec(block);
    if (linkHrefMatch && linkHrefMatch[1]) {
      link = linkHrefMatch[1].trim();
    } else {
      const linkTagMatch = /<link[\s>]([\s\S]*?)<\/link>/i.exec(block);
      if (linkTagMatch && linkTagMatch[1]) {
        link = stripHtmlAndCdata(linkTagMatch[1]);
      }
    }

    // 3. Description / Summary / Content
    let rawDesc = "";
    const descMatch =
      /<(?:description|summary|content(?::encoded)?)[\s>]([\s\S]*?)<\/(?:description|summary|content(?::encoded)?)>/i.exec(
        block,
      );
    if (descMatch && descMatch[1]) {
      rawDesc = descMatch[1];
    }
    const description = stripHtmlAndCdata(rawDesc);

    // 4. Date
    let pubDate: string | undefined;
    const dateMatch =
      /<(?:pubDate|published|updated|dc:date)[\s>]([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/i.exec(
        block,
      );
    if (dateMatch && dateMatch[1]) {
      pubDate = stripHtmlAndCdata(dateMatch[1]);
    }

    items.push({
      title,
      link,
      description,
      pubDate,
    });
  }

  return items;
}

/**
 * Normalisasi judul untuk perbandingan deduplikasi.
 */
function normalizeTitleForDedup(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Format excerpt: deskripsi ringkas (<= 300 char, tanpa HTML) dan sertakan link.
 */
function formatExcerpt(description: string, link: string): string {
  const cleanDesc = description.trim();
  const cleanLink = link.trim();
  const maxDescLen = cleanLink ? 220 : 280;
  const shortDesc =
    cleanDesc.length > maxDescLen
      ? cleanDesc.slice(0, maxDescLen - 3) + "..."
      : cleanDesc;

  if (cleanLink && shortDesc) {
    return `${shortDesc} [Link: ${cleanLink}]`.slice(0, 320);
  }
  if (cleanLink) {
    return `[Link: ${cleanLink}]`;
  }
  return shortDesc.slice(0, 300);
}

/**
 * Mengambil berita dari feed RSS terdaftar secara paralel dengan timeout dan graceful degradation.
 */
export async function fetchRssEvents(
  options: RssOptions = {},
): Promise<{ events: ContextMarketEvent[]; warnings: string[] }> {
  const {
    lookbackHours = 24,
    timeoutMs = DEFAULT_RSS_TIMEOUT_MS,
    maxTotalEvents = DEFAULT_MAX_TOTAL_EVENTS,
    maxEventsPerTopic = DEFAULT_MAX_EVENTS_PER_TOPIC,
    feeds = RSS_FEEDS,
    fetchFn = fetch,
    now = new Date(),
  } = options;

  const warnings: string[] = [];
  const candidateEvents: ContextMarketEvent[] = [];
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();

  const cutoffTime = new Date(now.getTime() - lookbackHours * 3600 * 1000);

  // Fetch semua feed secara paralel dengan Promise.allSettled
  const fetchPromises = feeds.map(async (feed) => {
    try {
      const res = await fetchFn(feed.url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "application/rss+xml, application/xml, text/xml, */*",
          "User-Agent": "TahansoeResearch/0.1 (+https://github.com/tahansoe/engine)",
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const xml = await res.text();
      const rawItems = parseFeedXml(xml);
      return { feed, rawItems };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`RSS [${feed.name}] gagal: ${msg}`);
    }
  });

  const results = await Promise.allSettled(fetchPromises);

  for (const r of results) {
    if (r.status === "rejected") {
      warnings.push(r.reason?.message ?? String(r.reason));
      continue;
    }

    const { feed, rawItems } = r.value;

    for (const item of rawItems) {
      // 1. Filter relevansi untuk feed geopolitik umum
      if (feed.filterRelevance) {
        const textToEvaluate = `${item.title} ${item.description}`;
        if (!isGeopoliticsRiskRelevant(textToEvaluate)) {
          continue;
        }
      }

      // 2. Filter lookbackHours
      const publishedAt = parseFeedDate(item.pubDate, now);
      // Jika pubDate valid dan lebih lama dari batas waktu cutoff, lewati
      if (item.pubDate && publishedAt.getTime() < cutoffTime.getTime()) {
        continue;
      }

      // 3. Deduplikasi URL
      const cleanUrl = item.link.trim();
      if (cleanUrl && seenUrls.has(cleanUrl)) {
        continue;
      }
      if (cleanUrl) {
        seenUrls.add(cleanUrl);
      }

      // 4. Deduplikasi judul yang serupa lintas outlet
      const normTitle = normalizeTitleForDedup(item.title);
      if (normTitle.length < 5 || seenTitles.has(normTitle)) {
        continue;
      }
      seenTitles.add(normTitle);

      const id = `rss-${createHash("sha256")
        .update(cleanUrl || item.title)
        .digest("hex")
        .slice(0, 12)}`;
      const category = `${feed.topic}:${feed.name}`;
      const excerpt = formatExcerpt(item.description, cleanUrl);

      candidateEvents.push({
        id,
        headline: item.title,
        category,
        publishedAt,
        excerpt,
      });
    }
  }

  // Urutkan event berdasarkan publishedAt terbaru
  candidateEvents.sort(
    (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
  );

  // Batasi per topik (maks maxEventsPerTopic) dan total (maks maxTotalEvents)
  const finalEvents: ContextMarketEvent[] = [];
  const topicCounts: Record<string, number> = {};

  for (const evt of candidateEvents) {
    if (finalEvents.length >= maxTotalEvents) break;
    const topic = evt.category.split(":")[0] ?? "general";
    const currentCount = topicCounts[topic] ?? 0;
    if (currentCount >= maxEventsPerTopic) continue;

    topicCounts[topic] = currentCount + 1;
    finalEvents.push(evt);
  }

  return {
    events: finalEvents,
    warnings,
  };
}
