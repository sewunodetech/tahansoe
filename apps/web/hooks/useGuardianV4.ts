"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { erc20Abi, type Address, type Hash } from "viem";
import { useAccount, usePublicClient, useReadContracts, useSwitchChain, useWriteContract } from "wagmi";
import { hfToWad, wadToNumber } from "@tahansoe/domain";
import { useLiveTarget } from "@/lib/live-target";
import { useSimSession } from "@/lib/sim/hooks";
import {
  guardianAaveV4Abi,
  guardianMorphoAbi,
  getGuardianV4Address,
  formatPositionKeyAave,
  formatPositionKeyMorpho,
  getSavedTriggerBand,
  saveTriggerBand,
  clearSavedTriggerBand,
  ZERO_ADDRESS,
  type DynamicTriggerState,
  type LivePolicyV4,
  type LiveLayer2AaveV4,
  type LiveLayer3AaveV4,
  type LiveLayer2MorphoV4,
  type LiveQuoteFeeV4,
  type ProtectedPositionV4,
} from "@/lib/guardian-v4";

const REFRESH_MS = 15_000;

export type TxStepV4 =
  | "switch"
  | "approve"
  | "setPolicy"
  | "disable"
  | "revoke"
  | "setLayer2"
  | "setLayer3"
  | "setTriggerBand"
  | "setDebtPriority"
  | "protect";

export interface TxStateV4 {
  step: TxStepV4 | null;
  last: TxStepV4 | null;
  hash: Hash | null;
  error: string | null;
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "shortMessage" in err && typeof err.shortMessage === "string") {
    return err.shortMessage;
  }
  return err instanceof Error ? err.message.split("\n")[0] : "Transaction failed";
}

export interface UseGuardianV4Options {
  /** Optional specific Aave debt asset to read details for */
  aaveAsset?: Address;
  /** Optional specific Morpho market ID (bytes32 hex) to read details for */
  morphoMarketId?: `0x${string}`;
}

