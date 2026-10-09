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
  type FetchLike,
} from "../../src/llm/pricing.ts";
import {
  estimateCost,
  averageProfile,
  DEFAULT_TOKEN_PROFILE,
  RUNS_PER_DAY_CALM,
} from "../../src/llm/estimate.ts";

const USD_TO_IDR = 17891.619611;

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
  });
  // manual menimpa remote untuk m1
  assert.equal(r1.prices.get("m1")?.inputPerM, 9);
  assert.equal(r1.prices.get("m1")?.source, "manual");

  const failFetch: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "err" });
  const r2 = await loadPricing({ pricingUrl: "https://example/pricing", modelPricesJson: "", fetchImpl: failFetch });
  assert.equal(r2.prices.size, 0);
  assert.match(r2.warnings.join(" "), /gagal memuat LLM_PRICING_URL/);
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
