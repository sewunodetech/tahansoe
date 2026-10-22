import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  simulateCascade,
  isGuardianV2,
  L2_NONE,
  L2_ERC4626,
  L2_ATOKEN,
  type GuardianDeployment,
} from "../src";

describe("simulateCascade", () => {
  it("hand-checked test: v1 mode performs one action of 500 with new HF 1.362", () => {
    // collateral $5780, LT 0.825, debt $4000, trigger 1.3, target 1.6, L1 cap 500/bal 800/allow 1500
    const res = simulateCascade({
      collateralUsd: 5780,
      liquidationThreshold: 0.825,
      debtUsd: 4000,
      triggerHf: 1.3,
      targetHf: 1.6,
      version: 1,
      l1: {
        cap: 500,
        balance: 800,
        allowance: 1500,
      },
    });

    assert.equal(res.actionsCount, 1);
    assert.equal(res.l1Repay, 500);
    assert.equal(res.l2Repay, 0);
    assert.equal(res.l3Collateral, 0);
    assert.equal(res.l3Repay, 0);
    assert.equal(res.totalRepaid, 500);
    assert.equal(res.newDebtUsd, 3500);
    assert.equal(res.newCollateralUsd, 5780);
    // 5780 * 0.825 / 3500 = 4768.5 / 3500 = 1.36242857...
    assert.equal(res.newHf.toFixed(3), "1.362");
    assert.equal(res.status, "partial");
  });

  it("hand-checked test: v2 mode cascades L1 500 + L2 519.9 -> HF 1.60", () => {
    const res = simulateCascade({
      collateralUsd: 5780,
      liquidationThreshold: 0.825,
      debtUsd: 4000,
      triggerHf: 1.3,
      targetHf: 1.6,
      version: 2,
      l1: {
        cap: 500,
        balance: 800,
        allowance: 1500,
      },
      l2: {
        cap: 2500,
      },
    });

    assert.equal(res.actionsCount, 1);
    assert.equal(res.l1Repay, 500);
    // target debt = 5780 * 0.825 / 1.6001 = 2980.1262...
    // remaining need = (4000 - 2980.1262...) - 500 = 519.8737...
    assert.equal(res.l2Repay.toFixed(1), "519.9");
    assert.equal(res.l3Collateral, 0);
    assert.equal(res.l3Repay, 0);
    assert.equal(res.newHf.toFixed(2), "1.60");
    assert.equal(res.status, "target_reached");
  });

  it("v2 mode cascades into L3 when L1 and L2 caps are insufficient", () => {
    // collateral $5780, LT 0.825, debt $4000, trigger 1.3, target 1.6
    // L1 cap 300, L2 cap 200 -> total from L1+L2 is 500. Remaining needed ~519.9 solved by L3.
    const res = simulateCascade({
      collateralUsd: 5780,
      liquidationThreshold: 0.825,
      debtUsd: 4000,
      triggerHf: 1.3,
      targetHf: 1.6,
      version: 2,
      l1: { cap: 300 },
      l2: { cap: 200 },
      l3: {
        enabled: true,
        slippageBps: 50,
        flashPremiumBps: 5,
      },
    });

    assert.equal(res.l1Repay, 300);
    assert.equal(res.l2Repay, 200);
    assert.ok(res.l3Collateral > 0);
    assert.ok(res.l3Repay > 0);
    assert.equal(res.newHf.toFixed(2), "1.60");
    assert.equal(res.status, "target_reached");
  });

  it("respects L1 balance and allowance constraints", () => {
    // L1 cap is 1000, but balance is only 250 and allowance is 400 -> repays 250
    const res = simulateCascade({
      collateralUsd: 5780,
      liquidationThreshold: 0.825,
      debtUsd: 4000,
      triggerHf: 1.3,
      targetHf: 1.6,
      version: 2,
      l1: {
        cap: 1000,
        balance: 250,
        allowance: 400,
      },
    });

    assert.equal(res.l1Repay, 250);
    assert.equal(res.newDebtUsd, 3750);
  });

  it("returns not_at_risk when HF is already above trigger", () => {
    // Initial HF = 4768.5 / 3000 = 1.5895 >= 1.3
    const res = simulateCascade({
      collateralUsd: 5780,
      liquidationThreshold: 0.825,
      debtUsd: 3000,
      triggerHf: 1.3,
      targetHf: 1.6,
    });

    assert.equal(res.status, "not_at_risk");
    assert.equal(res.totalRepaid, 0);
    assert.equal(res.newHf, res.initialHf);
  });

  it("returns no_action when position needs protection but no layer is funded or enabled", () => {
    const res = simulateCascade({
      collateralUsd: 5780,
      liquidationThreshold: 0.825,
      debtUsd: 4000,
      triggerHf: 1.3,
      targetHf: 1.6,
      version: 2,
      l1: { enabled: false },
      l2: { enabled: false },
      l3: { enabled: false },
    });

    assert.equal(res.status, "no_action");
    assert.equal(res.totalRepaid, 0);
  });
});

describe("isGuardianV2", () => {
  it("identifies v1 as false and v2 as true", () => {
    const v1: GuardianDeployment = {
      version: 1,
      address: "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E",
      deployedBlock: 100,
    };
    const v2: GuardianDeployment = {
      version: 2,
      address: "0x2222222222222222222222222222222222222222",
      deployedBlock: 200,
    };
    assert.equal(isGuardianV2(v1), false);
    assert.equal(isGuardianV2(v2), true);
    assert.equal(isGuardianV2(undefined), false);
  });

  it("identifies deployment with features as v2 even if version < 2", () => {
    const v1WithFeatures: GuardianDeployment = {
      version: 1,
      address: "0x1111111111111111111111111111111111111111",
      deployedBlock: 100,
      features: { layer2: true },
    };
    assert.equal(isGuardianV2(v1WithFeatures), true);
  });

  it("exports Layer 2 kind constants", () => {
    assert.equal(L2_NONE, 0);
    assert.equal(L2_ERC4626, 1);
    assert.equal(L2_ATOKEN, 2);
  });
});
