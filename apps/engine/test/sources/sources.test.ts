/**
 * Unit tests untuk data sources research agent.
 *
 * Menguji adapter RSS, GDELT, FRED, Onchain, dan runner collectResearchInputs.
 * Semua test berjalan secara offline menggunakan fixture lokal (tanpa network dependency).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  stripHtmlAndCdata,
  parseFeedXml,
  parseFeedDate,
  isGeopoliticsRiskRelevant,
  fetchRssEvents,
  RSS_FEEDS,
  GEOPOLITICS_RISK_KEYWORDS,
} from "../../src/sources/rss.ts";
import {
  normalizeGdeltArticles,
  fetchGdeltEvents,
  type GdeltArticleRaw,
} from "../../src/sources/gdelt.ts";
import {
  normalizeFredSeries,
  fetchFredSignals,
  type FredObservationRaw,
} from "../../src/sources/fred.ts";
import {
  normalizeOnchainSnapshot,
  fetchOnchainSnapshot,
  type OnchainRawSnapshot,
} from "../../src/sources/onchain.ts";
import {
  parseNewYorkDateTime,
  getScheduledFomcEvents,
  fetchFredReleaseDates,
  fetchMacroCalendarEvents,
  type FredReleaseDatesResponse,
} from "../../src/sources/macro-calendar.ts";
import {
  evaluateStablecoinDeviation,
  fetchDefiLlamaStablecoins,
  fetchDefiLlamaHacks,
  fetchDefiLlamaSignals,
  type DefiLlamaStablecoinsResponse,
  type DefiLlamaHackEntry,
} from "../../src/sources/defillama.ts";
import { collectResearchInputs } from "../../src/sources/collect.ts";

// Helper untuk membaca file fixture JSON
function loadFixture<T>(filename: string): T {
  const fixturePath = join(
    new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    "fixtures",
    filename,
  );
  const content = readFileSync(fixturePath, "utf-8");
  return JSON.parse(content) as T;
}

// Helper untuk membaca file fixture teks/XML
function loadTextFixture(filename: string): string {
  const fixturePath = join(
    new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    "fixtures",
    filename,
  );
  return readFileSync(fixturePath, "utf-8");
}

describe("Data Sources: RSS Feed Adapter", () => {
  it("membersihkan tag HTML, CDATA, dan entity secara aman", () => {
    const raw =
      "<![CDATA[<p>Middle East &amp; Red Sea: <b>missile</b> strikes &quot;escalate&quot; &#39;sharply&#39;.</p>]]>";
    const cleaned = stripHtmlAndCdata(raw);
    assert.equal(
      cleaned,
      'Middle East & Red Sea: missile strikes "escalate" \'sharply\'.',
    );
  });

  it("melakukan parsing feed RSS 2.0 (BBC) dan mengekstrak item dengan benar", () => {
    const xml = loadTextFixture("rss-bbc.xml");
    const items = parseFeedXml(xml);

    assert.equal(items.length, 3, "harus mengekstrak tepat 3 item dari fixture BBC");
    assert.equal(
      items[0]?.title,
      "Middle East ceasefire talks stall amid missile strikes",
    );
    assert.equal(
      items[0]?.link,
      "https://www.bbc.co.uk/news/world-middle-east-10000001",
    );
    assert.ok(items[0]?.description.includes("Diplomatic efforts"));
    assert.equal(items[0]?.pubDate, "Thu, 08 Oct 2026 12:00:00 GMT");
  });

  it("melakukan parsing feed Atom dan mengekstrak link href serta summary", () => {
    const xml = loadTextFixture("atom-feed.xml");
    const items = parseFeedXml(xml);

    assert.equal(items.length, 2, "harus mengekstrak 2 entry dari fixture Atom");
    assert.equal(
      items[0]?.title,
      "Central bank keeps interest rates unchanged amid inflation risks",
    );
    assert.equal(items[0]?.link, "https://example.com/news/entry-1");
    assert.ok(items[0]?.description.includes("benchmark rates"));
    assert.equal(items[0]?.pubDate, "2026-10-08T12:15:00Z");
  });

  it("memfilter relevansi risiko pasar untuk feed geopolitik umum", () => {
    // 1. Kasus positif kuat
    assert.equal(
      isGeopoliticsRiskRelevant("Middle East ceasefire talks stall amid missile strikes"),
      true,
    );
    assert.equal(
      isGeopoliticsRiskRelevant("US announces new trade sanctions on key exports"),
      true,
    );
    assert.equal(
      isGeopoliticsRiskRelevant("Drone attack damages crude oil tanker in Red Sea"),
      true,
    );
    assert.equal(
      isGeopoliticsRiskRelevant("US presidential election race tightens amid tariff and inflation debate"),
      true,
    );
    assert.equal(
      isGeopoliticsRiskRelevant("Stock market plunges into bear market territory amid rate hike fears"),
      true,
      "frasa bear market tidak boleh digugurkan oleh filter hewan bear",
    );

    // 2. Kasus negatif pengecualian (contoh nyata non-pasar yang sebelumnya lolos)
    assert.equal(
      isGeopoliticsRiskRelevant("Bear kills man in home attack near Mongolian capital"),
      false,
      "harus digugurkan oleh kata pengecualian bear dan home attack",
    );
    assert.equal(
      isGeopoliticsRiskRelevant("Housing protest held across major cities in Spain"),
      false,
      "harus digugurkan oleh kata pengecualian housing",
    );
    assert.equal(
      isGeopoliticsRiskRelevant("Celebrity couple announces wedding plans in Venice"),
      false,
      "harus digugurkan oleh kata pengecualian celebrity",
    );
    assert.equal(
      isGeopoliticsRiskRelevant("Football championship tournament final ends in penalty shootout"),
      false,
      "harus digugurkan oleh kata pengecualian olahraga",
    );

    // 3. Kasus kata generik tanpa kualifikasi pasar/geopolitik kuat
    assert.equal(
      isGeopoliticsRiskRelevant("Local election in rural district chooses municipal council"),
      false,
      "election tanpa kualifikasi ekonomi besar / pasar harus digugurkan",
    );
    assert.equal(
      isGeopoliticsRiskRelevant("School district suffers sudden ransomware attack"),
      false,
      "attack tanpa konteks militer/konflik/energi harus digugurkan",
    );
  });

  it("mengambil berita RSS, memfilter relevansi, dan mendeduplikasi judul lintas outlet", async () => {
    const bbcXml = loadTextFixture("rss-bbc.xml");
    const atomXml = loadTextFixture("atom-feed.xml");
    const coindeskXml = loadTextFixture("rss-coindesk.xml");

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("bbci.co.uk")) {
        return new Response(bbcXml, { status: 200 });
      }
      if (urlStr.includes("atom-feed.xml") || urlStr.includes("aljazeera")) {
        return new Response(atomXml, { status: 200 });
      }
      if (urlStr.includes("coindesk")) {
        return new Response(coindeskXml, { status: 200 });
      }
      return new Response("<rss><channel></channel></rss>", { status: 200 });
    };

    const mockFeeds = [
      {
        name: "BBC",
        url: "https://feeds.bbci.co.uk/news/world/rss.xml",
        topic: "geopolitics" as const,
        filterRelevance: true,
      },
      {
        name: "AtomNews",
        url: "https://aljazeera.com/atom-feed.xml",
        topic: "macro" as const,
        filterRelevance: false,
      },
      {
        name: "CoinDesk",
        url: "https://coindesk.com/rss",
        topic: "crypto" as const,
        filterRelevance: false,
      },
    ];

    const res = await fetchRssEvents({
      feeds: mockFeeds,
      fetchFn: mockFetch,
      lookbackHours: 48,
    });

    assert.ok(res.events.length > 0, "harus menghasilkan events");
    assert.equal(res.warnings.length, 0, "tidak boleh ada warning");

    // 1. Artikel non-relevan (wedding) harus difilter keluar
    const weddingEvt = res.events.find((e) => e.headline.includes("wedding"));
    assert.equal(weddingEvt, undefined, "berita non-relevan harus difilter keluar");

    // 2. Artikel "Middle East ceasefire talks" ada di BBC dan AtomNews -> harus dideduplikasi (hanya 1)
    const ceasefireEvts = res.events.filter((e) =>
      e.headline.toLowerCase().includes("ceasefire talks stall"),
    );
    assert.equal(
      ceasefireEvts.length,
      1,
      "judul serupa lintas outlet harus dideduplikasi",
    );

    // 3. Category berformat <topic>:<outlet>
    const bbcEvt = res.events.find((e) => e.category === "geopolitics:BBC");
    assert.ok(bbcEvt, "harus ada event dengan category geopolitics:BBC");

    const cryptoEvt = res.events.find((e) => e.category === "crypto:CoinDesk");
    assert.ok(cryptoEvt, "harus ada event dengan category crypto:CoinDesk");

    // 4. Excerpt memuat link
    assert.ok(bbcEvt.excerpt.includes("[Link: https://"));
  });

  it("menangani kegagalan salah satu feed dengan graceful degradation (feed lain tetap jalan)", async () => {
    const bbcXml = loadTextFixture("rss-bbc.xml");

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("failing-feed")) {
        throw new Error("Connection refused (mock)");
      }
      return new Response(bbcXml, { status: 200 });
    };

    const mockFeeds = [
      {
        name: "FailingFeed",
        url: "https://failing-feed.com/rss.xml",
        topic: "geopolitics" as const,
        filterRelevance: false,
      },
      {
        name: "BBC",
        url: "https://feeds.bbci.co.uk/news/world/rss.xml",
        topic: "geopolitics" as const,
        filterRelevance: true,
      },
    ];

    const res = await fetchRssEvents({
      feeds: mockFeeds,
      fetchFn: mockFetch,
      now: new Date("2026-10-08T18:00:00Z"),
    });

    assert.ok(res.events.length > 0, "feed BBC harus tetap berhasil diambil");
    assert.equal(res.warnings.length, 1, "harus mencatat 1 warning untuk failing feed");
    assert.ok(res.warnings[0]?.includes("FailingFeed"));
  });
});

describe("Data Sources: GDELT DOC 2.0 Adapter", () => {
  it("melakukan parsing artikel dan mengklasifikasikan kategori secara tepat", () => {
    const fixture = loadFixture<{ articles: GdeltArticleRaw[] }>("gdelt.json");
    const events = normalizeGdeltArticles(fixture.articles);

    assert.ok(events.length > 0, "harus menghasilkan minimal satu event");
    // BBC strikes article
    const strikeEvent = events.find((e) => e.headline.includes("strikes"));
    assert.ok(strikeEvent, "harus menemukan artikel serangan/strikes");
    assert.equal(strikeEvent.category, "GEOPOLITICS");
    assert.ok(strikeEvent.excerpt.includes("bbc.co.uk"));

    // Military conflict article
    const conflictEvent = events.find((e) => e.headline.includes("military"));
    assert.ok(conflictEvent, "harus menemukan artikel militer/konflik");
    assert.equal(conflictEvent.category, "GEOPOLITICS");

    // Trump news article
    const trumpEvent = events.find((e) => e.headline.includes("Trump"));
    assert.ok(trumpEvent, "harus menemukan artikel berita umum");
    assert.equal(trumpEvent.category, "GENERAL_NEWS");
  });

  it("melakukan deduplikasi terhadap URL duplikat dan judul serupa", () => {
    const fixture = loadFixture<{ articles: GdeltArticleRaw[] }>("gdelt.json");
    const events = normalizeGdeltArticles(fixture.articles);

    assert.equal(
      events.length,
      3,
      "harus tersisa tepat 3 artikel unik setelah dedup URL dan judul serupa",
    );
  });

  it("menangani kegagalan fetch dengan graceful degradation (tanpa throw)", async () => {
    const mockFailingFetch: typeof fetch = async () => {
      throw new Error("DNS resolution failure");
    };

    const res = await fetchGdeltEvents({ fetchFn: mockFailingFetch });
    assert.equal(res.events.length, 0);
    assert.ok(res.warning?.includes("GDELT fetch gagal"));
  });

  it("mendeteksi respons teks rate limit (HTTP 200/429 non-JSON) dan mengembalikan warning", async () => {
    const rateLimitText =
      "Please limit requests to one every 5 seconds or contact kalev.leetaru5@gmail.com for larger queries.";
    const mockRateLimitFetch: typeof fetch = async () => {
      return new Response(rateLimitText, { status: 200 });
    };

    const res = await fetchGdeltEvents({ fetchFn: mockRateLimitFetch });
    assert.equal(res.events.length, 0);
    assert.ok(res.warning?.includes("GDELT rate limited"));
  });

  it("menangani timeout request secara aman dan mengembalikan warning", async () => {
    const mockTimeoutFetch: typeof fetch = async () => {
      throw new Error("The operation was aborted due to timeout");
    };

    const res = await fetchGdeltEvents({ fetchFn: mockTimeoutFetch });
    assert.equal(res.events.length, 0);
    assert.ok(res.warning?.includes("GDELT fetch gagal"));
    assert.ok(res.warning?.includes("timeout"));
  });

  it("berhasil melakukan retry setelah respons pertama rate limited", async () => {
    let callCount = 0;
    const fixture = loadFixture<{ articles: GdeltArticleRaw[] }>("gdelt.json");
    const mockRetryFetch: typeof fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("Please limit requests to one every 5 seconds", {
          status: 429,
        });
      }
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const res = await fetchGdeltEvents({ fetchFn: mockRetryFetch });
    assert.equal(callCount, 2, "harus mencoba retry sekali");
    assert.ok(res.events.length > 0, "harus berhasil mendapatkan events di percobaan kedua");
    assert.equal(res.warning, undefined, "tidak boleh ada warning jika retry sukses");
  });
});

describe("Data Sources: FRED API Adapter", () => {
  it("melewati sumber dengan warning jika FRED_API_KEY tidak dikonfigurasi", async () => {
    const res = await fetchFredSignals({ apiKey: undefined });
    assert.equal(res.signals.length, 0);
    assert.ok(
      res.warning?.includes("FRED_API_KEY tidak dikonfigurasi, sumber dilewati"),
    );
  });

  it("melakukan normalisasi observasi FRED dan menghitung delta perubahan", () => {
    interface FredFixture {
      FEDFUNDS?: { observations: FredObservationRaw[] };
      T10Y2Y?: { observations: FredObservationRaw[] };
    }
    const fixture = loadFixture<FredFixture>("fred.json");
    const fedfundsObs = fixture.FEDFUNDS?.observations || [];
    const sig = normalizeFredSeries("FEDFUNDS", fedfundsObs);

    assert.ok(sig);
    assert.equal(sig.module, "MACRO");
    assert.equal(sig.confidence, 0.6);
    assert.ok(sig.summary.includes("5.33"));
  });

  it("mendeteksi kurva yield terbalik (T10Y2Y < 0) dengan severity lebih tinggi", () => {
    interface FredFixture {
      T10Y2Y?: { observations: FredObservationRaw[] };
    }
    const fixture = loadFixture<FredFixture>("fred.json");
    const t10y2yObs = fixture.T10Y2Y?.observations || [];
    const sig = normalizeFredSeries("T10Y2Y", t10y2yObs);

    assert.ok(sig);
    assert.ok(sig.summary.includes("-0.15"));
    assert.equal(sig.severity, 0.5);
  });
});

describe("Data Sources: Onchain Arbitrum One Adapter", () => {
  it("menghitung deviasi oracle Aave vs Chainlink dan membentuk sinyal normal", () => {
    const rawSnapshot: OnchainRawSnapshot = {
      wethAavePrice: 265000000000n, // $2,650.00
      usdcAavePrice: 100000000n, // $1.0000
      ethChainlinkAnswer: 265250000000n, // $2,652.50 (diff ~0.09%)
      ethChainlinkStartedAt: 1728390000n,
      usdcChainlinkAnswer: 99980000n, // $0.9998 (diff ~0.02%)
      usdcChainlinkStartedAt: 1728390000n,
      sequencerAnswer: 0n, // UP
      sequencerStartedAt: 1728000000n,
    };

    const { signals, chainNotes } = normalizeOnchainSnapshot(rawSnapshot);

    assert.equal(signals.length, 3, "harus menghasilkan 3 sinyal (sequencer, weth, usdc)");

    const seqSig = signals.find((s) => s.id === "onchain-arbitrum-sequencer");
    assert.ok(seqSig);
    assert.equal(seqSig.module, "ONCHAIN");
    assert.equal(seqSig.severity, 0.05);
    assert.ok(seqSig.summary.includes("UP"));

    const wethSig = signals.find((s) => s.id === "oracle-arbitrum-weth");
    assert.ok(wethSig);
    assert.equal(wethSig.module, "ORACLE");
    assert.ok(wethSig.summary.includes("$2650.00"));

    const usdcSig = signals.find((s) => s.id === "oracle-arbitrum-usdc");
    assert.ok(usdcSig);
    assert.equal(usdcSig.module, "ORACLE");

    // Verifikasi chainNotes wajib Arbitrum One
    assert.ok(chainNotes.some((n) => n.includes("Capped USDC/USD")));
    assert.ok(chainNotes.some((n) => n.includes("PriceOracleSentinel is NOT installed")));
  });

  it("mendeteksi insiden Sequencer DOWN dengan severity 1.0 dan jalur T10", () => {
    const rawSnapshot: OnchainRawSnapshot = {
      wethAavePrice: 265000000000n,
      usdcAavePrice: 100000000n,
      ethChainlinkAnswer: 265000000000n,
      ethChainlinkStartedAt: 1728390000n,
      usdcChainlinkAnswer: 100000000n,
      usdcChainlinkStartedAt: 1728390000n,
      sequencerAnswer: 1n, // DOWN!
      sequencerStartedAt: 1728390000n,
    };

    const { signals } = normalizeOnchainSnapshot(rawSnapshot);
    const seqSig = signals.find((s) => s.id === "onchain-arbitrum-sequencer");
    assert.ok(seqSig);
    assert.equal(seqSig.severity, 1.0);
    assert.deepEqual(seqSig.paths, ["T10"]);
    assert.ok(seqSig.summary.includes("CRITICAL"));
  });

  it("fetchOnchainSnapshot menggunakan fallback dan menghasilkan warning saat RPC gagal", async () => {
    const res = await fetchOnchainSnapshot({
      rpcUrl: "http://127.0.0.1:19999/invalid-rpc",
      timeoutMs: 500,
    });

    assert.equal(res.signals.length, 0);
    assert.ok(res.warning?.includes("Onchain: Gagal membaca RPC"));
    assert.ok(res.chainNotes.length >= 2, "chainNotes fallback harus tetap tersedia");
  });
});

describe("Data Sources: collectResearchInputs Orchestrator", () => {
  it("menggunakan RSS sebagai sumber berita utama secara offline dan tidak memanggil GDELT saat flag mati", async () => {
    const bbcXml = loadTextFixture("rss-bbc.xml");
    let gdeltCalled = false;

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("gdeltproject.org")) {
        gdeltCalled = true;
        throw new Error("GDELT should not be called when RESEARCH_GDELT_ENABLED is false");
      }
      if (urlStr.includes("bbci.co.uk") || urlStr.includes("rss.xml") || urlStr.includes("xml")) {
        return new Response(bbcXml, {
          status: 200,
          headers: { "Content-Type": "application/xml" },
        });
      }
      return new Response(JSON.stringify({ observations: [] }), {
        status: 200,
      });
    };

    // Pastikan flag GDELT mati
    delete process.env.RESEARCH_GDELT_ENABLED;

    const result = await collectResearchInputs({
      chainId: 42161,
      assets: ["ETH", "USDC"],
      timeoutMs: 500,
      fetchFn: mockFetch,
      now: new Date("2026-10-08T18:00:00Z"),
    });

    assert.equal(gdeltCalled, false, "GDELT tidak boleh dipanggil saat flag mati");
    assert.ok(Array.isArray(result.marketEvents));
    assert.ok(
      result.marketEvents.length > 0,
      "harus mengumpulkan marketEvents dari feed RSS",
    );
    assert.ok(result.marketEvents[0]?.category.startsWith("geopolitics:") || result.marketEvents[0]?.category.startsWith("macro:") || result.marketEvents[0]?.category.startsWith("crypto:"));
    assert.ok(Array.isArray(result.macroEvents));
    assert.ok(Array.isArray(result.signals));
    assert.ok(Array.isArray(result.chainNotes));
    assert.ok(Array.isArray(result.warnings));
  });

  it("memanggil GDELT jika RESEARCH_GDELT_ENABLED=true", async () => {
    const bbcXml = loadTextFixture("rss-bbc.xml");
    const gdeltFixture = loadFixture<{ articles: GdeltArticleRaw[] }>("gdelt.json");
    let gdeltCalled = false;

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("gdeltproject.org")) {
        gdeltCalled = true;
        return new Response(JSON.stringify(gdeltFixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("bbci.co.uk") || urlStr.includes("rss.xml") || urlStr.includes("xml")) {
        return new Response(bbcXml, {
          status: 200,
          headers: { "Content-Type": "application/xml" },
        });
      }
      return new Response(JSON.stringify({ observations: [] }), {
        status: 200,
      });
    };

    process.env.RESEARCH_GDELT_ENABLED = "true";
    try {
      const result = await collectResearchInputs({
        chainId: 42161,
        assets: ["ETH", "USDC"],
        timeoutMs: 500,
        fetchFn: mockFetch,
      });

      assert.equal(gdeltCalled, true, "GDELT harus dipanggil saat RESEARCH_GDELT_ENABLED=true");
      assert.ok(result.marketEvents.length > 0);
    } finally {
      delete process.env.RESEARCH_GDELT_ENABLED;
    }
  });

  it("mengisi macroEvents dan sinyal DefiLlama secara paralel", async () => {
    const bbcXml = loadTextFixture("rss-bbc.xml");
    const fredRel = loadFixture<FredReleaseDatesResponse>("fred-releases.json");
    const stablecoinsFixture = loadFixture<DefiLlamaStablecoinsResponse>(
      "defillama-stablecoins.json",
    );
    const hacksFixture = loadFixture<DefiLlamaHackEntry[]>("defillama-hacks.json");

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("fred/release/dates")) {
        return new Response(JSON.stringify(fredRel), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("stablecoins.llama.fi")) {
        return new Response(JSON.stringify(stablecoinsFixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("api.llama.fi/hacks")) {
        return new Response(JSON.stringify(hacksFixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("bbci.co.uk") || urlStr.includes("rss.xml") || urlStr.includes("xml")) {
        return new Response(bbcXml, {
          status: 200,
          headers: { "Content-Type": "application/xml" },
        });
      }
      return new Response(JSON.stringify({ observations: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    process.env.FRED_API_KEY = "test-fred-key";
    try {
      const now = new Date("2026-10-08T12:00:00.000Z");
      const result = await collectResearchInputs({
        chainId: 42161,
        assets: ["ETH", "USDC"],
        timeoutMs: 1000,
        now,
        fetchFn: mockFetch,
      });

      assert.ok(Array.isArray(result.macroEvents), "macroEvents harus berupa array");
      assert.ok(
        result.macroEvents.length > 0,
        "macroEvents harus terisi event makro mendatang",
      );
      assert.ok(
        result.macroEvents.some((e) => e.id.includes("cpi") || e.id.includes("nfp")),
        "harus berisi event CPI atau NFP",
      );
      assert.ok(
        result.macroEvents.some((e) => e.id.includes("fomc")),
        "harus berisi event FOMC 27-28 Okt (jendela default 30 hari)",
      );

      assert.ok(
        result.signals.some((s) => s.id.includes("defillama")),
        "signals harus memuat sinyal dari DefiLlama",
      );
    } finally {
      delete process.env.FRED_API_KEY;
    }
  });
});

describe("Data Sources: Macro Calendar Adapter", () => {
  it("mengonversi waktu New York ke UTC secara presisi untuk EDT dan EST", () => {
    // 28 Okt 2026 adalah EDT (UTC-4), 14:00 New York = 18:00 UTC
    const edtFomc = parseNewYorkDateTime("2026-10-28", "14:00");
    assert.equal(edtFomc.toISOString(), "2026-10-28T18:00:00.000Z");

    // 9 Des 2026 adalah EST (UTC-5), 14:00 New York = 19:00 UTC
    const estFomc = parseNewYorkDateTime("2026-12-09", "14:00");
    assert.equal(estFomc.toISOString(), "2026-12-09T19:00:00.000Z");

    // Rilis BLS 08:30 pada EDT (14 Okt 2026): 08:30 + 4 = 12:30 UTC
    const edtBls = parseNewYorkDateTime("2026-10-14", "08:30");
    assert.equal(edtBls.toISOString(), "2026-10-14T12:30:00.000Z");
  });

  it("menyaring event FOMC mendatang dengan jendela default 30 hari (FOMC 27-28 Okt masuk dari 8 Okt)", () => {
    // 8 Okt 2026: Rapat FOMC berikutnya adalah 27-28 Okt 2026 (~20 hari ke depan)
    const now = new Date("2026-10-08T12:00:00.000Z");
    const defaultEvents = getScheduledFomcEvents(now);

    assert.equal(defaultEvents.length, 1, "default 30 hari harus memuat rapat FOMC 27-28 Okt 2026");
    const fomc = defaultEvents[0]!;
    assert.equal(fomc.id, "macro-fomc-2026-10-28");
    assert.equal(fomc.name, "FOMC Rate Decision");
    assert.equal(fomc.importance, "HIGH");
    assert.equal(fomc.scheduledAt.toISOString(), "2026-10-28T18:00:00.000Z");

    // Bila jendela dipersempit menjadi 14 hari, rapat 20 hari ke depan tidak boleh lolos
    const tightEvents = getScheduledFomcEvents(now, 14);
    assert.equal(tightEvents.length, 0, "jendela 14 hari tidak boleh memuat rapat FOMC 20 hari ke depan");
  });

  it("mengambil tanggal rilis FRED (CPI/NFP) dan memfilter horizon waktu", async () => {
    const fixture = loadFixture<FredReleaseDatesResponse>("fred-releases.json");
    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const now = new Date("2026-10-08T12:00:00.000Z");
    const res = await fetchFredReleaseDates({
      releaseId: 10,
      releaseName: "US Consumer Price Index (CPI) Release",
      eventPrefix: "cpi",
      apiKey: "test-api-key",
      now,
      lookaheadDays: 14,
      fetchFn: mockFetch,
    });

    assert.equal(res.events.length, 1, "hanya tanggal 2026-10-14 yang dalam 14 hari");
    const cpiEvent = res.events[0]!;
    assert.equal(cpiEvent.id, "macro-cpi-2026-10-14");
    assert.equal(cpiEvent.name, "US Consumer Price Index (CPI) Release");
    assert.equal(cpiEvent.importance, "HIGH");
    assert.equal(cpiEvent.scheduledAt.toISOString(), "2026-10-14T12:30:00.000Z");
  });

  it("menggabungkan FOMC (30 hari) dan FRED kalender (14 hari) secara terurut", async () => {
    const fixture = loadFixture<FredReleaseDatesResponse>("fred-releases.json");
    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    // 8 Okt 2026: FOMC 28 Okt masuk (30 hari) dan CPI 14 Okt masuk (14 hari)
    const now = new Date("2026-10-08T12:00:00.000Z");
    const res = await fetchMacroCalendarEvents({
      apiKey: "test-key",
      now,
      fetchFn: mockFetch,
    });

    assert.ok(res.events.length >= 2, "harus memuat CPI dan FOMC");
    const fomcEvent = res.events.find((e) => e.id.includes("fomc"));
    const cpiEvent = res.events.find((e) => e.id.includes("cpi"));
    assert.ok(fomcEvent, "FOMC harus masuk");
    assert.ok(cpiEvent, "CPI harus masuk");

    // Verifikasi urutan waktu ascending
    for (let i = 1; i < res.events.length; i++) {
      const prev = res.events[i - 1]!;
      const curr = res.events[i]!;
      assert.ok(
        prev.scheduledAt.getTime() <= curr.scheduledAt.getTime(),
        "event harus terurut secara ascending",
      );
    }
  });
});

describe("Data Sources: DefiLlama Adapter", () => {
  it("mengevaluasi deviasi stablecoin sesuai ambang batas bertingkat", () => {
    assert.equal(evaluateStablecoinDeviation(1.0001), 0.05); // aman
    assert.equal(evaluateStablecoinDeviation(0.994), 0.4); // 0.6% deviasi >= 0.5%
    assert.equal(evaluateStablecoinDeviation(0.988), 0.7); // 1.2% deviasi >= 1.0%
    assert.equal(evaluateStablecoinDeviation(0.965), 1.0); // 3.5% deviasi >= 3.0%
  });

  it("menghasilkan sinyal baseline saat semua stablecoin termonitor aman", async () => {
    const fixture = loadFixture<DefiLlamaStablecoinsResponse>(
      "defillama-stablecoins.json",
    );
    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const now = new Date("2026-10-08T12:00:00.000Z");
    const res = await fetchDefiLlamaStablecoins({
      now,
      fetchFn: mockFetch,
    });

    assert.equal(res.signals.length, 1);
    const sig = res.signals[0]!;
    assert.equal(sig.id, "defillama-stablecoin-pegs");
    assert.equal(sig.module, "ONCHAIN");
    assert.deepEqual(sig.paths, ["T4"]);
    assert.equal(sig.severity, 0.05);
    assert.equal(sig.confidence, 0.9);
  });

  it("mendeteksi anomali depeg dengan severity tinggi dan jalur T4 saat harga menyimpang", async () => {
    const depeggedData: DefiLlamaStablecoinsResponse = {
      peggedAssets: [
        { id: "1", name: "Tether USD", symbol: "USDT", price: 1.0 },
        { id: "2", name: "USD Coin", symbol: "USDC", price: 1.0 },
        { id: "3", name: "Dai", symbol: "DAI", price: 1.0 },
        { id: "4", name: "USDS", symbol: "USDS", price: 1.0 },
        { id: "5", name: "Ethena USDe", symbol: "USDe", price: 0.978 }, // deviasi 2.2% -> severity 0.7
      ],
    };
    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify(depeggedData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const now = new Date("2026-10-08T12:00:00.000Z");
    const res = await fetchDefiLlamaStablecoins({
      now,
      fetchFn: mockFetch,
    });

    assert.equal(res.signals.length, 1);
    const sig = res.signals[0]!;
    assert.equal(sig.id, "defillama-depeg-usde");
    assert.equal(sig.module, "ONCHAIN");
    assert.deepEqual(sig.paths, ["T4"]);
    assert.equal(sig.severity, 0.7);
    assert.equal(sig.confidence, 0.95);
    assert.ok(sig.summary.includes("USDe depeg detected"));
  });

  it("menyaring insiden hack 7 hari terakhir, menerapkan skala nominal dan boost relevansi Tahansoe", async () => {
    const fixture = loadFixture<DefiLlamaHackEntry[]>("defillama-hacks.json");
    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const now = new Date("2026-10-08T12:00:00.000Z");
    const res = await fetchDefiLlamaHacks({
      now,
      fetchFn: mockFetch,
    });

    // 1. MegaBridge Network ($65M, Arbitrum) -> >= $50M boosted ke 0.9
    const bridgeHack = res.signals.find((s) => s.id.includes("megabridge"));
    assert.ok(bridgeHack, "MegaBridge hack harus ada");
    assert.equal(bridgeHack.severity, 0.9, "hack $65M di Arbitrum harus di-boost ke 0.9");
    assert.deepEqual(bridgeHack.paths, ["T9"]);
    assert.ok(bridgeHack.summary.includes("[Tahansoe-relevant]"));

    // 2. DeFi Protocol Alpha ($15M, Arbitrum) -> $1M-$50M boosted ke 0.7
    const alphaHack = res.signals.find((s) => s.id.includes("protocol-alpha"));
    assert.ok(alphaHack, "Protocol Alpha hack harus ada");
    assert.equal(alphaHack.severity, 0.7, "hack $15M di Arbitrum harus di-boost ke 0.7");
    assert.deepEqual(alphaHack.paths, ["T9"]);
    assert.ok(alphaHack.summary.includes("[Tahansoe-relevant]"));

    // 3. Unrelated Protocol Beta ($300k, Solana) -> $100k-$1M base 0.15
    const betaHack = res.signals.find((s) => s.id.includes("protocol-beta"));
    assert.ok(betaHack, "Unrelated Protocol Beta hack harus ada");
    assert.equal(betaHack.severity, 0.15, "hack $300k di Solana harus severity base 0.15");
    assert.deepEqual(betaHack.paths, ["T9"]);
    assert.ok(!betaHack.summary.includes("[Tahansoe-relevant]"));

    // 4. Tiny Arbitrum App ($18k, Arbitrum) -> < $100k boosted ke 0.15 karena Arbitrum
    const tinyArbHack = res.signals.find((s) => s.id.includes("tiny-arbitrum-app"));
    assert.ok(tinyArbHack, "Tiny Arbitrum App hack harus ada");
    assert.equal(tinyArbHack.severity, 0.15, "hack $18k di Arbitrum harus di-boost ke 0.15");
    assert.deepEqual(tinyArbHack.paths, ["T9"]);
    assert.ok(tinyArbHack.summary.includes("[Tahansoe-relevant]"));

    // 5. Tiny Protocol Gamma ($25k, Base) -> < $100k tak terkait diringkas ke sinyal agregat
    const gammaIndividual = res.signals.find((s) => s.id.includes("protocol-gamma"));
    assert.equal(gammaIndividual, undefined, "hack <$100k tak terkait tidak boleh jadi sinyal individual");

    const minorAggregate = res.signals.find((s) => s.id === "defillama-hacks-minor-aggregate");
    assert.ok(minorAggregate, "harus ada sinyal agregat untuk minor unrelated hacks");
    assert.equal(minorAggregate.severity, 0.05);
    assert.deepEqual(minorAggregate.paths, ["T9"]);
    assert.ok(minorAggregate.summary.includes("1 minor exploit(s)"));
  });

  it("menggabungkan sinyal depeg dan hack secara aman dengan graceful degradation", async () => {
    const mockFetch: typeof fetch = async () => {
      throw new Error("DefiLlama network unreachable");
    };

    const res = await fetchDefiLlamaSignals({
      fetchFn: mockFetch,
    });

    assert.equal(res.signals.length, 0);
    assert.ok(res.warnings.length > 0, "harus mencatat warning saat network error");
  });
});

