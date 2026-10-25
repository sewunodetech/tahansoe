/**
 * Test unit rule engine & validator ProtectionPlan (spec §3.3).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultMandate,
  MANDATE_ACTION_BITS,
  type Mandate,
  type PositionState,
  type ProtectionPlan,
} from "@tahansoe/domain";
import {
  canonicalJson,
  computePlanHash,
  validateProtectionPlan,
} from "../../src/strategy/validate.ts";

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
      wallet: 1_000_000_000n, // 1000 USDC
      vault: 2_000_000_000n, // 2000 USDC
    },
    policy: {
      triggerHf: 1.15,
      targetHf: 1.6,
      maxRepayPerAction: 500_000_000n, // 500 USDC
    },
    regime: "STRESSED",
    signalIds: ["sig-oracle-1", "sig-news-2"],
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
      MANDATE_ACTION_BITS.REPAY_VAULT,
    maxPerAction: 500_000_000n,
    maxPer24h: 1_500_000_000n,
    maxPreemptHF: 1.4,
    validUntil: new Date("2026-11-25T10:00:00.000Z"),
    ...overrides,
  };
}

function createValidPlan(overrides: Partial<ProtectionPlan> = {}): ProtectionPlan {
  return {
    positionKey: "aave-v3:421614:0x1a5d249a8e711e2288add7c01e31eb7ffb05d97e:0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
    strategyVersion: "pp-2026.10.0",
    action: "REPAY_WALLET",
    amount: "250000000",
    expectedHfAfter: 1.5,
    urgency: "MEDIUM",
    drivers: ["sig-oracle-1"],
    playbookIds: ["pb-stressed-repay-wallet"],
    validUntil: "2026-10-25T10:15:00.000Z",
    ...overrides,
  };
}

test("validateProtectionPlan: menerima plan valid", () => {
  const state = createMockState();
  const mandate = createMockMandate();
  const plan = createValidPlan();

  const res = validateProtectionPlan(plan, state, mandate, { now: new Date("2026-10-25T10:00:00.000Z") });
  assert.equal(res.decision, "ACCEPTED");
  assert.equal(res.reason, undefined);
  assert.ok(res.planHash.startsWith("0x"));
});

test("validateProtectionPlan: menolak jika schema tidak valid", () => {
  const state = createMockState();
  const mandate = createMockMandate();
  const plan = createValidPlan({ amount: "invalid-amount" } as any);

  const res = validateProtectionPlan(plan, state, mandate);
  assert.equal(res.decision, "REJECTED");
  assert.match(res.reason!, /Invalid plan schema/);
});

test("validateProtectionPlan: menolak jika plan expired", () => {
  const state = createMockState();
  const mandate = createMockMandate();
  const plan = createValidPlan({ validUntil: "2026-10-25T09:59:00.000Z" });

  const res = validateProtectionPlan(plan, state, mandate, { now: new Date("2026-10-25T10:00:00.000Z") });
  assert.equal(res.decision, "REJECTED");
  assert.match(res.reason!, /Plan has expired/);
});

test("validateProtectionPlan: menolak jika mandat expired", () => {
  const state = createMockState();
  const mandate = createMockMandate({ validUntil: new Date("2026-10-25T09:00:00.000Z") });
  const plan = createValidPlan();

  const res = validateProtectionPlan(plan, state, mandate, { now: new Date("2026-10-25T10:00:00.000Z") });
  assert.equal(res.decision, "REJECTED");
  assert.match(res.reason!, /Mandate has expired/);
});

test("validateProtectionPlan: menolak aksi yang tidak ada di mandat", () => {
  const state = createMockState();
  // DELEVERAGE tidak diizinkan di default mandate
  const mandate = createMockMandate({ actionMask: MANDATE_ACTION_BITS.REPAY_WALLET });
  const plan = createValidPlan({ action: "DELEVERAGE" });

  const res = validateProtectionPlan(plan, state, mandate, { now: new Date("2026-10-25T10:00:00.000Z") });
  assert.equal(res.decision, "REJECTED");
  assert.match(res.reason!, /not permitted by mandate/);
});

test("validateProtectionPlan: menolak jika HF > maxPreemptHF", () => {
  const state = createMockState({ healthFactor: 1.45 });
  const mandate = createMockMandate({ maxPreemptHF: 1.4 });
  const plan = createValidPlan();

  const res = validateProtectionPlan(plan, state, mandate, { now: new Date("2026-10-25T10:00:00.000Z") });
  assert.equal(res.decision, "REJECTED");
  assert.match(res.reason!, /above maxPreemptHF/);
});

test("validateProtectionPlan: menolak jika regime/signals stale", () => {
  const stateWithNullRegime = createMockState({ regime: null });
  const mandate = createMockMandate();
  const plan = createValidPlan();

  // Test 1: regime null di state
  const res1 = validateProtectionPlan(plan, stateWithNullRegime, mandate, { now: new Date("2026-10-25T10:00:00.000Z") });
  assert.equal(res1.decision, "REJECTED");
  assert.match(res1.reason!, /stale or missing/);

  // Test 2: options.signalsStale === true
  const stateOk = createMockState();
  const res2 = validateProtectionPlan(plan, stateOk, mandate, { now: new Date("2026-10-25T10:00:00.000Z"), signalsStale: true });
  assert.equal(res2.decision, "REJECTED");
  assert.match(res2.reason!, /stale or missing/);
});

test("validateProtectionPlan: menolak aksi selain HOLD/SHIFT_TRIGGER di regime CALM kecuali HF < static trigger", () => {
  const mandate = createMockMandate();
  const plan = createValidPlan({ action: "REPAY_WALLET" });

  // HF 1.20 >= static trigger 1.15 di CALM -> REJECT
  const stateCalmHighHf = createMockState({ regime: "CALM", healthFactor: 1.2, policy: { triggerHf: 1.15, targetHf: 1.6, maxRepayPerAction: 500_000_000n } });
  const res1 = validateProtectionPlan(plan, stateCalmHighHf, mandate, { now: new Date("2026-10-25T10:00:00.000Z") });
  assert.equal(res1.decision, "REJECTED");
  assert.match(res1.reason!, /CALM regime/);

  // HF 1.10 < static trigger 1.15 di CALM -> ACCEPT (emergency protection)
  const stateCalmLowHf = createMockState({ regime: "CALM", healthFactor: 1.1, policy: { triggerHf: 1.15, targetHf: 1.6, maxRepayPerAction: 500_000_000n } });
  const res2 = validateProtectionPlan(plan, stateCalmLowHf, mandate, { now: new Date("2026-10-25T10:00:00.000Z") });
  assert.equal(res2.decision, "ACCEPTED");

  // SHIFT_TRIGGER di CALM dengan HF >= trigger -> ACCEPT
  const shiftPlan = createValidPlan({ action: "SHIFT_TRIGGER", triggerHf: 1.3, expectedHfAfter: 1.3, amount: undefined });
  const res3 = validateProtectionPlan(shiftPlan, stateCalmHighHf, mandate, { now: new Date("2026-10-25T10:00:00.000Z") });
  assert.equal(res3.decision, "ACCEPTED");
});

test("validateProtectionPlan: menolak jika amount > maxPerAction cap", () => {
  const state = createMockState();
  const mandate = createMockMandate({ maxPerAction: 500_000_000n });
  const plan = createValidPlan({ amount: "600000000" }); // 600 USDC > 500 USDC cap

  const res = validateProtectionPlan(plan, state, mandate, { now: new Date("2026-10-25T10:00:00.000Z") });
  assert.equal(res.decision, "REJECTED");
  assert.match(res.reason!, /exceeds mandate per-action cap/);
});

test("validateProtectionPlan: menolak jika amount > remaining 24h cap", () => {
  // max 24h = 1,500 USDC, sudah terpakai 1,200 USDC -> sisa 300 USDC
  const state = createMockState({ spent24h: 1_200_000_000n });
  const mandate = createMockMandate({ maxPerAction: 500_000_000n, maxPer24h: 1_500_000_000n });
  const plan = createValidPlan({ amount: "400000000" }); // 400 USDC > 300 USDC sisa

  const res = validateProtectionPlan(plan, state, mandate, { now: new Date("2026-10-25T10:00:00.000Z") });
  assert.equal(res.decision, "REJECTED");
  assert.match(res.reason!, /exceeds remaining 24h cap/);
});

test("validateProtectionPlan: menolak jika expectedHfAfter <= current HF", () => {
  const state = createMockState({ healthFactor: 1.3 });
  const mandate = createMockMandate();

  // expectedHfAfter sama dengan current HF
  const planEqual = createValidPlan({ expectedHfAfter: 1.3 });
  const res1 = validateProtectionPlan(planEqual, state, mandate, { now: new Date("2026-10-25T10:00:00.000Z") });
  assert.equal(res1.decision, "REJECTED");
  assert.match(res1.reason!, /must be greater than current HF/);

  // expectedHfAfter lebih rendah dari current HF
  const planLower = createValidPlan({ expectedHfAfter: 1.25 });
  const res2 = validateProtectionPlan(planLower, state, mandate, { now: new Date("2026-10-25T10:00:00.000Z") });
  assert.equal(res2.decision, "REJECTED");
  assert.match(res2.reason!, /must be greater than current HF/);
});

test("computePlanHash: determinisme planHash terhadap urutan key JSON", () => {
  const planA: ProtectionPlan = {
    positionKey: "aave-v3:421614:0xabc:0xdef",
    strategyVersion: "pp-2026.10.0",
    action: "REPAY_WALLET",
    amount: "100000000",
    expectedHfAfter: 1.5,
    urgency: "MEDIUM",
    drivers: ["sig-1", "sig-2"],
    playbookIds: ["pb-1"],
    validUntil: "2026-10-25T12:00:00.000Z",
  };

  // Objek dengan key yang didefinisikan dalam urutan berbeda
  const planB: ProtectionPlan = {
    validUntil: "2026-10-25T12:00:00.000Z",
    playbookIds: ["pb-1"],
    drivers: ["sig-1", "sig-2"],
    urgency: "MEDIUM",
    expectedHfAfter: 1.5,
    amount: "100000000",
    action: "REPAY_WALLET",
    strategyVersion: "pp-2026.10.0",
    positionKey: "aave-v3:421614:0xabc:0xdef",
  };

  const hashA = computePlanHash(planA);
  const hashB = computePlanHash(planB);

  assert.equal(hashA, hashB, "planHash harus identik meskipun urutan key objek berbeda");
  assert.ok(hashA.startsWith("0x"));
  assert.equal(hashA.length, 66); // 32 bytes hex + '0x'

  // Perubahan kecil pada amount harus menghasilkan hash berbeda
  const planC = { ...planA, amount: "100000001" };
  const hashC = computePlanHash(planC);
  assert.notEqual(hashA, hashC);
});
