/**
 * Dynamic Trigger Engine Writer (ADR 0002).
 *
 * Menggeser trigger on-chain (setDynamicTrigger) di dalam trigger band yang telah
 * disetujui user (setTriggerBand), berdasarkan rekomendasi RiskAssessment (Risk Fusion).
 *
 * Invarian:
 *  - Non-custodial: setDynamicTrigger hanya menggeser trigger, tidak pernah memindahkan dana.
 *  - AI advises, rules decide, contract enforces: trigger dibatasi pada [minTriggerHF, maxTriggerHF]
 *    dan strictly below policy.targetHF.
 *  - Graceful degradation (I6): jika assessment basi atau hilang, trigger dinamis tidak diubah / dibiarkan expired.
 *  - Hysteresis: hanya menulis jika selisih >= 0.02 atau masa berlaku sisa <= 30 menit.
 *  - Simulasi (eth_call) sebelum broadcast tx on-chain.
 *  - Safe fallback: error tidak pernah melempar keluar dari tick (try/catch I6).
 */

import {
  type Address,
  getChainConfig,
  hfToWad,
  wadToNumber,
} from "@tahansoe/domain";
import type { PublicClient, WalletClient } from "viem";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { guardianAaveV4Abi, guardianMorphoAbi } from "./abi.ts";
import type { SentinelDatabase } from "./db-adapter.ts";
import type { TelegramSender } from "../telegram/index.ts";
import type { PolicyRecord, DynamicTriggerDecision } from "./types.ts";
import { dynamicTriggerAlert } from "./views.ts";
import { env } from "../config.ts";
import { loadSettingsSync } from "../settings/settings.ts";

export type DynamicTriggerMode = "off" | "dry-run" | "live";

export interface OnChainTriggerBand {
  minTriggerHf: number;
  maxTriggerHf: number;
  riskAgent: Address;
  dynamicTriggerHf?: number | null;
  validUntil?: number | null; // epoch timestamp in seconds
}

export interface DynamicTriggerServiceLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface DynamicTriggerServiceOptions {
  client?: PublicClient;
  walletClient?: WalletClient;
  riskAgentPrivateKey?: string;
  riskAgentAddress?: Address;
  db?: SentinelDatabase;
  chainId: number;
  mode?: DynamicTriggerMode;
  logger?: DynamicTriggerServiceLogger;
  now?: () => Date;
  channelAdapter?: TelegramSender;
}

/**
 * Clamp recommendedTrigger ke [minTrigger, maxTrigger] dan strictly below targetHF.
 * Return null jika band atau target tidak memungkinkan trigger yang sah.
 */
export function clampTrigger(
  recommendedTrigger: number,
  minTrigger: number,
  maxTrigger: number,
  targetHf: number,
): number | null {
  if (minTrigger <= 0 || maxTrigger <= 0 || minTrigger > maxTrigger) {
    return null;
  }
  // Target HF harus strictly lebih besar dari trigger
  if (targetHf <= minTrigger) {
    return null;
  }

  // 1. Clamp ke [minTrigger, maxTrigger]
  let clamped = Math.max(minTrigger, Math.min(maxTrigger, recommendedTrigger));

  // 2. Strictly below targetHF (buffer 0.01 untuk float precision)
  if (clamped >= targetHf) {
    clamped = Number((targetHf - 0.01).toFixed(4));
  }

  if (clamped < minTrigger) {
    return null;
  }

  return Number(clamped.toFixed(4));
}

/**
 * Cek aturan hysteresis:
 * Tulis hanya jika |target - current| >= 0.02 atau dynamic trigger yang aktif akan expired dalam 30 menit.
 */
export function shouldUpdateDynamicTrigger(params: {
  targetTriggerHf: number;
  currentTriggerHf?: number | null;
  currentValidUntil?: number | null; // epoch seconds
  now: Date;
}): { shouldUpdate: boolean; reason: string } {
  const { targetTriggerHf, currentTriggerHf, currentValidUntil, now } = params;
  const nowSec = Math.floor(now.getTime() / 1000);

  // Jika belum ada trigger dinamis aktif atau sudah expired
  if (
    currentTriggerHf == null ||
    currentTriggerHf <= 0 ||
    currentValidUntil == null ||
    currentValidUntil <= nowSec
  ) {
    return { shouldUpdate: true, reason: "no_active_dynamic_trigger" };
  }

  // Cek delta ambang batas (>= 0.02)
  const delta = Math.abs(targetTriggerHf - currentTriggerHf);
  if (delta >= 0.02) {
    return { shouldUpdate: true, reason: `delta_exceeded_${delta.toFixed(4)}` };
  }

  // Cek masa berlaku sisa <= 30 menit (1800 detik)
  const remainingSec = currentValidUntil - nowSec;
  if (remainingSec <= 30 * 60) {
    return { shouldUpdate: true, reason: `expiring_in_${remainingSec}s` };
  }

  return { shouldUpdate: false, reason: "hysteresis_holds" };
}

