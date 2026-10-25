import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateDefaultBand,
  calculateDynamicTrigger,
  TARGET_BUFFER_WAD,
  WAD,
  WAD_0_10,
  WAD_0_20,
} from "../src/dynamic-trigger.ts";
import { parseScenario, replayPriceAt, replayRegimeAt } from "../src/scenario.ts";

describe("dynamic trigger calculation and band clamping", () => {
  const agent = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

  // Standard policy: trigger 1.25, target 1.55, band 1.20 - 1.50
  const standardBand = {
    minTriggerHF: 12n * 10n ** 17n, // 1.20
    maxTriggerHF: 15n * 10n ** 17n, // 1.50
  };
  const staticTrigger = 125n * 10n ** 16n; // 1.25
  const targetHF = 155n * 10n ** 16n; // 1.55

  it("CALM maps to static trigger within band", () => {
    const trigger = calculateDynamicTrigger({
      regime: "CALM",
      band: standardBand,
      staticTriggerHF: staticTrigger,
      targetHF,
    });
    assert.equal(trigger, staticTrigger);
    assert.ok(trigger >= standardBand.minTriggerHF);
    assert.ok(trigger <= standardBand.maxTriggerHF);
    assert.ok(trigger < targetHF);
  });

  it("ELEVATED maps to static + 0.10 WAD within band", () => {
    const trigger = calculateDynamicTrigger({
      regime: "ELEVATED",
      band: standardBand,
      staticTriggerHF: staticTrigger,
      targetHF,
    });
    assert.equal(trigger, staticTrigger + WAD_0_10); // 1.35
    assert.ok(trigger >= standardBand.minTriggerHF);
    assert.ok(trigger <= standardBand.maxTriggerHF);
    assert.ok(trigger < targetHF);
  });

  it("STRESSED maps to static + 0.20 WAD within band", () => {
    const trigger = calculateDynamicTrigger({
      regime: "STRESSED",
      band: standardBand,
      staticTriggerHF: staticTrigger,
      targetHF,
    });
    assert.equal(trigger, staticTrigger + WAD_0_20); // 1.45
    assert.ok(trigger >= standardBand.minTriggerHF);
    assert.ok(trigger <= standardBand.maxTriggerHF);
    assert.ok(trigger < targetHF);
  });

  it("CRISIS maps to band maxTriggerHF", () => {
    const trigger = calculateDynamicTrigger({
      regime: "CRISIS",
      band: standardBand,
      staticTriggerHF: staticTrigger,
      targetHF,
    });
    assert.equal(trigger, standardBand.maxTriggerHF); // 1.50
    assert.ok(trigger >= standardBand.minTriggerHF);
    assert.ok(trigger <= standardBand.maxTriggerHF);
    assert.ok(trigger < targetHF);
  });

  it("clamps candidate trigger to band minTriggerHF if static < min", () => {
    const lowStatic = 110n * 10n ** 16n; // 1.10 < min 1.20
    const trigger = calculateDynamicTrigger({
      regime: "CALM",
      band: standardBand,
      staticTriggerHF: lowStatic,
      targetHF,
    });
    assert.equal(trigger, standardBand.minTriggerHF);
  });

  it("clamps candidate trigger to band maxTriggerHF if static + buffer exceeds max", () => {
    const tightBand = {
      minTriggerHF: 120n * 10n ** 16n, // 1.20
      maxTriggerHF: 135n * 10n ** 16n, // 1.35
    };
    // STRESSED would want 1.25 + 0.20 = 1.45, but max is 1.35
    const trigger = calculateDynamicTrigger({
      regime: "STRESSED",
      band: tightBand,
      staticTriggerHF: staticTrigger,
      targetHF,
    });
    assert.equal(trigger, tightBand.maxTriggerHF);
  });

  it("strictly enforces triggerHF < targetHF when band max >= targetHF", () => {
    const highMaxBand = {
      minTriggerHF: 120n * 10n ** 16n, // 1.20
      maxTriggerHF: 160n * 10n ** 16n, // 1.60
    };
    const lowTarget = 150n * 10n ** 16n; // 1.50 <= maxTriggerHF (1.60)

    const trigger = calculateDynamicTrigger({
      regime: "CRISIS",
      band: highMaxBand,
      staticTriggerHF: staticTrigger,
      targetHF: lowTarget,
    });
    // Must be strictly below targetHF
    assert.ok(trigger < lowTarget, "trigger must be strictly below targetHF");
    assert.equal(trigger, lowTarget - TARGET_BUFFER_WAD);
  });

  it("calculateDefaultBand sets min=static and max below target capped at 1.60", () => {
    const policy = {
      triggerHF: 125n * 10n ** 16n, // 1.25
      targetHF: 170n * 10n ** 16n, // 1.70
    };
    const band = calculateDefaultBand(policy, agent);
    assert.equal(band.minTriggerHF, policy.triggerHF);
    assert.equal(band.maxTriggerHF, 160n * 10n ** 16n); // capped at 1.60
    assert.equal(band.riskAgent, agent);
  });

  it("calculateDefaultBand sets max with 0.05 buffer below target when target is close", () => {
    const policy = {
      triggerHF: 125n * 10n ** 16n, // 1.25
      targetHF: 150n * 10n ** 16n, // 1.50
    };
    const band = calculateDefaultBand(policy, agent);
    assert.equal(band.minTriggerHF, policy.triggerHF);
    assert.equal(band.maxTriggerHF, 145n * 10n ** 16n); // 1.50 - 0.05 = 1.45
    assert.ok(band.maxTriggerHF < policy.targetHF);
  });
});

