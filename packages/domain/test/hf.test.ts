import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hfRequired, dropTolerance, clampTrigger } from "../src/hf";

describe("hfRequired", () => {
  it("menghitung HF yang dibutuhkan persis sesuai contoh PRD §4.2", () => {
    // d = 0% -> HF = 1.0
    assert.equal(hfRequired(0), 1);

    // d = 25% -> HF 1.333... (PRD §4.2: d=25% -> HF 1.33)
    const hf25 = hfRequired(0.25);
    assert.equal(hf25, 4 / 3);
    assert.ok(Math.abs(hf25 - 1.3333333333333333) < 1e-12);

    // d = 15% -> ~1.18
    const hf15 = hfRequired(0.15);
    assert.ok(Math.abs(hf15 - 1 / 0.85) < 1e-12);
    assert.equal(hf15.toFixed(2), "1.18");

    // d = 30% -> ~1.43
    const hf30 = hfRequired(0.30);
    assert.ok(Math.abs(hf30 - 1 / 0.70) < 1e-12);
    assert.equal(hf30.toFixed(2), "1.43");

    // d = 40% -> ~1.67
    const hf40 = hfRequired(0.40);
    assert.ok(Math.abs(hf40 - 1 / 0.60) < 1e-12);
    assert.equal(hf40.toFixed(2), "1.67");
  });

  it("memvalidasi interval input d di [0, 1)", () => {
    // d < 0 harus lempar RangeError
    assert.throws(() => hfRequired(-0.01), RangeError);
    assert.throws(() => hfRequired(-1), RangeError);

    // d >= 1 harus lempar RangeError
    assert.throws(() => hfRequired(1), RangeError);
    assert.throws(() => hfRequired(1.5), RangeError);

    // non-finite / non-number harus lempar TypeError
    assert.throws(() => hfRequired(Number.NaN), TypeError);
    assert.throws(() => hfRequired(Number.POSITIVE_INFINITY), TypeError);
  });
});

describe("dropTolerance", () => {
  it("menghitung toleransi penurunan persis sesuai tabel knowledge §5", () => {
    // hf = 1.0 -> 0%
    assert.equal(dropTolerance(1.0), 0);

    // hf = 1.25 -> 20%
    assert.ok(Math.abs(dropTolerance(1.25) - 0.2) < 1e-12);

    // hf = 1.30 -> ~23%
    const dt130 = dropTolerance(1.30);
    assert.ok(Math.abs(dt130 - (1 - 1 / 1.30)) < 1e-12);
    assert.equal((dt130 * 100).toFixed(1), "23.1");

    // hf = 1.50 -> ~33.3%
    const dt150 = dropTolerance(1.50);
    assert.ok(Math.abs(dt150 - 1 / 3) < 1e-12);

    // hf = 1.60 -> 37.5%
    assert.equal(dropTolerance(1.60), 0.375);

    // hf = 2.00 -> 50%
    assert.equal(dropTolerance(2.00), 0.5);
  });

  it("merupakan fungsi invers timbal-balik dari hfRequired", () => {
    const d = 0.25;
    const hf = hfRequired(d);
    assert.ok(Math.abs(dropTolerance(hf) - d) < 1e-12);

    const initialHf = 1.6;
    const tolerance = dropTolerance(initialHf);
    assert.ok(Math.abs(hfRequired(tolerance) - initialHf) < 1e-12);
  });

  it("memvalidasi input hf > 0", () => {
    assert.throws(() => dropTolerance(0), RangeError);
    assert.throws(() => dropTolerance(-1), RangeError);
    assert.throws(() => dropTolerance(Number.NaN), TypeError);
    assert.throws(() => dropTolerance(Number.NEGATIVE_INFINITY), TypeError);
  });
});

describe("clampTrigger", () => {
  const defaultBand = { min: 1.25, max: 1.60 };

  it("meng-clamp trigger ke batas min jika di bawah band", () => {
    assert.equal(clampTrigger(1.15, defaultBand), 1.25);
    assert.equal(clampTrigger(1.24, defaultBand), 1.25);
  });

  it("membiarkan trigger jika berada di dalam band", () => {
    assert.equal(clampTrigger(1.25, defaultBand), 1.25);
    assert.equal(clampTrigger(1.40, defaultBand), 1.40);
    assert.equal(clampTrigger(1.60, defaultBand), 1.60);
  });

  it("meng-clamp trigger ke batas max jika di atas band", () => {
    assert.equal(clampTrigger(1.65, defaultBand), 1.60);
    assert.equal(clampTrigger(2.00, defaultBand), 1.60);
  });

  it("melempar error jika band min > band max", () => {
    assert.throws(
      () => clampTrigger(1.30, { min: 1.60, max: 1.25 }),
      RangeError
    );
  });

  it("memvalidasi tipe parameter", () => {
    assert.throws(
      () => clampTrigger(Number.NaN, defaultBand),
      TypeError
    );
    assert.throws(
      () => clampTrigger(1.30, { min: Number.NaN, max: 1.60 }),
      TypeError
    );
  });
});
