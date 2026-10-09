/**
 * Unit test drawdown (§3.6), HF rekomendasi (hfRequired), dan graceful
 * degradation fuse() (§4).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { hfRequired } from "@tahansoe/domain";
import { estimateDrawdown, realizedVolPerHour, MIN_PRICE_SAMPLES } from "../../src/fusion/drawdown.ts";
import { fuse } from "../../src/fusion/fuse.ts";
import { D_MAX } from "../../src/fusion/config.ts";
import { sig, NOW, priceSeries, resetSeq } from "./_fixtures.ts";

test("estimateDrawdown: h4 ≤ h24 (scaling akar waktu)", () => {
  const d = estimateDrawdown(0.01, "CALM");
  assert.ok(d.h4 < d.h24, `h4 ${d.h4} harus < h24 ${d.h24}`);
  assert.ok(d.h4 >= 0 && d.h24 <= D_MAX);
});

test("estimateDrawdown: regime lebih tinggi → drawdown lebih besar", () => {
  const calm = estimateDrawdown(0.01, "CALM");
  const crisis = estimateDrawdown(0.01, "CRISIS");
  assert.ok(crisis.h4 > calm.h4);
});

test("estimateDrawdown: clamp ke D_MAX", () => {
  const d = estimateDrawdown(1.0, "CRISIS"); // vol sangat besar
  assert.ok(d.h4 <= D_MAX && d.h24 <= D_MAX);
});

test("realizedVolPerHour: data kurang → null", () => {
  assert.equal(realizedVolPerHour([]), null);
  assert.equal(realizedVolPerHour(priceSeries(MIN_PRICE_SAMPLES - 1, 0.01)), null);
});

test("realizedVolPerHour: deret cukup → angka positif", () => {
  const v = realizedVolPerHour(priceSeries(30, 0.01, 1000, 60, NOW));
  assert.ok(typeof v === "number" && v! > 0, `vol ${v}`);
});

test("recommendedTriggerHF == hfRequired(d_reaction) sesuai PRD §4.2", () => {
  resetSeq();
  const a = fuse({
    asset: "ETH",
    chainId: 42161,
    now: NOW,
    signals: [sig({ module: "ORACLE", paths: ["T10"], severity: 0.9 })],
    priceSamples: priceSeries(30, 0.01, 1000, 60, NOW),
  });
  assert.ok(a);
  const expected = hfRequired(a!.drawdownEstimate.h4);
  assert.ok(Math.abs(a!.recommendedTriggerHF - expected) < 1e-9);
  assert.ok(a!.recommendedTargetHF > a!.recommendedTriggerHF);
});

test("fuse: tidak meng-clamp band user (trigger bisa < 1.25)", () => {
  resetSeq();
  // Vol sangat kecil + CALM → d kecil → hfRequired mendekati 1.0 (< 1.25).
  const a = fuse({
    asset: "ETH",
    chainId: 42161,
    now: NOW,
    signals: [sig({ module: "TECHNICAL", severity: 0.2, confidence: 0.4, direction: "DOWN" })],
    priceSamples: priceSeries(40, 0.0005, 1000, 60, NOW),
  });
  assert.ok(a);
  assert.ok(a!.recommendedTriggerHF < 1.25, `trigger ${a!.recommendedTriggerHF} harus bisa < 1.25 (tanpa clamp)`);
});

test("fuse: deterministik (input sama → output sama kecuali tidak ada waktu acak)", () => {
  resetSeq();
  const args = {
    asset: "ETH",
    chainId: 42161,
    now: NOW,
    signals: [sig({ module: "ONCHAIN", paths: ["T4"], severity: 0.6 })],
    priceSamples: priceSeries(30, 0.01, 1000, 60, NOW),
  };
  resetSeq();
  const a1 = fuse(args);
  resetSeq();
  const a2 = fuse(args);
  assert.deepEqual(a1, a2);
});

test("fuse: graceful degradation — tanpa sinyal aktif → null", () => {
  resetSeq();
  // Semua kedaluwarsa.
  const expired = sig({ observedHoursAgo: 5, expiresInHours: -1 });
  assert.equal(fuse({ asset: "ETH", chainId: 42161, now: NOW, signals: [expired] }), null);
  // Benar-benar kosong.
  assert.equal(fuse({ asset: "ETH", chainId: 42161, now: NOW, signals: [] }), null);
});

test("fuse: tanpa price samples → fallback vol + catatan di explanation", () => {
  resetSeq();
  const a = fuse({
    asset: "ETH",
    chainId: 42161,
    now: NOW,
    signals: [sig({ module: "ORACLE", paths: ["T10"], severity: 0.9 })],
  });
  assert.ok(a);
  assert.match(a!.explanation, /insufficient price history/);
  assert.ok(a!.drawdownEstimate.h4 > 0);
});
