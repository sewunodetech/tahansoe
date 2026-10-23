/**
 * Sentinel Worker: Health Factor Sentinel & Keeper scheduler (~60 s loop).
 *
 * Menggunakan Postgres advisory lock key 42161005 (single instance guard).
 *
 * Alur per siklus (tick):
 *  1. Sync event Guardian (PolicySet, PolicyDisabled, Protected, Layer*, Band*)
 *  2. Ambil seluruh policy aktif di chain
 *  3. Multicall ke AavePool & ERC20: getUserAccountData, allowance, balance, quoteRepay
 *  4. Upsert `positions` & hitung zona risiko (Critical, Warning, Watch, Safe)
 *  5. Deteksi transisi zona -> kirim alert Telegram & catat ke `notification_logs`
 *  6. Deteksi cadangan rendah (RESERVE_LOW) -> kirim alert Telegram
 *  7. Evaluasi Keeper -> panggil `protect(user)` jika HF < trigger & quote > 0
 */

import { pathToFileURL } from "node:url";
import type { PublicClient } from "viem";
import type { Address } from "@tahansoe/domain";
import {
  ARBITRUM_SEPOLIA,
  getChainConfig,
  calculateZone,
  type RiskZone,
} from "@tahansoe/domain";
import {
  acquireAdvisoryLock,
  createNeonLockClient,
  releaseAdvisoryLock,
  unwrapError,
  type AdvisoryLockClient,
} from "../worker/lock.ts";
import { SENTINEL_WORKER_ADVISORY_LOCK_KEY } from "../worker/lock.ts";
import { aavePoolAbi, erc20Abi, guardianAbi } from "./abi.ts";
import { syncGuardianEvents } from "./event-sync.ts";
import { Keeper } from "./keeper.ts";
import { hfWarningAlert, hfCriticalAlert, reserveLowAlert } from "./views.ts";
import type { SentinelDatabase } from "./db-adapter.ts";
import type { TelegramSender } from "../telegram/index.ts";
import type { KeeperExecutionResult, SentinelTickResult, UserPositionSnapshot } from "./types.ts";

export const DEFAULT_SENTINEL_INTERVAL_SEC = 60;

export interface SentinelWorkerClock {
  now: () => Date;
  setTimeout: (fn: () => void, ms: number) => any;
  clearTimeout: (timerId: any) => void;
}

export interface SentinelWorkerLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface MulticallBatchResult {
  accountData: {
    collateralBase: bigint;
    debtBase: bigint;
    liquidationThresholdBps: bigint;
    healthFactor: bigint;
  };
  allowance: bigint;
  balance: bigint;
  quoteAmount: bigint;
}

export interface SentinelWorkerOptions {
  databaseUrl?: string;
  rpcUrl?: string;
  chainId?: number;
  intervalSec?: number;
  client?: PublicClient;
  db?: SentinelDatabase;
  lockClient?: AdvisoryLockClient | null;
  channelAdapter?: TelegramSender;
  keeper?: Keeper;
  clock?: SentinelWorkerClock;
  logger?: SentinelWorkerLogger;
  exitFn?: (code: number) => void;
  /** Injectable multicall loader for unit testing */
  multicallLoader?: (
    policies: Array<{ user: Address; guardianAddress: Address; debtAsset: Address }>,
  ) => Promise<MulticallBatchResult[]>;
}

export class SentinelWorker {
  private isRunning = false;
  private isExecuting = false;
  private timer: any = null;
  private lockClient: AdvisoryLockClient | null | undefined;

  private readonly chainId: number;
  private readonly intervalSec: number;
  private readonly client?: PublicClient;
  private readonly db: SentinelDatabase;
  private readonly channelAdapter?: TelegramSender;
  private readonly keeper: Keeper;
  private readonly clock: SentinelWorkerClock;
  private readonly logger: SentinelWorkerLogger;
  private readonly exitFn: (code: number) => void;
  private readonly multicallLoader?: (
    policies: Array<{ user: Address; guardianAddress: Address; debtAsset: Address }>,
  ) => Promise<MulticallBatchResult[]>;

  private readonly userZones = new Map<string, RiskZone>();
  private readonly userReserveLowAlerted = new Map<string, boolean>();

