/**
 * Unit test toSignal (spec §6): cap confidence & expiresAt.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { toSignal } from "../../src/agents/to-signal.ts";
import type { ResearchReport } from "../../src/agents/schemas.ts";

function baseReport(overrides: Partial<ResearchReport> = {}): ResearchReport {
  return {
    assets: ["WETH"],
    proposedRegime: "ELEVATED",
    direction: "DOWN",
    paths: [
      { path: "T1", severity: 0.4, rationale: "r1" },
      { path: "T3", severity: 0.7, rationale: "r3" },
    ],
    keyDevelopments: [
      {
        summary: "dev",
        evidence: [{ summary: "e", source: "NEWS" }],
      },
    ],
    hawkCase: "hawk",
    doveCase: "dove",
    confidence: 0.9,
    horizonHours: 12,
    ...overrides,
  };
}

test("confidence di-cap ke 0.6", () => {
  const sig = toSignal(baseReport({ confidence: 0.9 }));
  assert.equal(sig.confidence, 0.6);
});

test("confidence di bawah cap tidak diubah", () => {
  const sig = toSignal(baseReport({ confidence: 0.3 }));
  assert.equal(sig.confidence, 0.3);
});

test("severity = max(paths.severity)", () => {
  const sig = toSignal(baseReport());
  assert.equal(sig.severity, 0.7);
});

test("expiresAt = createdAt + horizonHours", () => {
  const createdAt = new Date("2026-10-08T00:00:00.000Z");
  const sig = toSignal(baseReport({ horizonHours: 6 }), createdAt);
  assert.equal(sig.expiresAt.toISOString(), "2026-10-08T06:00:00.000Z");
});

test("evidence diratakan dari keyDevelopments", () => {
  const sig = toSignal(baseReport());
  assert.equal(sig.evidence.length, 1);
  assert.equal(sig.module, "RESEARCH");
});
