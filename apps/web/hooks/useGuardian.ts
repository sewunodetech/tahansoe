"use client";

/**
 * useGuardian
 *
 * Live on-chain counterpart of useProtection (M1 spec §3). Reads the connected wallet's
 * Aave V3 position and its policy on the current TahansoeGuardian, and sends the four
 * transactions the user controls: approve (bounded), setPolicy, disablePolicy, revoke.
 *
 * The contract is the source of truth; nothing here writes to the database. Older Guardian
 * versions are scanned too so the dashboard can walk the user through migrating.
 */

import { useCallback, useMemo, useState } from "react";
import { erc20Abi, type Address, type Hash } from "viem";
import { useAccount, usePublicClient, useReadContracts, useSwitchChain, useWriteContract } from "wagmi";
import type { GuardianDeployment } from "@tahansoe/domain";
import { recommendedRepayBase, baseToToken, remainingActions, hfToWad, wadToNumber, isGuardianV2 } from "@tahansoe/domain";
import { aaveOracleAbi, aavePoolAbi, guardianAbi, guardianV2Abi } from "@/lib/contracts";
import { useLiveTarget } from "@/lib/live-target";
import { isGuardianV4Available } from "@/lib/guardian-v4";
import { useSimSession } from "@/lib/sim/hooks";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const REFRESH_MS = 15_000;
/** Base units (USD, 8 decimals) of 1 dollar. */
const BASE_UNIT = 100_000_000;

export interface LivePolicy {
  enabled: boolean;
  debtAsset: Address;
  triggerHf: number;
  targetHf: number;
  maxRepayPerAction: bigint;
}

export interface LiveLayer2 {
  kind: number;
  source: Address;
  maxAssetsPerAction: bigint;
}

export interface LiveLayer3 {
  enabled: boolean;
  collateralAsset: Address;
  maxCollateralPerAction: bigint;
  maxSlippageBps: number;
}

export interface LiveTriggerBand {
  minTriggerHf: number;
  maxTriggerHf: number;
  riskAgent: Address;
  dynamicTriggerHf: number;
  validUntil: bigint;
}

export interface LiveQuoteProtect {
  l1Repay: bigint;
  l2Repay: bigint;
  l3Collateral: bigint;
  l3Repay: bigint;
  expectedHf: number;
}

export interface LiveAccount {
  collateralUsd: number;
  debtUsd: number;
  debtBase: bigint;
  /** null when the wallet has no debt (Aave reports an infinite HF). */
  hf: number | null;
  liquidationThreshold: number;
}

export interface LiveToken {
  address: Address;
  symbol: string;
  decimals: number;
  balance: bigint;
  allowance: bigint;
  priceBase: bigint;
}

export interface LegacyExposure {
  deployment: GuardianDeployment;
  policy: LivePolicy | null;
  allowances: { asset: Address; symbol: string; decimals: number; amount: bigint }[];
}

export type TxStep =
  | "switch"
  | "approve"
  | "setPolicy"
  | "disable"
  | "revoke"
  | "migrate"
  | "setLayer2"
  | "setLayer3"
  | "setTriggerBand"
  | "protect";

export interface TxState {
  /** Step in flight, null when idle. */
  step: TxStep | null;
  /** Step the hash/error below belong to, kept after it finishes. */
  last: TxStep | null;
  hash: Hash | null;
  error: string | null;
}

function toPolicy(raw: readonly [boolean, Address, bigint, bigint, bigint] | undefined): LivePolicy | null {
  if (!raw || raw[1] === ZERO_ADDRESS) return null;
  return {
    enabled: raw[0],
    debtAsset: raw[1],
    triggerHf: wadToNumber(raw[2]),
    targetHf: wadToNumber(raw[3]),
    maxRepayPerAction: raw[4],
  };
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "shortMessage" in err && typeof err.shortMessage === "string") {
    return err.shortMessage;
  }
  return err instanceof Error ? err.message.split("\n")[0] : "Transaction failed";
}