export function useGuardianV4(options: UseGuardianV4Options = {}) {
  const { address: user, chainId } = useAccount();
  const target = useLiveTarget();
  const { data: simSession } = useSimSession(target.isSimulation);
  const publicClient = usePublicClient({ chainId: target.chain.id });
  const { mutateAsync: writeContract } = useWriteContract();
  const { mutateAsync: switchChain } = useSwitchChain();
  const [tx, setTx] = useState<TxStateV4>({ step: null, last: null, hash: null, error: null });

  const aaveGuardianAddress = useMemo(
    () =>
      getGuardianV4Address({
        chainId: target.chain.id,
        protocol: "aave-v3",
        isSimulation: target.isSimulation,
        simContracts: simSession?.contracts,
      }),
    [target.chain.id, target.isSimulation, simSession?.contracts]
  );

  const morphoGuardianAddress = useMemo(
    () =>
      getGuardianV4Address({
        chainId: target.chain.id,
        protocol: "morpho-blue",
        isSimulation: target.isSimulation,
        simContracts: simSession?.contracts,
      }),
    [target.chain.id, target.isSimulation, simSession?.contracts]
  );

  const available = Boolean(aaveGuardianAddress || morphoGuardianAddress);
  const queryEnabled = Boolean(user) && available && (!target.isSimulation || target.ready);

  /* ── 1. Read registered debtAssetsOf & marketsOf ────────────────────────── */
  const aaveOverviewRead = useReadContracts({
    contracts: aaveGuardianAddress && user
      ? [
          {
            chainId: target.chain.id,
            address: aaveGuardianAddress,
            abi: guardianAaveV4Abi,
            functionName: "debtAssetsOf",
            args: [user],
          },
          {
            chainId: target.chain.id,
            address: aaveGuardianAddress,
            abi: guardianAaveV4Abi,
            functionName: "healthFactor",
            args: [user],
          },
        ]
      : [],
    allowFailure: true,
    query: { enabled: queryEnabled && Boolean(aaveGuardianAddress), refetchInterval: REFRESH_MS },
  });

  const morphoOverviewRead = useReadContracts({
    contracts: morphoGuardianAddress && user
      ? [
          {
            chainId: target.chain.id,
            address: morphoGuardianAddress,
            abi: guardianMorphoAbi,
            functionName: "marketsOf",
            args: [user],
          },
        ]
      : [],
    allowFailure: true,
    query: { enabled: queryEnabled && Boolean(morphoGuardianAddress), refetchInterval: REFRESH_MS },
  });

  const aaveDebtAssets: Address[] = useMemo(() => {
    const raw = aaveOverviewRead.data?.[0]?.result as Address[] | undefined;
    return raw ? [...raw] : [];
  }, [aaveOverviewRead.data]);

  const morphoMarkets: `0x${string}`[] = useMemo(() => {
    const raw = morphoOverviewRead.data?.[0]?.result as `0x${string}`[] | undefined;
    return raw ? [...raw] : [];
  }, [morphoOverviewRead.data]);

  // Merge the assets of interest: registered ones plus options.aaveAsset
  const allAaveAssets = useMemo(() => {
    const set = new Set<string>(aaveDebtAssets.map((a) => a.toLowerCase()));
    if (options.aaveAsset) set.add(options.aaveAsset.toLowerCase());
    return [...set] as Address[];
  }, [aaveDebtAssets, options.aaveAsset]);

  // Merge the markets of interest: registered ones plus options.morphoMarketId
  const allMorphoMarkets = useMemo(() => {
    const set = new Set<string>(morphoMarkets.map((m) => m.toLowerCase()));
    if (options.morphoMarketId) set.add(options.morphoMarketId.toLowerCase());
    return [...set] as `0x${string}`[];
  }, [morphoMarkets, options.morphoMarketId]);

  /* ── 2. Read per-asset Aave details ────────────────────────────────────── */
  // 7 calls per Aave asset: policyOf, layer2Of, layer3Of, effectiveTrigger, needsProtection, quoteProtect, quoteFee
  const aaveDetailContracts = useMemo(() => {
    if (!aaveGuardianAddress || !user || allAaveAssets.length === 0) return [];
    return allAaveAssets.flatMap((asset) => [
      { chainId: target.chain.id, address: aaveGuardianAddress, abi: guardianAaveV4Abi, functionName: "policyOf" as const, args: [user, asset] as const },
      { chainId: target.chain.id, address: aaveGuardianAddress, abi: guardianAaveV4Abi, functionName: "layer2Of" as const, args: [user, asset] as const },
      { chainId: target.chain.id, address: aaveGuardianAddress, abi: guardianAaveV4Abi, functionName: "layer3Of" as const, args: [user, asset] as const },
      { chainId: target.chain.id, address: aaveGuardianAddress, abi: guardianAaveV4Abi, functionName: "effectiveTrigger" as const, args: [user, asset] as const },
      { chainId: target.chain.id, address: aaveGuardianAddress, abi: guardianAaveV4Abi, functionName: "needsProtection" as const, args: [user, asset] as const },
      { chainId: target.chain.id, address: aaveGuardianAddress, abi: guardianAaveV4Abi, functionName: "quoteProtect" as const, args: [user, asset] as const },
      { chainId: target.chain.id, address: aaveGuardianAddress, abi: guardianAaveV4Abi, functionName: "quoteFee" as const, args: [user, asset] as const },
    ]);
  }, [aaveGuardianAddress, user, allAaveAssets, target.chain.id]);

  const aaveDetailsRead = useReadContracts({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: aaveDetailContracts as any,
    allowFailure: true,
    query: { enabled: queryEnabled && aaveDetailContracts.length > 0, refetchInterval: REFRESH_MS },
  });

  /* ── 3. Read per-market Morpho details ─────────────────────────────────── */
  // 7 calls per Morpho market: policyOf, layer2Of, healthFactor, effectiveTrigger, needsProtection, quoteProtect, quoteFee
  const morphoDetailContracts = useMemo(() => {
    if (!morphoGuardianAddress || !user || allMorphoMarkets.length === 0) return [];
    return allMorphoMarkets.flatMap((market) => [
      { chainId: target.chain.id, address: morphoGuardianAddress, abi: guardianMorphoAbi, functionName: "policyOf" as const, args: [user, market] as const },
      { chainId: target.chain.id, address: morphoGuardianAddress, abi: guardianMorphoAbi, functionName: "layer2Of" as const, args: [user, market] as const },
      { chainId: target.chain.id, address: morphoGuardianAddress, abi: guardianMorphoAbi, functionName: "healthFactor" as const, args: [user, market] as const },
      { chainId: target.chain.id, address: morphoGuardianAddress, abi: guardianMorphoAbi, functionName: "effectiveTrigger" as const, args: [user, market] as const },
      { chainId: target.chain.id, address: morphoGuardianAddress, abi: guardianMorphoAbi, functionName: "needsProtection" as const, args: [user, market] as const },
      { chainId: target.chain.id, address: morphoGuardianAddress, abi: guardianMorphoAbi, functionName: "quoteProtect" as const, args: [user, market] as const },
      { chainId: target.chain.id, address: morphoGuardianAddress, abi: guardianMorphoAbi, functionName: "quoteFee" as const, args: [user, market] as const },
    ]);
  }, [morphoGuardianAddress, user, allMorphoMarkets, target.chain.id]);

  const morphoDetailsRead = useReadContracts({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: morphoDetailContracts as any,
    allowFailure: true,
    query: { enabled: queryEnabled && morphoDetailContracts.length > 0, refetchInterval: REFRESH_MS },
  });

  /* ── 4. Read DynamicTriggerSet events ──────────────────────────────────── */
  const [dynamicTriggers, setDynamicTriggers] = useState<Map<string, DynamicTriggerState>>(new Map());

  const fetchDynamicTriggers = useCallback(async () => {
    if (!publicClient || !user) return;
    const now = Math.floor(Date.now() / 1000);
    const map = new Map<string, DynamicTriggerState>();

    try {
      if (aaveGuardianAddress) {
        const logs = await publicClient.getContractEvents({
          address: aaveGuardianAddress,
          abi: guardianAaveV4Abi,
          eventName: "DynamicTriggerSet",
          args: { user },
          fromBlock: 0n,
        });

        for (const log of logs) {
          const debtAsset = (log.args as { debtAsset?: Address }).debtAsset?.toLowerCase();
          const validUntil = Number((log.args as { validUntil?: bigint }).validUntil ?? 0n);
          const active = validUntil > now;
          if (debtAsset) {
            map.set(`aave-v3:${debtAsset}`, {
              active,
              dynamicTriggerHf: wadToNumber((log.args as { triggerHF?: bigint }).triggerHF ?? 0n),
              validUntil,
              riskAgent: (log.args as { agent?: Address }).agent ?? ZERO_ADDRESS,
              remainingSeconds: Math.max(0, validUntil - now),
            });
          }
        }
      }

      if (morphoGuardianAddress) {
        const logs = await publicClient.getContractEvents({
          address: morphoGuardianAddress,
          abi: guardianMorphoAbi,
          eventName: "DynamicTriggerSet",
          args: { user },
          fromBlock: 0n,
        });

        for (const log of logs) {
          const marketId = (log.args as { marketId?: `0x${string}` }).marketId?.toLowerCase();
          const validUntil = Number((log.args as { validUntil?: bigint }).validUntil ?? 0n);
          const active = validUntil > now;
          if (marketId) {
            map.set(`morpho-blue:${marketId}`, {
              active,
              dynamicTriggerHf: wadToNumber((log.args as { triggerHF?: bigint }).triggerHF ?? 0n),
              validUntil,
              riskAgent: (log.args as { agent?: Address }).agent ?? ZERO_ADDRESS,
              remainingSeconds: Math.max(0, validUntil - now),
            });
          }
        }
      }

      setDynamicTriggers(map);
    } catch {
      // Ignore RPC log fetch errors gracefully
    }
  }, [publicClient, user, aaveGuardianAddress, morphoGuardianAddress]);

  useEffect(() => {
    if (queryEnabled) {
      fetchDynamicTriggers();
      const interval = setInterval(fetchDynamicTriggers, REFRESH_MS);
      return () => clearInterval(interval);
    }
  }, [queryEnabled, fetchDynamicTriggers]);

  /* ── Map parsed protected positions ───────────────────────────────────── */
  const aavePoliciesMap = useMemo(() => {
    const map = new Map<string, LivePolicyV4>();
    if (!aaveDetailsRead.data) return map;

    allAaveAssets.forEach((asset, idx) => {
      const offset = idx * 7;
      const rawPolicy = aaveDetailsRead.data?.[offset]?.result as readonly [boolean, bigint, bigint, bigint] | undefined;
      if (rawPolicy) {
        map.set(asset.toLowerCase(), {
          enabled: rawPolicy[0],
          triggerHf: wadToNumber(rawPolicy[1]),
          targetHf: wadToNumber(rawPolicy[2]),
          maxRepayPerAction: rawPolicy[3],
        });
      }
    });
    return map;
  }, [aaveDetailsRead.data, allAaveAssets]);

  const morphoPoliciesMap = useMemo(() => {
    const map = new Map<string, LivePolicyV4>();
    if (!morphoDetailsRead.data) return map;

    allMorphoMarkets.forEach((market, idx) => {
      const offset = idx * 7;
      const rawPolicy = morphoDetailsRead.data?.[offset]?.result as readonly [boolean, bigint, bigint, bigint] | undefined;
      if (rawPolicy) {
        map.set(market.toLowerCase(), {
          enabled: rawPolicy[0],
          triggerHf: wadToNumber(rawPolicy[1]),
          targetHf: wadToNumber(rawPolicy[2]),
          maxRepayPerAction: rawPolicy[3],
        });
      }
    });
    return map;
  }, [morphoDetailsRead.data, allMorphoMarkets]);

  const protectedPositions: ProtectedPositionV4[] = useMemo(() => {
    const list: ProtectedPositionV4[] = [];

    if (aaveGuardianAddress) {
      allAaveAssets.forEach((asset, idx) => {
        const offset = idx * 7;
        const policy = aavePoliciesMap.get(asset.toLowerCase());
        if (!policy || !policy.enabled) return;

        const rawL2 = aaveDetailsRead.data?.[offset + 1]?.result as readonly [number, Address, bigint] | undefined;
        const rawL3 = aaveDetailsRead.data?.[offset + 2]?.result as readonly [boolean, Address, bigint, number] | undefined;
        const rawEffTrigger = aaveDetailsRead.data?.[offset + 3]?.result as bigint | undefined;
        const rawNeedsProt = aaveDetailsRead.data?.[offset + 4]?.result as boolean | undefined;
        const rawQuoteFee = aaveDetailsRead.data?.[offset + 6]?.result as readonly [boolean, bigint] | undefined;

        const layer2Aave: LiveLayer2AaveV4 | null = rawL2
          ? { kind: Number(rawL2[0]), source: rawL2[1], maxAssetsPerAction: rawL2[2] }
          : null;
        const layer3Aave: LiveLayer3AaveV4 | null = rawL3
          ? { enabled: rawL3[0], collateralAsset: rawL3[1], maxCollateralPerAction: rawL3[2], maxSlippageBps: Number(rawL3[3]) }
          : null;
        const feeQuote: LiveQuoteFeeV4 | null = rawQuoteFee
          ? { eligible: rawQuoteFee[0], fee: rawQuoteFee[1] }
          : null;

        const posKey = formatPositionKeyAave({ chainId: target.chain.id, guardian: aaveGuardianAddress, debtAsset: asset });
        const dynamicTrigger = dynamicTriggers.get(`aave-v3:${asset.toLowerCase()}`) ?? null;
        const savedBand = getSavedTriggerBand(posKey);

        list.push({
          protocol: "aave-v3",
          positionKey: posKey,
          chainId: target.chain.id,
          guardianAddress: aaveGuardianAddress,
          keyIdentifier: asset,
          policy,
          layer2Aave,
          layer3Aave,
          feeQuote,
          effectiveTrigger: rawEffTrigger ? wadToNumber(rawEffTrigger) : policy.triggerHf,
          needsProtection: rawNeedsProt ?? false,
          dynamicTrigger,
          savedBand,
        });
      });
    }

    if (morphoGuardianAddress) {
      allMorphoMarkets.forEach((market, idx) => {
        const offset = idx * 7;
        const policy = morphoPoliciesMap.get(market.toLowerCase());
        if (!policy || !policy.enabled) return;

        const rawL2 = morphoDetailsRead.data?.[offset + 1]?.result as readonly [Address, bigint] | undefined;
        const rawEffTrigger = morphoDetailsRead.data?.[offset + 3]?.result as bigint | undefined;
        const rawNeedsProt = morphoDetailsRead.data?.[offset + 4]?.result as boolean | undefined;
        const rawQuoteFee = morphoDetailsRead.data?.[offset + 6]?.result as readonly [boolean, bigint] | undefined;

        const layer2Morpho: LiveLayer2MorphoV4 | null = rawL2
          ? { vault: rawL2[0], maxAssetsPerAction: rawL2[1] }
          : null;
        const feeQuote: LiveQuoteFeeV4 | null = rawQuoteFee
          ? { eligible: rawQuoteFee[0], fee: rawQuoteFee[1] }
          : null;

        const posKey = formatPositionKeyMorpho({ chainId: target.chain.id, guardian: morphoGuardianAddress, marketId: market });
        const dynamicTrigger = dynamicTriggers.get(`morpho-blue:${market.toLowerCase()}`) ?? null;
        const savedBand = getSavedTriggerBand(posKey);

        list.push({
          protocol: "morpho-blue",
          positionKey: posKey,
          chainId: target.chain.id,
          guardianAddress: morphoGuardianAddress,
          keyIdentifier: market,
          policy,
          layer2Morpho,
          feeQuote,
          effectiveTrigger: rawEffTrigger ? wadToNumber(rawEffTrigger) : policy.triggerHf,
          needsProtection: rawNeedsProt ?? false,
          dynamicTrigger,
          savedBand,
        });
      });
    }

    return list;
  }, [
    aaveGuardianAddress,
    morphoGuardianAddress,
    allAaveAssets,
    allMorphoMarkets,
    aavePoliciesMap,
    morphoPoliciesMap,
    aaveDetailsRead.data,
    morphoDetailsRead.data,
    dynamicTriggers,
    target.chain.id,
  ]);

  /* ── Writes ────────────────────────────────────────────────────────────── */
  const refetch = useCallback(async () => {
    await Promise.all([
      aaveOverviewRead.refetch(),
      morphoOverviewRead.refetch(),
      aaveDetailsRead.refetch(),
      morphoDetailsRead.refetch(),
      fetchDynamicTriggers(),
    ]);
  }, [aaveOverviewRead, morphoOverviewRead, aaveDetailsRead, morphoDetailsRead, fetchDynamicTriggers]);

  const wrongChain = chainId !== target.chain.id;

  const send = useCallback(
    async (step: TxStepV4, request: Parameters<typeof writeContract>[0]) => {
      setTx({ step, last: step, hash: null, error: null });
      try {
        if (wrongChain) await switchChain({ chainId: target.chain.id });
        const hash = await writeContract(request);
        setTx({ step, last: step, hash, error: null });
        await publicClient!.waitForTransactionReceipt({ hash });
        await refetch();
        setTx({ step: null, last: step, hash, error: null });
        return true;
      } catch (err) {
        setTx((prev) => ({ step: null, last: step, hash: prev.hash, error: errorMessage(err) }));
        return false;
      }
    },
    [wrongChain, switchChain, writeContract, publicClient, refetch, target.chain.id]
  );

  /* Aave V4 Setters */
  const setAavePolicy = useCallback(
    (debtAsset: Address, triggerHf: number, targetHf: number, maxRepayPerAction: bigint) => {
      if (!aaveGuardianAddress) throw new Error("Aave Guardian v4 not deployed on this chain");
      return send("setPolicy", {
        chainId: target.chain.id,
        address: aaveGuardianAddress,
        abi: guardianAaveV4Abi,
        functionName: "setPolicy",
        args: [debtAsset, hfToWad(triggerHf), hfToWad(targetHf), maxRepayPerAction],
      });
    },
    [send, aaveGuardianAddress, target.chain.id]
  );

  const disableAavePolicy = useCallback(
    (debtAsset: Address) => {
      if (!aaveGuardianAddress) throw new Error("Aave Guardian v4 not deployed on this chain");
      return send("disable", {
        chainId: target.chain.id,
        address: aaveGuardianAddress,
        abi: guardianAaveV4Abi,
        functionName: "disablePolicy",
        args: [debtAsset],
      });
    },
    [send, aaveGuardianAddress, target.chain.id]
  );

  const setAaveLayer2 = useCallback(
    (debtAsset: Address, kind: number, source: Address, maxAssetsPerAction: bigint) => {
      if (!aaveGuardianAddress) throw new Error("Aave Guardian v4 not deployed on this chain");
      return send("setLayer2", {
        chainId: target.chain.id,
        address: aaveGuardianAddress,
        abi: guardianAaveV4Abi,
        functionName: "setLayer2",
        args: [debtAsset, kind, source, maxAssetsPerAction],
      });
    },
    [send, aaveGuardianAddress, target.chain.id]
  );

  const setAaveLayer3 = useCallback(
    (debtAsset: Address, enabled: boolean, collateralAsset: Address, maxCollateralPerAction: bigint, maxSlippageBps: number) => {
      if (!aaveGuardianAddress) throw new Error("Aave Guardian v4 not deployed on this chain");
      return send("setLayer3", {
        chainId: target.chain.id,
        address: aaveGuardianAddress,
        abi: guardianAaveV4Abi,
        functionName: "setLayer3",
        args: [debtAsset, enabled, collateralAsset, maxCollateralPerAction, maxSlippageBps],
      });
    },
    [send, aaveGuardianAddress, target.chain.id]
  );

  const setAaveTriggerBand = useCallback(
    async (debtAsset: Address, minTriggerHf: number, maxTriggerHf: number, riskAgent: Address) => {
      if (!aaveGuardianAddress) throw new Error("Aave Guardian v4 not deployed on this chain");
      const ok = await send("setTriggerBand", {
        chainId: target.chain.id,
        address: aaveGuardianAddress,
        abi: guardianAaveV4Abi,
        functionName: "setTriggerBand",
        args: [debtAsset, hfToWad(minTriggerHf), hfToWad(maxTriggerHf), riskAgent],
      });
      if (ok) {
        const key = formatPositionKeyAave({
          chainId: target.chain.id,
          guardian: aaveGuardianAddress,
          debtAsset,
        });
        if (riskAgent.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
          clearSavedTriggerBand(key);
        } else {
          saveTriggerBand(key, { minTriggerHf, maxTriggerHf, riskAgent, enabled: true });
        }
      }
      return ok;
    },
    [send, aaveGuardianAddress, target.chain.id]
  );

  const setDebtPriority = useCallback(
    (debtAssets: Address[]) => {
      if (!aaveGuardianAddress) throw new Error("Aave Guardian v4 not deployed on this chain");
      return send("setDebtPriority", {
        chainId: target.chain.id,
        address: aaveGuardianAddress,
        abi: guardianAaveV4Abi,
        functionName: "setDebtPriority",
        args: [debtAssets],
      });
    },
    [send, aaveGuardianAddress, target.chain.id]
  );

  const protectAave = useCallback(
    (debtAsset: Address) => {
      if (!aaveGuardianAddress || !user) throw new Error("Aave Guardian v4 not available");
      return send("protect", {
        chainId: target.chain.id,
        address: aaveGuardianAddress,
        abi: guardianAaveV4Abi,
        functionName: "protect",
        args: [user, debtAsset],
      });
    },
    [send, aaveGuardianAddress, user, target.chain.id]
  );

  /* Morpho V4 Setters */
  const setMorphoPolicy = useCallback(
    (marketId: `0x${string}`, triggerHf: number, targetHf: number, maxRepayPerAction: bigint) => {
      if (!morphoGuardianAddress) throw new Error("Morpho Guardian v4 not deployed on this chain");
      return send("setPolicy", {
        chainId: target.chain.id,
        address: morphoGuardianAddress,
        abi: guardianMorphoAbi,
        functionName: "setPolicy",
        args: [marketId, hfToWad(triggerHf), hfToWad(targetHf), maxRepayPerAction],
      });
    },
    [send, morphoGuardianAddress, target.chain.id]
  );

  const disableMorphoPolicy = useCallback(
    (marketId: `0x${string}`) => {
      if (!morphoGuardianAddress) throw new Error("Morpho Guardian v4 not deployed on this chain");
      return send("disable", {
        chainId: target.chain.id,
        address: morphoGuardianAddress,
        abi: guardianMorphoAbi,
        functionName: "disablePolicy",
        args: [marketId],
      });
    },
    [send, morphoGuardianAddress, target.chain.id]
  );

  const setMorphoLayer2 = useCallback(
    (marketId: `0x${string}`, vault: Address, maxAssetsPerAction: bigint) => {
      if (!morphoGuardianAddress) throw new Error("Morpho Guardian v4 not deployed on this chain");
      return send("setLayer2", {
        chainId: target.chain.id,
        address: morphoGuardianAddress,
        abi: guardianMorphoAbi,
        functionName: "setLayer2",
        args: [marketId, vault, maxAssetsPerAction],
      });
    },
    [send, morphoGuardianAddress, target.chain.id]
  );

  const setMorphoTriggerBand = useCallback(
    async (marketId: `0x${string}`, minTriggerHf: number, maxTriggerHf: number, riskAgent: Address) => {
      if (!morphoGuardianAddress) throw new Error("Morpho Guardian v4 not deployed on this chain");
      const ok = await send("setTriggerBand", {
        chainId: target.chain.id,
        address: morphoGuardianAddress,
        abi: guardianMorphoAbi,
        functionName: "setTriggerBand",
        args: [marketId, hfToWad(minTriggerHf), hfToWad(maxTriggerHf), riskAgent],
      });
      if (ok) {
        const key = formatPositionKeyMorpho({
          chainId: target.chain.id,
          guardian: morphoGuardianAddress,
          marketId,
        });
        if (riskAgent.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
          clearSavedTriggerBand(key);
        } else {
          saveTriggerBand(key, { minTriggerHf, maxTriggerHf, riskAgent, enabled: true });
        }
      }
      return ok;
    },
    [send, morphoGuardianAddress, target.chain.id]
  );

  const protectMorpho = useCallback(
    (marketId: `0x${string}`) => {
      if (!morphoGuardianAddress || !user) throw new Error("Morpho Guardian v4 not available");
      return send("protect", {
        chainId: target.chain.id,
        address: morphoGuardianAddress,
        abi: guardianMorphoAbi,
        functionName: "protect",
        args: [user, marketId],
      });
    },
    [send, morphoGuardianAddress, user, target.chain.id]
  );

  /* Generic Token Approval & Revocation */
  const approve = useCallback(
    (tokenAddress: Address, spender: Address, amount: bigint) =>
      send("approve", {
        chainId: target.chain.id,
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, amount],
      }),
    [send, target.chain.id]
  );

  const revoke = useCallback(
    (tokenAddress: Address, spender: Address) =>
      send("revoke", {
        chainId: target.chain.id,
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, 0n],
      }),
    [send, target.chain.id]
  );

  return {
    user,
    available,
    aaveGuardianAddress,
    morphoGuardianAddress,
    aaveDebtAssets,
    morphoMarkets,
    aavePolicies: aavePoliciesMap,
    morphoPolicies: morphoPoliciesMap,
    protectedPositions,
    isLoading: aaveOverviewRead.isLoading || morphoOverviewRead.isLoading,
    tx,
    actions: {
      setAavePolicy,
      disableAavePolicy,
      setAaveLayer2,
      setAaveLayer3,
      setAaveTriggerBand,
      setDebtPriority,
      protectAave,
      setMorphoPolicy,
      disableMorphoPolicy,
      setMorphoLayer2,
      setMorphoTriggerBand,
      protectMorpho,
      approve,
      revoke,
      refetch,
    },
  };
}

export type UseGuardianV4Return = ReturnType<typeof useGuardianV4>;
