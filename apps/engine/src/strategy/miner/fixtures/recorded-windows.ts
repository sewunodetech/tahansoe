/**
 * Recorded Fixture Event Logs untuk 3 Jendela Crash Arbitrum One.
 *
 * Mengacu pada PRD §6.4 dan docs/knowledge/risk-transmission.md:
 * 1. usdc-depeg-mar-2023 (T4)
 * 2. yen-carry-aug-2024 (T1, T3)
 * 3. tariff-crash-oct-2025 (T1, T3, T6)
 *
 * Digunakan untuk:
 * - Deterministic unit testing (at-risk detection, outcome classification, feature extraction, playbook emission)
 * - Fallback mining saat RPC arsip historis tidak disediakan di lingkungan eksekusi
 */

import { ARBITRUM_ONE } from "@tahansoe/domain";
import type { NormalizedAaveEvent } from "../types.ts";
import { HISTORICAL_CRASH_WINDOWS } from "../windows.ts";

const USDC = (ARBITRUM_ONE.tokens?.USDC ?? "0xaf88d065e77c8cc2239327c5edb3a432268e5831").toLowerCase();
const WETH = (ARBITRUM_ONE.tokens?.WETH ?? "0x82af49447d8a07e3bd95bd0d56f35241523fbab1").toLowerCase();
const USDT = (ARBITRUM_ONE.tokens?.USDT ?? "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9").toLowerCase();
const LIQUIDATOR_1 = "0x0000000000000000000000000000000000001191";
const LIQUIDATOR_2 = "0x0000000000000000000000000000000000001192";

/**
 * Buat event fixture untuk jendela crash USDC depeg (Mar 2023).
 */
export function getUsdcDepegFixtureEvents(): NormalizedAaveEvent[] {
  const window = HISTORICAL_CRASH_WINDOWS[0]!;
  const drawdownBlock = window.drawdownStartBlock; // 69_850_000n

  const events: NormalizedAaveEvent[] = [];

  // Wallet A1 (Survivor - Repay Wallet Preemptive)
  const a1 = "0x1111111111111111111111111111111111111001";
  events.push(
    {
      type: "Borrow",
      blockNumber: drawdownBlock - 50_000n,
      logIndex: 1,
      transactionHash: "0xa1_borrow",
      user: a1,
      reserveAsset: USDC,
      amount: 50_000n * 10n ** 6n,
    },
    // Repay preemptif 20.000 blok sebelum drawdown puncak
    {
      type: "Repay",
      blockNumber: drawdownBlock - 20_000n,
      logIndex: 2,
      transactionHash: "0xa1_repay",
      user: a1,
      reserveAsset: USDC,
      amount: 25_000n * 10n ** 6n,
      extra: { repayer: a1, useATokens: false },
    },
  );

  // Wallet A2 (Survivor - Withdraw & Repay / Deleverage)
  const a2 = "0x1111111111111111111111111111111111111002";
  events.push(
    {
      type: "Borrow",
      blockNumber: drawdownBlock - 60_000n,
      logIndex: 3,
      transactionHash: "0xa2_borrow",
      user: a2,
      reserveAsset: USDC,
      amount: 80_000n * 10n ** 6n,
    },
    {
      type: "Withdraw",
      blockNumber: drawdownBlock - 15_000n,
      logIndex: 4,
      transactionHash: "0xa2_withdraw",
      user: a2,
      reserveAsset: WETH,
      amount: 15n * 10n ** 18n,
    },
    {
      type: "Repay",
      blockNumber: drawdownBlock - 15_000n,
      logIndex: 5,
      transactionHash: "0xa2_repay",
      user: a2,
      reserveAsset: USDC,
      amount: 40_000n * 10n ** 6n,
      extra: { repayer: a2, useATokens: false },
    },
  );

  // Wallet A3 (Survivor - Collateral Topup)
  const a3 = "0x1111111111111111111111111111111111111003";
  events.push(
    {
      type: "Borrow",
      blockNumber: drawdownBlock - 40_000n,
      logIndex: 6,
      transactionHash: "0xa3_borrow",
      user: a3,
      reserveAsset: USDC,
      amount: 30_000n * 10n ** 6n,
    },
    {
      type: "Supply",
      blockNumber: drawdownBlock - 12_000n,
      logIndex: 7,
      transactionHash: "0xa3_supply",
      user: a3,
      reserveAsset: WETH,
      amount: 25n * 10n ** 18n,
    },
  );

  // Wallet A4 (Liquidated - Tanpa aksi proteksi)
  const a4 = "0x1111111111111111111111111111111111111004";
  events.push(
    {
      type: "Borrow",
      blockNumber: drawdownBlock - 50_000n,
      logIndex: 8,
      transactionHash: "0xa4_borrow",
      user: a4,
      reserveAsset: USDC,
      amount: 100_000n * 10n ** 6n,
    },
    {
      type: "LiquidationCall",
      blockNumber: drawdownBlock + 5_000n,
      logIndex: 9,
      transactionHash: "0xa4_liq",
      user: a4,
      reserveAsset: USDC,
      amount: 50_000n * 10n ** 6n,
      extra: {
        collateralAsset: WETH,
        liquidatedCollateralAmount: 30n * 10n ** 18n,
        liquidator: LIQUIDATOR_1,
        receiveAToken: false,
      },
    },
  );

  // Wallet A5 (Liquidated - Terlambat bertindak)
  const a5 = "0x1111111111111111111111111111111111111005";
  events.push(
    {
      type: "Borrow",
      blockNumber: drawdownBlock - 30_000n,
      logIndex: 10,
      transactionHash: "0xa5_borrow",
      user: a5,
      reserveAsset: USDC,
      amount: 45_000n * 10n ** 6n,
    },
    // Repay terlalu kecil setelah crash berjalan
    {
      type: "Repay",
      blockNumber: drawdownBlock + 2_000n,
      logIndex: 11,
      transactionHash: "0xa5_late_repay",
      user: a5,
      reserveAsset: USDC,
      amount: 3_000n * 10n ** 6n,
      extra: { repayer: a5, useATokens: false },
    },
    {
      type: "LiquidationCall",
      blockNumber: drawdownBlock + 8_000n,
      logIndex: 12,
      transactionHash: "0xa5_liq",
      user: a5,
      reserveAsset: USDC,
      amount: 22_500n * 10n ** 6n,
      extra: {
        collateralAsset: WETH,
        liquidatedCollateralAmount: 14n * 10n ** 18n,
        liquidator: LIQUIDATOR_2,
        receiveAToken: false,
      },
    },
  );

  // Wallet A6 (Healthy - Tidak berisiko)
  const a6 = "0x1111111111111111111111111111111111111006";
  events.push({
    type: "Supply",
    blockNumber: drawdownBlock - 80_000n,
    logIndex: 13,
    transactionHash: "0xa6_supply",
    user: a6,
    reserveAsset: WETH,
    amount: 100n * 10n ** 18n,
  });

  return events;
}

