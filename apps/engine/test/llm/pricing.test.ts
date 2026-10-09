/**
 * Unit test pricing & estimate (offline). Memverifikasi:
 *  - parser Bynara (credit/1k IDR → USD, simpan IDR asli, konversi usd_to_idr)
 *  - parser OpenRouter (USD per token → per 1M)
 *  - parser JSON manual (USD per 1M)
 *  - loadPricing dengan fetch mock (manual menimpa remote; gagal fetch → warning)
 *  - estimateCost (per run/day/month + IDR) & averageProfile dari diagnostics
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBynara,
  parseOpenRouter,
  parseManualPrices,
  parsePricingPayload,
  loadPricing,
  cacheFileName,
  CACHE_TTL_MS,
  type FetchLike,
  type PricingCacheStore,
  type CacheEntry,
} from "../../src/llm/pricing.ts";
import {
  estimateCost,
  averageProfile,
  DEFAULT_TOKEN_PROFILE,
  RUNS_PER_DAY_CALM,
} from "../../src/llm/estimate.ts";

const USD_TO_IDR = 17891.619611;

/** Cache in-memory untuk test (tanpa menyentuh disk). `nowMs` dapat diatur. */
function memoryCache(seed?: Record<string, CacheEntry>, nowMs = 1_000_000_000_000): PricingCacheStore {
  const store = new Map<string, CacheEntry>(Object.entries(seed ?? {}));
  return {
    async read(url) {
      return store.get(url) ?? null;
    },
    async write(url, entry) {
      store.set(url, entry);
    },
    now() {
      return nowMs;
    },
  };
}

/** Payload Bynara minimal untuk satu alias. */
function bynaraPayload(alias: string, inC = 1, outC = 2) {
  return { data: [{ alias, input_credit_per_1k: inC, output_credit_per_1k: outC }], usd_to_idr: USD_TO_IDR };
}

test("parseBynara: credit/1k (IDR) → USD per 1M + simpan IDR asli", () => {
  const { prices } = parseBynara(
    [
      { alias: "agnes-2.5-flash", input_credit_per_1k: 0.1, output_credit_per_1k: 0.2, reasoning: true, max_context_tokens: 512000 },
    ],
    USD_TO_IDR,
  );
  const p = prices.get("agnes-2.5-flash")!;
  // input: 0.1 credit/1k → 100 IDR/1M → /17891.6 USD
  assert.ok(Math.abs(p.native!.inputPerM - 100) < 1e-9, "IDR per 1M input = 100");
  assert.ok(Math.abs(p.native!.outputPerM - 200) < 1e-9, "IDR per 1M output = 200");
  assert.ok(Math.abs(p.inputPerM - 100 / USD_TO_IDR) < 1e-12);
  assert.ok(Math.abs(p.outputPerM - 200 / USD_TO_IDR) < 1e-12);
  assert.equal(p.native!.currency, "IDR");
  assert.equal(p.native!.usdToNative, USD_TO_IDR);
  assert.equal(p.reasoning, true);
  assert.equal(p.maxContextTokens, 512000);
  assert.equal(p.source, "bynara");
});

test("parseBynara: usd_to_idr invalid → kosong + warning", () => {
  const { prices, warnings } = parseBynara([{ alias: "x", input_credit_per_1k: 1, output_credit_per_1k: 1 }], 0);
  assert.equal(prices.size, 0);
  assert.match(warnings.join(" "), /usd_to_idr/);
});

test("parseOpenRouter: USD per token → per 1M", () => {
  const { prices } = parseOpenRouter([
    { id: "meta/llama", pricing: { prompt: "0.0000005", completion: "0.0000015" }, context_length: 128000 },
  ]);
  const p = prices.get("meta/llama")!;
  assert.ok(Math.abs(p.inputPerM - 0.5) < 1e-9, "0.5 USD per 1M input");
  assert.ok(Math.abs(p.outputPerM - 1.5) < 1e-9, "1.5 USD per 1M output");
  assert.equal(p.maxContextTokens, 128000);
  assert.equal(p.source, "openrouter");
});