  constructor(options: SentinelWorkerOptions = {}) {
    this.chainId = options.chainId ?? ARBITRUM_SEPOLIA.chainId;
    this.intervalSec = options.intervalSec ?? DEFAULT_SENTINEL_INTERVAL_SEC;
    this.client = options.client;
    this.db = options.db as any;
    this.channelAdapter = options.channelAdapter;
    this.keeper = options.keeper ?? new Keeper();
    this.lockClient = options.lockClient;
    this.multicallLoader = options.multicallLoader;

    this.clock = options.clock ?? {
      now: () => new Date(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (t) => clearTimeout(t),
    };

    this.logger = options.logger ?? {
      info: (m) => console.log(`[sentinel] ${m}`),
      warn: (m) => console.warn(`[sentinel] ${m}`),
      error: (m) => console.error(`[sentinel] ${m}`),
    };

    this.exitFn = options.exitFn ?? ((code) => process.exit(code));
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Single-instance advisory lock enforcement
    if (this.lockClient === undefined) {
      const dbUrl = process.env.DATABASE_URL;
      if (dbUrl) {
        try {
          this.lockClient = await createNeonLockClient(dbUrl, {
            logger: this.logger,
          });
        } catch (err) {
          this.logger.error(`Gagal menghubungkan lock client: ${unwrapError(err)}`);
          this.exitFn(1);
          return;
        }
      }
    }

    if (this.lockClient) {
      const locked = await acquireAdvisoryLock(
        this.lockClient,
        SENTINEL_WORKER_ADVISORY_LOCK_KEY,
      );
      if (!locked) {
        this.logger.warn("Instance SentinelWorker lain sudah berjalan (advisory lock aktif). Keluar.");
        this.exitFn(0);
        return;
      }
    }

    this.logger.info(`SentinelWorker dimulai (interval ${this.intervalSec}s, chainId ${this.chainId}).`);

    // Jalankan siklus pertama segera
    void this.tick();

    // Jadwalkan siklus berulang
    this.scheduleNext();
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.lockClient) {
      try {
        await releaseAdvisoryLock(
          this.lockClient,
          SENTINEL_WORKER_ADVISORY_LOCK_KEY,
        );
      } catch {
        // abaikan error release saat shutdown
      }
    }

    this.logger.info("SentinelWorker dihentikan.");
  }

  private scheduleNext(): void {
    if (!this.isRunning) return;
    this.timer = this.clock.setTimeout(() => {
      void (async () => {
        await this.tick();
        this.scheduleNext();
      })();
    }, this.intervalSec * 1000);
  }