/**
 * Buat event fixture untuk jendela crash Yen Carry Trade Unwind (Agu 2024).
 */
export function getYenCarryFixtureEvents(): NormalizedAaveEvent[] {
  const window = HISTORICAL_CRASH_WINDOWS[1]!;
  const drawdownBlock = window.drawdownStartBlock; // 239_500_000n

  const events: NormalizedAaveEvent[] = [];

  // Wallet B1 (Survivor - Repay Wallet Preemptive)
  const b1 = "0x2222222222222222222222222222222222222001";
  events.push(
    {
      type: "Borrow",
      blockNumber: drawdownBlock - 45_000n,
      logIndex: 1,
      transactionHash: "0xb1_borrow",
      user: b1,
      reserveAsset: USDT,
      amount: 60_000n * 10n ** 6n,
    },
    {
      type: "Repay",
      blockNumber: drawdownBlock - 18_000n,
      logIndex: 2,
      transactionHash: "0xb1_repay",
      user: b1,
      reserveAsset: USDT,
      amount: 35_000n * 10n ** 6n,
      extra: { repayer: b1, useATokens: false },
    },
  );

  // Wallet B2 (Survivor - Repay via useATokens direct)
  const b2 = "0x2222222222222222222222222222222222222002";
  events.push(
    {
      type: "Borrow",
      blockNumber: drawdownBlock - 50_000n,
      logIndex: 3,
      transactionHash: "0xb2_borrow",
      user: b2,
      reserveAsset: USDC,
      amount: 120_000n * 10n ** 6n,
    },
    {
      type: "Repay",
      blockNumber: drawdownBlock - 14_000n,
      logIndex: 4,
      transactionHash: "0xb2_atokens_repay",
      user: b2,
      reserveAsset: USDC,
      amount: 60_000n * 10n ** 6n,
      extra: { repayer: b2, useATokens: true },
    },
  );

  // Wallet B3 (Survivor - Collateral Topup)
  const b3 = "0x2222222222222222222222222222222222222003";
  events.push(
    {
      type: "Borrow",
      blockNumber: drawdownBlock - 30_000n,
      logIndex: 5,
      transactionHash: "0xb3_borrow",
      user: b3,
      reserveAsset: USDC,
      amount: 70_000n * 10n ** 6n,
    },
    {
      type: "Supply",
      blockNumber: drawdownBlock - 22_000n,
      logIndex: 6,
      transactionHash: "0xb3_supply",
      user: b3,
      reserveAsset: WETH,
      amount: 40n * 10n ** 18n,
    },
  );

  // Wallet B4 (Liquidated)
  const b4 = "0x2222222222222222222222222222222222222004";
  events.push(
    {
      type: "Borrow",
      blockNumber: drawdownBlock - 40_000n,
      logIndex: 7,
      transactionHash: "0xb4_borrow",
      user: b4,
      reserveAsset: USDC,
      amount: 95_000n * 10n ** 6n,
    },
    {
      type: "LiquidationCall",
      blockNumber: drawdownBlock + 3_000n,
      logIndex: 8,
      transactionHash: "0xb4_liq",
      user: b4,
      reserveAsset: USDC,
      amount: 47_500n * 10n ** 6n,
      extra: {
        collateralAsset: WETH,
        liquidatedCollateralAmount: 20n * 10n ** 18n,
        liquidator: LIQUIDATOR_1,
        receiveAToken: false,
      },
    },
  );

  return events;
}

