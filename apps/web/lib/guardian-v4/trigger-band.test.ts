import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import {
  calculateDefaultBand,
  validateTriggerBandInputs,
  buildTriggerBandArgs,
  ZERO_ADDRESS,
  MIN_TRIGGER_HF,
  MAX_TARGET_HF,
} from "./trigger-band";

describe("Guardian v4 trigger-band helpers", () => {
  const riskAgent: Address = "0x4eF8E7A6106Ffc768fcd12b5886319dA71CD42ca";

  describe("constants", () => {
    it("exports MIN_TRIGGER_HF and MAX_TARGET_HF constants matching GuardianCore", () => {
      assert.equal(MIN_TRIGGER_HF, 1.05);
      assert.equal(MAX_TARGET_HF, 3.0);
    });
  });

  describe("calculateDefaultBand", () => {
    it("computes min = static trigger and max = min(target - 0.05, static + 0.25)", () => {
      // Case 1: static 1.20, target 1.60
      // target - 0.05 = 1.55; static + 0.25 = 1.45 => min(1.55, 1.45) = 1.45
      const band1 = calculateDefaultBand(1.2, 1.6);
      assert.equal(band1.minTriggerHf, 1.2);
      assert.equal(band1.maxTriggerHf, 1.45);

      // Case 2: static 1.30, target 1.40
      // target - 0.05 = 1.35; static + 0.25 = 1.55 => min(1.35, 1.55) = 1.35
      const band2 = calculateDefaultBand(1.3, 1.4);
      assert.equal(band2.minTriggerHf, 1.3);
      assert.equal(band2.maxTriggerHf, 1.35);

      // Case 3: static 1.15, target 1.80
      // target - 0.05 = 1.75; static + 0.25 = 1.40 => min(1.75, 1.40) = 1.40
      const band3 = calculateDefaultBand(1.15, 1.8);
      assert.equal(band3.minTriggerHf, 1.15);
      assert.equal(band3.maxTriggerHf, 1.4);

      // Case 4: static 1.40, target 1.70
      // target - 0.05 = 1.65; static + 0.25 = 1.65 => 1.65
      const band4 = calculateDefaultBand(1.4, 1.7);
      assert.equal(band4.minTriggerHf, 1.4);
      assert.equal(band4.maxTriggerHf, 1.65);
    });

    it("rounds cleanly to 2 decimal places and ensures max >= min", () => {
      const band = calculateDefaultBand(1.234, 1.567);
      assert.equal(band.minTriggerHf, 1.23);
      assert.equal(band.maxTriggerHf, 1.48);
    });
  });

  describe("buildTriggerBandArgs", () => {
    it("returns correct arguments for opt-in", () => {
      const args = buildTriggerBandArgs({
        optIn: true,
        minTriggerHf: 1.2,
        maxTriggerHf: 1.45,
        riskAgent,
      });
      assert.deepEqual(args, {
        minTriggerHf: 1.2,
        maxTriggerHf: 1.45,
        riskAgent,
      });
    });

    it("returns zero address (0x0) for opt-off to reset band per GuardianCore", () => {
      const args = buildTriggerBandArgs({
        optIn: false,
        minTriggerHf: 1.2,
        maxTriggerHf: 1.45,
        riskAgent,
      });
      assert.equal(args.riskAgent, ZERO_ADDRESS);
      assert.equal(args.minTriggerHf, 0);
      assert.equal(args.maxTriggerHf, 0);
    });
  });

  describe("validateTriggerBandInputs", () => {
    it("passes when dynamic trigger is disabled (opt-off)", () => {
      const res = validateTriggerBandInputs({
        enabled: false,
        minTriggerHf: 0,
        maxTriggerHf: 0,
        targetHf: 1.5,
      });
      assert.equal(res.valid, true);
    });

    it("rejects when enabled without valid risk agent address", () => {
      const res1 = validateTriggerBandInputs({
        enabled: true,
        minTriggerHf: 1.2,
        maxTriggerHf: 1.4,
        targetHf: 1.6,
      });
      assert.equal(res1.valid, false);
      assert.match(res1.error ?? "", /risk agent/i);

      const res2 = validateTriggerBandInputs({
        enabled: true,
        minTriggerHf: 1.2,
        maxTriggerHf: 1.4,
        targetHf: 1.6,
        riskAgent: ZERO_ADDRESS,
      });
      assert.equal(res2.valid, false);
    });

    it("rejects when minTriggerHf < MIN_TRIGGER_HF (1.05)", () => {
      const res = validateTriggerBandInputs({
        enabled: true,
        minTriggerHf: 1.04,
        maxTriggerHf: 1.4,
        targetHf: 1.6,
        riskAgent,
      });
      assert.equal(res.valid, false);
      assert.match(res.error ?? "", /cannot be below 1.05/);
    });

    it("rejects when minTriggerHf > maxTriggerHf", () => {
      const res = validateTriggerBandInputs({
        enabled: true,
        minTriggerHf: 1.4,
        maxTriggerHf: 1.3,
        targetHf: 1.6,
        riskAgent,
      });
      assert.equal(res.valid, false);
      assert.match(res.error ?? "", /cannot exceed Max/i);
    });

    it("rejects when maxTriggerHf >= targetHf", () => {
      const res = validateTriggerBandInputs({
        enabled: true,
        minTriggerHf: 1.2,
        maxTriggerHf: 1.6,
        targetHf: 1.6,
        riskAgent,
      });
      assert.equal(res.valid, false);
      assert.match(res.error ?? "", /strictly less than target/i);
    });

    it("rejects when maxTriggerHf > MAX_TARGET_HF (3.0)", () => {
      const res = validateTriggerBandInputs({
        enabled: true,
        minTriggerHf: 1.2,
        maxTriggerHf: 3.1,
        targetHf: 3.5,
        riskAgent,
      });
      assert.equal(res.valid, false);
      assert.match(res.error ?? "", /cannot exceed 3.00/i);
    });

    it("passes for valid opt-in inputs", () => {
      const res = validateTriggerBandInputs({
        enabled: true,
        minTriggerHf: 1.2,
        maxTriggerHf: 1.45,
        targetHf: 1.6,
        riskAgent,
      });
      assert.equal(res.valid, true);
      assert.equal(res.error, undefined);
    });
  });
});