/**
 * @param selectedAsset debt asset the form is configuring; defaults to the policy's asset,
 * then to the first Aave reserve.
 */
export function useGuardian(selectedAsset?: Address) {
  const { address: user, chainId } = useAccount();
  const target = useLiveTarget();
  const { chain, pool, oracle, guardian, legacyGuardians, debtAssets } = target;
  const { data: simSession } = useSimSession(target.isSimulation);
  const publicClient = usePublicClient({ chainId: chain.id });
  const { mutateAsync: writeContract } = useWriteContract();
  const { mutateAsync: switchChain } = useSwitchChain();
  const [tx, setTx] = useState<TxState>({ step: null, last: null, hash: null, error: null });

  const isV2 = isGuardianV2(guardian);
  const enabled = Boolean(user) && target.ready;
  const query = { enabled, refetchInterval: REFRESH_MS };

  const v4Available = useMemo(
    () =>
      isGuardianV4Available({
        chainId: chain.id,
        isSimulation: target.isSimulation,
        simContracts: simSession?.contracts,
      }),
    [chain.id, target.isSimulation, simSession?.contracts]
  );

  const effectiveLegacyGuardians = useMemo(() => {
    if (!v4Available) return legacyGuardians;
    // When v4 is available on Live, classic v1–v3 deployments (including target.guardian if < v4) are migration candidates
    const all = [guardian, ...legacyGuardians].filter((g) => g.version < 4);
    const seen = new Set<string>();
    return all.filter((g) => {
      const addr = g.address.toLowerCase();
      if (seen.has(addr)) return false;
      seen.add(addr);
      return true;
    });
  }, [v4Available, guardian, legacyGuardians]);

  /* ── Position + policy on the current Guardian ─────────────────────────── */
  const v1Contracts = [
    { chainId: chain.id, address: pool, abi: aavePoolAbi, functionName: "getUserAccountData" as const, args: [user!] as const },
    { chainId: chain.id, address: guardian.address, abi: guardianAbi, functionName: "policies" as const, args: [user!] as const },
    { chainId: chain.id, address: guardian.address, abi: guardianAbi, functionName: "quoteRepay" as const, args: [user!] as const },
  ];

  const v2Contracts = [
    { chainId: chain.id, address: pool, abi: aavePoolAbi, functionName: "getUserAccountData" as const, args: [user!] as const },
    { chainId: chain.id, address: guardian.address, abi: guardianV2Abi, functionName: "policies" as const, args: [user!] as const },
    { chainId: chain.id, address: guardian.address, abi: guardianV2Abi, functionName: "layer2" as const, args: [user!] as const },
    { chainId: chain.id, address: guardian.address, abi: guardianV2Abi, functionName: "layer3" as const, args: [user!] as const },
    { chainId: chain.id, address: guardian.address, abi: guardianV2Abi, functionName: "triggerBands" as const, args: [user!] as const },
    { chainId: chain.id, address: guardian.address, abi: guardianV2Abi, functionName: "effectiveTrigger" as const, args: [user!] as const },
    { chainId: chain.id, address: guardian.address, abi: guardianV2Abi, functionName: "quoteProtect" as const, args: [user!] as const },
  ];

  const core = useReadContracts({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: (isV2 ? v2Contracts : v1Contracts) as any,
    allowFailure: false,
    query,
  });

  const policy = toPolicy(core.data?.[1] as readonly [boolean, Address, bigint, bigint, bigint] | undefined);
  const debtAsset: Address = selectedAsset ?? policy?.debtAsset ?? debtAssets[0].address;

  /* ── Debt token: wallet balance, allowance to the Guardian, price ──────── */
  const token = useReadContracts({
    contracts: [
      { chainId: chain.id, address: debtAsset, abi: erc20Abi, functionName: "balanceOf", args: [user!] },
      { chainId: chain.id, address: debtAsset, abi: erc20Abi, functionName: "allowance", args: [user!, guardian.address] },
      { chainId: chain.id, address: debtAsset, abi: erc20Abi, functionName: "decimals" },
      { chainId: chain.id, address: debtAsset, abi: erc20Abi, functionName: "symbol" },
      { chainId: chain.id, address: oracle, abi: aaveOracleAbi, functionName: "getAssetPrice", args: [debtAsset] },
    ],
    allowFailure: false,
    query,
  });

  /* ── Older Guardian versions (migration) ───────────────────────────────── */
  const legacyContracts = effectiveLegacyGuardians.flatMap((g) => [
    { chainId: chain.id, address: g.address, abi: guardianAbi, functionName: "policies" as const, args: [user!] as const },
    ...debtAssets.map((asset) => ({
      chainId: chain.id,
      address: asset.address,
      abi: erc20Abi,
      functionName: "allowance" as const,
      args: [user!, g.address] as const,
    })),
  ]);
  const legacy = useReadContracts({
    contracts: legacyContracts,
    allowFailure: false,
    query: { ...query, enabled: enabled && effectiveLegacyGuardians.length > 0 },
  });

  /* ── Derived values ────────────────────────────────────────────────────── */
  const account: LiveAccount | null = useMemo(() => {
    const raw = core.data?.[0] as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint] | undefined;
    if (!raw) return null;
    const [collateralBase, debtBase, , lt, , hf] = raw;
    return {
      collateralUsd: Number(collateralBase) / BASE_UNIT,
      debtUsd: Number(debtBase) / BASE_UNIT,
      debtBase,
      hf: debtBase === 0n ? null : wadToNumber(hf),
      liquidationThreshold: Number(lt) / 10_000,
    };
  }, [core.data]);

  const tokenInfo: LiveToken | null = useMemo(() => {
    if (!token.data) return null;
    const [balance, allowance, decimals, symbol, priceBase] = token.data;
    return { address: debtAsset, symbol, decimals, balance, allowance, priceBase };
  }, [token.data, debtAsset]);

  const layer2: LiveLayer2 | null = useMemo(() => {
    if (!isV2 || !core.data?.[2]) return null;
    const raw = core.data[2] as unknown as readonly [number, Address, bigint];
    return {
      kind: Number(raw[0]),
      source: raw[1],
      maxAssetsPerAction: raw[2],
    };
  }, [isV2, core.data]);

  const layer3: LiveLayer3 | null = useMemo(() => {
    if (!isV2 || !core.data?.[3]) return null;
    const raw = core.data[3] as unknown as readonly [boolean, Address, bigint, number];
    return {
      enabled: raw[0],
      collateralAsset: raw[1],
      maxCollateralPerAction: raw[2],
      maxSlippageBps: Number(raw[3]),
    };
  }, [isV2, core.data]);

  const triggerBand: LiveTriggerBand | null = useMemo(() => {
    if (!isV2 || !core.data?.[4]) return null;
    const raw = core.data[4] as unknown as readonly [bigint, bigint, Address, bigint, bigint | number];
    return {
      minTriggerHf: wadToNumber(raw[0]),
      maxTriggerHf: wadToNumber(raw[1]),
      riskAgent: raw[2],
      dynamicTriggerHf: wadToNumber(raw[3]),
      validUntil: BigInt(raw[4]),
    };
  }, [isV2, core.data]);

  const effectiveTrigger: number | null = useMemo(() => {
    if (!policy) return null;
    if (isV2 && core.data?.[5]) {
      const raw = core.data[5] as bigint;
      if (raw > 0n) return wadToNumber(raw);
    }
    return policy.triggerHf;
  }, [isV2, core.data, policy]);

  const quoteProtect: LiveQuoteProtect | null = useMemo(() => {
    if (!isV2 || !core.data?.[6]) return null;
    const raw = core.data[6] as unknown as readonly [bigint, bigint, bigint, bigint, bigint];
    return {
      l1Repay: raw[0],
      l2Repay: raw[1],
      l3Collateral: raw[2],
      l3Repay: raw[3],
      expectedHf: wadToNumber(raw[4]),
    };
  }, [isV2, core.data]);

  const legacyExposure: LegacyExposure[] = useMemo(() => {
    if (!legacy.data) return [];
    const perGuardian = 1 + debtAssets.length;
    return effectiveLegacyGuardians.map((deployment, i) => {
      const slice = legacy.data.slice(i * perGuardian, (i + 1) * perGuardian);
      const rawPolicy = slice[0] as readonly [boolean, Address, bigint, bigint, bigint] | undefined;
      const legacyPolicy = toPolicy(rawPolicy);
      const allowances = debtAssets.map((asset, j) => ({
        asset: asset.address,
        symbol: asset.symbol,
        decimals: asset.decimals,
        amount: (slice[1 + j] as bigint | undefined) ?? 0n,
      })).filter((a) => a.amount > 0n);
      return { deployment, policy: legacyPolicy, allowances };
    }).filter((x) => x.policy?.enabled || x.allowances.length > 0);
  }, [legacy.data, effectiveLegacyGuardians, debtAssets]);

  /** Recommended per-action cap in token units: repay needed when HF hits the trigger. */
  const recommendedMaxRepay = useCallback(
    (triggerHf: number, targetHf: number): bigint => {
      if (!account || !tokenInfo) return 0n;
      const base = recommendedRepayBase(account.debtBase, hfToWad(triggerHf), hfToWad(targetHf));
      return baseToToken(base, tokenInfo.priceBase, tokenInfo.decimals);
    },
    [account, tokenInfo]
  );

  /** Debt expressed in the selected token, for the 25/50/100% presets. */
  const debtInToken = account && tokenInfo ? baseToToken(account.debtBase, tokenInfo.priceBase, tokenInfo.decimals) : 0n;

  const actionsLeft =
    policy && tokenInfo ? remainingActions(tokenInfo.allowance, tokenInfo.balance, policy.maxRepayPerAction) : 0;

  const quoteRepayValue = !isV2 ? (core.data?.[2] as bigint | undefined ?? 0n) : 0n;

  const hasRepay = isV2
    ? Boolean(quoteProtect && (quoteProtect.l1Repay + quoteProtect.l2Repay + quoteProtect.l3Repay > 0n))
    : quoteRepayValue > 0n;

  const canProtect = Boolean(
    policy?.enabled &&
    account?.hf !== null &&
    account?.hf !== undefined &&
    effectiveTrigger !== null &&
    account.hf < effectiveTrigger &&
    hasRepay
  );

  /* ── Writes ────────────────────────────────────────────────────────────── */
  const refetch = useCallback(async () => {
    await Promise.all([core.refetch(), token.refetch(), legacy.refetch()]);
  }, [core, token, legacy]);

  const wrongChain = chainId !== chain.id;

  const send = useCallback(
    async (step: TxStep, request: Parameters<typeof writeContract>[0]) => {
      setTx({ step, last: step, hash: null, error: null });
      try {
        if (wrongChain) await switchChain({ chainId: chain.id });
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
    [wrongChain, switchChain, writeContract, publicClient, refetch, chain.id]
  );

  const approve = useCallback(
    (amount: bigint, spender?: Address, tokenAddress?: Address) =>
      send("approve", {
        chainId: chain.id,
        address: tokenAddress ?? debtAsset,
        abi: erc20Abi,
        functionName: "approve",
        args: [spender ?? guardian.address, amount],
      }),
    [send, debtAsset, chain.id, guardian.address]
  );

  const setPolicy = useCallback(
    (triggerHf: number, targetHf: number, maxRepayPerAction: bigint) =>
      send("setPolicy", {
        chainId: chain.id,
        address: guardian.address,
        abi: isV2 ? guardianV2Abi : guardianAbi,
        functionName: "setPolicy",
        args: [debtAsset, hfToWad(triggerHf), hfToWad(targetHf), maxRepayPerAction],
      }),
    [send, isV2, debtAsset, chain.id, guardian.address]
  );

  const disablePolicy = useCallback(
    () =>
      send("disable", {
        chainId: chain.id,
        address: guardian.address,
        abi: isV2 ? guardianV2Abi : guardianAbi,
        functionName: "disablePolicy",
      }),
    [send, isV2, chain.id, guardian.address]
  );

  const setLayer2 = useCallback(
    (kind: number, source: Address, maxAssetsPerAction: bigint) =>
      send("setLayer2", {
        chainId: chain.id,
        address: guardian.address,
        abi: guardianV2Abi,
        functionName: "setLayer2",
        args: [kind, source, maxAssetsPerAction],
      }),
    [send, chain.id, guardian.address]
  );

  const setLayer3 = useCallback(
    (enabled: boolean, collateralAsset: Address, maxCollateralPerAction: bigint, maxSlippageBps: number) =>
      send("setLayer3", {
        chainId: chain.id,
        address: guardian.address,
        abi: guardianV2Abi,
        functionName: "setLayer3",
        args: [enabled, collateralAsset, maxCollateralPerAction, maxSlippageBps],
      }),
    [send, chain.id, guardian.address]
  );

  const setTriggerBand = useCallback(
    (minTriggerHf: number, maxTriggerHf: number, riskAgent: Address) =>
      send("setTriggerBand", {
        chainId: chain.id,
        address: guardian.address,
        abi: guardianV2Abi,
        functionName: "setTriggerBand",
        args: [hfToWad(minTriggerHf), hfToWad(maxTriggerHf), riskAgent],
      }),
    [send, chain.id, guardian.address]
  );

  const protect = useCallback(
    () =>
      send("protect", {
        chainId: chain.id,
        address: guardian.address,
        abi: isV2 ? guardianV2Abi : guardianAbi,
        functionName: "protect",
        args: [user!],
      }),
    [send, isV2, user, chain.id, guardian.address]
  );

  const revoke = useCallback(
    () =>
      send("revoke", {
        chainId: chain.id,
        address: debtAsset,
        abi: erc20Abi,
        functionName: "approve",
        args: [guardian.address, 0n],
      }),
    [send, debtAsset, chain.id, guardian.address]
  );

  /** Turn off an old Guardian: disable its policy, then zero every allowance it still has. */
  const retireLegacy = useCallback(
    async (exposure: LegacyExposure) => {
      if (exposure.policy?.enabled) {
        const ok = await send("migrate", {
          chainId: chain.id,
          address: exposure.deployment.address,
          abi: guardianAbi,
          functionName: "disablePolicy",
        });
        if (!ok) return false;
      }
      for (const a of exposure.allowances) {
        const ok = await send("migrate", {
          chainId: chain.id,
          address: a.asset,
          abi: erc20Abi,
          functionName: "approve",
          args: [exposure.deployment.address, 0n],
        });
        if (!ok) return false;
      }
      return true;
    },
    [send, chain.id]
  );

  const switchToLiveChain = useCallback(async () => {
    setTx({ step: "switch", last: "switch", hash: null, error: null });
    try {
      await switchChain({ chainId: chain.id });
      setTx({ step: null, last: "switch", hash: null, error: null });
    } catch (err) {
      setTx({ step: null, last: "switch", hash: null, error: errorMessage(err) });
    }
  }, [switchChain, chain.id]);

  return {
    user,
    guardian,
    target,
    isV2,
    wrongChain,
    isLoading: core.isLoading || token.isLoading,
    readError: core.error ?? token.error ?? null,
    account,
    policy,
    token: tokenInfo,
    quoteRepay: quoteRepayValue,
    quoteProtect,
    effectiveTrigger,
    canProtect,
    layer2,
    layer3,
    triggerBand,
    debtInToken,
    actionsLeft,
    recommendedMaxRepay,
    legacy: legacyExposure,
    tx,
    actions: {
      approve,
      setPolicy,
      disablePolicy,
      revoke,
      setLayer2,
      setLayer3,
      setTriggerBand,
      protect,
      retireLegacy,
      switchToLiveChain,
      refetch,
    },
  };
}

export type UseGuardianReturn = ReturnType<typeof useGuardian>;
