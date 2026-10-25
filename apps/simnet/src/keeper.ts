/**
 * Sim keeper (spec §3.6): per fork, every 2 s:
 * - V3: usersPage → needsProtection(user) → protect(user)
 * - AaveV4: positionsPage → needsProtection(user, debtAsset) → protect(user, debtAsset) (at most one per user per tick, highest priority first)
 * - Morpho: positionsPage → needsProtection(user, marketId) → protect(user, marketId)
 *
 * During scenario replay on the fork, the sim keeper also acts as the risk agent:
 * - Ensures a default trigger band with SIM_RISK_AGENT is set for active positions
 * - For positions whose band riskAgent is SIM_RISK_AGENT, calls setDynamicTrigger
 *   mapped from the scenario's regime series (CALM/ELEVATED/STRESSED/CRISIS).
 * - Decodes and emits DynamicTriggerSet logs for the simulation timeline.
 *
 * NOTE: The regime series in simulation fixtures represents hindsight labelling
 * for historical demonstration and testing, not a live AI/risk engine forecast.
 *
 * Separate from the production engine sentinel; the engine never touches forks.
 */

import {
  concat,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  keccak256,
  pad,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { guardianAaveV4Abi, guardianAbi, guardianMorphoAbi } from "./abis.ts";
import { calculateDefaultBand, calculateDynamicTrigger } from "./dynamic-trigger.ts";
import type { ForkClient } from "./fork-client.ts";
import type { ScenarioRegime } from "./scenario.ts";

/** anvil default account #1; impersonated, so its key is irrelevant. */
export const SIM_KEEPER: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

/** anvil default account #1 acts as the simulation risk agent. */
export const SIM_RISK_AGENT: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

export interface SimEvent {
  type: "protected" | "layer" | "fee" | "dynamic_trigger";
  user: Address;
  txHash: Hex;
  blockNumber: number;
  layer?: number;
  amount?: string;
  hfBefore?: string;
  hfAfter?: string;
  waived?: string;
  positionKey?: string;
  triggerHF?: string;
  validUntil?: number;
  agent?: Address;
}

export function aavePositionKey(chainId: number, guardian: Address, debtAsset: Address): string {
  return `aave-v3:${chainId}:${guardian.toLowerCase()}:${debtAsset.toLowerCase()}`;
}

export function morphoPositionKey(chainId: number, guardian: Address, marketId: Hex): string {
  return `morpho-blue:${chainId}:${guardian.toLowerCase()}:${marketId.toLowerCase()}`;
}

export function v2PositionKey(chainId: number, guardian: Address): string {
  return `aave-v2:${chainId}:${guardian.toLowerCase()}`;
}

export interface CachedBand {
  minTriggerHF: bigint;
  maxTriggerHF: bigint;
  riskAgent: Address;
  dynamicTriggerHF: bigint;
  validUntil: number;
}

const bandCache = new Map<string, CachedBand>();

export function getBandCacheKey(positionKey: string, user: Address): string {
  return `${user.toLowerCase()}:${positionKey.toLowerCase()}`;
}

export function setCachedBand(positionKey: string, user: Address, band: CachedBand): void {
  bandCache.set(getBandCacheKey(positionKey, user), band);
}

export function getCachedBand(positionKey: string, user: Address): CachedBand | undefined {
  return bandCache.get(getBandCacheKey(positionKey, user));
}

export function clearBandCache(): void {
  bandCache.clear();
}

/** Storage slot for mapping(address user => mapping(address debtAsset => TriggerBand)) at slot 3 */
export function getAaveV4TriggerBandSlot(user: Address, debtAsset: Address): `0x${string}` {
  const slot3 = pad(toHex(3n), { size: 32 });
  const paddedUser = pad(user, { size: 32 });
  const inner = keccak256(concat([paddedUser, slot3]));
  const paddedAsset = pad(debtAsset, { size: 32 });
  return keccak256(concat([paddedAsset, inner]));
}

/** Storage slot for mapping(address user => mapping(bytes32 marketId => TriggerBand)) at slot 2 */
export function getMorphoTriggerBandSlot(user: Address, marketId: Hex): `0x${string}` {
  const slot2 = pad(toHex(2n), { size: 32 });
  const paddedUser = pad(user, { size: 32 });
  const inner = keccak256(concat([paddedUser, slot2]));
  const paddedMarket = pad(marketId, { size: 32 });
  return keccak256(concat([paddedMarket, inner]));
}

async function readBandAaveV4(
  fork: ForkClient,
  guardian: Address,
  user: Address,
  debtAsset: Address,
  chainId: number,
): Promise<CachedBand | null> {
  const posKey = aavePositionKey(chainId, guardian, debtAsset);
  // 1. Try reading via custom view if mocked in test
  try {
    const res = await fork.read<readonly [bigint, bigint, Address, bigint, bigint | number]>(
      guardian,
      guardianAaveV4Abi,
      "triggerBandOf" as any,
      [user, debtAsset],
    );
    if (res && res.length >= 3) {
      const b: CachedBand = {
        minTriggerHF: res[0],
        maxTriggerHF: res[1],
        riskAgent: getAddress(res[2]),
        dynamicTriggerHF: res[3] ?? 0n,
        validUntil: Number(res[4] ?? 0),
      };
      setCachedBand(posKey, user, b);
      return b;
    }
  } catch {
    // view function does not exist on contract, continue
  }

  // 2. Try reading from storage on real fork
  if (typeof fork.rpc === "function") {
    try {
      const baseSlot = getAaveV4TriggerBandSlot(user, debtAsset);
      const minHex = await fork.rpc<Hex>("eth_getStorageAt", [guardian, baseSlot, "latest"]);
      const minTriggerHF = BigInt(minHex ?? "0x0");
      if (minTriggerHF > 0n) {
        const maxHex = await fork.rpc<Hex>("eth_getStorageAt", [guardian, toHex(BigInt(baseSlot) + 1n), "latest"]);
        const agentHex = await fork.rpc<Hex>("eth_getStorageAt", [guardian, toHex(BigInt(baseSlot) + 2n), "latest"]);
        const dynHex = await fork.rpc<Hex>("eth_getStorageAt", [guardian, toHex(BigInt(baseSlot) + 3n), "latest"]);
        const expHex = await fork.rpc<Hex>("eth_getStorageAt", [guardian, toHex(BigInt(baseSlot) + 4n), "latest"]);
        const rawAgent = (agentHex ?? "0x").slice(-40);
        const b: CachedBand = {
          minTriggerHF,
          maxTriggerHF: BigInt(maxHex ?? "0x0"),
          riskAgent: getAddress("0x" + rawAgent.padStart(40, "0")),
          dynamicTriggerHF: BigInt(dynHex ?? "0x0"),
          validUntil: Number(BigInt(expHex ?? "0x0")),
        };
        setCachedBand(posKey, user, b);
        return b;
      }
    } catch {
      // storage read failed
    }
  }

  // 3. Check memory cache
  return getCachedBand(posKey, user) ?? null;
}

async function readBandMorpho(
  fork: ForkClient,
  guardian: Address,
  user: Address,
  marketId: Hex,
  chainId: number,
): Promise<CachedBand | null> {
  const posKey = morphoPositionKey(chainId, guardian, marketId);
  // 1. Try reading via custom view if mocked in test
  try {
    const res = await fork.read<readonly [bigint, bigint, Address, bigint, bigint | number]>(
      guardian,
      guardianMorphoAbi,
      "triggerBandOf" as any,
      [user, marketId],
    );
    if (res && res.length >= 3) {
      const b: CachedBand = {
        minTriggerHF: res[0],
        maxTriggerHF: res[1],
        riskAgent: getAddress(res[2]),
        dynamicTriggerHF: res[3] ?? 0n,
        validUntil: Number(res[4] ?? 0),
      };
      setCachedBand(posKey, user, b);
      return b;
    }
  } catch {
    // view function does not exist on contract, continue
  }

  // 2. Try reading from storage on real fork
  if (typeof fork.rpc === "function") {
    try {
      const baseSlot = getMorphoTriggerBandSlot(user, marketId);
      const minHex = await fork.rpc<Hex>("eth_getStorageAt", [guardian, baseSlot, "latest"]);
      const minTriggerHF = BigInt(minHex ?? "0x0");
      if (minTriggerHF > 0n) {
        const maxHex = await fork.rpc<Hex>("eth_getStorageAt", [guardian, toHex(BigInt(baseSlot) + 1n), "latest"]);
        const agentHex = await fork.rpc<Hex>("eth_getStorageAt", [guardian, toHex(BigInt(baseSlot) + 2n), "latest"]);
        const dynHex = await fork.rpc<Hex>("eth_getStorageAt", [guardian, toHex(BigInt(baseSlot) + 3n), "latest"]);
        const expHex = await fork.rpc<Hex>("eth_getStorageAt", [guardian, toHex(BigInt(baseSlot) + 4n), "latest"]);
        const rawAgent = (agentHex ?? "0x").slice(-40);
        const b: CachedBand = {
          minTriggerHF,
          maxTriggerHF: BigInt(maxHex ?? "0x0"),
          riskAgent: getAddress("0x" + rawAgent.padStart(40, "0")),
          dynamicTriggerHF: BigInt(dynHex ?? "0x0"),
          validUntil: Number(BigInt(expHex ?? "0x0")),
        };
        setCachedBand(posKey, user, b);
        return b;
      }
    } catch {
      // storage read failed
    }
  }

  // 3. Check memory cache
  return getCachedBand(posKey, user) ?? null;
}

async function readBandV2V3(
  fork: ForkClient,
  guardian: Address,
  user: Address,
  chainId: number,
): Promise<CachedBand | null> {
  const posKey = v2PositionKey(chainId, guardian);
  try {
    const res = await fork.read<readonly [bigint, bigint, Address, bigint, bigint | number]>(
      guardian,
      guardianAbi,
      "triggerBands",
      [user],
    );
    if (res && res.length >= 3) {
      const b: CachedBand = {
        minTriggerHF: res[0],
        maxTriggerHF: res[1],
        riskAgent: getAddress(res[2]),
        dynamicTriggerHF: res[3] ?? 0n,
        validUntil: Number(res[4] ?? 0),
      };
      setCachedBand(posKey, user, b);
      return b;
    }
  } catch {
    // ignore
  }
  return getCachedBand(posKey, user) ?? null;
}

export interface DecodeLogsOptions {
  chainId?: number;
  protocol?: "aave-v3" | "morpho-blue";
  debtAsset?: Address;
  marketId?: Hex;
}

/** Decodes Protected / LayerUsed / FeeCharged / DynamicTriggerSet from Guardian logs. */
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
    } else if (ev.eventName === "DynamicTriggerSet") {
      out.push({
        ...base,
        type: "dynamic_trigger",
        user: ev.args.user,
        triggerHF: ev.args.triggerHF ? ev.args.triggerHF.toString() : undefined,
        validUntil: ev.args.validUntil ? Number(ev.args.validUntil) : undefined,
        agent: ev.args.agent ? getAddress(ev.args.agent) : undefined,
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

export interface KeeperOptions {
  getRegime?: () => ScenarioRegime | undefined;
  riskAgent?: Address;
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

async function handleDynamicTriggerAaveV4(
  fork: ForkClient,
  guardian: Address,
  user: Address,
  debtAsset: Address,
  regime: ScenarioRegime,
  riskAgent: Address,
  onEvents: (events: SimEvent[]) => void,
  chainId: number,
  onError: (e: unknown) => void,
): Promise<void> {
  try {
    const policy = await fork.read<readonly [boolean, bigint, bigint, bigint]>(
      guardian,
      guardianAaveV4Abi,
      "policyOf",
      [user, debtAsset],
    );
    const [enabled, staticTriggerHF, targetHF] = policy;
    if (!enabled) return;

    let band = await readBandAaveV4(fork, guardian, user, debtAsset, chainId);

    // If band is not set or riskAgent is zero, set default trigger band
    if (!band || band.riskAgent.toLowerCase() === zeroAddress.toLowerCase()) {
      const def = calculateDefaultBand({ triggerHF: staticTriggerHF, targetHF }, riskAgent);
      await fork.sendAs(
        user,
        guardian,
        encodeFunctionData({
          abi: guardianAaveV4Abi,
          functionName: "setTriggerBand",
          args: [debtAsset, def.minTriggerHF, def.maxTriggerHF, riskAgent],
        }),
      );
      band = {
        minTriggerHF: def.minTriggerHF,
        maxTriggerHF: def.maxTriggerHF,
        riskAgent,
        dynamicTriggerHF: 0n,
        validUntil: 0,
      };
      setCachedBand(aavePositionKey(chainId, guardian, debtAsset), user, band);
    }

    if (band.riskAgent.toLowerCase() !== riskAgent.toLowerCase()) return;

    const dynamicTriggerHF = calculateDynamicTrigger({
      regime,
      band,
      staticTriggerHF,
      targetHF,
    });

    const nowSec = Math.floor(Date.now() / 1000);
    // Skip if already at target and valid for at least 60s
    if (band.dynamicTriggerHF === dynamicTriggerHF && band.validUntil > nowSec + 60) {
      return;
    }

    const validUntil = BigInt(nowSec + 3600);
    const receipt = await fork.sendAs(
      riskAgent,
      guardian,
      encodeFunctionData({
        abi: guardianAaveV4Abi,
        functionName: "setDynamicTrigger",
        args: [user, debtAsset, dynamicTriggerHF, validUntil],
      }),
    );

    band.dynamicTriggerHF = dynamicTriggerHF;
    band.validUntil = Number(validUntil);
    setCachedBand(aavePositionKey(chainId, guardian, debtAsset), user, band);

    onEvents(decodeGuardianLogs(guardian, receipt.logs, { chainId, protocol: "aave-v3", debtAsset }));
  } catch (err) {
    onError(err);
  }
}

async function handleDynamicTriggerMorpho(
  fork: ForkClient,
  guardian: Address,
  user: Address,
  marketId: Hex,
  regime: ScenarioRegime,
  riskAgent: Address,
  onEvents: (events: SimEvent[]) => void,
  chainId: number,
  onError: (e: unknown) => void,
): Promise<void> {
  try {
    const policy = await fork.read<readonly [boolean, bigint, bigint, bigint]>(
      guardian,
      guardianMorphoAbi,
      "policyOf",
      [user, marketId],
    );
    const [enabled, staticTriggerHF, targetHF] = policy;
    if (!enabled) return;

    let band = await readBandMorpho(fork, guardian, user, marketId, chainId);

    // If band is not set or riskAgent is zero, set default trigger band
    if (!band || band.riskAgent.toLowerCase() === zeroAddress.toLowerCase()) {
      const def = calculateDefaultBand({ triggerHF: staticTriggerHF, targetHF }, riskAgent);
      await fork.sendAs(
        user,
        guardian,
        encodeFunctionData({
          abi: guardianMorphoAbi,
          functionName: "setTriggerBand",
          args: [marketId, def.minTriggerHF, def.maxTriggerHF, riskAgent],
        }),
      );
      band = {
        minTriggerHF: def.minTriggerHF,
        maxTriggerHF: def.maxTriggerHF,
        riskAgent,
        dynamicTriggerHF: 0n,
        validUntil: 0,
      };
      setCachedBand(morphoPositionKey(chainId, guardian, marketId), user, band);
    }

    if (band.riskAgent.toLowerCase() !== riskAgent.toLowerCase()) return;

    const dynamicTriggerHF = calculateDynamicTrigger({
      regime,
      band,
      staticTriggerHF,
      targetHF,
    });

    const nowSec = Math.floor(Date.now() / 1000);
    if (band.dynamicTriggerHF === dynamicTriggerHF && band.validUntil > nowSec + 60) {
      return;
    }

    const validUntil = BigInt(nowSec + 3600);
    const receipt = await fork.sendAs(
      riskAgent,
      guardian,
      encodeFunctionData({
        abi: guardianMorphoAbi,
        functionName: "setDynamicTrigger",
        args: [user, marketId, dynamicTriggerHF, validUntil],
      }),
    );

    band.dynamicTriggerHF = dynamicTriggerHF;
    band.validUntil = Number(validUntil);
    setCachedBand(morphoPositionKey(chainId, guardian, marketId), user, band);

    onEvents(decodeGuardianLogs(guardian, receipt.logs, { chainId, protocol: "morpho-blue", marketId }));
  } catch (err) {
    onError(err);
  }
}

async function handleDynamicTriggerV2V3(
  fork: ForkClient,
  guardian: Address,
  user: Address,
  regime: ScenarioRegime,
  riskAgent: Address,
  onEvents: (events: SimEvent[]) => void,
  chainId: number,
  onError: (e: unknown) => void,
): Promise<void> {
  try {
    const policy = await fork.read<readonly [boolean, bigint, bigint, bigint]>(
      guardian,
      guardianAbi,
      "policyOf",
      [user],
    );
    const [enabled, staticTriggerHF, targetHF] = policy;
    if (!enabled) return;

    let band = await readBandV2V3(fork, guardian, user, chainId);

    if (!band || band.riskAgent.toLowerCase() === zeroAddress.toLowerCase()) {
      const def = calculateDefaultBand({ triggerHF: staticTriggerHF, targetHF }, riskAgent);
      await fork.sendAs(
        user,
        guardian,
        encodeFunctionData({
          abi: guardianAbi,
          functionName: "setTriggerBand",
          args: [def.minTriggerHF, def.maxTriggerHF, riskAgent],
        }),
      );
      band = {
        minTriggerHF: def.minTriggerHF,
        maxTriggerHF: def.maxTriggerHF,
        riskAgent,
        dynamicTriggerHF: 0n,
        validUntil: 0,
      };
      setCachedBand(v2PositionKey(chainId, guardian), user, band);
    }

    if (band.riskAgent.toLowerCase() !== riskAgent.toLowerCase()) return;

    const dynamicTriggerHF = calculateDynamicTrigger({
      regime,
      band,
      staticTriggerHF,
      targetHF,
    });

    const nowSec = Math.floor(Date.now() / 1000);
    if (band.dynamicTriggerHF === dynamicTriggerHF && band.validUntil > nowSec + 60) {
      return;
    }

    const validUntil = BigInt(nowSec + 3600);
    const receipt = await fork.sendAs(
      riskAgent,
      guardian,
      encodeFunctionData({
        abi: guardianAbi,
        functionName: "setDynamicTrigger",
        args: [user, dynamicTriggerHF, validUntil],
      }),
    );

    band.dynamicTriggerHF = dynamicTriggerHF;
    band.validUntil = Number(validUntil);
    setCachedBand(v2PositionKey(chainId, guardian), user, band);

    onEvents(decodeGuardianLogs(guardian, receipt.logs, { chainId, protocol: "aave-v3" }));
  } catch (err) {
    onError(err);
  }
}

export function startKeeper(
  fork: ForkClient,
  guardianInput: Address | KeeperGuardians,
  onEvents: (events: SimEvent[]) => void,
  intervalMs: number,
  onError: (e: unknown) => void,
  onCheck?: (timestamp: number) => void,
  options?: KeeperOptions,
): KeeperHandle {
  const g: KeeperGuardians = typeof guardianInput === "string" ? { guardian: guardianInput } : guardianInput;
  const chainId = (fork as { chainId?: number }).chainId ?? 4216199;
  const riskAgent = options?.riskAgent ?? SIM_RISK_AGENT;

  let busy = false;
  let stopped = false;
  let lastCheckedAt: number | null = null;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const regime = options?.getRegime?.();

      // 1. V2/V3 guardian
      for (let offset = 0n; ; offset += PAGE) {
        if (stopped) return;
        const users = await fork.read<readonly Address[]>(g.guardian, guardianAbi, "usersPage", [offset, PAGE]);
        for (const user of users) {
          if (stopped) return;

          // Sim keeper acts as risk agent: update dynamic trigger based on scenario regime
          if (regime) {
            await handleDynamicTriggerV2V3(fork, g.guardian, user, regime, riskAgent, onEvents, chainId, onError);
          }

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

              // Sim keeper acts as risk agent: update dynamic trigger based on scenario regime
              if (regime) {
                await handleDynamicTriggerAaveV4(
                  fork,
                  guardianAaveV4,
                  user,
                  debtAsset,
                  regime,
                  riskAgent,
                  onEvents,
                  chainId,
                  onError,
                );
              }

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

            // Sim keeper acts as risk agent: update dynamic trigger based on scenario regime
            if (regime) {
              await handleDynamicTriggerMorpho(
                fork,
                guardianMorpho,
                user,
                marketId,
                regime,
                riskAgent,
                onEvents,
                chainId,
                onError,
              );
            }

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