/**
 * Menghitung validUntil untuk on-chain tx: now + 2 jam (atau validUntil assessment jika lebih awal).
 * Mengembalikan epoch timestamp dalam detik.
 */
export function computeValidUntil(assessmentValidUntil: Date, now: Date): number {
  const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const effective =
    assessmentValidUntil.getTime() < twoHoursLater.getTime()
      ? assessmentValidUntil
      : twoHoursLater;
  return Math.floor(effective.getTime() / 1000);
}

export class DynamicTriggerService {
  private readonly client?: PublicClient;
  private readonly walletClient?: WalletClient;
  private readonly db?: SentinelDatabase;
  private readonly chainId: number;
  private readonly mode: DynamicTriggerMode;
  private readonly logger: DynamicTriggerServiceLogger;
  private readonly nowFn: () => Date;
  private readonly channelAdapter?: TelegramSender;

  private readonly riskAgentAddress?: Address;
  private readonly account?: ReturnType<typeof privateKeyToAccount>;

  constructor(options: DynamicTriggerServiceOptions) {
    this.client = options.client;
    this.db = options.db;
    this.chainId = options.chainId;
    this.logger = options.logger ?? {
      info: (m) => console.log(m),
      warn: (m) => console.warn(m),
      error: (m) => console.error(m),
    };
    this.nowFn = options.now ?? (() => new Date());
    this.channelAdapter = options.channelAdapter;

    // Load mode
    if (options.mode) {
      this.mode = options.mode;
    } else {
      const s = loadSettingsSync();
      this.mode = s.settings.dynamicTrigger?.mode ?? "dry-run";
    }

    // Signer / risk agent address
    const pk = options.riskAgentPrivateKey ?? env.riskAgentPrivateKey();
    if (pk && pk.startsWith("0x") && pk.length === 66) {
      try {
        this.account = privateKeyToAccount(pk as `0x${string}`);
        this.riskAgentAddress = this.account.address.toLowerCase() as Address;
      } catch (err) {
        this.logger.warn(`[dynamic-trigger] Gagal membaca private key signer: ${err}`);
      }
    } else if (options.riskAgentAddress) {
      this.riskAgentAddress = options.riskAgentAddress.toLowerCase() as Address;
    }

    // Wallet client
    if (options.walletClient) {
      this.walletClient = options.walletClient;
    } else if (this.account && this.client) {
      const rpcUrl = env.arbitrumSepoliaRpcUrl() || "https://sepolia-rollup.arbitrum.io/rpc";
      this.walletClient = createWalletClient({
        account: this.account,
        transport: http(rpcUrl),
      });
    }
  }

  public getMode(): DynamicTriggerMode {
    return this.mode;
  }

  public getRiskAgentAddress(): Address | undefined {
    return this.riskAgentAddress;
  }

