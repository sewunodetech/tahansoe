/**
 * Unit tests untuk data sources research agent.
 *
 * Menguji adapter GDELT, FRED, Onchain, dan runner collectResearchInputs.
 * Semua test berjalan secara offline menggunakan fixture lokal (tanpa network dependency).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  it("menjalankan pengumpulan paralel dan tidak pernah melempar error", async () => {
    const gdeltFixture =
      loadFixture<{ articles: GdeltArticleRaw[] }>("gdelt.json");
    const mockFetch: typeof fetch = async (url) => {
      if (String(url).includes("gdeltproject.org")) {
        return new Response(JSON.stringify(gdeltFixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ observations: [] }), {
        status: 200,
      });
    };

    const result = await collectResearchInputs({
      chainId: 42161,
      assets: ["ETH", "USDC"],
      timeoutMs: 500,
      fetchFn: mockFetch,
    });

    assert.ok(Array.isArray(result.marketEvents));
    assert.ok(
      result.marketEvents.length > 0,
      "harus mengumpulkan marketEvents dari mock fixture",
    );
    assert.ok(Array.isArray(result.macroEvents));
    assert.ok(Array.isArray(result.signals));
    assert.ok(Array.isArray(result.chainNotes));
    assert.ok(Array.isArray(result.warnings));
    assert.ok(
      result.chainNotes.length >= 2,
      "chainNotes wajib berisi catatan Arbitrum",
    );
  });
});
