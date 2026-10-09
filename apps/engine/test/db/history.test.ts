/**
 * Unit test history: mapRow + formatHistory (pure, tanpa DB).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mapRow, formatHistory } from "../../src/db/history.ts";

test("mapRow: ambil regime/direction/confidence dari report + token & model dari usage", () => {
  const row = mapRow({
    id: "abc",
    createdAt: new Date("2026-10-08T16:29:06Z"),
    report: { proposedRegime: "ELEVATED", direction: "DOWN", confidence: 0.55 },
    usage: {
      totalInputTokens: 42000,
      totalOutputTokens: 4234,
      roles: [{ role: "assessor", usedModel: "gemini:gemini-flash-latest" }],
    },
  });
  assert.equal(row.regime, "ELEVATED");
  assert.equal(row.direction, "DOWN");
  assert.equal(row.confidence, 0.55);
  assert.equal(row.totalTokens, 46234);
  assert.equal(row.assessorModel, "gemini:gemini-flash-latest");
});

test("mapRow: default aman bila field hilang", () => {
  const row = mapRow({ id: "x", createdAt: new Date(), report: {}, usage: {} });
  assert.equal(row.regime, "?");
  assert.equal(row.totalTokens, 0);
  assert.equal(row.assessorModel, "?");
});

test("formatHistory: tabel teks memuat header + baris", () => {
  const out = formatHistory([
    {
      id: "abc",
      createdAt: new Date("2026-10-08T16:29:06Z"),
      regime: "ELEVATED",
      direction: "DOWN",
      confidence: 0.55,
      totalTokens: 46234,
      assessorModel: "gemini:gemini-flash-latest",
    },
  ]);
  assert.match(out, /created_at/);
  assert.match(out, /ELEVATED/);
  assert.match(out, /46234/);
  assert.match(out, /gemini-flash-latest/);
});

test("formatHistory: kosong → pesan jelas", () => {
  assert.match(formatHistory([]), /no research reports/);
});
