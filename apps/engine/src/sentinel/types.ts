import type { Address } from "@tahansoe/domain";
import type { RiskZone } from "@tahansoe/domain";

export interface PolicyRecord {
  id: string;
  userId: string;
  userAddress: Address;
  chainId: number;
  guardianAddress: Address;
  guardianVersion: number;
  debtAsset: Address;
  maxRepayPerAction: bigint;
  triggerThreshold: number;
  targetHealthFactor: number;
  isActive: boolean;
  minTriggerHf?: number | null;
  maxTriggerHf?: number | null;
  riskAgent?: Address | null;
  dynamicTriggerHf?: number | null;
  dynamicValidUntil?: Date | null;
}

export interface UserPositionSnapshot {
  user: Address;
  collateralBase: bigint;
  debtBase: bigint;
  liquidationThresholdBps: bigint;
  healthFactor: bigint;
  hfNumber: number;
  allowance: bigint;
  balance: bigint;
  zone: RiskZone;
  previousZone?: RiskZone;
  isReserveLow: boolean;
  quoteAmount: bigint;
  policy: PolicyRecord;
}

export interface KeeperExecutionResult {
  user: Address;
  guardianAddress: Address;
  status:
    | "executed"
    | "dry_run"
    | "skipped_in_flight"
    | "skipped_backoff"
    | "failed"
    | "no_action_needed";
  quoteAmount: bigint;
  txHash?: string;
  error?: string;
}

export interface SentinelTickResult {
  syncedLogs: number;
  checkedUsers: number;
  transitions: { user: Address; from: RiskZone; to: RiskZone }[];
  alertsSent: number;
  keeperActions: KeeperExecutionResult[];
}
