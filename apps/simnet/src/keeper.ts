/**
 * Sim keeper (spec §3.6): per fork, every 2 s:
 * - V3: usersPage → needsProtection(user) → protect(user)
 * - AaveV4: positionsPage → needsProtection(user, debtAsset) → protect(user, debtAsset) (at most one per user per tick, highest priority first)
 * - Morpho: positionsPage → needsProtection(user, marketId) → protect(user, marketId)
 * Separate from the production engine sentinel; the engine never touches forks.
 */

import { decodeEventLog, encodeFunctionData, getAddress, type Address, type Hex, type Log } from "viem";
import { guardianAaveV4Abi, guardianAbi, guardianMorphoAbi } from "./abis.ts";
import type { ForkClient } from "./fork-client.ts";

/** anvil default account #1; impersonated, so its key is irrelevant. */
export const SIM_KEEPER: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

export interface SimEvent {
  type: "protected" | "layer" | "fee";
  user: Address;
  txHash: Hex;
  blockNumber: number;
  layer?: number;
  amount?: string;
  hfBefore?: string;
  hfAfter?: string;
  waived?: string;
  positionKey?: string;
}

export function aavePositionKey(chainId: number, guardian: Address, debtAsset: Address): string {
  return `aave-v3:${chainId}:${guardian.toLowerCase()}:${debtAsset.toLowerCase()}`;
}

export function morphoPositionKey(chainId: number, guardian: Address, marketId: Hex): string {
  return `morpho-blue:${chainId}:${guardian.toLowerCase()}:${marketId.toLowerCase()}`;
}

export interface DecodeLogsOptions {
  chainId?: number;
  protocol?: "aave-v3" | "morpho-blue";
  debtAsset?: Address;
  marketId?: Hex;
}

/** Decodes Protected / LayerUsed / FeeCharged from Guardian logs; ignores everything else. */
export function decodeGuardianLogs(guardian: Address, logs: readonly Log[], opts?: DecodeLogsOptions): SimEvent[] {
  const out: SimEvent[] = [];
  const chainId = opts?.chainId ?? 4216199;

  // Pre-scan to associate debtAsset / marketId with txHash for logs that lack indexed keys (e.g. V2/V3 LayerUsed)
  const debtAssetByTx = new Map<string, Address>();
  const marketIdByTx = new Map<string, Hex>();

  for (const log of logs) {
    if (getAddress(log.address) !== getAddress(guardian) || !log.transactionHash) continue;
    try {
      const ev = decodeEventLog({ abi: guardianAaveV4Abi, data: log.data, topics: log.topics });
      if (ev.args && "debtAsset" in ev.args && ev.args.debtAsset) {
        debtAssetByTx.set(log.transactionHash, ev.args.debtAsset as Address);
      }
    } catch {
      try {
        const ev = decodeEventLog({ abi: guardianMorphoAbi, data: log.data, topics: log.topics });
        if (ev.args && "marketId" in ev.args && ev.args.marketId) {
          marketIdByTx.set(log.transactionHash, ev.args.marketId as Hex);
        }
      } catch {
        // ignore
      }
    }
  }

  for (const log of logs) {
    if (getAddress(log.address) !== getAddress(guardian) || !log.transactionHash) continue;

    let ev: any;
    let protocol: "aave-v3" | "morpho-blue" = opts?.protocol ?? "aave-v3";
    let debtAsset: Address | undefined = opts?.debtAsset ?? debtAssetByTx.get(log.transactionHash);
    let marketId: Hex | undefined = opts?.marketId ?? marketIdByTx.get(log.transactionHash);

    try {
      ev = decodeEventLog({ abi: guardianAaveV4Abi, data: log.data, topics: log.topics });
      protocol = "aave-v3";
      if (ev.args && "debtAsset" in ev.args && ev.args.debtAsset) {
        debtAsset = ev.args.debtAsset as Address;
      }
    } catch {
      try {
        ev = decodeEventLog({ abi: guardianMorphoAbi, data: log.data, topics: log.topics });
        protocol = "morpho-blue";
        if (ev.args && "marketId" in ev.args && ev.args.marketId) {
          marketId = ev.args.marketId as Hex;
        }
      } catch {
        try {
          ev = decodeEventLog({ abi: guardianAbi, data: log.data, topics: log.topics });
          protocol = "aave-v3";
          if (ev.args && "debtAsset" in ev.args && ev.args.debtAsset) {
            debtAsset = ev.args.debtAsset as Address;
          }
        } catch {
          continue;
        }
      }
    }

    let positionKey: string | undefined;
    if (protocol === "morpho-blue" && marketId) {
      positionKey = morphoPositionKey(chainId, guardian, marketId);
    } else if (debtAsset) {
      positionKey = aavePositionKey(chainId, guardian, debtAsset);
    }

    const base = { txHash: log.transactionHash, blockNumber: Number(log.blockNumber ?? 0n) };
    if (ev.eventName === "Protected") {
      out.push({
        ...base,
        type: "protected",
        user: ev.args.user,
        amount: ev.args.repaid.toString(),
        hfBefore: ev.args.healthFactorBefore.toString(),
        hfAfter: ev.args.healthFactorAfter.toString(),
        ...(positionKey ? { positionKey } : {}),
      });
    } else if (ev.eventName === "LayerUsed") {
      out.push({
        ...base,
        type: "layer",
        user: ev.args.user,
        layer: ev.args.layer,
        amount: ev.args.debtRepaid.toString(),
        ...(positionKey ? { positionKey } : {}),
      });
    } else if (ev.eventName === "FeeCharged") {
      out.push({
        ...base,
        type: "fee",
        user: ev.args.user,
        amount: ev.args.amount.toString(),
        waived: ev.args.waived.toString(),
        ...(positionKey ? { positionKey } : {}),
      });
    }
  }
  return out;
}