  /**
   * Eksekusi satu siklus sentinel (dapat dipanggil manual/one-shot untuk test & CLI).
   */
  public async tick(): Promise<SentinelTickResult> {
    if (this.isExecuting) {
      this.logger.warn("Tick sebelumnya masih berjalan, lewati siklus ini.");
      return {
        syncedLogs: 0,
        checkedUsers: 0,
        transitions: [],
        alertsSent: 0,
        keeperActions: [],
      };
    }

    this.isExecuting = true;
    const now = this.clock.now();
    let syncedLogs = 0;
    const transitions: { user: Address; from: RiskZone; to: RiskZone }[] = [];
    let alertsSent = 0;
    const keeperActions: KeeperExecutionResult[] = [];

    try {
      // 1. Sync Event Guardian
      if (this.client && this.db) {
        try {
          const syncRes = await syncGuardianEvents({
            client: this.client,
            db: this.db,
            chainId: this.chainId,
            channelAdapter: this.channelAdapter,
            logger: this.logger,
          });
          syncedLogs = syncRes.logsProcessed;
        } catch (err) {
          this.logger.warn(`Event sync mengalami kendala: ${err}`);
        }
      }

      // 2. Baca seluruh policy aktif di DB
      if (!this.db) {
        return {
          syncedLogs,
          checkedUsers: 0,
          transitions: [],
          alertsSent: 0,
          keeperActions: [],
        };
      }

      const activePolicies = await this.db.loadActivePolicies(this.chainId);
      if (activePolicies.length === 0) {
        return {
          syncedLogs,
          checkedUsers: 0,
          transitions: [],
          alertsSent: 0,
          keeperActions: [],
        };
      }

      // 3. Batch Multicall data on-chain
      const chain = getChainConfig(this.chainId) ?? ARBITRUM_SEPOLIA;
      const poolAddress = (chain.aave?.pool ?? "0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff") as Address;
      const oracleAddress = (chain.aave?.oracle ?? "0xEf95A6B9e88Bd509Fd67BA741cf2b263DaC65c00") as Address;

      let batchResults: MulticallBatchResult[];

      if (this.multicallLoader) {
        batchResults = await this.multicallLoader(
          activePolicies.map((p) => ({
            user: p.userAddress,
            guardianAddress: p.guardianAddress,
            debtAsset: p.debtAsset,
          })),
        );
      } else if (this.client) {
        batchResults = await this.executeViemMulticall(activePolicies, poolAddress);
      } else {
        return {
          syncedLogs,
          checkedUsers: activePolicies.length,
          transitions: [],
          alertsSent: 0,
          keeperActions: [],
        };
      }

      // 4. Proses setiap posisi pengguna
      for (let i = 0; i < activePolicies.length; i++) {
        const policy = activePolicies[i]!;
        const data = batchResults[i];
        if (!data) continue;

        const userKey = policy.userAddress.toLowerCase() as Address;

        // Hitung HF float aman
        let hfNumber: number;
        if (data.accountData.debtBase === 0n) {
          hfNumber = 999.0;
        } else {
          // data.accountData.healthFactor adalah 1e18 WAD
          hfNumber = Number(data.accountData.healthFactor) / 1e18;
          if (!Number.isFinite(hfNumber)) hfNumber = 999.0;
        }

        // Hitung trigger efektif
        let effectiveTrigger = policy.triggerThreshold;
        if (
          policy.dynamicTriggerHf != null &&
          policy.dynamicValidUntil != null &&
          policy.dynamicValidUntil.getTime() > now.getTime()
        ) {
          effectiveTrigger = policy.dynamicTriggerHf;
        }

        // Hitung zona risiko
        const currentZone = calculateZone(hfNumber, effectiveTrigger);
        const previousZone = this.userZones.get(userKey);

        // Upsert posisi ke database
        const positionId = await this.db.upsertPosition({
          userId: policy.userId,
          protocol: "aave-v3",
          chainId: this.chainId,
          healthFactor: hfNumber.toFixed(4),
          liquidationThreshold: (Number(data.accountData.liquidationThresholdBps) / 10000).toFixed(4),
          collateralValueUsd: (Number(data.accountData.collateralBase) / 1e8).toFixed(2),
          debtValueUsd: (Number(data.accountData.debtBase) / 1e8).toFixed(2),
          oracleSource: oracleAddress,
          now,
        });

        await this.db.linkPolicyPosition(policy.id, positionId);

        // 5. Cek Transisi Zona Risiko & Kirim Notifikasi
        if (previousZone !== undefined && previousZone !== currentZone) {
          transitions.push({
            user: userKey,
            from: previousZone,
            to: currentZone,
          });

          if (currentZone === "Warning") {
            const alertMsg = hfWarningAlert({
              user: userKey,
              hf: hfNumber,
              triggerHf: effectiveTrigger,
            });

            await this.recordAndDispatchAlert(policy.userId, "HF_WARNING", alertMsg);
            alertsSent++;
          } else if (currentZone === "Critical") {
            const alertMsg = hfCriticalAlert({
              user: userKey,
              hf: hfNumber,
              triggerHf: effectiveTrigger,
            });

            await this.recordAndDispatchAlert(policy.userId, "HF_CRITICAL", alertMsg);
            alertsSent++;
          }
        }
        this.userZones.set(userKey, currentZone);

        // 6. Cek Cadangan (RESERVE_LOW)
        const minReserve = data.allowance < data.balance ? data.allowance : data.balance;
        const isReserveLow =
          policy.maxRepayPerAction > 0n && minReserve < policy.maxRepayPerAction;
        const wasReserveLowAlerted = this.userReserveLowAlerted.get(userKey) ?? false;

        if (isReserveLow && !wasReserveLowAlerted) {
          const alertMsg = reserveLowAlert({
            user: userKey,
            allowance: data.allowance,
            balance: data.balance,
            cap: policy.maxRepayPerAction,
          });

          await this.recordAndDispatchAlert(policy.userId, "RESERVE_LOW", alertMsg);
          this.userReserveLowAlerted.set(userKey, true);
          alertsSent++;
        } else if (!isReserveLow) {
          this.userReserveLowAlerted.set(userKey, false);
        }

        // 7. Evaluasi Keeper Proteksi
        if (hfNumber < effectiveTrigger && data.quoteAmount > 0n) {
          const keeperResult = await this.keeper.evaluateAndProtect({
            user: userKey,
            guardianAddress: policy.guardianAddress,
            hf: hfNumber,
            triggerHf: effectiveTrigger,
            quoteAmount: data.quoteAmount,
          });
          keeperActions.push(keeperResult);
        }
      }

      return {
        syncedLogs,
        checkedUsers: activePolicies.length,
        transitions,
        alertsSent,
        keeperActions,
      };
    } finally {
      this.isExecuting = false;
    }
  }