  /**
   * Membaca trigger band on-chain (via triggerBandOf jika tersedia, atau fallback ke policy).
   */
  public async readTriggerBand(policy: PolicyRecord): Promise<OnChainTriggerBand | null> {
    const isMorpho = policy.protocol === "morpho-blue" || Boolean(policy.marketId);

    if (this.client) {
      try {
        if (isMorpho && policy.marketId) {
          const res = (await this.client.readContract({
            address: policy.guardianAddress,
            abi: guardianMorphoAbi,
            functionName: "triggerBandOf",
            args: [policy.userAddress, policy.marketId as `0x${string}`],
          })) as [bigint, bigint, Address, bigint, bigint | number];

          return {
            minTriggerHf: wadToNumber(res[0]),
            maxTriggerHf: wadToNumber(res[1]),
            riskAgent: (res[2] as string).toLowerCase() as Address,
            dynamicTriggerHf: res[3] > 0n ? wadToNumber(res[3]) : null,
            validUntil: Number(res[4]),
          };
        } else {
          const res = (await this.client.readContract({
            address: policy.guardianAddress,
            abi: guardianAaveV4Abi,
            functionName: "triggerBandOf",
            args: [policy.userAddress, policy.debtAsset],
          })) as [bigint, bigint, Address, bigint, bigint | number];

          return {
            minTriggerHf: wadToNumber(res[0]),
            maxTriggerHf: wadToNumber(res[1]),
            riskAgent: (res[2] as string).toLowerCase() as Address,
            dynamicTriggerHf: res[3] > 0n ? wadToNumber(res[3]) : null,
            validUntil: Number(res[4]),
          };
        }
      } catch {
        // triggerBandOf view mungkin tidak di-expose di bytecode kontrak, fallback ke database/policy
      }
    }

    if (
      policy.riskAgent &&
      policy.minTriggerHf != null &&
      policy.maxTriggerHf != null
    ) {
      return {
        minTriggerHf: policy.minTriggerHf,
        maxTriggerHf: policy.maxTriggerHf,
        riskAgent: policy.riskAgent.toLowerCase() as Address,
        dynamicTriggerHf: policy.dynamicTriggerHf ?? null,
        validUntil: policy.dynamicValidUntil
          ? Math.floor(policy.dynamicValidUntil.getTime() / 1000)
          : null,
      };
    }

    return null;
  }

