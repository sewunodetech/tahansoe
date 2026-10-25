/**
 * Event Sync: sinkronisasi event Guardian v1, v2, v3, dan v4 (Aave & Morpho) ke database.
 *
 * Mengambil log secara chunked (default 50.000 blok) dari deployedBlock atau cursor terakhir,
 * dan memperbarui tabel `policies`, `users`, `event_cursors`, serta `notification_logs`.
 *
 * Mendukung event v4: PolicySet, PolicyDisabled, LayerUsed, Protected, FeeCharged, DynamicTriggerSet
 * yang di-key berdasarkan positionKey (`aave-v3:<chainId>:<guardian>:<debtAsset>` /
 * `morpho-blue:<chainId>:<guardian>:<marketId>`).
 */

import { parseEventLogs, type PublicClient } from "viem";
import type { Address } from "@tahansoe/domain";
import { wadToNumber, getChainConfig, ARBITRUM_SEPOLIA, PER_POSITION_GUARDIAN_VERSION } from "@tahansoe/domain";
import {
  policySetEventAbi,
  policyDisabledEventAbi,
  protectedEventAbi,
  layer2SetEventAbi,
  layer3SetEventAbi,
  triggerBandSetEventAbi,
  dynamicTriggerSetEventAbi,
  policyDisabledAaveV4EventAbi,
  layerUsedAaveV4EventAbi,
  feeChargedAaveEventAbi,
  dynamicTriggerSetAaveV4EventAbi,
  policySetMorphoEventAbi,
  policyDisabledMorphoEventAbi,
  layerUsedMorphoEventAbi,
  protectedMorphoEventAbi,
  feeChargedMorphoEventAbi,
  dynamicTriggerSetMorphoEventAbi,
} from "./abi.ts";
import { buildPositionKey, getGuardiansForChain } from "./adapters.ts";
import { protectedExecutionAlert } from "./views.ts";
import type { TelegramSender } from "../telegram/index.ts";

export const GUARDIAN_EVENTS_ABI = [
  // V2/V3 & shared Aave
  policySetEventAbi,
  policyDisabledEventAbi,
  protectedEventAbi,
  layer2SetEventAbi,
  layer3SetEventAbi,
  triggerBandSetEventAbi,
  dynamicTriggerSetEventAbi,
  // V4 Aave
  policyDisabledAaveV4EventAbi,
  layerUsedAaveV4EventAbi,
  feeChargedAaveEventAbi,
  dynamicTriggerSetAaveV4EventAbi,
  // V4 Morpho Blue
  policySetMorphoEventAbi,
  policyDisabledMorphoEventAbi,
  layerUsedMorphoEventAbi,
  protectedMorphoEventAbi,
  feeChargedMorphoEventAbi,
  dynamicTriggerSetMorphoEventAbi,
] as const;

// 10.000 blok: batas eth_getLogs umum di RPC berbayar (mis. QuickNode); 50.000 ditolak di sana.
export const DEFAULT_CHUNK_SIZE = 10_000n;

export interface EventSyncDatabase {
  getCursor(
    chainId: number,
    contractAddress: Address,
    cursorName?: string,
  ): Promise<bigint | null>;
  setCursor(
    chainId: number,
    contractAddress: Address,
    lastBlock: bigint,
    cursorName?: string,
  ): Promise<void>;
  upsertUser(walletAddress: Address, chainId: number): Promise<string>;
  upsertPolicy(data: {
    userId: string;
    chainId: number;
    guardianAddress: Address;
    guardianVersion: number;
    debtAsset?: Address;
    marketId?: string;
    positionKey?: string;
    protocol?: "aave-v3" | "morpho-blue";
    maxRepayPerAction: bigint;
    triggerThreshold: number;
    targetHealthFactor: number;
  }): Promise<void>;
  disablePolicy(userId: string, guardianAddress: Address, positionKey?: string): Promise<void>;
  updateLayer2(data: {
    userId: string;
    guardianAddress: Address;
    kind: number;
    source: Address;
    maxAssets: bigint;
    positionKey?: string;
  }): Promise<void>;
  updateLayer3(data: {
    userId: string;
    guardianAddress: Address;
    enabled: boolean;
    collateralAsset: Address;
    maxCollateral: bigint;
    maxSlippageBps: number;
    positionKey?: string;
  }): Promise<void>;
  updateTriggerBand(data: {
    userId: string;
    guardianAddress: Address;
    minTriggerHf: number;
    maxTriggerHf: number;
    riskAgent: Address;
    positionKey?: string;
  }): Promise<void>;
  updateDynamicTrigger(data: {
    userId: string;
    guardianAddress: Address;
    dynamicTriggerHf: number;
    validUntil: Date;
    positionKey?: string;
  }): Promise<void>;
  getLinkedTelegramAccounts?(userId: string): Promise<string[]>;
  recordNotificationLog?(data: {
    userId: string;
    type: "HF_WARNING" | "HF_CRITICAL" | "EXECUTION_SUCCESS" | "EXECUTION_FAILED" | "LINK_CONFIRMED" | "RESERVE_LOW";
    message: string;
    deliveredOk: boolean;
  }): Promise<void>;
}