test("parseManualPrices: USD per 1M langsung", () => {
  const { prices } = parseManualPrices('{"deepseek-v4.1-flash":{"inputPerM":0.3,"outputPerM":1.2,"reasoning":true}}');
  const p = prices.get("deepseek-v4.1-flash")!;
  assert.equal(p.inputPerM, 0.3);
  assert.equal(p.outputPerM, 1.2);
  assert.equal(p.reasoning, true);
  assert.equal(p.source, "manual");
});

test("parseManualPrices: JSON invalid → warning, tanpa crash", () => {
  const { prices, warnings } = parseManualPrices("{not json");
  assert.equal(prices.size, 0);
  assert.match(warnings.join(" "), /bukan JSON valid/);
});

test("parsePricingPayload: deteksi Bynara vs OpenRouter", () => {
  const bynara = parsePricingPayload({ data: [{ alias: "a", input_credit_per_1k: 1, output_credit_per_1k: 2 }], usd_to_idr: USD_TO_IDR });
  assert.equal(bynara.prices.get("a")?.source, "bynara");
  const or = parsePricingPayload({ data: [{ id: "x/y", pricing: { prompt: "0.000001", completion: "0.000002" } }] });
  assert.equal(or.prices.get("x/y")?.source, "openrouter");
  const unknown = parsePricingPayload({ data: [{ foo: 1 }] });
  assert.match(unknown.warnings.join(" "), /tidak dikenali/);
});

test("loadPricing: remote (mock) + manual menimpa; fetch gagal → warning tanpa crash", async () => {
  const okFetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ alias: "m1", input_credit_per_1k: 1, output_credit_per_1k: 2 }], usd_to_idr: USD_TO_IDR }),
    text: async () => "",
  });
  const r1 = await loadPricing({
    pricingUrl: "https://example/pricing",
    modelPricesJson: '{"m1":{"inputPerM":9,"outputPerM":9}}',
    fetchImpl: okFetch,
    cache: memoryCache(),
  });
  // manual menimpa remote untuk m1
  assert.equal(r1.prices.get("m1")?.inputPerM, 9);
  assert.equal(r1.prices.get("m1")?.source, "manual");

  const failFetch: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "err" });
  const r2 = await loadPricing({
    pricingUrl: "https://example/pricing",
    modelPricesJson: "",
    fetchImpl: failFetch,
    cache: memoryCache(),
  });
  assert.equal(r2.prices.size, 0);
  assert.match(r2.warnings.join(" "), /gagal memuat LLM_PRICING_URL/);
});

test("cacheFileName: deterministik & aman untuk nama file", () => {
  const a = cacheFileName("https://router.bynara.id/api/pricing");
  const b = cacheFileName("https://router.bynara.id/api/pricing");
  const c = cacheFileName("https://openrouter.ai/api/v1/models");
  assert.equal(a, b, "URL sama → nama sama");
  assert.notEqual(a, c, "URL beda → nama beda");
  assert.match(a, /^pricing-[0-9a-f]{16}\.json$/);
});

test("resilience: retry berhasil di percobaan kedua (5xx lalu 200)", async () => {
  let calls = 0;
  const fetchImpl: FetchLike = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 503, json: async () => ({}), text: async () => "busy" };
    return { ok: true, status: 200, json: async () => bynaraPayload("retry-model"), text: async () => "" };
  };
  const cache = memoryCache();
  const r = await loadPricing({ pricingUrl: "https://x/pricing", modelPricesJson: "", fetchImpl, cache });
  assert.equal(calls, 2, "dicoba 2x (retry sekali)");
  assert.ok(r.prices.get("retry-model"), "harga dari percobaan kedua termuat");
  // Sukses menulis cache
  assert.ok(await cache.read("https://x/pricing"), "cache ditulis setelah sukses");
});

test("resilience: network error lalu sukses (retry)", async () => {
  let calls = 0;
  const fetchImpl: FetchLike = async () => {
    calls += 1;
    if (calls === 1) throw new Error("fetch failed");
    return { ok: true, status: 200, json: async () => bynaraPayload("net-model"), text: async () => "" };
  };
  const r = await loadPricing({ pricingUrl: "https://x/pricing", modelPricesJson: "", fetchImpl, cache: memoryCache() });
  assert.equal(calls, 2);
  assert.ok(r.prices.get("net-model"));
});

