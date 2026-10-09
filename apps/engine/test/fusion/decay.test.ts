/**
 * Unit test decay (§3.3), clampConfidence (§3.4), dan hysteresis (§3.5.4).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { decayFactor, effectiveWeight, clampConfidence } from "../../src/fusion/decay.ts";
import { decideRegime } from "../../src/fusion/regime.ts";
import { sig, NOW, resetSeq } from "./_fixtures.ts";

test("decay: sinyal lebih tua → bobot efektif lebih kecil", () => {
  resetSeq();
  const fresh = sig({ observedHoursAgo: 0.1, expiresInHours: 4 });
  const old = sig({ observedHoursAgo: 3.5, expiresInHours: 0.5 });
  const wFresh = effectiveWeight(fresh, NOW);
  const wOld = effectiveWeight(old, NOW);
  assert.ok(wFresh > wOld, `fresh ${wFresh} harus > old ${wOld}`);
});

test("decay: now ≥ expiresAt → faktor 0", () => {
  const expired = sig({ observedHoursAgo: 5, expiresInHours: -1 }); // expired 1 jam lalu
  assert.equal(decayFactor(expired, NOW), 0);
  assert.equal(effectiveWeight(expired, NOW), 0);
});

test("decay: rentang hidup tidak valid (observed == expires) → 0", () => {
  const s = sig();
  const bad = { ...s, observedAt: NOW, expiresAt: NOW };
  assert.equal(decayFactor(bad, NOW), 0);
});

test("clampConfidence: RESEARCH & NEWS/SOCIAL dijepit ≤ 0.6; module lain tidak", () => {
  assert.equal(clampConfidence({ module: "RESEARCH", confidence: 0.95 }), 0.6);
  assert.equal(clampConfidence({ module: "NEWS", confidence: 0.9 }), 0.6);
  assert.equal(clampConfidence({ module: "SOCIAL", confidence: 1 }), 0.6);
  assert.equal(clampConfidence({ module: "ONCHAIN", confidence: 0.9 }), 0.9);
  assert.equal(clampConfidence({ module: "ORACLE", confidence: 0.95 }), 0.95);
});

test("clampConfidence: RESEARCH conf > 0.6 memengaruhi effectiveWeight (dijepit)", () => {
  resetSeq();
  const high = sig({ module: "RESEARCH", confidence: 0.95, severity: 1, observedHoursAgo: 0 });
  const capped = sig({ module: "RESEARCH", confidence: 0.6, severity: 1, observedHoursAgo: 0 });
  // Keduanya memberi bobot sama karena 0.95 dijepit ke 0.6.
  assert.ok(Math.abs(effectiveWeight(high, NOW) - effectiveWeight(capped, NOW)) < 1e-9);
});

test("hysteresis: naik segera (prior CALM → kandidat STRESSED)", () => {
  resetSeq();
  const r = decideRegime({
    now: NOW,
    signals: [sig({ module: "ORACLE", paths: ["T10"], severity: 0.9 })],
    prior: { regime: "CALM", createdAt: new Date(NOW.getTime() - 5 * 60_000) },
  });
  assert.equal(r.regime, "STRESSED", "naik segera tanpa penahanan");
  assert.ok(!r.reasons.includes("HYSTERESIS-HOLD"));
});

test("hysteresis: turun TERTAHAN bila cooldown belum terpenuhi (HYSTERESIS-HOLD)", () => {
  resetSeq();
  // Kondisi sekarang tenang (CALM), tapi prior STRESSED baru 5 menit lalu.
  const r = decideRegime({
    now: NOW,
    signals: [sig({ module: "ONCHAIN", severity: 0.1, confidence: 0.3, paths: ["T7"] })],
    prior: { regime: "STRESSED", createdAt: new Date(NOW.getTime() - 5 * 60_000) },
  });
  assert.equal(r.regime, "STRESSED", "ditahan di regime prior");
  assert.ok(r.reasons.includes("HYSTERESIS-HOLD"));
});

test("hysteresis: turun DIIZINKAN setelah cooldown + margin terpenuhi", () => {
  resetSeq();
  const r = decideRegime({
    now: NOW,
    signals: [sig({ module: "ONCHAIN", severity: 0.1, confidence: 0.3, paths: ["T7"] })],
    prior: { regime: "STRESSED", createdAt: new Date(NOW.getTime() - 120 * 60_000) }, // 2 jam lalu
  });
  assert.notEqual(r.regime, "STRESSED", "boleh turun setelah cooldown");
  assert.ok(!r.reasons.includes("HYSTERESIS-HOLD"));
});
