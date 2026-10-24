import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import type { PositionDetail } from "@tahansoe/domain";
import {
  formatPositionKeyAave,
  formatPositionKeyMorpho,
  parsePositionKey,
  reorderPriority,
  moveDebtPriority,
  validatePolicyInputs,
  positionStatusV4,
} from "./position-key";

describe("Guardian v4 helpers", () => {
  describe("positionKey formatting and parsing", () => {
    it("formats Aave v4 position keys in canonical lowercase", () => {
      const key = formatPositionKeyAave({
        chainId: 421614,
        guardian: "0x1234567890abcdef1234567890abcdef12345678",
        debtAsset: "0xAf88d065e77c8cC2239327C5EDb3A432268e5831",
      });
      assert.equal(
        key,
        "aave-v3:421614:0x1234567890abcdef1234567890abcdef12345678:0xaf88d065e77c8cc2239327c5edb3a432268e5831"
      );
    });

    it("formats Morpho v4 position keys in canonical lowercase", () => {
      const key = formatPositionKeyMorpho({
        chainId: 42161,
        guardian: "0xABCDEF1234567890abcdef1234567890abcdef12",
        marketId: "0x0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF",
      });
      assert.equal(
        key,
        "morpho-blue:42161:0xabcdef1234567890abcdef1234567890abcdef12:0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      );
    });

    it("parses valid Aave and Morpho position keys", () => {
      const aaveParsed = parsePositionKey(
        "aave-v3:421614:0x1234567890abcdef1234567890abcdef12345678:0xaf88d065e77c8cc2239327c5edb3a432268e5831"
      );
      assert.deepEqual(aaveParsed, {
        protocol: "aave-v3",
        chainId: 421614,
        guardian: "0x1234567890abcdef1234567890abcdef12345678" as Address,
        keyIdentifier: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      });

      const morphoParsed = parsePositionKey(
        "morpho-blue:42161:0xabcdef1234567890abcdef1234567890abcdef12:0x1111"
      );
      assert.deepEqual(morphoParsed, {
        protocol: "morpho-blue",
        chainId: 42161,
        guardian: "0xabcdef1234567890abcdef1234567890abcdef12" as Address,
        keyIdentifier: "0x1111",
      });
    });

    it("returns null for malformed position keys", () => {
      assert.equal(parsePositionKey("invalid"), null);
      assert.equal(parsePositionKey("aave-v3:abc:0x1:0x2"), null);
      assert.equal(parsePositionKey("compound:1:0x1:0x2"), null);
      assert.equal(parsePositionKey("aave-v3:1:0x1"), null);
    });
  });

  describe("priority reordering", () => {
    const list: Address[] = [
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      "0x3333333333333333333333333333333333333333",
    ];

    it("moves element up", () => {
      const moved = moveDebtPriority(list, list[1], "up");
      assert.deepEqual(moved, [list[1], list[0], list[2]]);
    });

    it("does not move first element up", () => {
      const moved = moveDebtPriority(list, list[0], "up");
      assert.deepEqual(moved, list);
    });

    it("moves element down", () => {
      const moved = moveDebtPriority(list, list[1], "down");
      assert.deepEqual(moved, [list[0], list[2], list[1]]);
    });

    it("does not move last element down", () => {
      const moved = moveDebtPriority(list, list[2], "down");
      assert.deepEqual(moved, list);
    });

    it("handles non-existent asset safely", () => {
      const moved = moveDebtPriority(list, "0x4444444444444444444444444444444444444444" as Address, "up");
      assert.deepEqual(moved, list);
    });

    it("handles boundary indices in generic reorderPriority", () => {
      assert.deepEqual(reorderPriority(list, -1, "up"), list);
      assert.deepEqual(reorderPriority(list, 10, "down"), list);
    });
  });

  describe("form validation", () => {
    it("accepts valid inputs", () => {
      const res = validatePolicyInputs({
        triggerHf: 1.3,
        targetHf: 1.6,
        maxRepayPerAction: 1000000n,
      });
      assert.equal(res.valid, true);
      assert.equal(res.error, undefined);
    });

    it("rejects trigger HF below 1.0", () => {
      const res = validatePolicyInputs({
        triggerHf: 0.95,
        targetHf: 1.5,
        maxRepayPerAction: 1000n,
      });
      assert.equal(res.valid, false);
      assert.match(res.error!, /at least 1\.00/i);
    });

    it("rejects target HF less than or equal to trigger HF", () => {
      const res = validatePolicyInputs({
        triggerHf: 1.4,
        targetHf: 1.3,
        maxRepayPerAction: 1000n,
      });
      assert.equal(res.valid, false);
      assert.match(res.error!, /greater than trigger/i);
    });

    it("rejects target HF exceeding 5.0", () => {
      const res = validatePolicyInputs({
        triggerHf: 1.3,
        targetHf: 5.5,
        maxRepayPerAction: 1000n,
      });
      assert.equal(res.valid, false);
      assert.match(res.error!, /cannot exceed 5\.00/i);
    });

    it("rejects non-positive max repay cap", () => {
      const res = validatePolicyInputs({
        triggerHf: 1.25,
        targetHf: 1.5,
        maxRepayPerAction: 0n,
      });
      assert.equal(res.valid, false);
      assert.match(res.error!, /greater than zero/i);
    });
  });

  describe("position status per position", () => {
    const dummyAavePosition: PositionDetail = {
      id: "aave-pos-1",
      protocol: "aave-v3",
      chainId: 421614,
      user: "0x0000000000000000000000000000000000000001" as Address,
      oracleSource: "0x0000000000000000000000000000000000000002" as Address,
      collateral: [{ address: "0x1111111111111111111111111111111111111111" as Address, symbol: "WETH", decimals: 18, amount: 2000000000000000000n, valueUsd: 5000 }],
      debt: [
        { address: "0x2222222222222222222222222222222222222222" as Address, symbol: "USDC", decimals: 6, amount: 2000000000n, valueUsd: 2000 },
        { address: "0x3333333333333333333333333333333333333333" as Address, symbol: "WBTC", decimals: 8, amount: 10000000n, valueUsd: 6000 },
      ],
      collateralValueUsd: 500000000000n,
      debtValueUsd: 800000000000n,
      healthFactor: 1800000000000000000n,
      liquidationThreshold: 8250n,
      liquidationThresholdBps: 8250,
      monitorOnly: false,
      mainCollateral: { address: "0x1111111111111111111111111111111111111111" as Address, symbol: "WETH", decimals: 18, amount: 2000000000000000000n, valueUsd: 5000 },
      priceAtHf: () => 1800,
    };

    const dummyMorphoPosition: PositionDetail = {
      id: "0xmarket123",
      protocol: "morpho-blue",
      chainId: 42161,
      user: "0x0000000000000000000000000000000000000001" as Address,
      oracleSource: "0x0000000000000000000000000000000000000002" as Address,
      collateral: [{ address: "0x4444444444444444444444444444444444444444" as Address, symbol: "wstETH", decimals: 18, amount: 1000000000000000000n, valueUsd: 3000 }],
      debt: [{ address: "0x1111111111111111111111111111111111111111" as Address, symbol: "WETH", decimals: 18, amount: 1000000000000000000n, valueUsd: 2500 }],
      collateralValueUsd: 300000000000n,
      debtValueUsd: 250000000000n,
      healthFactor: 1200000000000000000n,
      liquidationThreshold: 8600n,
      liquidationThresholdBps: 8600,
      monitorOnly: true,
      mainCollateral: { address: "0x4444444444444444444444444444444444444444" as Address, symbol: "wstETH", decimals: 18, amount: 1000000000000000000n, valueUsd: 3000 },
      priceAtHf: () => 2400,
    };

    it("marks Aave position as monitor-only when no Aave guardian is deployed", () => {
      const status = positionStatusV4({
        position: dummyAavePosition,
        aaveGuardianAddress: null,
        morphoGuardianAddress: null,
      });
      assert.equal(status.kind, "monitor-only");
    });

    it("marks Aave position as not-protected when guardian exists but no policy is enabled", () => {
      const status = positionStatusV4({
        position: dummyAavePosition,
        aaveGuardianAddress: "0xguardAave" as Address,
        morphoGuardianAddress: null,
        aavePolicies: new Map(),
      });
      assert.equal(status.kind, "not-protected");
    });

    it("marks Aave position as protected when policy is enabled, and notes partial protection", () => {
      const policies = new Map([
        [
          "0x2222222222222222222222222222222222222222",
          {
            enabled: true,
            triggerHf: 1.3,
            targetHf: 1.6,
            maxRepayPerAction: 500000000n,
          },
        ],
      ]);
      const status = positionStatusV4({
        position: dummyAavePosition,
        aaveGuardianAddress: "0xguardAave" as Address,
        morphoGuardianAddress: null,
        aavePolicies: policies,
      });
      assert.equal(status.kind, "protected");
      assert.equal(status.debtSymbol, "USDC");
      assert.equal(status.triggerHf, 1.3);
      assert.equal(status.note, "1 of 2 debt assets protected");
    });

    it("marks Morpho position as monitor-only when no Morpho guardian exists", () => {
      const status = positionStatusV4({
        position: dummyMorphoPosition,
        aaveGuardianAddress: null,
        morphoGuardianAddress: null,
      });
      assert.equal(status.kind, "monitor-only");
      assert.match(status.reason, /cannot act on Morpho on this chain yet/i);
    });

    it("marks Morpho position as not-protected when guardian exists but no policy is set", () => {
      const status = positionStatusV4({
        position: dummyMorphoPosition,
        aaveGuardianAddress: null,
        morphoGuardianAddress: "0xguardMorpho" as Address,
        morphoPolicies: new Map(),
      });
      assert.equal(status.kind, "not-protected");
    });

    it("marks Morpho position as protected when Morpho policy is enabled", () => {
      const policies = new Map([
        [
          "0xmarket123",
          {
            enabled: true,
            triggerHf: 1.15,
            targetHf: 1.4,
            maxRepayPerAction: 1000000000000000000n,
          },
        ],
      ]);
      const status = positionStatusV4({
        position: dummyMorphoPosition,
        aaveGuardianAddress: null,
        morphoGuardianAddress: "0xguardMorpho" as Address,
        morphoPolicies: policies,
      });
      assert.equal(status.kind, "protected");
      assert.equal(status.debtSymbol, "WETH");
      assert.equal(status.triggerHf, 1.15);
      assert.equal(status.targetHf, 1.4);
    });
  });
});
