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
  titlePrefix?: string;
  maxItemsPerFeed?: number;
  dropMarketTicks?: boolean;
  maxPerSpeaker?: number;
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
    name: "FinancialJuice",
    url: "https://www.financialjuice.com/feed.ashx?xy=rss",
    topic: "macro",
    filterRelevance: false,
    titlePrefix: "FinancialJuice: ",
    maxItemsPerFeed: 12,
    dropMarketTicks: true,
    maxPerSpeaker: 2,
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
 * Pola kata atau frasa yang menandakan berita fundamental, kebijakan moneter,
 * indikator makro, geopolitik, kredit, perbankan, narasi kausalitas, atau rilis ekonomi.
 */
const NON_TICK_PATTERNS: readonly RegExp[] = [
  // Kutipan pembicara / pejabat (speaker prefix)
  /: /,
  // Kebijakan, bank sentral & pejabat
  /\b(?:fed|fomc|ecb|boj|boe|rba|snb|pboc|central bank|rate hike|rate cut|interest rates?|benchmark rate|policymakers?)\b/i,
  // Rilis data & indikator makroekonomi
  /\b(?:cpi|ppi|pce|gdp|pmi|nfp|payrolls?|inflation|unemployment|retail sales|jobless|sentiment|confidence|trade balance|expectations?|forecasts?|consensus|estimates?|m\/m|y\/y|yoy|mom|qoq)\b/i,
  // Geopolitik, perang & konflik
  /\b(?:war|military|missile|strike|attack|sanctions?|tariff|tariffs?|election|nuclear|ceasefire|troops?|drone|blockade|geopolit\w*|israel|iran|gaza|russia|ukraine|taiwan|houthi|hezbollah|red sea)\b/i,
  // Kredit, perbankan, regulasi & krisis pasar
  /\b(?:stablecoin|depeg|bank concerns?|concerns?|crisis|default|insolvency|liquidity|bailout|bankrupt\w*|hack|exploit|scam|fraud|lawsuit|investigat\w*|sec\b|probe|regulation)\b/i,
  // Narasi kausalitas, output energi / kuota komoditas, dan laporan korporasi
  /\b(?:amid|because|due to|as\b|warns?|warning|says?|said|claims?|urges?|sees?|signals?|calls? for|agrees?|plans?|output|bpd|barrels?|opec|revenue|earnings?|profit)\b/i,
] as const;

/**
 * Kata kerja dan arah pergerakan harga/pasar keuangan.
 */
const TICK_MOVEMENT_REGEX =
  /\b(?:last up|last down|last at|trades? at|trading at|settles? at|closes? at|up|down|rises?|rose|rising|falls?|fell|falling|climbs?|climbed|climbing|gains?|gained|gaining|drops?|dropped|dropping|slips?|slipped|slipping|advances?|advanced|advancing|declines?|declined|declining|surges?|surged|surging|jumps?|jumped|jumping|dips?|dipped|dipping|increases?|increased|increasing|higher|lower|flat|unchanged)\b/i;

/**
 * Instrumen dan kelas aset keuangan yang umum pada headline tick pasar murni.
 */
const TICK_INSTRUMENT_REGEX =
  /\b(?:[A-Z]{2,4}\/[A-Z]{2,4}|euro|yen|sterling|pounds?|dollars?|greenback|yuan|won|francs?|bunds?|oats?|gilts?|btps?|jgbs?|treasur(?:y|ies)|bonds?|notes?|yields?|futures|s&p|nasdaq|dow|ftse|dax|cac|nikkei|hang seng|stoxx|kospi|stocks?|equities|shares|gold|silver|crude|brent|wti)\b/i;

/**
 * Heuristik konservatif untuk mendeteksi headline tick pasar murni (instrumen + pergerakan harga/persen).
 *
 * Mengembalikan true HANYA jika judul adalah pergerakan harga instrumen murni (noise tick).
 * Mengembalikan false untuk semua berita yang memuat konten kebijakan, geopolitik, indikator
 * ekonomi makro, atau risiko kredit bahkan bila judul memuat angka persentase.
 */