  private async executeViemMulticall(
    activePolicies: Array<{ userAddress: Address; guardianAddress: Address; debtAsset: Address }>,
    poolAddress: Address,
  ): Promise<MulticallBatchResult[]> {
    if (!this.client) return [];

    const calls: any[] = [];
    for (const p of activePolicies) {
      calls.push({
        address: poolAddress,
        abi: aavePoolAbi,
        functionName: "getUserAccountData",
        args: [p.userAddress],
      });
      calls.push({
        address: p.debtAsset,
        abi: erc20Abi,
        functionName: "allowance",
        args: [p.userAddress, p.guardianAddress],
      });
      calls.push({
        address: p.debtAsset,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [p.userAddress],
      });
      calls.push({
        address: p.guardianAddress,
        abi: guardianAbi,
        functionName: "quoteRepay",
        args: [p.userAddress],
      });
    }

    const multicallResults = await this.client.multicall({
      contracts: calls,
      allowFailure: true,
    });

    const results: MulticallBatchResult[] = [];
    for (let i = 0; i < activePolicies.length; i++) {
      const idx = i * 4;
      const accountRes = multicallResults[idx];
      const allowanceRes = multicallResults[idx + 1];
      const balanceRes = multicallResults[idx + 2];
      const quoteRes = multicallResults[idx + 3];

      const acct = (accountRes?.status === "success" ? accountRes.result : null) as any;
      const allowance = allowanceRes?.status === "success" ? BigInt(allowanceRes.result as any) : 0n;
      const balance = balanceRes?.status === "success" ? BigInt(balanceRes.result as any) : 0n;
      const quoteAmount = quoteRes?.status === "success" ? BigInt(quoteRes.result as any) : 0n;

      results.push({
        accountData: {
          collateralBase: acct ? BigInt(acct[0]) : 0n,
          debtBase: acct ? BigInt(acct[1]) : 0n,
          liquidationThresholdBps: acct ? BigInt(acct[3]) : 0n,
          healthFactor: acct ? BigInt(acct[5]) : 0n,
        },
        allowance,
        balance,
        quoteAmount,
      });
    }

    return results;
  }

  private async recordAndDispatchAlert(
    userId: string,
    type: "HF_WARNING" | "HF_CRITICAL" | "RESERVE_LOW",
    message: string,
  ): Promise<void> {
    let delivered = false;

    if (this.channelAdapter && this.db.getLinkedTelegramAccounts) {
      try {
        const chatIds = await this.db.getLinkedTelegramAccounts(userId);
        for (const chatId of chatIds) {
          try {
            await this.channelAdapter.send(chatId, message, { parseMode: "HTML" });
            delivered = true;
          } catch (err) {
            this.logger.warn(`Gagal kirim notifikasi ${type} ke chat ${chatId}: ${err}`);
          }
        }
      } catch (err) {
        this.logger.warn(`Gagal memuat akun telegram linked untuk user ${userId}: ${err}`);
      }
    }

    if (this.db.recordNotificationLog) {
      await this.db.recordNotificationLog({
        userId,
        type,
        message,
        deliveredOk: delivered,
      });
    }
  }
}
