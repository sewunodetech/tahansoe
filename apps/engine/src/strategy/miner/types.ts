/**
 * Types untuk Survivor Playbook Miner (spec m4-protection-strategy-agent §3.4).
 *
 * Mengklasifikasikan wallet Aave V3 Arbitrum One pada crash window historis
 * (HF < 1.15: SURVIVED vs LIQUIDATED), mengekstrak fitur aksi proteksi,
 * dan menghasilkan Playbook dengan ringkasan bukti agregat tanpa daftar wallet.
 */

import type { Playbook, ProtectionAction } from "@tahansoe/domain";

/** Jalur transmisi risiko dari docs/knowledge/risk-transmission.md. */
export type TransmissionPath =
  | "T1"
  | "T2"
  | "T3"
  | "T4"
  | "T5"
  | "T6"
  | "T7"
  | "T8"
  | "T9"
  | "T10"
  | "T11";

/** Definisi jendela crash historis (PRD §6.4 & risk-transmission.md §3). */
export interface CrashWindow {
  id: string;
  name: string;
  description: string;
  startDate: string; // ISO string
  endDate: string; // ISO string
  startBlock: bigint;
  endBlock: bigint;
  drawdownStartBlock: bigint;
  dominantPaths: TransmissionPath[];
  referenceAsset: string;
}

/** Tipe event Aave V3 Pool yang diamati. */
export type AavePoolEventType =
  | "Supply"
  | "Withdraw"
  | "Borrow"
  | "Repay"
  | "LiquidationCall";

/** Event Aave V3 yang dinormalisasi untuk analisis miner. */
export interface NormalizedAaveEvent {
  type: AavePoolEventType;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: string;
  user: string; // Canonical lowercase address
  reserveAsset: string;
  amount: bigint;
  extra?: {
    repayer?: string;
    onBehalfOf?: string;
    to?: string;
    collateralAsset?: string;
    liquidatedCollateralAmount?: bigint;
    liquidator?: string;
    useATokens?: boolean;
    receiveAToken?: boolean;
    interestRateMode?: bigint;
    borrowRate?: bigint;
  };
}

/** Snapshot akun Aave V3 getUserAccountData. */
export interface UserAccountDataSnapshot {
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  availableBorrowsBase: bigint;
  currentLiquidationThreshold: bigint;
  ltv: bigint;
  healthFactor: number;
}

/** Sumber pendanaan aksi proteksi. */
export type FundingSource =
  | "REPAY_WALLET"
  | "WITHDRAW_AND_REPAY"
  | "COLLATERAL_TOPUP"
  | "NONE";

/** Fitur perilaku proteksi survivor vs liquidated. */
export interface ProtectionBehavior {
  fundingSource: FundingSource;
  firstDeRiskBlock: bigint;
  leadBlocks: bigint; // drawdownStartBlock - firstDeRiskBlock (positif = preemptif)
  minHfDuringWindow: number;
  hfAfterAction: number;
  repayOrTopupAmountBase: bigint;
  debtBaseBefore: bigint;
  relativeSize: number; // repayOrTopupAmount / debtBaseBefore
}

/** Hasil evaluasi satu wallet pada satu jendela crash. */
export interface WalletWindowResult {
  wallet: string; // Local only! NEVER committed / exported to candidate playbooks.
  windowId: string;
  isAtRisk: boolean;
  minHf: number;
  outcome: "SURVIVED" | "LIQUIDATED" | "NOT_AT_RISK";
  behavior?: ProtectionBehavior;
}

/** Statistik agregat perilaku proteksi per jendela atau lintas jendela. */
export interface AggregateMiningEvidence {
  windowId: string;
  windowName: string;
  startBlock: bigint;
  endBlock: bigint;
  totalEvents: number;
  totalWallets: number;
  atRiskWallets: number;
  survivedWallets: number;
  liquidatedWallets: number;
  survivalRate: number; // 0..1
  actionDistribution: {
    repayWallet: number;
    withdrawAndRepay: number;
    collateralTopup: number;
    noAction: number;
  };
  medianLeadBlocks: number;
  medianHfAfter: number;
  medianRelativeSize: number;
}

/** Ringkasan hasil mining untuk seluruh batch jendela crash. */
export interface MinerRunReport {
  windows: AggregateMiningEvidence[];
  candidatePlaybooks: Playbook[];
  summary: {
    totalWindowsMined: number;
    totalAtRiskAnalyzed: number;
    totalSurvivors: number;
    totalLiquidated: number;
    overallSurvivalRate: number;
  };
  generatedAt: string;
  /** FIXTURE = wallet sintetis untuk test, bukan bukti empiris; hanya RPC yang boleh jadi kandidat playbook. */
  dataSource: "FIXTURE" | "RPC";
}
