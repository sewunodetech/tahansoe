/**
 * Tipe & konfigurasi Broadcaster (spec m3-research-broadcast §3 T4).
 */

import type { Signal, RiskAssessment } from "@tahansoe/domain";
import type { TelegramSender, FetchedReportLike, Lang } from "../telegram/index.ts";
import type { AdvisoryLock } from "../worker/lock.ts";
import type { Recipient } from "./recipients.ts";

export const BROADCAST_WORKER_ADVISORY_LOCK_KEY = 42161006;
export const DEFAULT_BROADCAST_DIGEST_TIMES = "08:00,20:00";
export const DEFAULT_BROADCAST_TZ = "Asia/Jakarta";
export const DEFAULT_BROADCAST_LANG: Lang = "id";
export const DEFAULT_BROADCAST_POLL_SEC = 60;
export const HYSTERESIS_DOWN_HOLD_MS = 60 * 60 * 1000; // 1 jam
export const DEFAULT_DEDUPE_HOURS = 6; // 6 jam

export interface BroadcastWorkerLoaders {
  loadRecipients?: () => Promise<Recipient[]>;
  deactivateRecipient?: (telegramUserId: bigint | string) => Promise<void>;
  loadAssessments?: (chainId: number, now: Date) => Promise<RiskAssessment[]>;
  loadActiveSignals?: (chainId: number, now: Date) => Promise<Signal[]>;
  loadLatestReport?: () => Promise<FetchedReportLike | null>;
  recordBroadcast?: (params: {
    kind: string;
    dedupeKey: string;
    message: string;
    recipientsCount: number;
    sentCount: number;
    failedCount: number;
  }) => Promise<void>;
  isDeduped?: (dedupeKey: string, severity: number, now: Date) => Promise<boolean>;
}

export interface BroadcastWorkerOptions extends BroadcastWorkerLoaders {
  sender?: TelegramSender;
  db?: any;
  databaseUrl?: string;
  logger?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  pollIntervalSec?: number;
  advisoryLockKey?: number;
  openLock?: (databaseUrl: string, key: number, options?: any) => Promise<AdvisoryLock>;
}
