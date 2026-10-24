import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  priceForHealthFactor,
  pickMainCollateral,
  morphoHealthFactor,
  toAssetsUp,
  wTaylorCompounded,
  accrueBorrowAssets,
  serializePosition,
  deserializePosition,
  makePriceAtHf,
  type AssetAmount,
  type PositionDetail,
} from "../src";

const WETH: AssetAmount = {
  symbol: "WETH",
  address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  decimals: 18,
  amount: 2n * 10n ** 18n,
  valueUsd: 6000,
  liquidationThresholdBps: 8250,
};
const WBTC: AssetAmount = {
  symbol: "WBTC",
  address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
  decimals: 8,
  amount: 6_666_666n,
  valueUsd: 4000,
  liquidationThresholdBps: 7500,
};

const close = (actual: number | null, expected: number, eps = 1e-6) => {
  assert.ok(actual !== null, "expected a price, got null");
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);
};

describe("priceForHealthFactor", () => {
  it("single collateral: 2 WETH, debt $3000, LT 82.5%", () => {
    // HF now = 6000 × 0.825 / 3000 = 1.65; p(HF) = HF × 3000 / (2 × 0.825)
    close(priceForHealthFactor({ collateral: [WETH], debtUsd: 3000, mainCollateral: WETH, hf: 1 }), 3000 / 1.65);
    close(priceForHealthFactor({ collateral: [WETH], debtUsd: 3000, mainCollateral: WETH.address, hf: 1.3 }), 3900 / 1.65);
    // HF now → current price
    close(priceForHealthFactor({ collateral: [WETH], debtUsd: 3000, mainCollateral: WETH, hf: 1.65 }), 3000);
  });

  it("multi collateral: other assets held constant with their own LT", () => {
    // rest = 4000 × 0.75 = 3000; p = (hf × 6000 − 3000) / (2 × 0.825)
    const input = { collateral: [WETH, WBTC], debtUsd: 6000, mainCollateral: WETH };
    close(priceForHealthFactor({ ...input, hf: 1 }), 3000 / 1.65);
    close(priceForHealthFactor({ ...input, hf: 1.2 }), 4200 / 1.65);
  });

  it("uses the fallback LT for assets without their own", () => {
    const bare = { ...WETH, liquidationThresholdBps: undefined };
    close(
      priceForHealthFactor({ collateral: [bare], debtUsd: 3000, liquidationThresholdBps: 8000, mainCollateral: bare, hf: 1 }),
      3000 / 1.6
    );
    assert.equal(priceForHealthFactor({ collateral: [bare], debtUsd: 3000, mainCollateral: bare, hf: 1 }), null);
  });

  it("returns null when impossible", () => {
    assert.equal(priceForHealthFactor({ collateral: [WETH], debtUsd: 0, mainCollateral: WETH, hf: 1 }), null, "no debt");
    assert.equal(priceForHealthFactor({ collateral: [WETH], debtUsd: 3000, mainCollateral: WBTC, hf: 1 }), null, "main missing");
    assert.equal(priceForHealthFactor({ collateral: [WETH], debtUsd: 3000, mainCollateral: WETH, hf: 0 }), null, "hf 0");
    // other collateral alone keeps HF above 1: 10000 × 0.75 = 7500 > 3000
    const bigBtc = { ...WBTC, valueUsd: 10_000 };
    assert.equal(priceForHealthFactor({ collateral: [WETH, bigBtc], debtUsd: 3000, mainCollateral: WETH, hf: 1 }), null);
  });

  it("pickMainCollateral picks the largest by value", () => {
    assert.equal(pickMainCollateral([WBTC, WETH]), WETH);
    assert.equal(pickMainCollateral([]), undefined);
  });
});

describe("Morpho math", () => {
  it("toAssetsUp follows SharesMathLib with virtual shares and rounds up", () => {
    // (2000e12 × (2000e6 − 1 + 1)) / (2000e12 − 1e6 + 1e6) = 2000e6 exactly
    assert.equal(toAssetsUp(2000n * 10n ** 12n, 2000n * 10n ** 6n - 1n, 2000n * 10n ** 12n - 10n ** 6n), 2000n * 10n ** 6n);
    // 1 share of (10 assets / 3e6 shares) → (1 × 11) / (3e6 + 1e6) rounds up to 1
    assert.equal(toAssetsUp(1n, 10n, 3_000_000n), 1n);
    assert.equal(toAssetsUp(0n, 10n, 3_000_000n), 0n);
  });

  it("morphoHealthFactor: 1 WETH @ $3000, lltv 86%, debt 2000 USDC → 1.29", () => {
    const price = 3000n * 10n ** 24n; // 1e36 × 3000 × 10^(6 − 18)
    const hf = morphoHealthFactor({ collateral: 10n ** 18n, price, lltv: 86n * 10n ** 16n, borrowAssets: 2000n * 10n ** 6n });
    assert.equal(hf, 129n * 10n ** 16n);
  });

  it("morphoHealthFactor: exactly at lltv gives 1.0, no debt gives max uint", () => {
    const price = 3000n * 10n ** 24n;
    const lltv = 86n * 10n ** 16n;
    assert.equal(morphoHealthFactor({ collateral: 10n ** 18n, price, lltv, borrowAssets: 2580n * 10n ** 6n }), 10n ** 18n);
    assert.equal(morphoHealthFactor({ collateral: 10n ** 18n, price, lltv, borrowAssets: 0n }), 2n ** 256n - 1n);
  });

  it("wTaylorCompounded / accrueBorrowAssets", () => {
    // x·n = 1 WAD → 1 + 1/2 + 1/6 = 1.6666… WAD
    assert.equal(wTaylorCompounded(10n ** 9n, 10n ** 9n), 1_666_666_666_666_666_666n);
    assert.equal(accrueBorrowAssets(1000n, 10n ** 9n, 0n), 1000n);
    // 1e18 assets, ~3.17% APR for one year: 1e9 per second × 31_536_000 s
    const accrued = accrueBorrowAssets(10n ** 18n, 10n ** 9n, 31_536_000n);
    assert.ok(accrued > 1_032_000_000_000_000_000n && accrued < 1_033_000_000_000_000_000n, String(accrued));
  });
});

describe("serializePosition / deserializePosition", () => {
  it("round-trips through JSON and rebuilds priceAtHf", () => {
    const debt: AssetAmount[] = [{ symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, amount: 3000n * 10n ** 6n, valueUsd: 3000 }];
    const p: PositionDetail = {
      protocol: "aave-v3",
      chainId: 42161,
      user: "0x000000000000000000000000000000000000dEaD",
      healthFactor: 165n * 10n ** 16n,
      liquidationThreshold: 8250n,
      collateralValueUsd: 6000n * 10n ** 8n,
      debtValueUsd: 3000n * 10n ** 8n,
      oracleSource: "0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7",
      id: "aave-v3:42161:pool:0x000000000000000000000000000000000000dead",
      collateral: [WETH],
      debt,
      liquidationThresholdBps: 8250,
      priceAtHf: makePriceAtHf([WETH], 3000, 8250, WETH),
      mainCollateral: WETH,
      monitorOnly: true,
    };
    const json = JSON.stringify(serializePosition(p));
    const back = deserializePosition(JSON.parse(json));
    assert.equal(back.healthFactor, p.healthFactor);
    assert.equal(back.collateral[0]?.amount, WETH.amount);
    assert.equal(back.mainCollateral, back.collateral[0]);
    close(back.priceAtHf(1), p.priceAtHf(1)!);
  });
});
