/**
 * Unit tests for deterministic protection replay engine.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  priceForHealthFactor,
  dropTolerance,
} from "@tahansoe/domain";
import {
  replayPosition,
  unassistedDecider,
} from "../../src/backtest/protection-replay.ts";
import { staticDecider } from "../../src/backtest/deciders.ts";
import type { ProtectionScenario, SyntheticPositionConfig } from "../../src/backtest/types.ts";

function createTestScenario(prices: number[], regimes?: string[]): ProtectionScenario {
  return {
    id: "unit-test-scenario",
    title: "Unit Test Scenario",
    description: "Synthetic prices for test",
    source: "synthetic",
    points: prices.map((price, idx) => ({
      t: 1700000000 + idx * 3600,
      price,
      regime: (regimes?.[idx] ?? "CALM") as any,
    })),
  };
}

function createTestPosition(overrides?: Partial<SyntheticPositionConfig>): SyntheticPositionConfig {
  return {
    positionKey: "aave-v3:42161:test:weth-usdc",
    collateralAsset: {
      symbol: "WETH",
      decimals: 18,
      initialPriceUsd: 2000,
    },
    debtAsset: {
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      symbol: "USDC",
      decimals: 6,
      priceUsd: 1.0,
    },
    liquidationThreshold: 0.8,
    initialHf: 1.5,
    initialDebtBase: 10_000_000_000n, // 10,000 USDC
    policy: {
      triggerHf: 1.25,
      targetHf: 1.6,
      maxRepayPerAction: 3_000_000_000n, // 3,000 USDC
    },
    initialReserves: {
      wallet: 5_000_000_000n,
      vault: 5_000_000_000n,
    },
    ...overrides,
  };
}

test("HF math: priceForHealthFactor matches replay HF calculation", () => {
  const pos = createTestPosition();
  const debtUsd = 10000;
  const lt = 0.8;
  const initialHf = 1.5;
  const initialPrice = 2000;

  // Q_col = (initialHf * debtUsd / lt) / initialPrice
  const initialColUsd = (initialHf * debtUsd) / lt; // 18,750 USD
  const collateralQty = initialColUsd / initialPrice; // 9.375 WETH

  // Calculate price at triggerHf (1.25)
  // triggerHf = (qty * P * LT) / debtUsd => P = triggerHf * debtUsd / (qty * LT)
  const triggerPrice = (1.25 * debtUsd) / (collateralQty * lt);
  assert.equal(triggerPrice, 1666.6666666666667);

  // Cross-check with domain helper priceForHealthFactor
  const domainPrice = priceForHealthFactor({
    collateral: [
      {
        address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
        symbol: "WETH",
        amount: BigInt(Math.round(collateralQty * 1e18)),
        decimals: 18,
        valueUsd: initialColUsd,
        liquidationThresholdBps: 8000,
      },
    ],
    debtUsd,
    mainCollateral: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
    hf: 1.25,
  });

  assert.ok(domainPrice !== null);
  assert.ok(Math.abs(domainPrice - triggerPrice) < 0.01);
});

test("HF math: dropTolerance matches liquidation threshold price drop", () => {
  const hf = 1.25;
  const tolerance = dropTolerance(hf);
  assert.ok(Math.abs(tolerance - 0.2) < 1e-9); // 20% drop to touch HF = 1.0

  const initialPrice = 2000;
  const priceAtLiq = initialPrice * (1 - tolerance); // 1600
  const hfAt1600 = (9.375 * 1600 * 0.8) / 10000;
  assert.equal(hfAt1600, 1.2);
});

test("Caps never exceeded: maxPerAction and rolling 24h cap strictly enforced", async () => {
  // Scenario with consecutive steps where price drops and stays low
  const scenario = createTestScenario([2000, 1500, 1400, 1300, 1200]);
  const pos = createTestPosition({
    policy: {
      triggerHf: 1.3,
      targetHf: 1.6,
      maxRepayPerAction: 1_000_000_000n, // 1,000 USDC max per action
    },
    mandate: {
      maxPerAction: 1_000_000_000n,
      maxPer24h: 2_000_000_000n, // 2,000 USDC max per 24h
    },
  });

  const result = await replayPosition(pos, scenario, staticDecider);

  // Every action must be <= maxPerAction (1,000 USDC)
  for (const event of result.events) {
    if (event.action === "REPAY_WALLET" || event.action === "REPAY_VAULT") {
      assert.ok(
        event.amountRepaidBase <= 1_000_000_000n,
        `Action amount ${event.amountRepaidBase} exceeded maxPerAction 1000000000`
      );
    }
  }

  // Check rolling 24h windows: in any 24h window, total repaid must be <= maxPer24h
  for (let i = 0; i < result.events.length; i++) {
    const t0 = result.events[i]!.t;
    const windowTotal = result.events
      .filter((e) => e.t >= t0 && e.t < t0 + 86400)
      .reduce((acc, e) => acc + e.amountRepaidBase, 0n);

    assert.ok(
      windowTotal <= 2_000_000_000n,
      `24h window starting at ${t0} exceeded cap: ${windowTotal} > 2000000000`
    );
  }
});

test("Liquidation applied correctly: close factor 50%, bonus 5%, loss tracked", async () => {
  // Moderate crash scenario: initial HF = 1.25, price drops 25% from 2000 to 1500 (HF dips to 0.9375)
  const scenario = createTestScenario([2000, 1500]);
  const pos = createTestPosition({
    initialHf: 1.25,
    initialReserves: { wallet: 0n, vault: 0n }, // No reserves -> cannot repay -> gets liquidated!
  });

  const result = await replayPosition(pos, scenario, unassistedDecider);

  assert.equal(result.liquidationsCount, 1);
  assert.ok(result.liquidationLossUsd > 0);

  const liqEvent = result.events.find((e) => e.liquidationOccurred);
  assert.ok(liqEvent !== undefined);

  // Debt was 10,000 USDC. 50% close factor = 5,000 USDC liquidated.
  assert.equal(liqEvent.debtLiquidatedBase, 5_000_000_000n);
  assert.equal(liqEvent.debtLiquidatedUsd, 5000);

  // Collateral seized = 5000 * 1.05 = 5250 USD
  assert.equal(liqEvent.collateralSeizedUsd, 5250);

  // Loss = 5000 * 0.05 = 250 USD
  assert.equal(liqEvent.liquidationLossUsd, 250);
  assert.equal(result.liquidationLossUsd, 250);

  // Post-liquidation HF is restored above 1.0
  assert.ok(liqEvent.hfAfter > 1.0);
  assert.ok(Math.abs(liqEvent.hfAfter - 1.035) < 0.01);
});

test("DELEVERAGE: sells collateral with slippage parameter to repay debt", async () => {
  const scenario = createTestScenario([2000, 1600]);
  const pos = createTestPosition({
    initialReserves: { wallet: 0n, vault: 0n }, // No reserves
    mandate: {
      actionMask: 8, // DELEVERAGE only
      maxPerAction: 5_000_000_000n,
      maxPer24h: 15_000_000_000n,
      maxPreemptHF: 1.5,
    },
  });

  // Custom decider that triggers DELEVERAGE when HF < 1.3
  const deleverageDecider = (state: any) => {
    if (state.healthFactor < 1.3) {
      return {
        positionKey: state.positionKey,
        strategyVersion: "deleverage-v1",
        action: "DELEVERAGE" as const,
        expectedHfAfter: 1.6,
        urgency: "HIGH" as const,
        drivers: ["test"],
        playbookIds: [],
        validUntil: new Date(Date.now() + 3600000).toISOString(),
      };
    }
    return {
      positionKey: state.positionKey,
      strategyVersion: "deleverage-v1",
      action: "HOLD" as const,
      expectedHfAfter: state.healthFactor,
      urgency: "LOW" as const,
      drivers: [],
      playbookIds: [],
      validUntil: new Date(Date.now() + 3600000).toISOString(),
    };
  };

  const result = await replayPosition(pos, scenario, deleverageDecider, { slippage: 0.01 });

  const delEvent = result.events.find((e) => e.action === "DELEVERAGE");
  assert.ok(delEvent !== undefined);
  assert.ok(delEvent.collateralSoldUsd > delEvent.repaidUsd);
  assert.ok(delEvent.slippageLossUsd > 0);
  assert.equal(result.liquidationsCount, 0); // Avoided liquidation!
});
