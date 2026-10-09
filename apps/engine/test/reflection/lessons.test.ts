/**
 * Unit test rankLessons (spec §6): ≤ 5, hanya aktif, irisan jalur.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { rankLessons, type StoredLesson } from "../../src/reflection/lessons.ts";
import type { TransmissionPath } from "../../src/agents/schemas.ts";

function lesson(id: string, paths: TransmissionPath[], active = true, dayOffset = 0): StoredLesson {
  return {
    id,
    paths,
    lesson: `lesson ${id}`,
    active,
    createdAt: new Date(Date.UTC(2026, 9, 1 + dayOffset)),
  };
}

test("hanya lesson aktif yang dipilih", () => {
  const stored = [lesson("a", ["T1"], true), lesson("b", ["T1"], false)];
  const out = rankLessons(stored, new Set<TransmissionPath>(["T1"]));
  assert.equal(out.length, 1);
});

test("hanya lesson dengan irisan jalur", () => {
  const stored = [lesson("a", ["T1"]), lesson("b", ["T7"])];
  const out = rankLessons(stored, new Set<TransmissionPath>(["T1"]));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0]?.paths, ["T1"]);
});

test("maksimal 5 lesson", () => {
  const stored = Array.from({ length: 8 }, (_, i) => lesson(String(i), ["T1"], true, i));
  const out = rankLessons(stored, new Set<TransmissionPath>(["T1"]));
  assert.equal(out.length, 5);
});

test("urut irisan terbanyak dulu, lalu terbaru", () => {
  const stored = [
    lesson("few", ["T1"], true, 5),
    lesson("many", ["T1", "T3"], true, 0),
  ];
  const out = rankLessons(stored, new Set<TransmissionPath>(["T1", "T3"]));
  assert.equal(out[0]?.lesson, "lesson many");
});
