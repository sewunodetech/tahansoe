import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  simulateCascade,
  isGuardianV2,
  L2_NONE,
  L2_ERC4626,
  L2_ATOKEN,
  type GuardianDeployment,
  SUCCESS_FEE_BPS,
  FEE_HF_CEILING,
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

describe("fee-math parity vectors (ADR 0013 / spec m4 §3.5)", () => {
  it("exports fee constants", () => {
    assert.equal(SUCCESS_FEE_BPS, 15);
    assert.equal(FEE_HF_CEILING, 1.5);
  });

  it("vector 1: fee paid from Source A only (leftover debt tokens)", () => {
    // Collateral $100,000, LT 0.8, debt $80,000 -> initial HF = 1.0 (< static trigger 1.3 && < 1.50)
    // L1 cap 10,000, balance 10,000, allowance 10,000 -> repaid 10,000.
    // Fee = floor(10,000 * 15 / 10,000) = 15.
    // leftoverDebtUsd = 15, remaining wallet balance = 0 after L1 repay.
    const res = simulateCascade({
      collateralUsd: 100_000,
      liquidationThreshold: 0.8,
      debtUsd: 80_000,
      triggerHf: 1.3,
      targetHf: 1.6,
      staticTriggerHf: 1.3,
      leftoverDebtUsd: 15,
      version: 2,
      l1: {
        cap: 10_000,
        balance: 10_000,
        allowance: 10_000,
      },
    });

    assert.equal(res.feeEligible, true);
    assert.equal(res.totalRepaid, 10_000);
    assert.equal(res.fee, 15);
    assert.equal(res.feeWaived, 0);
  });

  it("vector 2: fee paid from Source B only (wallet balance within allowance)", () => {
    // leftoverDebtUsd = 0.
    // L1 balance = 15,000, allowance = 15,000. Repays 10,000.
    // Remaining wallet balance = 5,000, remaining allowance = 5,000.
    // Fee = 15, fully paid from wallet.
    const res = simulateCascade({
      collateralUsd: 100_000,
      liquidationThreshold: 0.8,
      debtUsd: 80_000,
      triggerHf: 1.3,
      targetHf: 1.6,
      leftoverDebtUsd: 0,
      version: 2,
      l1: {
        cap: 10_000,
        balance: 15_000,
        allowance: 15_000,
      },
    });

    assert.equal(res.feeEligible, true);
    assert.equal(res.totalRepaid, 10_000);
    assert.equal(res.fee, 15);
    assert.equal(res.feeWaived, 0);
  });

  it("vector 3: fee paid from Source A + B combined", () => {
    // leftoverDebtUsd = 9 (Source A pays 9). Remaining fee = 6.
    // Wallet balance = 10,006, allowance = 10,006. After repay 10,000, remaining = 6.
    // Source B pays 6.
    // Total fee paid = 15, feeWaived = 0.
    const res = simulateCascade({
      collateralUsd: 100_000,
      liquidationThreshold: 0.8,
      debtUsd: 80_000,
      triggerHf: 1.3,
      targetHf: 1.6,
      leftoverDebtUsd: 9,
      version: 2,
      l1: {
        cap: 10_000,
        balance: 10_006,
        allowance: 10_006,
      },
    });

    assert.equal(res.feeEligible, true);
    assert.equal(res.totalRepaid, 10_000);
    assert.equal(res.fee, 15);
    assert.equal(res.feeWaived, 0);
  });

  it("vector 4: shortfall waived when leftover + wallet balance are insufficient", () => {
    // leftoverDebtUsd = 5 (Source A pays 5). Remaining needed = 10.
    // Wallet balance = 10_004, allowance = 10_004. After repay 10,000, remaining = 4.
    // Source B pays 4. Total paid = 9. Shortfall waived = 15 - 9 = 6.
    // Crucial: repay amount remains exactly 10,000 (fee never changes repay amounts).
    const res = simulateCascade({
      collateralUsd: 100_000,
      liquidationThreshold: 0.8,
      debtUsd: 80_000,
      triggerHf: 1.3,
      targetHf: 1.6,
      leftoverDebtUsd: 5,
      version: 2,
      l1: {
        cap: 10_000,
        balance: 10_004,
        allowance: 10_004,
      },
    });

    assert.equal(res.feeEligible, true);
    assert.equal(res.totalRepaid, 10_000);
    assert.equal(res.fee, 9);
    assert.equal(res.feeWaived, 6);
  });

  it("vector 5: dynamic-trigger-only is NOT eligible for fee", () => {
    // static trigger = 1.20, dynamic trigger elevated to 1.35.
    // Collateral $100,000, LT 0.8, debt $64,000 -> initial HF = 1.25.
    // 1.25 < 1.35 (cascade triggers, totalRepaid > 0).
    // BUT 1.25 >= 1.20 (initialHf >= staticTrigger) -> feeEligible = false.
    const res = simulateCascade({
      collateralUsd: 100_000,
      liquidationThreshold: 0.8,
      debtUsd: 64_000,
      triggerHf: 1.35,
      staticTriggerHf: 1.20,
      targetHf: 1.6,
      version: 2,
      l1: {
        cap: 10_000,
        balance: 20_000,
        allowance: 20_000,
      },
    });

    assert.ok(res.totalRepaid > 0);
    assert.equal(res.feeEligible, false);
    assert.equal(res.fee, 0);
    assert.equal(res.feeWaived, 0);
  });

  it("vector 6: HF >= 1.50 is NOT eligible for fee even if below static trigger", () => {
    // static trigger = 1.55, trigger = 1.55.
    // Collateral $100,000, LT 0.8, debt $52,631.57 -> initial HF ≈ 1.52.
    // initial HF < trigger (so cascade repays).
    // BUT initial HF >= 1.50 (FEE_HF_CEILING) -> feeEligible = false.
    const res = simulateCascade({
      collateralUsd: 100_000,
      liquidationThreshold: 0.8,
      debtUsd: 52_631.57,
      triggerHf: 1.55,
      staticTriggerHf: 1.55,
      targetHf: 1.7,
      version: 2,
      l1: {
        cap: 10_000,
        balance: 20_000,
        allowance: 20_000,
      },
    });

    assert.ok(res.totalRepaid > 0);
    assert.ok(res.initialHf >= 1.5);
    assert.equal(res.feeEligible, false);
    assert.equal(res.fee, 0);
    assert.equal(res.feeWaived, 0);
  });

  it("vector 7: rounding truncates down (floor)", () => {
    // 666 * 15 / 10,000 = 0.999 -> floor = 0
    const res666 = simulateCascade({
      collateralUsd: 100_000,
      liquidationThreshold: 0.8,
      debtUsd: 80_000,
      triggerHf: 1.3,
      targetHf: 1.6,
      version: 2,
      l1: { cap: 666, balance: 1000, allowance: 1000 },
    });
    assert.equal(res666.totalRepaid, 666);
    assert.equal(res666.fee, 0);
    assert.equal(res666.feeWaived, 0);

    // 667 * 15 / 10,000 = 1.0005 -> floor = 1
    const res667 = simulateCascade({
      collateralUsd: 100_000,
      liquidationThreshold: 0.8,
      debtUsd: 80_000,
      triggerHf: 1.3,
      targetHf: 1.6,
      version: 2,
      l1: { cap: 667, balance: 1000, allowance: 1000 },
    });
    assert.equal(res667.totalRepaid, 667);
    assert.equal(res667.fee, 1);
    assert.equal(res667.feeWaived, 0);

    // 1333 * 15 / 10,000 = 1.9995 -> floor = 1
    const res1333 = simulateCascade({
      collateralUsd: 100_000,
      liquidationThreshold: 0.8,
      debtUsd: 80_000,
      triggerHf: 1.3,
      targetHf: 1.6,
      version: 2,
      l1: { cap: 1333, balance: 2000, allowance: 2000 },
    });
    assert.equal(res1333.totalRepaid, 1333);
    assert.equal(res1333.fee, 1);

    // 1334 * 15 / 10,000 = 2.001 -> floor = 2
    const res1334 = simulateCascade({
      collateralUsd: 100_000,
      liquidationThreshold: 0.8,
      debtUsd: 80_000,
      triggerHf: 1.3,
      targetHf: 1.6,
      version: 2,
      l1: { cap: 1334, balance: 2000, allowance: 2000 },
    });
    assert.equal(res1334.totalRepaid, 1334);
    assert.equal(res1334.fee, 2);
  });

  it("defaults static trigger to triggerHf when omitted", () => {
    const res = simulateCascade({
      collateralUsd: 100_000,
      liquidationThreshold: 0.8,
      debtUsd: 80_000,
      triggerHf: 1.3,
      targetHf: 1.6,
      version: 2,
      l1: { cap: 10_000, balance: 20_000, allowance: 20_000 },
    });
    assert.equal(res.feeEligible, true);
    assert.equal(res.fee, 15);
  });
});
