/**
 * Tipe kanonik domain Tahansoe.
 * Sumber kebenaran: docs/prd.md §6.3, §7.1, §7.2 dan docs/knowledge/risk-transmission.md.
 *
 * Murni tanpa dependensi I/O, database, network, atau SDK eksternal (viem, dsb.).
 */

/** Alamat Ethereum hex 20-byte (format 0x...) */
export type Address = `0x${string}`;

/** String heksadesimal dengan prefix 0x */
export type Hex = `0x${string}`;

/**
 * Jalur transmisi kejadian dunia nyata ke likuidasi posisi (docs/knowledge/risk-transmission.md §1).
 * T1: Harga collateral jatuh
 * T2: Volatilitas naik
 * T3: Leverage cascade
 * T4: Depeg stablecoin
 * T5: Depeg LST/LRT
 * T6: Gas / kongesti
 * T7: Likuiditas reserve kering
 * T8: Oracle lag / anomali
 * T9: Insiden protokol
 * T10: Sequencer L2 down
 * T11: Bunga & carry (borrow APR melonjak / carry negatif → HF turun tanpa harga bergerak)
 */
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

export const TRANSMISSION_PATHS: readonly TransmissionPath[] = [
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
  "T6",
  "T7",
  "T8",
  "T9",
  "T10",
  "T11",
] as const;

/**
 * Rezim risiko pasar (docs/prd.md §6.3).
 */
export type Regime = "CALM" | "ELEVATED" | "STRESSED" | "CRISIS";

export const REGIMES: readonly Regime[] = [
  "CALM",
  "ELEVATED",
  "STRESSED",
  "CRISIS",
] as const;

/**
 * Bukti pendukung untuk sinyal (docs/prd.md §6.3).
 */
export interface SignalEvidence {
  title: string;
  url?: string;
  source: string;
  dedupeKey?: string;
}

/**
 * Sinyal risiko dari salah satu modul pendeteksi (docs/prd.md §6.3).
 */
export interface Signal {
  id: string;
  module: "ORACLE" | "TECHNICAL" | "ONCHAIN" | "MACRO" | "NEWS" | "SOCIAL" | "RESEARCH";
  paths?: TransmissionPath[];   // T1..T11, lihat knowledge/risk-transmission.md
  assets: string[];             // mis. ["ETH", "WBTC"]
  direction: "DOWN" | "UP" | "VOLATILITY";
  severity: number;             // 0..1
  confidence: number;           // 0..1
  horizonHours: number;
  observedAt: Date;
  expiresAt: Date;
  evidence: SignalEvidence[];
  dedupeKey?: string;
}

/**
 * Hasil agregasi (risk fusion) seluruh sinyal risiko untuk suatu aset (docs/prd.md §6.3).
 */
export interface RiskAssessment {
  asset: string;
  chainId: number;
  regime: Regime;
  riskScore: number;            // 0..100
  drawdownEstimate: {           // kuantil drawdown, mis. p99
    h4: number;
    h24: number;
  };
  recommendedTriggerHF: number; // sebelum di-clamp ke band user
  recommendedTargetHF: number;
  drivers: Signal[];            // sinyal paling berpengaruh
  explanation: string;          // ringkasan untuk user
  modelVersion: string;
  createdAt: Date;
  validUntil: Date;
}

/**
 * Snapshot posisi peminjaman on-chain (docs/prd.md §7.1).
 */
export interface Position {
  protocol: "aave-v3" | "morpho-blue";
  chainId: number;
  user: Address;
  healthFactor: bigint;          // 1e18
  liquidationThreshold: bigint;
  collateralValueUsd: bigint;
  debtValueUsd: bigint;
  oracleSource: Address;
  marketId?: Hex;                // Morpho Blue: isolated per market
}

/**
 * Panggilan kontrak tingkat rendah (docs/prd.md §7.1).
 */
export interface Call {
  to: Address;
  data: Hex;
  value?: bigint;
}

/**
 * Adapter protokol pinjaman (docs/prd.md §7.1).
 */
export interface ProtocolAdapter {
  readonly protocol: Position["protocol"];
  readonly chainId: number;
  readPosition(user: Address): Promise<Position[]>;
  buildRepay(intent: Intent): Promise<Call>;
  buildSupply(intent: Intent): Promise<Call>;
}

/**
 * Objek Intent yang dihasilkan rule engine deterministik (docs/prd.md §7.2).
 */
export interface Intent {
  action: "REPAY" | "SUPPLY_COLLATERAL" | "DELEVERAGE" | "NOOP";
  chainId: number;
  amount: bigint;
  asset: Address;
  source: "HOT_RESERVE" | "WARM_RESERVE" | "FLASH_LOAN";
  targetHealthFactor: bigint;
  effectiveTriggerHF: bigint;
  riskAssessmentId?: string;     // jejak ke alasan AI, jika ada
  reason: string;
  estimatedGas: bigint;
  estimatedSlippageBps: number;
}
