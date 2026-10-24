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
 *  7. Evaluasi Keeper -> panggil `protect(...)` jika HF < trigger & quote > 0
 *  8. Evaluasi adapter on-chain (jika adapters dikonfigurasi)
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
import type { GuardianAdapter } from "./adapters.ts";
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
  adapters?: GuardianAdapter[];
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
  private readonly adapters?: GuardianAdapter[];
  private readonly multicallLoader?: (
    policies: Array<{ user: Address; guardianAddress: Address; debtAsset: Address }>,
  ) => Promise<MulticallBatchResult[]>;

  // Keyed by positionKey (or fallback to guardian:debtAsset:user)
  private readonly positionZones = new Map<string, RiskZone>();
  private readonly positionReserveLowAlerted = new Map<string, boolean>();

  constructor(options: SentinelWorkerOptions = {}) {
    this.chainId = options.chainId ?? ARBITRUM_SEPOLIA.chainId;
    this.intervalSec = options.intervalSec ?? DEFAULT_SENTINEL_INTERVAL_SEC;
    this.client = options.client;
    this.db = options.db as any;
    this.channelAdapter = options.channelAdapter;
    this.keeper = options.keeper ?? new Keeper();
    this.lockClient = options.lockClient;
    this.multicallLoader = options.multicallLoader;
    this.adapters = options.adapters;

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
    const transitions: { user: Address; from: RiskZone; to: RiskZone; positionKey?: string }[] = [];
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

      // Jalankan adapter on-chain jika dikonfigurasi
      if (this.adapters && this.adapters.length > 0) {
        try {
          const adapterResults = await this.keeper.runTick(this.adapters);
          keeperActions.push(...adapterResults);
        } catch (err) {
          this.logger.error(`[sentinel] error pada on-chain adapters: ${err}`);
        }
      }

      if (activePolicies.length === 0) {
        return {
          syncedLogs,
          checkedUsers: 0,
          transitions: [],
          alertsSent,
          keeperActions,
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
          alertsSent,
          keeperActions,
        };
      }

      // 4. Proses setiap posisi pengguna
      for (let i = 0; i < activePolicies.length; i++) {
        const policy = activePolicies[i]!;
        const data = batchResults[i];
        if (!data) continue;

        const userKey = policy.userAddress.toLowerCase() as Address;
        const dedupeKey = policy.positionKey ?? `${policy.guardianAddress.toLowerCase()}:${policy.debtAsset.toLowerCase()}:${userKey}`;

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
        const previousZone = this.positionZones.get(dedupeKey);

        // Upsert posisi ke database
        const positionId = await this.db.upsertPosition({
          userId: policy.userId,
          protocol: policy.protocol ?? "aave-v3",
          chainId: this.chainId,
          healthFactor: hfNumber.toFixed(4),
          liquidationThreshold: (Number(data.accountData.liquidationThresholdBps) / 10000).toFixed(4),
          collateralValueUsd: (Number(data.accountData.collateralBase) / 1e8).toFixed(2),
          debtValueUsd: (Number(data.accountData.debtBase) / 1e8).toFixed(2),
          oracleSource: oracleAddress,
          now,
          marketId: policy.marketId ?? undefined,
        });

        await this.db.linkPolicyPosition(policy.id, positionId);

        // 5. Cek Transisi Zona Risiko & Kirim Notifikasi (dedupe per position)
        if (previousZone !== undefined && previousZone !== currentZone) {
          transitions.push({
            user: userKey,
            from: previousZone,
            to: currentZone,
            positionKey: policy.positionKey ?? undefined,
          });

          if (currentZone === "Warning") {
            const alertMsg = hfWarningAlert({
              user: userKey,
              hf: hfNumber,
              triggerHf: effectiveTrigger,
              protocol: policy.protocol ?? "aave-v3",
              debtAsset: policy.debtAsset,
              marketId: policy.marketId ?? undefined,
              positionKey: policy.positionKey ?? undefined,
            });

            await this.recordAndDispatchAlert(policy.userId, "HF_WARNING", alertMsg);
            alertsSent++;
          } else if (currentZone === "Critical") {
            const alertMsg = hfCriticalAlert({
              user: userKey,
              hf: hfNumber,
              triggerHf: effectiveTrigger,
              protocol: policy.protocol ?? "aave-v3",
              debtAsset: policy.debtAsset,
              marketId: policy.marketId ?? undefined,
              positionKey: policy.positionKey ?? undefined,
            });

            await this.recordAndDispatchAlert(policy.userId, "HF_CRITICAL", alertMsg);
            alertsSent++;
          }
        }
        this.positionZones.set(dedupeKey, currentZone);

        // 6. Cek Cadangan (RESERVE_LOW, dedupe per position)
        const minReserve = data.allowance < data.balance ? data.allowance : data.balance;
        const isReserveLow =
          policy.maxRepayPerAction > 0n && minReserve < policy.maxRepayPerAction;
        const wasReserveLowAlerted = this.positionReserveLowAlerted.get(dedupeKey) ?? false;

        if (isReserveLow && !wasReserveLowAlerted) {
          const alertMsg = reserveLowAlert({
            user: userKey,
            allowance: data.allowance,
            balance: data.balance,
            cap: policy.maxRepayPerAction,
            protocol: policy.protocol ?? "aave-v3",
            positionKey: policy.positionKey ?? undefined,
          });

          await this.recordAndDispatchAlert(policy.userId, "RESERVE_LOW", alertMsg);
          this.positionReserveLowAlerted.set(dedupeKey, true);
          alertsSent++;
        } else if (!isReserveLow) {
          this.positionReserveLowAlerted.set(dedupeKey, false);
        }

        // 7. Evaluasi Keeper Proteksi
        if (hfNumber < effectiveTrigger && data.quoteAmount > 0n) {
          const keeperResult = await this.keeper.evaluateAndProtect({
            user: userKey,
            guardianAddress: policy.guardianAddress,
            positionKey: policy.positionKey ?? undefined,
            protocol: policy.protocol ?? "aave-v3",
            key: policy.marketId ?? policy.debtAsset,
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

    const parsed: MulticallBatchResult[] = [];
    for (let i = 0; i < activePolicies.length; i++) {
      const baseIdx = i * 4;
      const accountDataRes = multicallResults[baseIdx];
      const allowanceRes = multicallResults[baseIdx + 1];
      const balanceRes = multicallResults[baseIdx + 2];
      const quoteRes = multicallResults[baseIdx + 3];

      let collateralBase = 0n;
      let debtBase = 0n;
      let liquidationThresholdBps = 0n;
      let healthFactor = 999n * 10n ** 18n;

      if (accountDataRes && accountDataRes.status === "success" && Array.isArray(accountDataRes.result)) {
        collateralBase = accountDataRes.result[0] as bigint;
        debtBase = accountDataRes.result[1] as bigint;
        liquidationThresholdBps = accountDataRes.result[3] as bigint;
        healthFactor = accountDataRes.result[5] as bigint;
      }

      const allowance = allowanceRes && allowanceRes.status === "success"
        ? (allowanceRes.result as bigint)
        : 0n;

      const balance = balanceRes && balanceRes.status === "success"
        ? (balanceRes.result as bigint)
        : 0n;

      const quoteAmount = quoteRes && quoteRes.status === "success"
        ? (quoteRes.result as bigint)
        : 0n;

      parsed.push({
        accountData: {
          collateralBase,
          debtBase,
          liquidationThresholdBps,
          healthFactor,
        },
        allowance,
        balance,
        quoteAmount,
      });
    }

    return parsed;
  }

  private async recordAndDispatchAlert(
    userId: string,
    type: "HF_WARNING" | "HF_CRITICAL" | "RESERVE_LOW",
    alertMsg: string,
  ): Promise<void> {
    if (this.db.recordNotificationLog) {
      try {
        await this.db.recordNotificationLog({
          userId,
          type,
          message: alertMsg,
          deliveredOk: false,
        });
      } catch (err) {
        this.logger.warn(`Gagal mencatat notification_log: ${err}`);
      }
    }

    if (this.channelAdapter && this.db.getLinkedTelegramAccounts) {
      try {
        const chatIds = await this.db.getLinkedTelegramAccounts(userId);
        for (const chatId of chatIds) {
          try {
            await this.channelAdapter.send(chatId, alertMsg, { parseMode: "HTML" });
          } catch (err) {
            this.logger.warn(`Gagal kirim alert ke telegram chat ${chatId}: ${err}`);
          }
        }
      } catch (err) {
        this.logger.warn(`Gagal mengambil linked telegram accounts: ${err}`);
      }
    }
  }
}
