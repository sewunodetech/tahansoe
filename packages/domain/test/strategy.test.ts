import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ProtectionPlanSchema,
  defaultMandate,
  mandateAllows,
  MANDATE_ACTION_BITS,
  ARBITRUM_SEPOLIA,
  ARBITRUM_ONE,
} from "../src";

const validPlan = {
  positionKey: "aave-v3:421614:0xa7bbab6366a723e17cd2f220d708757e449571b4:0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
  strategyVersion: "pp-2026.11.1",
  action: "REPAY_WALLET",
  amount: "250000000",
  expectedHfAfter: 1.6,
  urgency: "HIGH",
  drivers: ["assessment:ETH:2026-10-25T00:00:00Z"],
  playbookIds: ["stressed-early-repay"],
  validUntil: "2026-10-25T01:00:00.000Z",
};

describe("ProtectionPlanSchema", () => {
  it("menerima plan yang valid", () => {
    assert.equal(ProtectionPlanSchema.safeParse(validPlan).success, true);
  });
  it("menolak aksi di luar daftar dan amount yang bukan bilangan bulat", () => {
    assert.equal(ProtectionPlanSchema.safeParse({ ...validPlan, action: "OPEN_LONG" }).success, false);
    assert.equal(ProtectionPlanSchema.safeParse({ ...validPlan, amount: "1.5" }).success, false);
    assert.equal(ProtectionPlanSchema.safeParse({ ...validPlan, amount: "-1" }).success, false);
  });
});

describe("mandat default (spec §7)", () => {
  const m = defaultMandate({
    positionKey: validPlan.positionKey,
    agent: "0x0000000000000000000000000000000000000001",
    staticTriggerHf: 1.3,
    maxRepayPerAction: 500_000_000n,
    validUntil: new Date("2026-11-25T00:00:00Z"),
  });
  it("maxPreemptHF = trigger statis + 0.25, cap 24 jam = 3 × cap per aksi", () => {
    assert.ok(Math.abs(m.maxPreemptHF - 1.55) < 1e-9);
    assert.equal(m.maxPerAction, 500_000_000n);
    assert.equal(m.maxPer24h, 1_500_000_000n);
  });
  it("DELEVERAGE mati secara default, HOLD selalu boleh", () => {
    assert.equal(mandateAllows(m, "DELEVERAGE"), false);
    assert.equal(mandateAllows(m, "REPAY_WALLET"), true);
    assert.equal(mandateAllows(m, "HOLD"), true);
    assert.equal(mandateAllows({ ...m, actionMask: MANDATE_ACTION_BITS.DELEVERAGE }, "DELEVERAGE"), true);
  });
});

describe("registry ERC-8004 (ADR 0017)", () => {
  it("Arbitrum Sepolia dan One punya Identity + Reputation Registry", () => {
    assert.equal(ARBITRUM_SEPOLIA.erc8004?.identity, "0x8004A818BFB912233c491871b3d84c89A494BD9e");
    assert.equal(ARBITRUM_SEPOLIA.erc8004?.reputation, "0x8004B663056A597Dffe9eCcC1965A193B7388713");
    assert.equal(ARBITRUM_ONE.erc8004?.identity, "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432");
    assert.equal(ARBITRUM_ONE.erc8004?.reputation, "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63");
  });
});
