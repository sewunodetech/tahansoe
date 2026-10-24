import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateTokenValueUsd,
  calculateL1CapacityUsd,
  buildHoldingRow,
} from "@/lib/holdings";

const USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const WETH_ADDRESS = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";

test("calculateTokenValueUsd - calculates display USD value accurately", () => {
  // 500 USDC (6 decimals) @ $1.00 (100_000_000 base)
  const usdcVal = calculateTokenValueUsd(500_000_000n, 6, 100_000_000n);
  assert.equal(usdcVal, 500);

  // 2.5 WETH (18 decimals) @ $2,400.00 (240_000_000_000 base)
  const ethVal = calculateTokenValueUsd(2500000000000000000n, 18, 240000000000n);
  assert.equal(ethVal, 6000);

  // Non-positive or null priceBase returns null
  assert.equal(calculateTokenValueUsd(100n, 6, null), null);
  assert.equal(calculateTokenValueUsd(100n, 6, undefined), null);
  assert.equal(calculateTokenValueUsd(100n, 6, 0n), null);
  assert.equal(calculateTokenValueUsd(100n, 6, -100n), null);
});

test("calculateL1CapacityUsd - min(balance, allowance, maxRepayPerAction) in USD", () => {
  const priceBase = 100_000_000n; // $1.00
  const decimals = 6;

  // Case 1: Balance is the bottleneck
  // balance: $300, allowance: $1000, maxRepay: $500 -> capacity: $300
  const cap1 = calculateL1CapacityUsd({
    balance: 300_000_000n,
    allowance: 1000_000_000n,
    maxRepayPerAction: 500_000_000n,
    decimals,
    priceBase,
  });
  assert.equal(cap1, 300);

  // Case 2: Allowance is the bottleneck
  // balance: $1000, allowance: $250, maxRepay: $500 -> capacity: $250
  const cap2 = calculateL1CapacityUsd({
    balance: 1000_000_000n,
    allowance: 250_000_000n,
    maxRepayPerAction: 500_000_000n,
    decimals,
    priceBase,
  });
  assert.equal(cap2, 250);

  // Case 3: maxRepayPerAction is the bottleneck
  // balance: $1000, allowance: $1000, maxRepay: $400 -> capacity: $400
  const cap3 = calculateL1CapacityUsd({
    balance: 1000_000_000n,
    allowance: 1000_000_000n,
    maxRepayPerAction: 400_000_000n,
    decimals,
    priceBase,
  });
  assert.equal(cap3, 400);

  // Case 4: Allowance is 0 -> capacity: $0
  const capZero = calculateL1CapacityUsd({
    balance: 1000_000_000n,
    allowance: 0n,
    maxRepayPerAction: 500_000_000n,
    decimals,
    priceBase,
  });
  assert.equal(capZero, 0);

  // Case 5: No policy (maxRepayPerAction is null) -> returns null
  const noPolicy = calculateL1CapacityUsd({
    balance: 1000_000_000n,
    allowance: 1000_000_000n,
    maxRepayPerAction: null,
    decimals,
    priceBase,
  });
  assert.equal(noPolicy, null);

  // Case 6: Policy disabled -> returns null
  const disabledPolicy = calculateL1CapacityUsd({
    balance: 1000_000_000n,
    allowance: 1000_000_000n,
    maxRepayPerAction: 500_000_000n,
    decimals,
    priceBase,
    policyEnabled: false,
  });
  assert.equal(disabledPolicy, null);
});

test("buildHoldingRow - builds rows for native ETH and ERC20 tokens", () => {
  // Native ETH row
  const ethRow = buildHoldingRow({
    symbol: "ETH",
    address: "native",
    decimals: 18,
    balance: 1000000000000000000n, // 1 ETH
    priceBase: 250000000000n, // $2500
    allowanceToGuardian: null,
    policyDebtAsset: USDC_ADDRESS,
    policyEnabled: true,
  });
  assert.equal(ethRow.symbol, "ETH");
  assert.equal(ethRow.address, "native");
  assert.equal(ethRow.allowanceToGuardian, null);
  assert.equal(ethRow.valueUsd, 2500);
  assert.equal(ethRow.usedByLayer1, false);

  // ERC20 matching policy debt asset
  const usdcRow = buildHoldingRow({
    symbol: "USDC",
    address: USDC_ADDRESS,
    decimals: 6,
    balance: 500_000_000n,
    priceBase: 100_000_000n,
    allowanceToGuardian: 1000_000_000n,
    policyDebtAsset: USDC_ADDRESS,
    policyEnabled: true,
  });
  assert.equal(usdcRow.symbol, "USDC");
  assert.equal(usdcRow.address, USDC_ADDRESS);
  assert.equal(usdcRow.allowanceToGuardian, 1000_000_000n);
  assert.equal(usdcRow.valueUsd, 500);
  assert.equal(usdcRow.usedByLayer1, true);

  // ERC20 not matching policy debt asset
  const wethRow = buildHoldingRow({
    symbol: "WETH",
    address: WETH_ADDRESS,
    decimals: 18,
    balance: 1000000000000000000n,
    priceBase: 250000000000n,
    allowanceToGuardian: 0n,
    policyDebtAsset: USDC_ADDRESS,
    policyEnabled: true,
  });
  assert.equal(wethRow.usedByLayer1, false);
});
