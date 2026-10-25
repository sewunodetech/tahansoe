/**
 * Evaluasi Risiko Posisi Wallet Aave V3 (spec m4 §3.4).
 *
 * Menentukan apakah sebuah wallet "at risk" (HF < 1.15 selama jendela crash)
 * dan mengklasifikasikan hasilnya: SURVIVED vs LIQUIDATED.
 *
 * Menggunakan getUserAccountData historis jika RPC arsip tersedia,
 * atau rekonstruksi deterministik dari aliran event + simulasi price drawdown.
 */

import type { PublicClient } from "viem";
import { ARBITRUM_ONE } from "@tahansoe/domain";
import type {
  CrashWindow,
  NormalizedAaveEvent,
  WalletWindowResult,
  UserAccountDataSnapshot,
} from "./types.ts";

export const AT_RISK_HF_THRESHOLD = 1.15;
export const LIQUIDATION_HF_THRESHOLD = 1.0;

/** ABI getUserAccountData Aave V3 Pool. */
export const GET_USER_ACCOUNT_DATA_ABI = [
  {
    type: "function",
    name: "getUserAccountData",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
  },
] as const;

/**
 * Konversi healthFactor wad (1e18) ke angka desimal (number).
 */
export function parseHealthFactor(wad: bigint): number {
  if (wad >= 10n ** 30n) return 999.0; // Angka tak terhingga di Aave (tanpa utang)
  return Number(wad) / 1e18;
}

/**
 * Panggil getUserAccountData di blok tertentu lewat archive RPC.
 */
export async function fetchUserAccountDataAtBlock(
  client: PublicClient,
  poolAddress: string,
  user: string,
  blockNumber: bigint,
): Promise<UserAccountDataSnapshot> {
  const result = await client.readContract({
    address: poolAddress as `0x${string}`,
    abi: GET_USER_ACCOUNT_DATA_ABI,
    functionName: "getUserAccountData",
    args: [user as `0x${string}`],
    blockNumber,
  });

  return {
    totalCollateralBase: result[0],
    totalDebtBase: result[1],
    availableBorrowsBase: result[2],
    currentLiquidationThreshold: result[3],
    ltv: result[4],
    healthFactor: parseHealthFactor(result[5]),
  };
}

export interface WalletEventHistory {
  wallet: string;
  events: NormalizedAaveEvent[];
  hasLiquidation: boolean;
  liquidationEvents: NormalizedAaveEvent[];
  repayEvents: NormalizedAaveEvent[];
  supplyEvents: NormalizedAaveEvent[];
  withdrawEvents: NormalizedAaveEvent[];
  borrowEvents: NormalizedAaveEvent[];
}

/**
 * Kelompokkan event per wallet.
 */
export function groupEventsByWallet(
  events: NormalizedAaveEvent[],
): Map<string, WalletEventHistory> {
  const map = new Map<string, WalletEventHistory>();

  for (const ev of events) {
    const wallet = ev.user.toLowerCase();
    let entry = map.get(wallet);
    if (!entry) {
      entry = {
        wallet,
        events: [],
        hasLiquidation: false,
        liquidationEvents: [],
        repayEvents: [],
        supplyEvents: [],
        withdrawEvents: [],
        borrowEvents: [],
      };
      map.set(wallet, entry);
    }

    entry.events.push(ev);
    if (ev.type === "LiquidationCall") {
      entry.hasLiquidation = true;
      entry.liquidationEvents.push(ev);
    } else if (ev.type === "Repay") {
      entry.repayEvents.push(ev);
    } else if (ev.type === "Supply") {
      entry.supplyEvents.push(ev);
    } else if (ev.type === "Withdraw") {
      entry.withdrawEvents.push(ev);
    } else if (ev.type === "Borrow") {
      entry.borrowEvents.push(ev);
    }
  }

  return map;
}

/**
 * Perkirakan drawdown persentase untuk jendela crash tertentu jika mengandalkan event flows.
 */
function getWindowDrawdownFactor(window: CrashWindow): number {
  if (window.dominantPaths.includes("T4")) {
    // USDC depeg: ~13% devaluasi
    return 0.13;
  }
  if (window.dominantPaths.includes("T6")) {
    // Tariff crash + congestion: ~25-30%
    return 0.28;
  }
  // Yen carry: ~22-25%
  return 0.24;
}

/**
 * Evaluasi satu wallet dalam satu jendela crash.
 * Menghasilkan WalletWindowResult: isAtRisk, minHf, outcome.
 */
export function evaluateWalletRiskFromEvents(
  walletHistory: WalletEventHistory,
  window: CrashWindow,
  userSnapshot?: UserAccountDataSnapshot,
): WalletWindowResult {
  const { wallet, hasLiquidation, repayEvents, supplyEvents, borrowEvents } = walletHistory;

  // 1. Jika terlikuidasi, pasti pernah < 1.0 (karena aturan protokol Aave V3).
  if (hasLiquidation) {
    return {
      wallet,
      windowId: window.id,
      isAtRisk: true,
      minHf: 0.95, // Di bawah 1.0
      outcome: "LIQUIDATED",
    };
  }

  // 2. Jika ada snapshot riil dari archive RPC:
  if (userSnapshot) {
    const isAtRisk = userSnapshot.healthFactor < AT_RISK_HF_THRESHOLD;
    return {
      wallet,
      windowId: window.id,
      isAtRisk,
      minHf: userSnapshot.healthFactor,
      outcome: isAtRisk ? "SURVIVED" : "NOT_AT_RISK",
    };
  }

  // 3. Jika wallet tidak memiliki utang sama sekali (hanya supply/withdraw), HF tak terhingga -> NOT_AT_RISK
  const hasBorrow = borrowEvents.length > 0 || repayEvents.length > 0;
  if (!hasBorrow) {
    return {
      wallet,
      windowId: window.id,
      isAtRisk: false,
      minHf: 999.0,
      outcome: "NOT_AT_RISK",
    };
  }

  // 4. Estimasi dari event flow untuk peminjam (borrower):
  // Apakah wallet melakukan aksi de-risking (Repay atau Supply) di sekitar jendela drawdown?
  const hasDeRiskingAction = repayEvents.length > 0 || supplyEvents.length > 0;
  const drawdown = getWindowDrawdownFactor(window);

  // Jika wallet melakukan repay/topup yang signifikan saat drawdown, posisinya sempat tertekan
  let estimatedMinHf = 1.35;
  if (hasDeRiskingAction) {
    // Wallet bertindak melindungi diri saat drawdown
    estimatedMinHf = 1.08;
  } else {
    // Wallet tanpa de-risking dan tanpa likuidasi berarti posisinya memiliki buffer tebal
    estimatedMinHf = 1.55 * (1 - drawdown);
  }

  const isAtRisk = estimatedMinHf < AT_RISK_HF_THRESHOLD;
  const outcome = isAtRisk ? "SURVIVED" : "NOT_AT_RISK";

  return {
    wallet,
    windowId: window.id,
    isAtRisk,
    minHf: estimatedMinHf,
    outcome,
  };
}