/**
 * Buat event fixture untuk jendela crash US-China Tariff Escalation (Okt 2025).
 */
export function getTariffCrashFixtureEvents(): NormalizedAaveEvent[] {
  const window = HISTORICAL_CRASH_WINDOWS[2]!;
  const drawdownBlock = window.drawdownStartBlock; // 360_700_000n

  const events: NormalizedAaveEvent[] = [];

  // Wallet C1 (Survivor - Repay Wallet Preemptive)
  const c1 = "0x3333333333333333333333333333333333333001";
  events.push(
    {
      type: "Borrow",
      blockNumber: drawdownBlock - 60_000n,
      logIndex: 1,
      transactionHash: "0xc1_borrow",
      user: c1,
      reserveAsset: USDC,
      amount: 150_000n * 10n ** 6n,
    },
    {
      type: "Repay",
      blockNumber: drawdownBlock - 30_000n,
      logIndex: 2,
      transactionHash: "0xc1_repay",
      user: c1,
      reserveAsset: USDC,
      amount: 80_000n * 10n ** 6n,
      extra: { repayer: c1, useATokens: false },
    },
  );

  // Wallet C2 (Survivor - Withdraw & Repay / Deleverage)
  const c2 = "0x3333333333333333333333333333333333333002";
  events.push(
    {
      type: "Borrow",
      blockNumber: drawdownBlock - 50_000n,
      logIndex: 3,
      transactionHash: "0xc2_borrow",
      user: c2,
      reserveAsset: USDC,
      amount: 110_000n * 10n ** 6n,
    },
    {
      type: "Withdraw",
      blockNumber: drawdownBlock - 25_000n,
      logIndex: 4,
      transactionHash: "0xc2_withdraw",
      user: c2,
      reserveAsset: WETH,
      amount: 20n * 10n ** 18n,
    },
    {
      type: "Repay",
      blockNumber: drawdownBlock - 25_000n,
      logIndex: 5,
      transactionHash: "0xc2_repay",
      user: c2,
      reserveAsset: USDC,
      amount: 55_000n * 10n ** 6n,
      extra: { repayer: c2, useATokens: false },
    },
  );

  // Wallet C3 (Survivor - Collateral Topup)
  const c3 = "0x3333333333333333333333333333333333333003";
  events.push(
    {
      type: "Borrow",
      blockNumber: drawdownBlock - 40_000n,
      logIndex: 6,
      transactionHash: "0xc3_borrow",
      user: c3,
      reserveAsset: USDT,
      amount: 85_000n * 10n ** 6n,
    },
    {
      type: "Supply",
      blockNumber: drawdownBlock - 18_000n,
      logIndex: 7,
      transactionHash: "0xc3_supply",
      user: c3,
      reserveAsset: WETH,
      amount: 35n * 10n ** 18n,
    },
  );

  // Wallet C4 (Liquidated 1)
  const c4 = "0x3333333333333333333333333333333333333004";
  events.push(
    {
      type: "Borrow",
      blockNumber: drawdownBlock - 70_000n,
      logIndex: 8,
      transactionHash: "0xc4_borrow",
      user: c4,
      reserveAsset: USDC,
      amount: 200_000n * 10n ** 6n,
    },
    {
      type: "LiquidationCall",
      blockNumber: drawdownBlock + 4_000n,
      logIndex: 9,
      transactionHash: "0xc4_liq",
      user: c4,
      reserveAsset: USDC,
      amount: 100_000n * 10n ** 6n,
      extra: {
        collateralAsset: WETH,
        liquidatedCollateralAmount: 45n * 10n ** 18n,
        liquidator: LIQUIDATOR_1,
        receiveAToken: false,
      },
    },
  );

  // Wallet C5 (Liquidated 2)
  const c5 = "0x3333333333333333333333333333333333333005";
  events.push(
    {
      type: "Borrow",
      blockNumber: drawdownBlock - 45_000n,
      logIndex: 10,
      transactionHash: "0xc5_borrow",
      user: c5,
      reserveAsset: USDT,
      amount: 75_000n * 10n ** 6n,
    },
    {
      type: "LiquidationCall",
      blockNumber: drawdownBlock + 6_000n,
      logIndex: 11,
      transactionHash: "0xc5_liq",
      user: c5,
      reserveAsset: USDT,
      amount: 37_500n * 10n ** 6n,
      extra: {
        collateralAsset: WETH,
        liquidatedCollateralAmount: 18n * 10n ** 18n,
        liquidator: LIQUIDATOR_2,
        receiveAToken: false,
      },
    },
  );

  return events;
}

/**
 * Peta fixture events per window ID.
 */
export const FIXTURE_EVENTS_BY_WINDOW: Record<string, () => NormalizedAaveEvent[]> = {
  "usdc-depeg-mar-2023": getUsdcDepegFixtureEvents,
  "yen-carry-aug-2024": getYenCarryFixtureEvents,
  "tariff-crash-oct-2025": getTariffCrashFixtureEvents,
};