test("resilience: 4xx tidak di-retry (langsung gagal)", async () => {
  let calls = 0;
  const fetchImpl: FetchLike = async () => {
    calls += 1;
    return { ok: false, status: 404, json: async () => ({}), text: async () => "nf" };
  };
  const r = await loadPricing({ pricingUrl: "https://x/pricing", modelPricesJson: "", fetchImpl, cache: memoryCache() });
  assert.equal(calls, 1, "4xx tidak di-retry");
  assert.match(r.warnings.join(" "), /gagal memuat LLM_PRICING_URL/);
});

test("resilience: fetch gagal → fallback ke cache (walau kedaluwarsa) + warning", async () => {
  const url = "https://x/pricing";
  const now = 2_000_000_000_000;
  // Cache ditulis jauh di masa lampau (kedaluwarsa).
  const staleAt = now - CACHE_TTL_MS - 10_000;
  const cache = memoryCache({ [url]: { fetchedAt: staleAt, payload: bynaraPayload("cached-model") } }, now);
  let calls = 0;
  const fetchImpl: FetchLike = async () => {
    calls += 1;
    throw new Error("fetch failed");
  };
  const r = await loadPricing({ pricingUrl: url, modelPricesJson: "", fetchImpl, cache });
  assert.equal(calls, 2, "fetch tetap dicoba (2x) sebelum fallback");
  assert.ok(r.prices.get("cached-model"), "harga dari cache kedaluwarsa dipakai");
  assert.match(r.warnings.join(" "), /memakai harga cache dari/);
  assert.match(r.warnings.join(" "), /mungkin kedaluwarsa/);
});

test("resilience: cache valid (dalam TTL) TIDAK memicu fetch", async () => {
  const url = "https://x/pricing";
  const now = 2_000_000_000_000;
  const freshAt = now - 60_000; // 1 menit lalu, masih dalam TTL
  const cache = memoryCache({ [url]: { fetchedAt: freshAt, payload: bynaraPayload("fresh-model") } }, now);
  let calls = 0;
  const fetchImpl: FetchLike = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => bynaraPayload("should-not-be-used"), text: async () => "" };
  };
  const r = await loadPricing({ pricingUrl: url, modelPricesJson: "", fetchImpl, cache });
  assert.equal(calls, 0, "cache segar → tidak fetch");
  assert.ok(r.prices.get("fresh-model"));
  assert.equal(r.prices.get("should-not-be-used"), undefined);
});

test("estimateCost: per run/day/month + IDR dari harga native", () => {
  const price = {
    inputPerM: 0.3,
    outputPerM: 1.2,
    native: { currency: "IDR" as const, inputPerM: 0.3 * USD_TO_IDR, outputPerM: 1.2 * USD_TO_IDR, usdToNative: USD_TO_IDR },
  };
  const e = estimateCost(price, { inputTokens: 1_000_000, outputTokens: 1_000_000, source: "" });
  assert.ok(Math.abs(e.perRunUsd - 1.5) < 1e-9, "0.3 + 1.2 = 1.5 USD/run");
  assert.ok(Math.abs(e.perDayUsd - 1.5 * RUNS_PER_DAY_CALM) < 1e-9);
  assert.ok(Math.abs(e.perMonthUsd - 1.5 * RUNS_PER_DAY_CALM * 30) < 1e-6);
  assert.ok(e.idr, "IDR estimate ada");
  assert.ok(Math.abs(e.idr!.perRunIdr - 1.5 * USD_TO_IDR) < 1e-3);
});

test("DEFAULT_TOKEN_PROFILE: cocok dengan run nyata 8 Okt", () => {
  assert.equal(DEFAULT_TOKEN_PROFILE.inputTokens, 43100);
  assert.equal(DEFAULT_TOKEN_PROFILE.outputTokens, 3800);
});

test("averageProfile: rata-rata diagnostics, abaikan yang invalid", () => {
  const prof = averageProfile([
    { totalInputTokens: 40000, totalOutputTokens: 3000 },
    { totalInputTokens: 50000, totalOutputTokens: 5000 },
    { foo: "bar" }, // diabaikan
    null, // diabaikan
  ]);
  assert.ok(prof);
  assert.equal(prof!.inputTokens, 45000);
  assert.equal(prof!.outputTokens, 4000);
  assert.match(prof!.source, /2 research_reports/);
  assert.equal(averageProfile([]), null);
});
