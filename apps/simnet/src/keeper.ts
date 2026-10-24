/**
 * Sim keeper (spec §3.6): per fork, every 2 s, usersPage → needsProtection → protect.
 * Separate from the production engine sentinel; the engine never touches forks.
 */

import { decodeEventLog, encodeFunctionData, getAddress, type Address, type Hex, type Log } from "viem";
import { guardianAbi } from "./abis.ts";
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
}

/** Decodes Protected / LayerUsed / FeeCharged from Guardian logs; ignores everything else. */
export function decodeGuardianLogs(guardian: Address, logs: readonly Log[]): SimEvent[] {
  const out: SimEvent[] = [];
  for (const log of logs) {
    if (getAddress(log.address) !== getAddress(guardian) || !log.transactionHash) continue;
    let ev;
    try {
      ev = decodeEventLog({ abi: guardianAbi, data: log.data, topics: log.topics });
    } catch {
      continue;
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
      });
    } else if (ev.eventName === "LayerUsed") {
      out.push({ ...base, type: "layer", user: ev.args.user, layer: ev.args.layer, amount: ev.args.debtRepaid.toString() });
    } else if (ev.eventName === "FeeCharged") {
      out.push({ ...base, type: "fee", user: ev.args.user, amount: ev.args.amount.toString(), waived: ev.args.waived.toString() });
    }
  }
  return out;
}

export interface KeeperHandle {
  stop(): void;
}

const PAGE = 100n;

export function startKeeper(
  fork: ForkClient,
  guardian: Address,
  onEvents: (events: SimEvent[]) => void,
  intervalMs: number,
  onError: (e: unknown) => void,
): KeeperHandle {
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      for (let offset = 0n; ; offset += PAGE) {
        const users = await fork.read<readonly Address[]>(guardian, guardianAbi, "usersPage", [offset, PAGE]);
        for (const user of users) {
          if (stopped) return;
          const needs = await fork.read<boolean>(guardian, guardianAbi, "needsProtection", [user]);
          if (!needs) continue;
          try {
            const receipt = await fork.sendAs(
              SIM_KEEPER,
              guardian,
              encodeFunctionData({ abi: guardianAbi, functionName: "protect", args: [user] }),
            );
            onEvents(decodeGuardianLogs(guardian, receipt.logs));
          } catch (e) {
            onError(e);
          }
        }
        if (BigInt(users.length) < PAGE) break;
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
  };
}
