/**
 * Unit test aturan regime (spec §3.5.1–§3.5.2). Satu test per aturan floor + skor.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { decideRegime } from "../../src/fusion/regime.ts";
import { sig, NOW, resetSeq } from "./_fixtures.ts";

test("R-MACRO-SOON: MACRO terjadwal ≤ 18 jam → ELEVATED", () => {
  resetSeq();
  const r = decideRegime({ now: NOW, signals: [sig({ module: "MACRO", horizonHours: 18, severity: 0.3 })] });
  assert.ok(["ELEVATED", "STRESSED", "CRISIS"].includes(r.regime), `got ${r.regime}`);
  assert.ok(r.reasons.includes("R-MACRO-SOON"));
});

test("R-MACRO-SOON: MACRO jauh (>18 jam) tidak memicu floor", () => {
  resetSeq();
  const r = decideRegime({ now: NOW, signals: [sig({ module: "MACRO", horizonHours: 48, severity: 0.3 })] });
  assert.ok(!r.reasons.includes("R-MACRO-SOON"));
});

test("R-SEQUENCER-DOWN: ORACLE T10 → ≥ STRESSED", () => {
  resetSeq();
  const r = decideRegime({ now: NOW, signals: [sig({ module: "ORACLE", paths: ["T10"], severity: 0.9 })] });
  assert.ok(["STRESSED", "CRISIS"].includes(r.regime), `got ${r.regime}`);
  assert.ok(r.reasons.includes("R-SEQUENCER-DOWN"));
});

test("R-DEPEG-CONFIRMED: ONCHAIN T4 → STRESSED; severity besar → CRISIS", () => {
  resetSeq();
  const stressed = decideRegime({ now: NOW, signals: [sig({ module: "ONCHAIN", paths: ["T4"], severity: 0.6 })] });
  assert.equal(stressed.regime, "STRESSED");
  assert.ok(stressed.reasons.includes("R-DEPEG-CONFIRMED"));

  const crisis = decideRegime({ now: NOW, signals: [sig({ module: "ONCHAIN", paths: ["T4"], severity: 0.95 })] });
  assert.equal(crisis.regime, "CRISIS");
});

test("R-EXPLOIT-CONFIRMED: ONCHAIN T9 + NEWS → STRESSED; tanpa NEWS tidak", () => {
  resetSeq();
  const withNews = decideRegime({
    now: NOW,
    signals: [sig({ module: "ONCHAIN", paths: ["T9"], severity: 0.85 }), sig({ module: "NEWS", severity: 0.5, confidence: 0.5 })],
  });
  assert.ok(["STRESSED", "CRISIS"].includes(withNews.regime));
  assert.ok(withNews.reasons.includes("R-EXPLOIT-CONFIRMED"));

  const noNews = decideRegime({ now: NOW, signals: [sig({ module: "ONCHAIN", paths: ["T9"], severity: 0.85 })] });
  assert.ok(!noNews.reasons.includes("R-EXPLOIT-CONFIRMED"));
});

test("R-ORACLE-DEVIATION: ORACLE T8 severity tinggi → STRESSED; severity rendah tidak", () => {
  resetSeq();
  const high = decideRegime({ now: NOW, signals: [sig({ module: "ORACLE", paths: ["T8"], severity: 0.7 })] });
  assert.ok(high.reasons.includes("R-ORACLE-DEVIATION"));
  assert.ok(["STRESSED", "CRISIS"].includes(high.regime));

  const low = decideRegime({ now: NOW, signals: [sig({ module: "ORACLE", paths: ["T8"], severity: 0.1 })] });
  assert.ok(!low.reasons.includes("R-ORACLE-DEVIATION"));
});

test("skor agregat: banyak sinyal DOWN kuat → regime naik via SCORE-*", () => {
  resetSeq();
  const r = decideRegime({
    now: NOW,
    signals: [
      sig({ module: "ONCHAIN", severity: 0.9, confidence: 0.9, direction: "DOWN" }),
      sig({ module: "TECHNICAL", severity: 0.9, confidence: 0.9, direction: "DOWN" }),
      sig({ module: "ORACLE", severity: 0.8, confidence: 0.9, direction: "DOWN" }),
    ],
  });
  assert.ok(["STRESSED", "CRISIS", "ELEVATED"].includes(r.regime));
  assert.ok(r.reasons.some((x) => x.startsWith("SCORE-")));
});

test("multi-path bonus: ≥3 jalur berbeda → MULTI-PATH-BONUS di reasons", () => {
  resetSeq();
  const r = decideRegime({
    now: NOW,
    signals: [
      sig({ module: "TECHNICAL", severity: 0.6, confidence: 0.7, paths: ["T1"] }),
      sig({ module: "TECHNICAL", severity: 0.6, confidence: 0.7, paths: ["T3"] }),
      sig({ module: "ONCHAIN", severity: 0.6, confidence: 0.7, paths: ["T6"] }),
    ],
  });
  assert.ok(r.reasons.includes("MULTI-PATH-BONUS"));
});

test("CALM: hanya sinyal tenang → CALM", () => {
  resetSeq();
  const r = decideRegime({
    now: NOW,
    signals: [
      sig({ module: "ONCHAIN", severity: 0.15, confidence: 0.5, paths: ["T7"] }),
      sig({ module: "ORACLE", severity: 0.1, confidence: 0.5, paths: ["T8"] }),
    ],
  });
  assert.equal(r.regime, "CALM");
});
