/**
 * Event Sync: sinkronisasi event Guardian v1/v2 ke database.
 *
 * Mengambil log secara chunked (default 50.000 blok) dari deployedBlock atau cursor terakhir,
 * dan memperbarui tabel `policies`, `users`, `event_cursors`, serta `notification_logs`.
 */

import { parseEventLogs, type PublicClient } from "viem";
import type { Address } from "@tahansoe/domain";
import { wadToNumber, getChainConfig, ARBITRUM_SEPOLIA } from "@tahansoe/domain";
import {
  policySetEventAbi,
  policyDisabledEventAbi,
  protectedEventAbi,
  layer2SetEventAbi,
  layer3SetEventAbi,
  triggerBandSetEventAbi,
  dynamicTriggerSetEventAbi,
} from "./abi.ts";
import { protectedExecutionAlert } from "./views.ts";
import type { TelegramSender } from "../telegram/index.ts";

export const GUARDIAN_EVENTS_ABI = [
  policySetEventAbi,
  policyDisabledEventAbi,
  protectedEventAbi,
  layer2SetEventAbi,
  layer3SetEventAbi,
  triggerBandSetEventAbi,
  dynamicTriggerSetEventAbi,
] as const;

export const DEFAULT_CHUNK_SIZE = 50_000n;

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
    debtAsset: Address;
    maxRepayPerAction: bigint;
    triggerThreshold: number;
    targetHealthFactor: number;
  }): Promise<void>;
  disablePolicy(userId: string, guardianAddress: Address): Promise<void>;
  updateLayer2(data: {
    userId: string;
    guardianAddress: Address;
    kind: number;
    source: Address;
    maxAssets: bigint;
  }): Promise<void>;
  updateLayer3(data: {
    userId: string;
    guardianAddress: Address;
    enabled: boolean;
    collateralAsset: Address;
    maxCollateral: bigint;
    maxSlippageBps: number;
  }): Promise<void>;
  updateTriggerBand(data: {
    userId: string;
    guardianAddress: Address;
    minTriggerHf: number;
    maxTriggerHf: number;
    riskAgent: Address;
  }): Promise<void>;
  updateDynamicTrigger(data: {
    userId: string;
    guardianAddress: Address;
    dynamicTriggerHf: number;
    validUntil: Date;
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
  const guardians = chain.guardians && chain.guardians.length > 0
    ? chain.guardians
    : chain.guardian
      ? [{ version: 1, address: chain.guardian, deployedBlock: 0 }]
      : [];

  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const currentBlock = await options.client.getBlockNumber();

  let totalLogs = 0;
  let minFromBlock = currentBlock;
  let maxToBlock = currentBlock;

  for (const guardian of guardians) {
    const guardianAddress = guardian.address.toLowerCase() as Address;
    const existingCursor = await options.db.getCursor(chainId, guardianAddress, "events");

    let fromBlock = existingCursor !== null
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

        for (const log of parsedLogs) {
          totalLogs++;
          const args = (log as any).args;

          switch (log.eventName) {
            case "PolicySet": {
              const userAddress = (args.user as string).toLowerCase() as Address;
              const debtAsset = (args.debtAsset as string).toLowerCase() as Address;
              const triggerHF = wadToNumber(args.triggerHF);
              const targetHF = wadToNumber(args.targetHF);
              const maxRepayPerAction = BigInt(args.maxRepayPerAction);

              const userId = await options.db.upsertUser(userAddress, chainId);
              await options.db.upsertPolicy({
                userId,
                chainId,
                guardianAddress,
                guardianVersion: guardian.version,
                debtAsset,
                maxRepayPerAction,
                triggerThreshold: triggerHF,
                targetHealthFactor: targetHF,
              });
              break;
            }

            case "PolicyDisabled": {
              const userAddress = (args.user as string).toLowerCase() as Address;
              const userId = await options.db.upsertUser(userAddress, chainId);
              await options.db.disablePolicy(userId, guardianAddress);
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
              await options.db.updateDynamicTrigger({
                userId,
                guardianAddress,
                dynamicTriggerHf: wadToNumber(args.triggerHF),
                validUntil: new Date(Number(args.validUntil) * 1000),
              });
              break;
            }

            case "Protected": {
              const userAddress = (args.user as string).toLowerCase() as Address;
              const caller = (args.caller as string).toLowerCase() as Address;
              const repaid = BigInt(args.repaid);
              const healthFactorBefore = BigInt(args.healthFactorBefore);
              const healthFactorAfter = BigInt(args.healthFactorAfter);

              const userId = await options.db.upsertUser(userAddress, chainId);
              const alertMsg = protectedExecutionAlert({
                user: userAddress,
                repaid,
                hfBefore: healthFactorBefore,
                hfAfter: healthFactorAfter,
                caller,
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
