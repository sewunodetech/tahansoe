/**
 * Test unit Protection Agent decider (spec §3.2, ADR 0016).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  MANDATE_ACTION_BITS,
  type Mandate,
  type PositionState,
  type StrategyVersion,
  type ProtectionPlan,
} from "@tahansoe/domain";
import {
  createProtectionAgentDecider,
  ACTION_ESCALATION_LEVEL,
} from "../../src/strategy/agent.ts";
import { SEED_STRATEGY_VERSION } from "../../src/strategy/library.ts";

function createMockState(overrides: Partial<PositionState> = {}): PositionState {
  return {
    positionKey: "aave-v3:421614:0x1a5d249a8e711e2288add7c01e31eb7ffb05d97e:0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
    at: new Date("2026-10-25T10:00:00.000Z"),
    healthFactor: 1.2,
    collateralUsd: 10_000,
    debtUsd: 6_875,
    liquidationThreshold: 0.825,
    debtAsset: {
      address: "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
      symbol: "USDC",
      decimals: 6,
      priceUsd: 1.0,
    },
    reserves: {
      wallet: 2_000_000_000n, // 2000 USDC
      vault: 5_000_000_000n, // 5000 USDC
    },
    policy: {
      triggerHf: 1.15,
      targetHf: 1.6,
      maxRepayPerAction: 1_000_000_000n, // 1000 USDC
    },
    regime: "STRESSED",
    signalIds: ["sig-oracle-1", "sig-macro-2"],
    spent24h: 0n,
    ...overrides,
  };
}

function createMockMandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    positionKey: "aave-v3:421614:0x1a5d249a8e711e2288add7c01e31eb7ffb05d97e:0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
    agent: "0x0000000000000000000000000000000000000001",
    actionMask:
      MANDATE_ACTION_BITS.SHIFT_TRIGGER |
      MANDATE_ACTION_BITS.REPAY_WALLET |
      MANDATE_ACTION_BITS.REPAY_VAULT |
      MANDATE_ACTION_BITS.DELEVERAGE,
    maxPerAction: 1_000_000_000n, // 1000 USDC
    maxPer24h: 3_000_000_000n, // 3000 USDC
    maxPreemptHF: 1.5,
    validUntil: new Date("2026-11-25T10:00:00.000Z"),
    ...overrides,
  };
}

test("createProtectionAgentDecider: di atas maxPreemptHF tidak repay, tetapi boleh menaikkan trigger preemptif", async () => {
  const decider = createProtectionAgentDecider(SEED_STRATEGY_VERSION);
  // HF = 1.55 > maxPreemptHF 1.50, regime STRESSED
  const state = createMockState({ healthFactor: 1.55 });
  const mandate = createMockMandate({ maxPreemptHF: 1.5 });

  const plan = await decider(state, mandate);
  assert.equal(plan.action, "SHIFT_TRIGGER");
  assert.equal(plan.triggerHf, 1.45);
  assert.equal(plan.amount, undefined);
  // Menggeser trigger di bawah HF saat ini tidak mengubah HF.
  assert.equal(plan.expectedHfAfter, 1.55);
});

test("createProtectionAgentDecider: HOLD di atas maxPreemptHF bila mandat tidak mengizinkan SHIFT_TRIGGER", async () => {
  const decider = createProtectionAgentDecider(SEED_STRATEGY_VERSION);
  const state = createMockState({ healthFactor: 1.55 });
  const mandate = createMockMandate({
    maxPreemptHF: 1.5,
    actionMask: MANDATE_ACTION_BITS.REPAY_WALLET | MANDATE_ACTION_BITS.REPAY_VAULT,
  });

  const plan = await decider(state, mandate);
  assert.equal(plan.action, "HOLD");
  assert.equal(plan.expectedHfAfter, 1.55);
});

test("createProtectionAgentDecider: SHIFT_TRIGGER tidak pernah di bawah trigger statis atau di atas target policy", async () => {
  const strategy: StrategyVersion = {
    version: "test-shift",
    status: "ACTIVE",
    playbooks: [
      { id: "too-low", description: "x", when: { regimeAtLeast: "ELEVATED" }, action: "SHIFT_TRIGGER", targetHf: 1.1, source: "MANUAL" },
      { id: "too-high", description: "x", when: { regimeAtLeast: "ELEVATED" }, action: "SHIFT_TRIGGER", targetHf: 1.7, source: "MANUAL" },
    ],
  };
  const decider = createProtectionAgentDecider(strategy);
  const plan = await decider(createMockState({ healthFactor: 1.4 }), createMockMandate({ maxPreemptHF: 1.8 }));
  assert.equal(plan.action, "HOLD");
});

test("createProtectionAgentDecider: kalkulasi amount tidak pernah melebihi cap dan tidak overshoot target HF secara material", async () => {
  const customStrategy: StrategyVersion = {
    version: "test-v1",
    status: "ACTIVE",
    playbooks: [
      {
        id: "pb-test-repay",
        description: "Repay to 1.50",
        when: { regimeAtLeast: "STRESSED", hfBelow: 1.3 },
        action: "REPAY_WALLET",
        targetHf: 1.5,
        source: "MANUAL",
      },
    ],
  };

  const decider = createProtectionAgentDecider(customStrategy);
  const state = createMockState({
    collateralUsd: 10_000,
    debtUsd: 6_875, // HF = 10000 * 0.825 / 6875 = 1.20
    healthFactor: 1.2,
  });
  const mandate = createMockMandate({
    maxPerAction: 2_000_000_000n, // 2000 USDC cap
  });

  const plan = await decider(state, mandate);
  assert.equal(plan.action, "REPAY_WALLET");
  assert.ok(plan.amount);

  const amountBig = BigInt(plan.amount);
  assert.ok(amountBig <= mandate.maxPerAction, "amount tidak boleh melebihi maxPerAction");

  // Untuk mencapai HF 1.50: debtTarget = 10000 * 0.825 / 1.50 = 5500 USD.
  // Utang saat ini = 6875 USD -> pelunasan yang diperlukan = ~1375 USD (~1375000000 base units).
  assert.ok(
    amountBig >= 1_370_000_000n && amountBig <= 1_380_000_000n,
    `amount harus sekitar 1375 USDC, got ${amountBig}`,
  );

  // expectedHfAfter harus mendekati 1.50 tanpa overshoot material (<= 1.51)
  assert.ok(plan.expectedHfAfter >= 1.495 && plan.expectedHfAfter <= 1.51);
});

test("createProtectionAgentDecider: amount dibatasi oleh maxPerAction jika kebutuhan pelunasan lebih besar", async () => {
  const customStrategy: StrategyVersion = {
    version: "test-v1",
    status: "ACTIVE",
    playbooks: [
      {
        id: "pb-test-repay",
        description: "Repay to 1.70",
        when: { regimeAtLeast: "STRESSED", hfBelow: 1.3 },
        action: "REPAY_WALLET",
        targetHf: 1.7,
        source: "MANUAL",
      },
    ],
  };

  const decider = createProtectionAgentDecider(customStrategy);
  const state = createMockState({ healthFactor: 1.2 });
  // Batasi cap per aksi ke 500 USDC
  const mandate = createMockMandate({ maxPerAction: 500_000_000n });

  const plan = await decider(state, mandate);
  assert.equal(plan.action, "REPAY_WALLET");
  assert.equal(plan.amount, "500000000", "amount harus di-cap ke maxPerAction 500 USDC");
  assert.ok(plan.expectedHfAfter > 1.2, "HF tetap meningkat");
});

test("createProtectionAgentDecider: amount dibatasi oleh sisa cap 24 jam", async () => {
  const customStrategy: StrategyVersion = {
    version: "test-v1",
    status: "ACTIVE",
    playbooks: [
      {
        id: "pb-test-repay",
        description: "Repay to 1.50",
        when: { regimeAtLeast: "STRESSED", hfBelow: 1.3 },
        action: "REPAY_WALLET",
        targetHf: 1.5,
        source: "MANUAL",
      },
    ],
  };

  const decider = createProtectionAgentDecider(customStrategy);
  // max24h = 1000 USDC, sudah terpakai 800 USDC -> sisa 200 USDC
  const state = createMockState({ spent24h: 800_000_000n });
  const mandate = createMockMandate({
    maxPerAction: 500_000_000n,
    maxPer24h: 1_000_000_000n,
  });

  const plan = await decider(state, mandate);
  assert.equal(plan.action, "REPAY_WALLET");
  assert.equal(plan.amount, "200000000", "amount harus di-cap ke sisa 24h (200 USDC)");
});

test("createProtectionAgentDecider: memilih aksi dengan tingkat eskalasi terendah yang mencapai target", async () => {
  const customStrategy: StrategyVersion = {
    version: "test-v1",
    status: "ACTIVE",
    playbooks: [
      {
        id: "pb-deleverage",
        description: "Deleverage to 1.50",
        when: { regimeAtLeast: "STRESSED", hfBelow: 1.3 },
        action: "DELEVERAGE",
        targetHf: 1.5,
        source: "MANUAL",
      },
      {
        id: "pb-repay-vault",
        description: "Repay vault to 1.50",
        when: { regimeAtLeast: "STRESSED", hfBelow: 1.3 },
        action: "REPAY_VAULT",
        targetHf: 1.5,
        source: "MANUAL",
      },
      {
        id: "pb-repay-wallet",
        description: "Repay wallet to 1.50",
        when: { regimeAtLeast: "STRESSED", hfBelow: 1.3 },
        action: "REPAY_WALLET",
        targetHf: 1.5,
        source: "MANUAL",
      },
    ],
  };

  const decider = createProtectionAgentDecider(customStrategy);

  // Skenario 1: Wallet punya cukup cadangan -> REPAY_WALLET dipilih (eskalasi terendah di antara repay)
  const stateWithWallet = createMockState({
    reserves: { wallet: 2_000_000_000n, vault: 2_000_000_000n },
  });
  const plan1 = await decider(stateWithWallet, createMockMandate());
  assert.equal(plan1.action, "REPAY_WALLET");

  // Skenario 2: Wallet kosong (0), Vault punya cadangan -> eskalasi ke REPAY_VAULT
  const stateNoWallet = createMockState({
    reserves: { wallet: 0n, vault: 2_000_000_000n },
  });
  const plan2 = await decider(stateNoWallet, createMockMandate());
  assert.equal(plan2.action, "REPAY_VAULT");

  // Skenario 3: Wallet dan Vault kosong -> eskalasi ke DELEVERAGE
  const stateNoReserves = createMockState({
    reserves: { wallet: 0n, vault: 0n },
  });
  const plan3 = await decider(stateNoReserves, createMockMandate());
  assert.equal(plan3.action, "DELEVERAGE");
});

test("createProtectionAgentDecider: LLM memilih kandidat valid atau fallback ke deterministik saat error", async () => {
  const customStrategy: StrategyVersion = {
    version: "test-v1",
    status: "ACTIVE",
    playbooks: [
      {
        id: "pb-repay-wallet",
        description: "Repay wallet to 1.50",
        when: { regimeAtLeast: "STRESSED", hfBelow: 1.3 },
        action: "REPAY_WALLET",
        targetHf: 1.5,
        source: "MANUAL",
      },
      {
        id: "pb-shift-trigger",
        description: "Shift trigger to 1.45",
        when: { regimeAtLeast: "STRESSED", hfBelow: 1.3 },
        action: "SHIFT_TRIGGER",
        targetHf: 1.45,
        source: "MANUAL",
      },
    ],
  };

  const state = createMockState({ healthFactor: 1.2 });
  const mandate = createMockMandate();

  // Test 1: LLM memilih SHIFT_TRIGGER dari daftar kandidat valid
  let llmCalled = false;
  const deciderWithLlm = createProtectionAgentDecider(customStrategy, {
    llm: async ({ candidatePlans }) => {
      llmCalled = true;
      const shiftCandidate = candidatePlans.find((p) => p.action === "SHIFT_TRIGGER");
      return shiftCandidate;
    },
  });

  const plan1 = await deciderWithLlm(state, mandate);
  assert.equal(llmCalled, true);
  assert.equal(plan1.action, "SHIFT_TRIGGER");

  // Test 2: LLM throw error -> otomatis fallback ke pilihan deterministik (REPAY_WALLET atau SHIFT_TRIGGER)
  const deciderWithFailingLlm = createProtectionAgentDecider(customStrategy, {
    llm: async () => {
      throw new Error("LLM gateway 500 timeout");
    },
  });

  const plan2 = await deciderWithFailingLlm(state, mandate);
  assert.ok(plan2.action === "SHIFT_TRIGGER" || plan2.action === "REPAY_WALLET");

  // Test 3: LLM mengembalikan plan yang tidak ada di kandidat (halusinasi) -> fallback
  const deciderWithHallucinatingLlm = createProtectionAgentDecider(customStrategy, {
    llm: async () => {
      return {
        positionKey: state.positionKey,
        strategyVersion: "hallucinated",
        action: "DELEVERAGE", // tidak ada di candidatePlans
        amount: "999999999",
        expectedHfAfter: 2.5,
        urgency: "HIGH",
        drivers: [],
        playbookIds: [],
        validUntil: new Date().toISOString(),
      } as ProtectionPlan;
    },
  });

  const plan3 = await deciderWithHallucinatingLlm(state, mandate);
  assert.notEqual(plan3.action, "DELEVERAGE", "Harus fallback dari halusinasi LLM ke pilihan deterministik");
});
