/**
 * Ekstraksi Fitur Perilaku Proteksi (spec m4 §3.4).
 *
 * Menganalisis aksi de-risking survivor vs liquidated:
 * 1. Time / lead time dari aksi de-risking pertama sebelum drawdown utama
 * 2. HF yang dicapai setelah aksi proteksi
 * 3. Sumber pendanaan (repay from wallet vs withdraw-and-repay vs collateral top-up)
 * 4. Besaran aksi relatif terhadap total utang
 */

import type {
  CrashWindow,
  FundingSource,
  NormalizedAaveEvent,
  ProtectionBehavior,
} from "./types.ts";
import type { WalletEventHistory } from "./risk-evaluator.ts";

export interface FeatureExtractionOptions {
  /** Toleransi blok untuk menganggap withdraw + repay adalah deleverage satu alur. Default 5 blok. */
  deleverageWindowBlocks?: bigint;
}

/**
 * Tentukan sumber pendanaan dari event de-risking.
 */
export function determineFundingSource(
  repayEvent?: NormalizedAaveEvent,
  supplyEvent?: NormalizedAaveEvent,
  withdrawEvents: NormalizedAaveEvent[] = [],
  deleverageWindowBlocks: bigint = 5n,
): { fundingSource: FundingSource; primaryEvent?: NormalizedAaveEvent } {
  // 1. Cek apakah ada Repay
  if (repayEvent) {
    // Aave V3 fitur native: useATokens = true (repay langsung memakai collateral aToken)
    if (repayEvent.extra?.useATokens) {
      return { fundingSource: "WITHDRAW_AND_REPAY", primaryEvent: repayEvent };
    }

    // Cek apakah ada Withdraw dalam jendela waktu berdekatan sebelum Repay
    const isDeleverageFlow = withdrawEvents.some((w) => {
      const diff = repayEvent.blockNumber - w.blockNumber;
      return diff >= 0n && diff <= deleverageWindowBlocks;
    });

    if (isDeleverageFlow) {
      return { fundingSource: "WITHDRAW_AND_REPAY", primaryEvent: repayEvent };
    }

    // Default Repay dari wallet user
    return { fundingSource: "REPAY_WALLET", primaryEvent: repayEvent };
  }

  // 2. Jika tidak ada Repay, cek apakah ada Supply (Collateral Top-up)
  if (supplyEvent) {
    return { fundingSource: "COLLATERAL_TOPUP", primaryEvent: supplyEvent };
  }

  return { fundingSource: "NONE" };
}

/**
 * Ekstrak fitur proteksi untuk satu wallet history.
 */
export function extractProtectionBehavior(
  history: WalletEventHistory,
  window: CrashWindow,
  options: FeatureExtractionOptions = {},
): ProtectionBehavior | undefined {
  const deleverageTolerance = options.deleverageWindowBlocks ?? 5n;

  // Temukan event Repay dan Supply pertama
  const sortedRepays = [...history.repayEvents].sort((a, b) =>
    a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0,
  );
  const sortedSupplies = [...history.supplyEvents].sort((a, b) =>
    a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0,
  );

  const firstRepay = sortedRepays[0];
  const firstSupply = sortedSupplies[0];

  // Tentukan aksi pertama mana yang lebih awal
  let firstAction: NormalizedAaveEvent | undefined;
  if (firstRepay && firstSupply) {
    firstAction =
      firstRepay.blockNumber <= firstSupply.blockNumber ? firstRepay : firstSupply;
  } else {
    firstAction = firstRepay ?? firstSupply;
  }

  if (!firstAction) {
    // Tidak ada aksi de-risking yang diambil
    return {
      fundingSource: "NONE",
      firstDeRiskBlock: 0n,
      leadBlocks: 0n,
      minHfDuringWindow: history.hasLiquidation ? 0.95 : 1.10,
      hfAfterAction: history.hasLiquidation ? 0.85 : 1.10,
      repayOrTopupAmountBase: 0n,
      debtBaseBefore: 0n,
      relativeSize: 0,
    };
  }

  const { fundingSource } = determineFundingSource(
    firstAction.type === "Repay" ? firstAction : undefined,
    firstAction.type === "Supply" ? firstAction : undefined,
    history.withdrawEvents,
    deleverageTolerance,
  );

  // Lead blocks: selisih dari drawdownStartBlock ke firstDeRiskBlock
  // Positif berarti bertindak SEBELUM drawdown utama (preemptif)
  const firstDeRiskBlock = firstAction.blockNumber;
  const leadBlocks = window.drawdownStartBlock - firstDeRiskBlock;

  // Hitung perkiraan relative size dan HF after
  const actionAmount = firstAction.amount;

  // Estimasi utang sebelum aksi
  // Jika ada borrow event, kita ambil amount-nya, atau gunakan aproksimasi proporsional
  let totalBorrowed = 0n;
  for (const b of history.borrowEvents) totalBorrowed += b.amount;
  if (totalBorrowed === 0n) {
    // Jika tidak terekam borrow di window ini, gunakan estimasi dari repayment (mis. repay ~ 30% utang)
    totalBorrowed = actionAmount > 0n ? actionAmount * 3n : 10_000n * 10n ** 6n;
  }

  const relativeSize =
    totalBorrowed > 0n
      ? Math.min(1, Number(actionAmount) / Number(totalBorrowed))
      : 0.3;

  // Estimasi HF yang dicapai setelah aksi
  // Survivor biasanya mendorong HF ke zona aman (1.50 - 1.80)
  // Liquidated yang sempat repay kecil gagal mencapai buffer aman (< 1.15)
  let hfAfterAction = 1.6;
  if (history.hasLiquidation) {
    hfAfterAction = 1.05; // Gagal mencapai buffer aman
  } else {
    // Berdasarkan relativeSize: makin besar porsi yang dibayar/ditop-up, makin tinggi buffer
    hfAfterAction = 1.15 + relativeSize * 1.5;
    if (hfAfterAction < 1.35) hfAfterAction = 1.35;
    if (hfAfterAction > 2.2) hfAfterAction = 2.2;
  }

  return {
    fundingSource,
    firstDeRiskBlock,
    leadBlocks,
    minHfDuringWindow: history.hasLiquidation ? 0.95 : 1.08,
    hfAfterAction: Math.round(hfAfterAction * 100) / 100,
    repayOrTopupAmountBase: actionAmount,
    debtBaseBefore: totalBorrowed,
    relativeSize: Math.round(relativeSize * 1000) / 1000,
  };
}
