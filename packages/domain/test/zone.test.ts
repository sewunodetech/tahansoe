import test from "node:test";
import assert from "node:assert/strict";
import { calculateZone, isAtRisk } from "../src/zone";

test("calculateZone: mengklasifikasikan HF ke zona yang tepat", () => {
  const trigger = 1.30;

  // Critical: hf <= trigger
  assert.equal(calculateZone(1.20, trigger), "Critical");
  assert.equal(calculateZone(1.30, trigger), "Critical");

  // Warning: trigger < hf <= trigger + 0.15
  assert.equal(calculateZone(1.31, trigger), "Warning");
  assert.equal(calculateZone(1.45, trigger), "Warning");

  // Watch: trigger + 0.15 < hf < 1.6
  assert.equal(calculateZone(1.46, trigger), "Watch");
  assert.equal(calculateZone(1.59, trigger), "Watch");

  // Safe: hf >= 1.6
  assert.equal(calculateZone(1.60, trigger), "Safe");
  assert.equal(calculateZone(2.50, trigger), "Safe");
});

test("isAtRisk: mengembalikan true hanya untuk Critical dan Warning", () => {
  assert.equal(isAtRisk("Critical"), true);
  assert.equal(isAtRisk("Warning"), true);
  assert.equal(isAtRisk("Watch"), false);
  assert.equal(isAtRisk("Safe"), false);
});