export function isMarketTickHeadline(title: string): boolean {
  if (!title || typeof title !== "string") return false;

  // 1. Tolak jika memuat tanda kutipan speaker (: ) atau kata kunci kebijakan/makro/geopolitik/kredit/narasi
  if (NON_TICK_PATTERNS.some((pattern) => pattern.test(title))) {
    return false;
  }

  // 2. Wajib memuat angka persen atau harga/basis poin
  if (!/(?:\d+(?:\.\d+)?%|\$\d+(?:\.\d+)?|\b\d+\s*(?:bps|points?|pts)\b)/i.test(title)) {
    return false;
  }

  // 3. Wajib memuat pergerakan arah pasar
  if (!TICK_MOVEMENT_REGEX.test(title)) {
    return false;
  }

  // 4. Wajib menyebutkan instrumen keuangan
  if (!TICK_INSTRUMENT_REGEX.test(title)) {
    return false;
  }

  return true;
}

/**
 * Mengekstrak identitas pembicara dari judul berita bila diawali awalan "<speaker>:".
 * Menormalisasi huruf kecil serta memperlakukan karakter U+FFFD dan tanda petik lengkung (’) sama seperti '.
 */
export function extractSpeaker(title: string): string | null {
  const colonIdx = title.indexOf(": ");
  if (colonIdx <= 0) return null;
  const rawSpeaker = title.slice(0, colonIdx).trim();
  if (!rawSpeaker) return null;
  return rawSpeaker.toLowerCase().replace(/[\uFFFD\u2019']/g, "'");
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
    const speakerCounts = new Map<string, number>();
    let feedKeptCount = 0;

    // Urutkan item dari feed berdasarkan tanggal terbaru (newest first)
    const sortedRawItems = [...rawItems].sort((a, b) => {
      const dateA = parseFeedDate(a.pubDate, now).getTime();
      const dateB = parseFeedDate(b.pubDate, now).getTime();
      return dateB - dateA;
    });

    for (const item of sortedRawItems) {
      // 1. Strip awalan judul bila dikonfigurasi dan normalisasi karakter U+FFFD
      let title = item.title;
      if (feed.titlePrefix && title.startsWith(feed.titlePrefix)) {
        title = title.slice(feed.titlePrefix.length).trim();
      }
      title = title.replaceAll("\uFFFD", "'");

      // 2. Filter pergerakan harga/tick murni
      if (feed.dropMarketTicks && isMarketTickHeadline(title)) {
        continue;
      }

      // 3. Filter relevansi untuk feed geopolitik umum
      if (feed.filterRelevance) {
        const textToEvaluate = `${title} ${item.description}`;
        if (!isGeopoliticsRiskRelevant(textToEvaluate)) {
          continue;
        }
      }

      // 4. Filter lookbackHours
      const publishedAt = parseFeedDate(item.pubDate, now);
      // Jika pubDate valid dan lebih lama dari batas waktu cutoff, lewati
      if (item.pubDate && publishedAt.getTime() < cutoffTime.getTime()) {
        continue;
      }

      // 5. Deduplikasi URL
      const cleanUrl = item.link.trim();
      if (cleanUrl && seenUrls.has(cleanUrl)) {
        continue;
      }

      // 6. Deduplikasi judul yang serupa lintas outlet
      const normTitle = normalizeTitleForDedup(title);
      if (normTitle.length < 5 || seenTitles.has(normTitle)) {
        continue;
      }

      // 7. Batas maksimal kutipan per pembicara (speaker cap)
      const speaker = extractSpeaker(title);
      if (feed.maxPerSpeaker !== undefined && speaker) {
        const currentSpeakerCount = speakerCounts.get(speaker) ?? 0;
        if (currentSpeakerCount >= feed.maxPerSpeaker) {
          continue;
        }
      }

      // 8. Batas maksimal item yang disimpan dari feed ini (per-feed cap)
      if (
        feed.maxItemsPerFeed !== undefined &&
        feedKeptCount >= feed.maxItemsPerFeed
      ) {
        break;
      }

      // Simpan URL & judul yang diterima ke daftar deduplikasi
      if (cleanUrl) {
        seenUrls.add(cleanUrl);
      }
      seenTitles.add(normTitle);
      if (speaker) {
        const currentSpeakerCount = speakerCounts.get(speaker) ?? 0;
        speakerCounts.set(speaker, currentSpeakerCount + 1);
      }
      feedKeptCount++;

      const id = `rss-${createHash("sha256")
        .update(cleanUrl || title)
        .digest("hex")
        .slice(0, 12)}`;
      const category = `${feed.topic}:${feed.name}`;
      const excerpt = formatExcerpt(item.description, cleanUrl);

      candidateEvents.push({
        id,
        headline: title,
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