export interface SyncOptions {
  client: PublicClient;
  db: EventSyncDatabase;
  chainId?: number;
  chunkSize?: bigint;
  channelAdapter?: TelegramSender;
  logger?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
}

export interface SyncResult {
  logsProcessed: number;
  fromBlock: bigint;
  toBlock: bigint;
}

export async function syncGuardianEvents(options: SyncOptions): Promise<SyncResult> {
  const chainId = options.chainId ?? ARBITRUM_SEPOLIA.chainId;
  const chain = getChainConfig(chainId) ?? ARBITRUM_SEPOLIA;
  const guardians = getGuardiansForChain(chain);

  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const currentBlock = await options.client.getBlockNumber();

  let totalLogs = 0;
  let minFromBlock = currentBlock;
  let maxToBlock = currentBlock;

  for (const guardian of guardians) {
    const guardianAddress = guardian.address.toLowerCase() as Address;
    const existingCursor = await options.db.getCursor(chainId, guardianAddress, "events");

    const fromBlock = existingCursor !== null
      ? existingCursor + 1n
      : BigInt(guardian.deployedBlock);

    if (fromBlock < minFromBlock) minFromBlock = fromBlock;
    if (fromBlock > currentBlock) {
      continue;
    }

    let cursor = fromBlock;
    while (cursor <= currentBlock) {
      const chunkEnd = cursor + chunkSize - 1n < currentBlock
        ? cursor + chunkSize - 1n
        : currentBlock;

      if (chunkEnd > maxToBlock) maxToBlock = chunkEnd;

      try {
        const rawLogs = await options.client.getLogs({
          address: guardianAddress,
          fromBlock: cursor,
          toBlock: chunkEnd,
        });

        const parsedLogs = parseEventLogs({
          abi: GUARDIAN_EVENTS_ABI,
          logs: rawLogs,
          strict: false,
        });

        // Kumpulkan FeeCharged di chunk ini untuk di-korelasikan dengan Protected
        const feeMap = new Map<string, { amount: bigint; waived: bigint }>();
        for (const log of parsedLogs) {
          if (log.eventName === "FeeCharged") {
            const args = (log as any).args;
            const user = (args.user as string).toLowerCase();
            const key = (args.debtAsset ?? args.marketId ?? "").toLowerCase();
            const txHash = log.transactionHash ? log.transactionHash.toLowerCase() : "";
            const amount = BigInt(args.amount);
            const waived = BigInt(args.waived);
            if (txHash) {
              feeMap.set(`${txHash}:${user}`, { amount, waived });
              feeMap.set(`${txHash}:${user}:${key}`, { amount, waived });
            }
            feeMap.set(`${user}:${key}`, { amount, waived });
          }
        }

        for (const log of parsedLogs) {
          totalLogs++;
          const args = (log as any).args;
          const txHash = log.transactionHash ? log.transactionHash.toLowerCase() : "";

          switch (log.eventName) {
            case "PolicySet": {
              const userAddress = (args.user as string).toLowerCase() as Address;
              const triggerHF = wadToNumber(args.triggerHF);
              const targetHF = wadToNumber(args.targetHF);
              const maxRepayPerAction = BigInt(args.maxRepayPerAction);

              const userId = await options.db.upsertUser(userAddress, chainId);

              // Cek apakah event PolicySet dari Morpho (marketId) atau Aave (debtAsset)
              if (args.marketId !== undefined) {
                const marketId = (args.marketId as string).toLowerCase();
                const positionKey = buildPositionKey({
                  protocol: "morpho-blue",
                  chainId,
                  guardian: guardianAddress,
                  key: marketId,
                });

                await options.db.upsertPolicy({
                  userId,
                  chainId,
                  guardianAddress,
                  guardianVersion: guardian.version,
                  debtAsset: marketId as Address,
                  marketId,
                  positionKey,
                  protocol: "morpho-blue",
                  maxRepayPerAction,
                  triggerThreshold: triggerHF,
                  targetHealthFactor: targetHF,
                });
              } else {
                const debtAsset = (args.debtAsset as string).toLowerCase() as Address;
                // Guardian klasik (v1–v3) punya satu policy per user; hanya v4 yang per aset utang.
                const positionKey = guardian.version >= PER_POSITION_GUARDIAN_VERSION
                  ? buildPositionKey({
                      protocol: "aave-v3",
                      chainId,
                      guardian: guardianAddress,
                      key: debtAsset,
                    })
                  : undefined;

                await options.db.upsertPolicy({
                  userId,
                  chainId,
                  guardianAddress,
                  guardianVersion: guardian.version,
                  debtAsset,
                  positionKey,
                  protocol: "aave-v3",
                  maxRepayPerAction,
                  triggerThreshold: triggerHF,
                  targetHealthFactor: targetHF,
                });
              }
              break;
            }

            case "PolicyDisabled": {
              const userAddress = (args.user as string).toLowerCase() as Address;
              const userId = await options.db.upsertUser(userAddress, chainId);

              let positionKey: string | undefined;
              if (args.debtAsset) {
                positionKey = buildPositionKey({
                  protocol: "aave-v3",
                  chainId,
                  guardian: guardianAddress,
                  key: (args.debtAsset as string).toLowerCase(),
                });
              } else if (args.marketId) {
                positionKey = buildPositionKey({
                  protocol: "morpho-blue",
                  chainId,
                  guardian: guardianAddress,
                  key: (args.marketId as string).toLowerCase(),
                });
              }

              await options.db.disablePolicy(userId, guardianAddress, positionKey);
              break;
            }

            case "Layer2Set": {
              const userAddress = (args.user as string).toLowerCase() as Address;
              const source = (args.source as string).toLowerCase() as Address;
              const userId = await options.db.upsertUser(userAddress, chainId);
              await options.db.updateLayer2({
                userId,
                guardianAddress,
                kind: Number(args.kind),
                source,
                maxAssets: BigInt(args.maxAssetsPerAction),
              });
              break;
            }

            case "Layer3Set": {
              const userAddress = (args.user as string).toLowerCase() as Address;
              const collateralAsset = (args.collateralAsset as string).toLowerCase() as Address;
              const userId = await options.db.upsertUser(userAddress, chainId);
              await options.db.updateLayer3({
                userId,
                guardianAddress,
                enabled: Boolean(args.enabled),
                collateralAsset,
                maxCollateral: BigInt(args.maxCollateralPerAction),
                maxSlippageBps: Number(args.maxSlippageBps),
              });
              break;
            }

            case "LayerUsed": {
              const userAddress = (args.user as string).toLowerCase() as Address;
              const layer = Number(args.layer);
              const amountIn = BigInt(args.amountIn);
              const debtRepaid = BigInt(args.debtRepaid);
              const key = (args.debtAsset ?? args.marketId ?? "").toLowerCase();
              const positionKey = key
                ? buildPositionKey({
                    protocol: args.marketId ? "morpho-blue" : "aave-v3",
                    chainId,
                    guardian: guardianAddress,
                    key,
                  })
                : undefined;
              options.logger?.info?.(
                `[event-sync] LayerUsed: user=${userAddress} guardian=${guardianAddress} key=${key} positionKey=${positionKey} layer=${layer} amountIn=${amountIn} debtRepaid=${debtRepaid}`,
              );
              break;
            }

            case "TriggerBandSet": {
              const userAddress = (args.user as string).toLowerCase() as Address;
              const riskAgent = (args.riskAgent as string).toLowerCase() as Address;
              const userId = await options.db.upsertUser(userAddress, chainId);
              await options.db.updateTriggerBand({
                userId,
                guardianAddress,
                minTriggerHf: wadToNumber(args.minTriggerHF),
                maxTriggerHf: wadToNumber(args.maxTriggerHF),
                riskAgent,
              });
              break;
            }

            case "DynamicTriggerSet": {
              const userAddress = (args.user as string).toLowerCase() as Address;
              const userId = await options.db.upsertUser(userAddress, chainId);

              let positionKey: string | undefined;
              if (args.debtAsset) {
                positionKey = buildPositionKey({
                  protocol: "aave-v3",
                  chainId,
                  guardian: guardianAddress,
                  key: (args.debtAsset as string).toLowerCase(),
                });
              } else if (args.marketId) {
                positionKey = buildPositionKey({
                  protocol: "morpho-blue",
                  chainId,
                  guardian: guardianAddress,
                  key: (args.marketId as string).toLowerCase(),
                });
              }

              await options.db.updateDynamicTrigger({
                userId,
                guardianAddress,
                dynamicTriggerHf: wadToNumber(args.triggerHF),
                validUntil: new Date(Number(args.validUntil) * 1000),
                positionKey,
              });
              break;
            }

            case "FeeCharged": {
              const userAddress = (args.user as string).toLowerCase() as Address;
              const amount = BigInt(args.amount);
              const waived = BigInt(args.waived);
              const key = (args.debtAsset ?? args.marketId ?? "").toLowerCase();
              const positionKey = key
                ? buildPositionKey({
                    protocol: args.marketId ? "morpho-blue" : "aave-v3",
                    chainId,
                    guardian: guardianAddress,
                    key,
                  })
                : undefined;
              options.logger?.info?.(
                `[event-sync] FeeCharged: user=${userAddress} guardian=${guardianAddress} key=${key} positionKey=${positionKey} amount=${amount} waived=${waived}`,
              );
              break;
            }

            case "Protected": {
              const userAddress = (args.user as string).toLowerCase() as Address;
              const caller = (args.caller as string).toLowerCase() as Address;
              const repaid = BigInt(args.repaid);
              const healthFactorBefore = BigInt(args.healthFactorBefore);
              const healthFactorAfter = BigInt(args.healthFactorAfter);

              const isMorpho = args.marketId !== undefined || guardian.protocol === "morpho-blue";
              const protocol = isMorpho ? "morpho-blue" : "aave-v3";
              const debtAsset = args.debtAsset ? (args.debtAsset as string).toLowerCase() : undefined;
              const marketId = args.marketId ? (args.marketId as string).toLowerCase() : undefined;
              const key = debtAsset ?? marketId ?? "";

              const positionKey = buildPositionKey({
                protocol,
                chainId,
                guardian: guardianAddress,
                key,
              });

              // Cari data FeeCharged yang cocok dari map
              const feeData = (txHash ? feeMap.get(`${txHash}:${userAddress}:${key}`) : null)
                ?? (txHash ? feeMap.get(`${txHash}:${userAddress}`) : null)
                ?? feeMap.get(`${userAddress}:${key}`);

              const userId = await options.db.upsertUser(userAddress, chainId);
              const alertMsg = protectedExecutionAlert({
                user: userAddress,
                repaid,
                hfBefore: healthFactorBefore,
                hfAfter: healthFactorAfter,
                caller,
                protocol,
                positionKey,
                debtAsset,
                marketId,
                feeAmount: feeData?.amount,
                feeWaived: feeData?.waived,
              });

              if (options.db.recordNotificationLog) {
                await options.db.recordNotificationLog({
                  userId,
                  type: "EXECUTION_SUCCESS",
                  message: alertMsg,
                  deliveredOk: false,
                });
              }

              if (options.channelAdapter && options.db.getLinkedTelegramAccounts) {
                const chatIds = await options.db.getLinkedTelegramAccounts(userId);
                for (const chatId of chatIds) {
                  try {
                    await options.channelAdapter.send(chatId, alertMsg, { parseMode: "HTML" });
                  } catch (err) {
                    options.logger?.warn?.(`[event-sync] gagal kirim alert execution ke ${chatId}: ${err}`);
                  }
                }
              }
              break;
            }
          }
        }

        await options.db.setCursor(chainId, guardianAddress, chunkEnd, "events");
      } catch (err) {
        options.logger?.error?.(
          `[event-sync] gagal fetch log guardian ${guardianAddress} [${cursor}..${chunkEnd}]: ${err}`,
        );
        break;
      }

      cursor = chunkEnd + 1n;
    }
  }

  return {
    logsProcessed: totalLogs,
    fromBlock: minFromBlock,
    toBlock: maxToBlock,
  };
}
