/**
 * Unit test costOf: input/output, token cache (write 1.25x / read 0.1x),
 * dan fallback model tak dikenal ke harga opus (bukan gratis).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { costOf, setRuntimePricing, clearRuntimePricing } from "../../src/llm/budget.ts";
import type { ModelPrice } from "../../src/llm/pricing.ts";

test("(a) hanya input/output: haiku 1M in + 1M out", () => {
  // haiku: in $0.10, out $0.50 per 1M
  const c = costOf({
    model: "claude-haiku-5-5",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  assert.ok(Math.abs(c - 0.6) < 1e-9, `expected 0.6, got ${c}`);
});

test("(b) cache write & read memakai multiplier (opus)", () => {
  // opus input $4/1M. 1M input = $4; 1M cacheWrite = 4*1.25 = $5;
  // 1M cacheRead = 4*0.1 = $0.40; 1M output @ $20 = $20. Total = 29.40
  const c = costOf({
    model: "claude-opus-5-5",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheWriteTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
  });
  assert.ok(Math.abs(c - 29.4) < 1e-9, `expected 29.4, got ${c}`);
});

test("(b2) cache read murah: 10M read opus = 10M * $4 * 0.1 = $4", () => {
  const c = costOf({
    model: "claude-opus-5-5",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 10_000_000,
  });
  assert.ok(Math.abs(c - 4) < 1e-9, `expected 4, got ${c}`);
});

test("(c) model tak dikenal memakai harga opus (bukan gratis)", () => {
  const unknown = costOf({
    model: "claude-unknown-9",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  const opus = costOf({
    model: "claude-opus-5-5",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  assert.equal(unknown, opus);
  assert.ok(unknown > 0, "model tak dikenal tidak boleh gratis");
});

test("(d) harga runtime dipakai sebelum tabel bawaan", () => {
  try {
    const prices = new Map<string, ModelPrice>([
      ["deepseek-v4.1-flash", { inputPerM: 0.3, outputPerM: 1.2 }],
    ]);
    setRuntimePricing(prices);
    const c = costOf({ model: "deepseek-v4.1-flash", inputTokens: 1_000_000, outputTokens: 1_000_000 });
    assert.ok(Math.abs(c - 1.5) < 1e-9, `expected 1.5, got ${c}`);
  } finally {
    clearRuntimePricing();
  }
});

test("(e) tanpa harga runtime, model tak dikenal tetap fallback opus", () => {
  clearRuntimePricing();
  const c = costOf({ model: "mystery-model", inputTokens: 1_000_000, outputTokens: 0 });
  assert.ok(Math.abs(c - 4) < 1e-9, "fallback opus input $4/1M");
});