export interface KeeperGuardians {
  guardian: Address;
  guardianAaveV4?: Address;
  guardianMorpho?: Address;
}

export interface KeeperHandle {
  stop(): void;
  readonly lastCheckedAt?: number | null;
}

const keeperCheckedAtByUrl = new Map<string, number>();

export function getKeeperCheckedAt(url: string): number | null {
  return keeperCheckedAtByUrl.get(url) ?? null;
}

export function recordKeeperChecked(url: string, at = Date.now()): void {
  keeperCheckedAtByUrl.set(url, at);
}

export function clearKeeperChecked(url?: string): void {
  if (url) keeperCheckedAtByUrl.delete(url);
  else keeperCheckedAtByUrl.clear();
}

const PAGE = 100n;

export function startKeeper(
  fork: ForkClient,
  guardianInput: Address | KeeperGuardians,
  onEvents: (events: SimEvent[]) => void,
  intervalMs: number,
  onError: (e: unknown) => void,
  onCheck?: (timestamp: number) => void,
): KeeperHandle {
  const g: KeeperGuardians = typeof guardianInput === "string" ? { guardian: guardianInput } : guardianInput;
  const chainId = (fork as { chainId?: number }).chainId ?? 4216199;

  let busy = false;
  let stopped = false;
  let lastCheckedAt: number | null = null;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      // 1. V2/V3 guardian
      for (let offset = 0n; ; offset += PAGE) {
        if (stopped) return;
        const users = await fork.read<readonly Address[]>(g.guardian, guardianAbi, "usersPage", [offset, PAGE]);
        for (const user of users) {
          if (stopped) return;
          const needs = await fork.read<boolean>(g.guardian, guardianAbi, "needsProtection", [user]);
          if (!needs) continue;
          try {
            const receipt = await fork.sendAs(
              SIM_KEEPER,
              g.guardian,
              encodeFunctionData({ abi: guardianAbi, functionName: "protect", args: [user] }),
            );
            onEvents(decodeGuardianLogs(g.guardian, receipt.logs, { chainId, protocol: "aave-v3" }));
          } catch (e) {
            onError(e);
          }
        }
        if (BigInt(users.length) < PAGE) break;
      }

      // 2. Aave V4 guardian (if present)
      if (g.guardianAaveV4) {
        const guardianAaveV4 = g.guardianAaveV4;
        const handledUsers = new Set<string>();
        for (let offset = 0n; ; offset += PAGE) {
          if (stopped) return;
          const res = await fork.read<
            | readonly [readonly Address[], readonly Address[]]
            | { users: readonly Address[]; debtAssets: readonly Address[] }
          >(guardianAaveV4, guardianAaveV4Abi, "positionsPage", [offset, PAGE]);

          const users: readonly Address[] = Array.isArray(res) ? res[0] : (res as any)?.users ?? [];
          const debtAssets: readonly Address[] = Array.isArray(res) ? res[1] : (res as any)?.debtAssets ?? [];
          if (!users || users.length === 0) break;

          for (let i = 0; i < users.length; i++) {
            if (stopped) return;
            const user = users[i];
            if (!user) continue;
            const normUser = getAddress(user);
            if (handledUsers.has(normUser)) continue;
            handledUsers.add(normUser);

            const fallbackAsset = debtAssets[i];
            let priorityAssets: readonly Address[];
            try {
              priorityAssets = await fork.read<readonly Address[]>(
                guardianAaveV4,
                guardianAaveV4Abi,
                "debtAssetsOf",
                [user],
              );
            } catch {
              priorityAssets = fallbackAsset ? [fallbackAsset] : [];
            }
            if (!priorityAssets || priorityAssets.length === 0) {
              priorityAssets = fallbackAsset ? [fallbackAsset] : [];
            }

            for (const debtAsset of priorityAssets) {
              if (stopped) return;
              if (!debtAsset) continue;
              const needs = await fork.read<boolean>(
                guardianAaveV4,
                guardianAaveV4Abi,
                "needsProtection",
                [user, debtAsset],
              );
              if (!needs) continue;

              try {
                const receipt = await fork.sendAs(
                  SIM_KEEPER,
                  guardianAaveV4,
                  encodeFunctionData({
                    abi: guardianAaveV4Abi,
                    functionName: "protect",
                    args: [user, debtAsset],
                  }),
                );
                onEvents(decodeGuardianLogs(guardianAaveV4, receipt.logs, { chainId, protocol: "aave-v3", debtAsset }));
              } catch (e) {
                onError(e);
              }
              // At most one debt asset per user per tick
              break;
            }
          }
          if (BigInt(users.length) < PAGE) break;
        }
      }

      // 3. Morpho guardian (if present)
      if (g.guardianMorpho) {
        const guardianMorpho = g.guardianMorpho;
        for (let offset = 0n; ; offset += PAGE) {
          if (stopped) return;
          const res = await fork.read<
            | readonly [readonly Address[], readonly Hex[]]
            | { users: readonly Address[]; marketIds: readonly Hex[] }
          >(guardianMorpho, guardianMorphoAbi, "positionsPage", [offset, PAGE]);

          const users: readonly Address[] = Array.isArray(res) ? res[0] : (res as any)?.users ?? [];
          const marketIds: readonly Hex[] = Array.isArray(res) ? res[1] : (res as any)?.marketIds ?? [];
          if (!users || users.length === 0) break;

          for (let i = 0; i < users.length; i++) {
            if (stopped) return;
            const user = users[i];
            const marketId = marketIds[i];
            if (!user || !marketId) continue;
            const needs = await fork.read<boolean>(
              guardianMorpho,
              guardianMorphoAbi,
              "needsProtection",
              [user, marketId],
            );
            if (!needs) continue;

            try {
              const receipt = await fork.sendAs(
                SIM_KEEPER,
                guardianMorpho,
                encodeFunctionData({
                  abi: guardianMorphoAbi,
                  functionName: "protect",
                  args: [user, marketId],
                }),
              );
              onEvents(decodeGuardianLogs(guardianMorpho, receipt.logs, { chainId, protocol: "morpho-blue", marketId }));
            } catch (e) {
              onError(e);
            }
          }
          if (BigInt(users.length) < PAGE) break;
        }
      }

      if (!stopped) {
        const now = Date.now();
        lastCheckedAt = now;
        (fork as unknown as { keeperCheckedAt?: number }).keeperCheckedAt = now;
        recordKeeperChecked(fork.url, now);
        onCheck?.(now);
      }
    } catch (e) {
      onError(e);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    get lastCheckedAt() {
      return lastCheckedAt;
    },
  };
}
