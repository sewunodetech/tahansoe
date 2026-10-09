/**
 * Property test GUARDRAIL (spec §3.5.3): sinyal RESEARCH/NEWS/SOCIAL acak apa pun
 * (tanpa ORACLE/ONCHAIN/MACRO/TECHNICAL) TIDAK PERNAH menghasilkan regime ≥ STRESSED.
 * Kasus positif: menambahkan satu sinyal ONCHAIN searah membolehkan ≥ STRESSED.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { REGIMES } from "@tahansoe/domain";
import { decideRegime } from "../../src/fusion/regime.ts";
import { sig, NOW, resetSeq } from "./_fixtures.ts";

const rank = (r: string) => REGIMES.indexOf(r as (typeof REGIMES)[number]);

// PRNG deterministik (mulberry32) agar property test reproducible.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UNCONFIRMED: Array<"RESEARCH" | "NEWS" | "SOCIAL"> = ["RESEARCH", "NEWS", "SOCIAL"];
const PATHS = ["T1", "T2", "T3", "T4", "T8", "T9", "T10"] as const;

test("GUARDRAIL: 500 himpunan acak RESEARCH/NEWS/SOCIAL → tidak pernah ≥ STRESSED", () => {
  const rand = mulberry32(42);
  for (let iter = 0; iter < 500; iter++) {
    resetSeq();
    const n = 1 + Math.floor(rand() * 6);
    const signals = Array.from({ length: n }, () => {
      const module = UNCONFIRMED[Math.floor(rand() * UNCONFIRMED.length)]!;
      const paths = [PATHS[Math.floor(rand() * PATHS.length)]!];
      return sig({
        module,
        severity: rand(), // 0..1
        confidence: rand(),
        direction: rand() < 0.5 ? "DOWN" : "VOLATILITY",
        paths,
      });
    });
    const r = decideRegime({ now: NOW, signals });
    assert.ok(
      rank(r.regime) < rank("STRESSED"),
      `iter ${iter}: regime ${r.regime} ≥ STRESSED dari sinyal tak terkonfirmasi (reasons: ${r.reasons.join(",")})`,
    );
  }
});

test("GUARDRAIL: downgrade mencatat GUARDRAIL-RESEARCH-UNCONFIRMED saat skor tinggi", () => {
  resetSeq();
  // Banyak sinyal NEWS/RESEARCH kuat agar skor melewati ambang STRESSED, lalu di-guardrail.
  const signals = Array.from({ length: 8 }, (_, i) =>
    sig({ module: i % 2 === 0 ? "NEWS" : "RESEARCH", severity: 1, confidence: 1, direction: "DOWN", paths: ["T1"] }),
  );
  const r = decideRegime({ now: NOW, signals });
  assert.ok(rank(r.regime) < rank("STRESSED"), `got ${r.regime}`);
  // Bila kandidat sempat ≥ STRESSED, guardrail harus tercatat.
  if (rank(r.candidateRegime) >= rank("STRESSED") || r.reasons.includes("GUARDRAIL-RESEARCH-UNCONFIRMED")) {
    assert.ok(r.reasons.includes("GUARDRAIL-RESEARCH-UNCONFIRMED"));
  }
});

test("GUARDRAIL positif: tambah satu ONCHAIN searah → ≥ STRESSED diizinkan", () => {
  resetSeq();
  const signals = [
    sig({ module: "NEWS", severity: 0.9, confidence: 0.9, direction: "DOWN", paths: ["T1"] }),
    sig({ module: "RESEARCH", severity: 0.9, confidence: 0.9, direction: "DOWN", paths: ["T3"] }),
    sig({ module: "ONCHAIN", severity: 0.9, confidence: 0.9, direction: "DOWN", paths: ["T4"] }),
  ];
  const r = decideRegime({ now: NOW, signals });
  assert.ok(rank(r.regime) >= rank("STRESSED"), `got ${r.regime}`);
  assert.ok(!r.reasons.includes("GUARDRAIL-RESEARCH-UNCONFIRMED"));
});

test("GUARDRAIL T11: 500 himpunan acak sinyal T11-only → TIDAK PERNAH > ELEVATED", () => {
  const rand = mulberry32(1337);
  for (let iter = 0; iter < 500; iter++) {
    resetSeq();
    const count = 1 + Math.floor(rand() * 10);
    const signals = Array.from({ length: count }, () =>
      sig({
        module: "ONCHAIN",
        severity: rand(),
        confidence: rand(),
        direction: rand() < 0.5 ? "DOWN" : "VOLATILITY",
        paths: ["T11"],
      }),
    );
    const r = decideRegime({ now: NOW, signals });
    assert.ok(
      rank(r.regime) <= rank("ELEVATED"),
      `iter ${iter}: regime ${r.regime} > ELEVATED dari sinyal T11-only (reasons: ${r.reasons.join(",")})`,
    );
  }
});

test("GUARDRAIL T11: skor tinggi T11-only diturunkan ke ELEVATED dan mencatat GUARDRAIL-T11-ALONE", () => {
  resetSeq();
  // 10 sinyal ONCHAIN T11 dengan severity & confidence maksimum (skor agregat >> STRESSED/CRISIS)
  const signals = Array.from({ length: 10 }, () =>
    sig({
      module: "ONCHAIN",
      severity: 1.0,
      confidence: 1.0,
      direction: "DOWN",
      paths: ["T11"],
    }),
  );
  const r = decideRegime({ now: NOW, signals });
  assert.equal(r.regime, "ELEVATED", `expected ELEVATED, got ${r.regime}`);
  assert.ok(r.reasons.includes("GUARDRAIL-T11-ALONE"), "harus mencatat reason GUARDRAIL-T11-ALONE");
});

test("GUARDRAIL T11: RESEARCH/NEWS tidak bisa menumpang T11 untuk lolos ke STRESSED", () => {
  const rand = mulberry32(4242);
  for (let iter = 0; iter < 300; iter++) {
    resetSeq();
    const t11 = Array.from({ length: 1 + Math.floor(rand() * 5) }, () =>
      sig({ module: "ONCHAIN", severity: rand(), confidence: rand(), direction: "DOWN", paths: ["T11"] }),
    );
    const unconfirmed = Array.from({ length: 1 + Math.floor(rand() * 5) }, () =>
      sig({
        module: rand() < 0.5 ? "RESEARCH" : "NEWS",
        severity: 0.6 + rand() * 0.4,
        confidence: 0.6,
        direction: "DOWN",
        paths: [rand() < 0.5 ? "T1" : "T4"],
      }),
    );
    const r = decideRegime({ now: NOW, signals: [...t11, ...unconfirmed] });
    assert.ok(
      rank(r.regime) <= rank("ELEVATED"),
      `iter ${iter}: regime ${r.regime} > ELEVATED from T11 + unconfirmed signals (reasons: ${r.reasons.join(",")})`,
    );
  }
});

test("GUARDRAIL T11 positif: T11 disertai T7 (likuiditas reserve kering) diizinkan mencapai STRESSED", () => {
  resetSeq();
  const signals = [
    sig({
      module: "ONCHAIN",
      severity: 1.0,
      confidence: 1.0,
      direction: "DOWN",
      paths: ["T11", "T7"],
      observedHoursAgo: 0,
    }),
    sig({
      module: "ONCHAIN",
      severity: 1.0,
      confidence: 1.0,
      direction: "DOWN",
      paths: ["T11", "T7"],
      observedHoursAgo: 0,
    }),
  ];
  const r = decideRegime({ now: NOW, signals });
  assert.ok(rank(r.regime) >= rank("STRESSED"), `expected >= STRESSED, got ${r.regime}`);
  assert.ok(!r.reasons.includes("GUARDRAIL-T11-ALONE"));
});