  /**
   * Evaluasi satu policy pengguna. Tidak pernah melempar error (I6).
   */
  public async evaluatePolicy(policy: PolicyRecord): Promise<DynamicTriggerDecision> {
    const now = this.nowFn();
    const isMorpho = policy.protocol === "morpho-blue" || Boolean(policy.marketId);

    const baseDecision: DynamicTriggerDecision = {
      user: policy.userAddress,
      guardianAddress: policy.guardianAddress,
      guardianVersion: policy.guardianVersion,
      debtAsset: policy.debtAsset,
      marketId: policy.marketId ?? null,
      positionKey: policy.positionKey ?? undefined,
      protocol: policy.protocol ?? "aave-v3",
      status: "skipped",
      reason: "none",
    };

    // 1. Hanya berlaku untuk Guardian v4 (per-position policy)
    if (policy.guardianVersion < 4) {
      return { ...baseDecision, reason: "skipped_not_v4" };
    }

    // 2. Cek flag mode
    if (this.mode === "off") {
      return { ...baseDecision, reason: "skipped_mode_off" };
    }

    try {
      // 3. Verifikasi Risk Agent dengan ChainConfig
      const chainConfig = getChainConfig(this.chainId);
      const chainRiskAgent = chainConfig?.riskAgent?.toLowerCase() as Address | undefined;
      if (!chainRiskAgent) {
        return { ...baseDecision, reason: "skipped_no_chain_risk_agent" };
      }

      const activeRiskAgent = (this.riskAgentAddress ?? chainRiskAgent).toLowerCase() as Address;
      if (activeRiskAgent !== chainRiskAgent) {
        return {
          ...baseDecision,
          reason: `skipped_risk_agent_mismatch_chain_config (signer=${activeRiskAgent}, chain=${chainRiskAgent})`,
        };
      }

      // 4. Baca Trigger Band on-chain
      const band = await this.readTriggerBand(policy);
      if (!band) {
        return { ...baseDecision, reason: "skipped_no_trigger_band" };
      }

      baseDecision.currentDynamicTrigger = band.dynamicTriggerHf ?? null;

      // Act only if band.riskAgent == activeRiskAgent == ChainConfig.riskAgent
      if (band.riskAgent.toLowerCase() !== activeRiskAgent) {
        return {
          ...baseDecision,
          reason: `skipped_unauthorized_risk_agent (band=${band.riskAgent}, expected=${activeRiskAgent})`,
        };
      }

      // 5. Ambil Risk Assessment terbaru yang non-stale untuk collateral asset
      let collateralAssetSymbol = "ETH";
      const layer3Asset = (policy as any).layer3CollateralAsset as string | undefined;
      if (layer3Asset && chainConfig?.tokens) {
        for (const [sym, addr] of Object.entries(chainConfig.tokens)) {
          if (addr.toLowerCase() === layer3Asset.toLowerCase()) {
            collateralAssetSymbol = sym === "WETH" ? "ETH" : sym;
            break;
          }
        }
      }

      let assessment = this.db?.getLatestRiskAssessment
        ? await this.db.getLatestRiskAssessment(this.chainId, collateralAssetSymbol)
        : null;

      if (!assessment && collateralAssetSymbol !== "ETH" && this.db?.getLatestRiskAssessment) {
        assessment = await this.db.getLatestRiskAssessment(this.chainId, "ETH");
      }

      if (!assessment) {
        return { ...baseDecision, reason: "skipped_missing_risk_assessment" };
      }

      const assessmentExpiry = new Date(assessment.validUntil).getTime();
      if (assessmentExpiry <= now.getTime()) {
        return { ...baseDecision, reason: "skipped_stale_risk_assessment" };
      }

      baseDecision.regime = assessment.regime;
      baseDecision.explanation = assessment.explanation;

      // 6. Hitung Target Trigger: recommendedTriggerHF clamped ke [band.min, band.max] dan < targetHF
      const rawRecommended = assessment.recommendedTriggerHf ?? policy.triggerThreshold;
      const targetTrigger = clampTrigger(
        rawRecommended,
        band.minTriggerHf,
        band.maxTriggerHf,
        policy.targetHealthFactor,
      );

      if (targetTrigger == null) {
        return { ...baseDecision, reason: "skipped_cannot_clamp_to_target" };
      }

      baseDecision.targetTriggerHf = targetTrigger;

      // 7. Evaluasi Hysteresis
      const hysteresis = shouldUpdateDynamicTrigger({
        targetTriggerHf: targetTrigger,
        currentTriggerHf: band.dynamicTriggerHf,
        currentValidUntil: band.validUntil,
        now,
      });

      if (!hysteresis.shouldUpdate) {
        return { ...baseDecision, reason: hysteresis.reason };
      }

      // 8. Hitung validUntil
      const validUntilSec = computeValidUntil(new Date(assessment.validUntil), now);
      baseDecision.validUntilSec = validUntilSec;

      if (validUntilSec <= Math.floor(now.getTime() / 1000)) {
        return { ...baseDecision, reason: "skipped_valid_until_in_past" };
      }

      // 9. Cek Eksekusi: Dry-run vs Live
      const canExecuteLive =
        this.mode === "live" &&
        Boolean(this.walletClient && this.account);

      if (!canExecuteLive) {
        this.logger.info(
          `[dynamic-trigger] [dry-run] Would set trigger for ${policy.userAddress} (${policy.debtAsset}): ` +
            `${band.dynamicTriggerHf?.toFixed(2) ?? "static"} -> ${targetTrigger.toFixed(2)} ` +
            `(validUntil: ${new Date(validUntilSec * 1000).toISOString()}) reason=${hysteresis.reason}`,
        );
        return {
          ...baseDecision,
          status: "dry_run",
          reason: hysteresis.reason,
        };
      }

      // 10. Live Write: Simulasi (eth_call) sebelum broadcast
      const triggerWad = hfToWad(targetTrigger);

      if (this.client) {
        try {
          if (isMorpho && policy.marketId) {
            await this.client.simulateContract({
              address: policy.guardianAddress,
              abi: guardianMorphoAbi,
              functionName: "setDynamicTrigger",
              args: [
                policy.userAddress,
                policy.marketId as `0x${string}`,
                triggerWad,
                BigInt(validUntilSec),
              ],
              account: this.account,
            });
          } else {
            await this.client.simulateContract({
              address: policy.guardianAddress,
              abi: guardianAaveV4Abi,
              functionName: "setDynamicTrigger",
              args: [
                policy.userAddress,
                policy.debtAsset,
                triggerWad,
                BigInt(validUntilSec),
              ],
              account: this.account,
            });
          }
        } catch (simErr) {
          const errMsg = simErr instanceof Error ? simErr.message : String(simErr);
          this.logger.error(`[dynamic-trigger] Simulasi setDynamicTrigger gagal: ${errMsg}`);
          return {
            ...baseDecision,
            status: "failed",
            error: errMsg,
            reason: "simulation_failed",
          };
        }
      }

      // Broadcast transaksi
      try {
        let txHash: string;
        if (isMorpho && policy.marketId) {
          txHash = await this.walletClient!.writeContract({
            address: policy.guardianAddress,
            abi: guardianMorphoAbi,
            functionName: "setDynamicTrigger",
            args: [
              policy.userAddress,
              policy.marketId as `0x${string}`,
              triggerWad,
              BigInt(validUntilSec),
            ],
            chain: undefined,
            account: this.account!,
          });
        } else {
          txHash = await this.walletClient!.writeContract({
            address: policy.guardianAddress,
            abi: guardianAaveV4Abi,
            functionName: "setDynamicTrigger",
            args: [
              policy.userAddress,
              policy.debtAsset,
              triggerWad,
              BigInt(validUntilSec),
            ],
            chain: undefined,
            account: this.account!,
          });
        }

        this.logger.info(
          `[dynamic-trigger] Berhasil menulis dynamic trigger untuk ${policy.userAddress}: ` +
            `tx=${txHash} trigger=${targetTrigger.toFixed(2)}`,
        );

        // Update database lokal segera
        if (this.db?.updateDynamicTrigger) {
          try {
            await this.db.updateDynamicTrigger({
              userId: policy.userId,
              guardianAddress: policy.guardianAddress,
              dynamicTriggerHf: targetTrigger,
              validUntil: new Date(validUntilSec * 1000),
              positionKey: policy.positionKey ?? undefined,
            });
          } catch (dbErr) {
            this.logger.warn(`[dynamic-trigger] Gagal update DB lokal: ${dbErr}`);
          }
        }

        // Notifikasi Telegram
        await this.dispatchAlertIfConfigured({
          policy,
          fromHf: band.dynamicTriggerHf ?? policy.triggerThreshold,
          toHf: targetTrigger,
          regime: assessment.regime,
          explanation: assessment.explanation,
        });

        return {
          ...baseDecision,
          status: "executed",
          txHash,
          reason: hysteresis.reason,
        };
      } catch (writeErr) {
        const errMsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
        this.logger.error(`[dynamic-trigger] Eksekusi setDynamicTrigger gagal: ${errMsg}`);
        return {
          ...baseDecision,
          status: "failed",
          error: errMsg,
          reason: "tx_broadcast_failed",
        };
      }
    } catch (err) {
      // Invarian I6: jangan pernah throw keluar dari tick
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[dynamic-trigger] Exception tidak terduga pada evaluasi policy: ${errMsg}`);
      return {
        ...baseDecision,
        status: "failed",
        error: errMsg,
        reason: "unexpected_error",
      };
    }
  }

  /**
   * Evaluasi semua policy aktif pada siklus tick.
   */
  public async evaluateAll(policies: PolicyRecord[]): Promise<DynamicTriggerDecision[]> {
    const results: DynamicTriggerDecision[] = [];
    for (const policy of policies) {
      const decision = await this.evaluatePolicy(policy);
      results.push(decision);
    }
    return results;
  }

  private async dispatchAlertIfConfigured(opts: {
    policy: PolicyRecord;
    fromHf: number;
    toHf: number;
    regime?: string;
    explanation?: string;
  }): Promise<void> {
    const alertMsg = dynamicTriggerAlert({
      user: opts.policy.userAddress,
      fromHf: opts.fromHf,
      toHf: opts.toHf,
      regime: opts.regime,
      explanation: opts.explanation,
      protocol: opts.policy.protocol ?? "aave-v3",
      debtAsset: opts.policy.debtAsset,
      marketId: opts.policy.marketId ?? undefined,
      positionKey: opts.policy.positionKey ?? undefined,
    });

    if (this.db?.recordNotificationLog) {
      try {
        await this.db.recordNotificationLog({
          userId: opts.policy.userId,
          type: "EXECUTION_SUCCESS",
          message: alertMsg,
          deliveredOk: false,
        });
      } catch (err) {
        this.logger.warn(`[dynamic-trigger] Gagal record notification log: ${err}`);
      }
    }

    if (this.channelAdapter && this.db?.getLinkedTelegramAccounts) {
      try {
        const chatIds = await this.db.getLinkedTelegramAccounts(opts.policy.userId);
        for (const chatId of chatIds) {
          try {
            await this.channelAdapter.send(chatId, alertMsg, { parseMode: "HTML" });
          } catch (err) {
            this.logger.warn(`[dynamic-trigger] Gagal kirim Telegram ke ${chatId}: ${err}`);
          }
        }
      } catch (err) {
        this.logger.warn(`[dynamic-trigger] Gagal mengambil linked Telegram: ${err}`);
      }
    }
  }
}