describe("scenario regime evaluation", () => {
  const scenarioWithRegimes = parseScenario({
    id: "test-regimes",
    title: "Test Regimes",
    description: "Scenario with explicit regime series",
    source: "synthetic",
    normalized: false,
    points: [
      { t: 1000, price: 3000 },
      { t: 2000, price: 2800 },
      { t: 3000, price: 2500 },
      { t: 4000, price: 2000 },
    ],
    regimes: [
      { t: 1000, regime: "CALM" },
      { t: 1800, regime: "ELEVATED" },
      { t: 2500, regime: "STRESSED" },
      { t: 3200, regime: "CRISIS" },
    ],
  });

  const opts = { compression: 1, startPrice: 3000 };

  it("steps through explicit regime series by scenario timestamp", () => {
    // elapsedMs = 0 -> t = 1000 -> CALM
    assert.equal(replayRegimeAt(scenarioWithRegimes, 0, opts), "CALM");
    assert.equal(replayPriceAt(scenarioWithRegimes, 0, opts).regime, "CALM");

    // elapsedMs = 800_000 -> t = 1800 -> ELEVATED
    assert.equal(replayRegimeAt(scenarioWithRegimes, 800_000, opts), "ELEVATED");
    assert.equal(replayPriceAt(scenarioWithRegimes, 800_000, opts).regime, "ELEVATED");

    // elapsedMs = 1_600_000 -> t = 2600 -> STRESSED
    assert.equal(replayRegimeAt(scenarioWithRegimes, 1_600_000, opts), "STRESSED");
    assert.equal(replayPriceAt(scenarioWithRegimes, 1_600_000, opts).regime, "STRESSED");

    // elapsedMs = 2_500_000 -> t = 3500 -> CRISIS
    assert.equal(replayRegimeAt(scenarioWithRegimes, 2_500_000, opts), "CRISIS");
    assert.equal(replayPriceAt(scenarioWithRegimes, 2_500_000, opts).regime, "CRISIS");
  });

  it("derives hindsight regime from drawdown when regimes series is absent", () => {
    const rawScenario = parseScenario({
      id: "test-no-regimes",
      title: "Test No Regimes",
      description: "Scenario without explicit regime series",
      source: "synthetic",
      normalized: false,
      points: [
        { t: 1000, price: 1000 },
        { t: 2000, price: 950 },  // 5% drop -> ELEVATED
        { t: 3000, price: 880 },  // 12% drop -> STRESSED
        { t: 4000, price: 750 },  // 25% drop -> CRISIS
      ],
    });

    assert.equal(replayRegimeAt(rawScenario, 0, opts), "CALM");
    // t = 2000 (elapsedMs = 1000 * 1000)
    assert.equal(replayRegimeAt(rawScenario, 1_000_000, opts), "ELEVATED");
    // t = 3000 (elapsedMs = 2000 * 1000)
    assert.equal(replayRegimeAt(rawScenario, 2_000_000, opts), "STRESSED");
    // t = 4000 (elapsedMs = 3000 * 1000)
    assert.equal(replayRegimeAt(rawScenario, 3_000_000, opts), "CRISIS");
  });
});
