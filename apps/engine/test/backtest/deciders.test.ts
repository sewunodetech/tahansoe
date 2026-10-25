/**
 * Unit tests for protection deciders (static, dynamic, registry).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultMandate,
  type PositionState,
  type Mandate,
} from "@tahansoe/domain";
import {
  staticDecider,
  dynamicTriggerDecider,
  createDynamicTriggerDecider,
  DeciderRegistry,
  calculateRepayAmountBase,
} from "../../src/backtest/deciders.ts";

function createMockState(overrides?: Partial<PositionState>): PositionState {
  const at = new Date("2026-10-25T10:00:00Z");
  return {
    positionKey: "aave-v3:42161:0xUser:0xUSDC",
    at,
    healthFactor: 1.5,
    collateralUsd: 18181.82,
    debtUsd: 10000,
    liquidationThreshold: 0.825,
    debtAsset: {
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      symbol: "USDC",
      decimals: 6,
      priceUsd: 1.0,
    },
    reserves: {
      wallet: 5_000_000_000n,
      vault: 5_000_000_000n,
    },
    policy: {
      triggerHf: 1.25,
      targetHf: 1.6,
      maxRepayPerAction: 3_000_000_000n,
    },
    regime: "CALM",
    signalIds: ["test-signal"],
    spent24h: 0n,
    ...overrides,
  };
}

function createMockMandate(overrides?: Partial<Mandate>): Mandate {
  const base = defaultMandate({
    positionKey: "aave-v3:42161:0xUser:0xUSDC",
    agent: "0xAgent",
    staticTriggerHf: 1.25,
    maxRepayPerAction: 3_000_000_000n,
    validUntil: new Date("2027-01-01T00:00:00Z"),
  });
  return { ...base, ...overrides };
}

test("staticDecider: never acts above trigger HF", async () => {
  const state = createMockState({ healthFactor: 1.3, policy: { triggerHf: 1.25, targetHf: 1.6, maxRepayPerAction: 3_000_000_000n } });
  const mandate = createMockMandate();

  const plan = await staticDecider(state, mandate);
  assert.equal(plan.action, "HOLD");
  assert.equal(plan.expectedHfAfter, 1.3);
  assert.equal(plan.amount, undefined);
});

test("staticDecider: never acts when exactly at trigger HF", async () => {
  const state = createMockState({ healthFactor: 1.25 });
  const mandate = createMockMandate();

  const plan = await staticDecider(state, mandate);
  assert.equal(plan.action, "HOLD");
});

test("staticDecider: acts when HF drops below static trigger", async () => {
  const state = createMockState({
    healthFactor: 1.15,
    collateralUsd: 10000,
    debtUsd: 7173.91, // 10000 * 0.825 / 7173.91 = 1.15
  });
  const mandate = createMockMandate();

  const plan = await staticDecider(state, mandate);
  assert.equal(plan.action, "REPAY_WALLET");
  assert.ok(plan.amount !== undefined);
  assert.ok(plan.expectedHfAfter >= 1.55);
});

test("staticDecider: falls back to REPAY_VAULT if wallet reserve is empty", async () => {
  const state = createMockState({
    healthFactor: 1.15,
    collateralUsd: 10000,
    debtUsd: 7173.91,
    reserves: { wallet: 0n, vault: 4_000_000_000n },
  });
  const mandate = createMockMandate();

  const plan = await staticDecider(state, mandate);
  assert.equal(plan.action, "REPAY_VAULT");
});

test("dynamicTriggerDecider: shifts trigger based on regime within band", async () => {
  const decider = createDynamicTriggerDecider({
    band: { min: 1.25, max: 1.6 },
  });
  const mandate = createMockMandate();

  // STRESSED regime maps to 1.50
  const stateStressed = createMockState({
    regime: "STRESSED",
    healthFactor: 1.7, // HF above 1.50
    policy: { triggerHf: 1.25, targetHf: 1.75, maxRepayPerAction: 3_000_000_000n },
  });

  const plan = await decider(stateStressed, mandate);
  assert.equal(plan.action, "SHIFT_TRIGGER");
  assert.equal(plan.triggerHf, 1.5);
});

test("dynamicTriggerDecider: acts preemptively when HF drops below dynamic trigger", async () => {
  const decider = createDynamicTriggerDecider({
    band: { min: 1.25, max: 1.6 },
  });
  const mandate = createMockMandate();

  // In CRISIS, dynamic trigger is 1.60. Current HF is 1.45 (safe under static 1.25, but unsafe under CRISIS!)
  const stateCrisis = createMockState({
    regime: "CRISIS",
    healthFactor: 1.45,
    policy: { triggerHf: 1.25, targetHf: 1.7, maxRepayPerAction: 3_000_000_000n },
  });

  const plan = await decider(stateCrisis, mandate);
  assert.equal(plan.action, "REPAY_WALLET");
  assert.ok(plan.amount !== undefined);
});

test("dynamicTriggerDecider: graceful degradation when regime is null", async () => {
  const decider = createDynamicTriggerDecider();
  const mandate = createMockMandate();

  // regime is null, HF is 1.30 (above static 1.25)
  const stateNoRegime = createMockState({
    regime: null,
    healthFactor: 1.3,
    policy: { triggerHf: 1.25, targetHf: 1.6, maxRepayPerAction: 3_000_000_000n },
  });

  const plan = await decider(stateNoRegime, mandate);
  assert.equal(plan.action, "HOLD");
});

test("DeciderRegistry: register and retrieve deciders", () => {
  const registry = new DeciderRegistry();
  assert.ok(registry.has("static"));
  assert.ok(registry.has("dynamic"));
  assert.equal(registry.list().length, 2);

  const customDecider = () => ({
    positionKey: "test",
    strategyVersion: "test",
    action: "HOLD" as const,
    expectedHfAfter: 2.0,
    urgency: "LOW" as const,
    drivers: [],
    playbookIds: [],
    validUntil: new Date().toISOString(),
  });

  registry.register("custom", customDecider);
  assert.ok(registry.has("custom"));
  assert.equal(registry.get("custom"), customDecider);
});

test("calculateRepayAmountBase: exact math matches target HF", () => {
  const collateralUsd = 10000;
  const lt = 0.825;
  const debtUsd = 7000;
  const targetHf = 1.5;
  const decimals = 6;
  const priceUsd = 1.0;

  // targetDebt = 10000 * 0.825 / 1.5 = 5500
  // repayNeeded = 7000 - 5500 = 1500 USD = 1,500,000,000 base
  const amountBase = calculateRepayAmountBase(collateralUsd, debtUsd, lt, targetHf, decimals, priceUsd);
  assert.equal(amountBase, 1_500_000_000n);

  const newDebtUsd = debtUsd - Number(amountBase) / 10 ** decimals;
  const newHf = (collateralUsd * lt) / newDebtUsd;
  assert.ok(Math.abs(newHf - 1.5) < 0.001);
});
