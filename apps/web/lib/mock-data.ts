// Shared mock data for all dashboard pages.
// Replace with live on-chain reads when protocol adapters are ready.

export type PositionStatus = "safe" | "warning" | "critical";

export interface Position {
  id: string;
  protocol: "Aave V3" | "Morpho Blue";
  chain: string;
  collateral: string;
  collateralUsd: number;
  debt: string;
  debtUsd: number;
  hf: number;
  status: PositionStatus;
  triggerAt: number;
  targetHf: number;
  oracleSource: string;
  lastChecked: string;
}

export const POSITIONS: Position[] = [
  {
    id: "aave-base-eth",
    protocol: "Aave V3",
    chain: "Base",
    collateral: "4.2 ETH",
    collateralUsd: 14_280,
    debt: "5,400 USDC",
    debtUsd: 5_400,
    hf: 1.82,
    status: "safe",
    triggerAt: 1.3,
    targetHf: 1.6,
    oracleSource: "Chainlink ETH/USD",
    lastChecked: "2s ago",
  },
  {
    id: "morpho-eth-usdc",
    protocol: "Morpho Blue",
    chain: "Ethereum",
    collateral: "2.8 ETH",
    collateralUsd: 9_520,
    debt: "6,200 USDC",
    debtUsd: 6_200,
    hf: 1.35,
    status: "warning",
    triggerAt: 1.3,
    targetHf: 1.6,
    oracleSource: "Chainlink ETH/USD",
    lastChecked: "2s ago",
  },
];

export type HistoryAction = "REPAY" | "SUPPLY_COLLATERAL" | "NOOP" | "FLASH_LOAN";

export interface HistoryEntry {
  id: string;
  timestamp: string;
  positionId: string;
  protocol: string;
  chain: string;
  action: HistoryAction;
  amount: string;
  asset: string;
  source: string;
  hfBefore: number;
  hfAfter: number;
  txHash: string;
  status: "success" | "failed" | "pending";
  gasUsed: string;
}

export const HISTORY: HistoryEntry[] = [
  {
    id: "h1",
    timestamp: "2026-08-19 14:32:11",
    positionId: "aave-base-eth",
    protocol: "Aave V3",
    chain: "Base",
    action: "REPAY",
    amount: "500",
    asset: "USDC",
    source: "Flash loan",
    hfBefore: 1.29,
    hfAfter: 1.62,
    txHash: "0xabc123…def456",
    status: "success",
    gasUsed: "0.000312 ETH",
  },
  {
    id: "h2",
    timestamp: "2026-08-18 09:17:44",
    positionId: "aave-base-eth",
    protocol: "Aave V3",
    chain: "Base",
    action: "REPAY",
    amount: "300",
    asset: "USDC",
    source: "Flash loan",
    hfBefore: 1.27,
    hfAfter: 1.58,
    txHash: "0xfed987…abc321",
    status: "success",
    gasUsed: "0.000298 ETH",
  },
  {
    id: "h3",
    timestamp: "2026-08-17 22:04:03",
    positionId: "morpho-eth-usdc",
    protocol: "Morpho Blue",
    chain: "Ethereum",
    action: "SUPPLY_COLLATERAL",
    amount: "0.5",
    asset: "ETH",
    source: "Hot reserve",
    hfBefore: 1.31,
    hfAfter: 1.55,
    txHash: "0x112233…aabbcc",
    status: "success",
    gasUsed: "0.000441 ETH",
  },
  {
    id: "h4",
    timestamp: "2026-08-16 11:52:37",
    positionId: "aave-base-eth",
    protocol: "Aave V3",
    chain: "Base",
    action: "NOOP",
    amount: "0",
    asset: "—",
    source: "—",
    hfBefore: 1.85,
    hfAfter: 1.85,
    txHash: "—",
    status: "pending",
    gasUsed: "—",
  },
];

// HF trend over the last 24h — one data point per hour
export const HF_TREND = [
  { t: "00:00", aave: 2.1, morpho: 1.8 },
  { t: "02:00", aave: 2.05, morpho: 1.76 },
  { t: "04:00", aave: 1.98, morpho: 1.71 },
  { t: "06:00", aave: 1.92, morpho: 1.65 },
  { t: "08:00", aave: 1.87, morpho: 1.58 },
  { t: "10:00", aave: 1.75, morpho: 1.48 },
  { t: "12:00", aave: 1.62, morpho: 1.35 },
  { t: "13:00", aave: 1.29, morpho: 1.31 }, // trigger zone
  { t: "13:01", aave: 1.62, morpho: 1.38 }, // repay executed
  { t: "14:00", aave: 1.71, morpho: 1.41 },
  { t: "16:00", aave: 1.78, morpho: 1.39 },
  { t: "18:00", aave: 1.82, morpho: 1.35 },
  { t: "20:00", aave: 1.84, morpho: 1.36 },
  { t: "22:00", aave: 1.82, morpho: 1.35 },
  { t: "Now",   aave: 1.82, morpho: 1.35 },
];

// Collateral vs Debt breakdown for donut
export const PORTFOLIO_BREAKDOWN = [
  { name: "ETH (Aave)", value: 14_280, color: "#e2e8f0" },
  { name: "ETH (Morpho)", value: 9_520, color: "#94a3b8" },
  { name: "USDC debt", value: 11_600, color: "#334155" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Simulation seed factory
// Returns deep-cloned copies so the simulation engine can mutate freely
// without affecting the static exports used in non-reactive contexts.
// ─────────────────────────────────────────────────────────────────────────────
export function createSimSeed() {
  return {
    positions: POSITIONS.map((p) => ({ ...p })),
    hfTrend:   HF_TREND.map((p)  => ({ ...p })),
    history:   HISTORY.map((h)   => ({ ...h })),
  };
}
