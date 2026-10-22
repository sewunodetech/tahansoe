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
import { recommendedRepayBase, baseToToken, remainingActions, hfToWad, wadToNumber } from "@tahansoe/domain";
import {
  AAVE_ORACLE,
  AAVE_POOL,
  DEBT_ASSETS,
  GUARDIAN,
  LEGACY_GUARDIANS,
  LIVE_CHAIN,
  aaveOracleAbi,
  aavePoolAbi,
  guardianAbi,
} from "@/lib/contracts";

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

export type TxStep = "switch" | "approve" | "setPolicy" | "disable" | "revoke" | "migrate";

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
  const publicClient = usePublicClient({ chainId: LIVE_CHAIN.id });
  const { mutateAsync: writeContract } = useWriteContract();
  const { mutateAsync: switchChain } = useSwitchChain();
  const [tx, setTx] = useState<TxState>({ step: null, last: null, hash: null, error: null });

  const enabled = Boolean(user);
  const query = { enabled, refetchInterval: REFRESH_MS };

  /* ── Position + policy on the current Guardian ─────────────────────────── */
  const core = useReadContracts({
    contracts: [
      { chainId: LIVE_CHAIN.id, address: AAVE_POOL, abi: aavePoolAbi, functionName: "getUserAccountData", args: [user!] },
      { chainId: LIVE_CHAIN.id, address: GUARDIAN.address, abi: guardianAbi, functionName: "policies", args: [user!] },
      { chainId: LIVE_CHAIN.id, address: GUARDIAN.address, abi: guardianAbi, functionName: "quoteRepay", args: [user!] },
    ],
    allowFailure: false,
    query,
  });

  const policy = toPolicy(core.data?.[1]);
  const debtAsset: Address = selectedAsset ?? policy?.debtAsset ?? DEBT_ASSETS[0].address;

  /* ── Debt token: wallet balance, allowance to the Guardian, price ──────── */
  const token = useReadContracts({
    contracts: [
      { chainId: LIVE_CHAIN.id, address: debtAsset, abi: erc20Abi, functionName: "balanceOf", args: [user!] },
      { chainId: LIVE_CHAIN.id, address: debtAsset, abi: erc20Abi, functionName: "allowance", args: [user!, GUARDIAN.address] },
      { chainId: LIVE_CHAIN.id, address: debtAsset, abi: erc20Abi, functionName: "decimals" },
      { chainId: LIVE_CHAIN.id, address: debtAsset, abi: erc20Abi, functionName: "symbol" },
      { chainId: LIVE_CHAIN.id, address: AAVE_ORACLE, abi: aaveOracleAbi, functionName: "getAssetPrice", args: [debtAsset] },
    ],
    allowFailure: false,
    query,
  });

  /* ── Older Guardian versions (migration) ───────────────────────────────── */
  const legacyContracts = LEGACY_GUARDIANS.flatMap((g) => [
    { chainId: LIVE_CHAIN.id, address: g.address, abi: guardianAbi, functionName: "policies" as const, args: [user!] as const },
    ...DEBT_ASSETS.map((asset) => ({
      chainId: LIVE_CHAIN.id,
      address: asset.address,
      abi: erc20Abi,
      functionName: "allowance" as const,
      args: [user!, g.address] as const,
    })),
  ]);
  const legacy = useReadContracts({
    contracts: legacyContracts,
    allowFailure: false,
    query: { ...query, enabled: enabled && LEGACY_GUARDIANS.length > 0 },
  });

  /* ── Derived values ────────────────────────────────────────────────────── */
  const account: LiveAccount | null = useMemo(() => {
    const raw = core.data?.[0];
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

  const legacyExposure: LegacyExposure[] = useMemo(() => {
    if (!legacy.data) return [];
    const perGuardian = 1 + DEBT_ASSETS.length;
    return LEGACY_GUARDIANS.map((deployment, i) => {
      const slice = legacy.data.slice(i * perGuardian, (i + 1) * perGuardian);
      const legacyPolicy = toPolicy(slice[0] as readonly [boolean, Address, bigint, bigint, bigint]);
      const allowances = DEBT_ASSETS.map((asset, j) => ({
        asset: asset.address,
        symbol: asset.symbol,
        decimals: asset.decimals,
        amount: slice[1 + j] as bigint,
      })).filter((a) => a.amount > 0n);
      return { deployment, policy: legacyPolicy, allowances };
    }).filter((x) => x.policy?.enabled || x.allowances.length > 0);
  }, [legacy.data]);

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

  /* ── Writes ────────────────────────────────────────────────────────────── */
  const refetch = useCallback(async () => {
    await Promise.all([core.refetch(), token.refetch(), legacy.refetch()]);
  }, [core, token, legacy]);

  const wrongChain = chainId !== LIVE_CHAIN.id;

  const send = useCallback(
    async (step: TxStep, request: Parameters<typeof writeContract>[0]) => {
      setTx({ step, last: step, hash: null, error: null });
      try {
        if (wrongChain) await switchChain({ chainId: LIVE_CHAIN.id });
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
    [wrongChain, switchChain, writeContract, publicClient, refetch]
  );

  const approve = useCallback(
    (amount: bigint) =>
      send("approve", {
        chainId: LIVE_CHAIN.id,
        address: debtAsset,
        abi: erc20Abi,
        functionName: "approve",
        args: [GUARDIAN.address, amount],
      }),
    [send, debtAsset]
  );

  const setPolicy = useCallback(
    (triggerHf: number, targetHf: number, maxRepayPerAction: bigint) =>
      send("setPolicy", {
        chainId: LIVE_CHAIN.id,
        address: GUARDIAN.address,
        abi: guardianAbi,
        functionName: "setPolicy",
        args: [debtAsset, hfToWad(triggerHf), hfToWad(targetHf), maxRepayPerAction],
      }),
    [send, debtAsset]
  );

  const disablePolicy = useCallback(
    () =>
      send("disable", {
        chainId: LIVE_CHAIN.id,
        address: GUARDIAN.address,
        abi: guardianAbi,
        functionName: "disablePolicy",
      }),
    [send]
  );

  const revoke = useCallback(
    () =>
      send("revoke", {
        chainId: LIVE_CHAIN.id,
        address: debtAsset,
        abi: erc20Abi,
        functionName: "approve",
        args: [GUARDIAN.address, 0n],
      }),
    [send, debtAsset]
  );

  /** Turn off an old Guardian: disable its policy, then zero every allowance it still has. */
  const retireLegacy = useCallback(
    async (exposure: LegacyExposure) => {
      if (exposure.policy?.enabled) {
        const ok = await send("migrate", {
          chainId: LIVE_CHAIN.id,
          address: exposure.deployment.address,
          abi: guardianAbi,
          functionName: "disablePolicy",
        });
        if (!ok) return false;
      }
      for (const a of exposure.allowances) {
        const ok = await send("migrate", {
          chainId: LIVE_CHAIN.id,
          address: a.asset,
          abi: erc20Abi,
          functionName: "approve",
          args: [exposure.deployment.address, 0n],
        });
        if (!ok) return false;
      }
      return true;
    },
    [send]
  );

  const switchToLiveChain = useCallback(async () => {
    setTx({ step: "switch", last: "switch", hash: null, error: null });
    try {
      await switchChain({ chainId: LIVE_CHAIN.id });
      setTx({ step: null, last: "switch", hash: null, error: null });
    } catch (err) {
      setTx({ step: null, last: "switch", hash: null, error: errorMessage(err) });
    }
  }, [switchChain]);

  return {
    user,
    guardian: GUARDIAN,
    wrongChain,
    isLoading: core.isLoading || token.isLoading,
    readError: core.error ?? token.error ?? null,
    account,
    policy,
    token: tokenInfo,
    quoteRepay: core.data?.[2] ?? 0n,
    debtInToken,
    actionsLeft,
    recommendedMaxRepay,
    legacy: legacyExposure,
    tx,
    actions: { approve, setPolicy, disablePolicy, revoke, retireLegacy, switchToLiveChain, refetch },
  };
}

export type UseGuardianReturn = ReturnType<typeof useGuardian>;
