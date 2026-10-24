"use client";

import { useMemo } from "react";
import { erc20Abi, type Address } from "viem";
import { useReadContracts } from "wagmi";
import { aaveOracleAbi } from "@/lib/contracts";
import { useGuardian } from "@/hooks/useGuardian";
import { calculateTokenValueUsd } from "@/lib/holdings";
import {
  type ReserveAsset,
  type ReserveKind,
  type ReserveState,
  erc4626Abi,
  aTokenAbi,
  parseLayer2Kind,
  calculateL2CapacityUsd,
} from "@/lib/reserves";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const STALE_TIME_MS = 30_000;

export function useReserves(): ReserveState {
  const g = useGuardian();
  const { layer2, user, target, guardian, isLoading: isGuardianLoading, readError: guardianError } = g;
  const { chain, oracle, ready } = target;

  const rawKind = layer2?.kind;
  const kind: ReserveKind | null = parseLayer2Kind(rawKind);
  const source: Address | null =
    layer2?.source && layer2.source !== ZERO_ADDRESS ? layer2.source : null;
  const capPerAction: bigint | null =
    layer2 && layer2.maxAssetsPerAction > 0n ? layer2.maxAssetsPerAction : null;

  const isConfigured = Boolean(
    user && ready && kind !== null && source !== null && capPerAction !== null
  );

  /* ── Phase 1: Query source for underlying asset, user balance, and allowance ── */
  const phase1Contracts = useMemo(() => {
    if (!isConfigured || !source || !user) return [];

    if (kind === "erc4626") {
      return [
        {
          chainId: chain.id,
          address: source,
          abi: erc4626Abi,
          functionName: "asset" as const,
        },
        {
          chainId: chain.id,
          address: source,
          abi: erc4626Abi,
          functionName: "balanceOf" as const,
          args: [user] as const,
        },
        {
          chainId: chain.id,
          address: source,
          abi: erc4626Abi,
          functionName: "allowance" as const,
          args: [user, guardian.address] as const,
        },
      ];
    }

    if (kind === "atoken") {
      return [
        {
          chainId: chain.id,
          address: source,
          abi: aTokenAbi,
          functionName: "UNDERLYING_ASSET_ADDRESS" as const,
        },
        {
          chainId: chain.id,
          address: source,
          abi: aTokenAbi,
          functionName: "balanceOf" as const,
          args: [user] as const,
        },
        {
          chainId: chain.id,
          address: source,
          abi: aTokenAbi,
          functionName: "allowance" as const,
          args: [user, guardian.address] as const,
        },
      ];
    }

    return [];
  }, [isConfigured, source, user, kind, chain.id, guardian.address]);

  const {
    data: p1Data,
    isLoading: isP1Loading,
    error: p1Error,
  } = useReadContracts({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: phase1Contracts as any,
    allowFailure: true,
    query: {
      enabled: isConfigured && phase1Contracts.length > 0,
      staleTime: STALE_TIME_MS,
    },
  });

  const underlyingAddress: Address | null = useMemo(() => {
    if (p1Data?.[0]?.status === "success" && p1Data[0].result) {
      return p1Data[0].result as Address;
    }
    // Fallback: in Guardian contract, underlying asset is required to match policy.debtAsset
    if (g.policy?.debtAsset && g.policy.debtAsset !== ZERO_ADDRESS) {
      return g.policy.debtAsset;
    }
    return null;
  }, [p1Data, g.policy?.debtAsset]);

  const rawBalance: bigint = useMemo(() => {
    if (p1Data?.[1]?.status === "success") {
      return p1Data[1].result as bigint;
    }
    return 0n;
  }, [p1Data]);

  const rawAllowance: bigint = useMemo(() => {
    if (p1Data?.[2]?.status === "success") {
      return p1Data[2].result as bigint;
    }
    return 0n;
  }, [p1Data]);

  /* ── Phase 2: Convert to assets (for ERC-4626), read asset metadata & price ── */
  const phase2Contracts = useMemo(() => {
    if (!isConfigured || !source || !underlyingAddress) return [];

    const calls = [];

    if (kind === "erc4626") {
      calls.push(
        {
          chainId: chain.id,
          address: source,
          abi: erc4626Abi,
          functionName: "convertToAssets" as const,
          args: [rawBalance] as const,
        },
        {
          chainId: chain.id,
          address: source,
          abi: erc4626Abi,
          functionName: "convertToAssets" as const,
          args: [rawAllowance] as const,
        }
      );
    }

    calls.push(
      {
        chainId: chain.id,
        address: underlyingAddress,
        abi: erc20Abi,
        functionName: "decimals" as const,
      },
      {
        chainId: chain.id,
        address: underlyingAddress,
        abi: erc20Abi,
        functionName: "symbol" as const,
      },
      {
        chainId: chain.id,
        address: oracle,
        abi: aaveOracleAbi,
        functionName: "getAssetPrice" as const,
        args: [underlyingAddress] as const,
      }
    );

    return calls;
  }, [isConfigured, source, underlyingAddress, kind, chain.id, rawBalance, rawAllowance, oracle]);

  const {
    data: p2Data,
    isLoading: isP2Loading,
    error: p2Error,
  } = useReadContracts({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: phase2Contracts as any,
    allowFailure: true,
    query: {
      enabled: isConfigured && phase2Contracts.length > 0,
      staleTime: STALE_TIME_MS,
    },
  });

  const state: ReserveState = useMemo(() => {
    if (!isConfigured || !source) {
      return {
        enabled: false,
        kind: null,
        source: null,
        asset: null,
        shares: null,
        assetsValue: null,
        valueUsd: null,
        capPerAction: null,
        allowance: null,
        l2CapacityUsd: null,
        isLoading: isGuardianLoading,
        error: guardianError,
      };
    }

    let shares: bigint | null = null;
    let assetsValue: bigint | null = null;
    let allowanceAssets: bigint | null = null;
    let rawAllowanceResult: bigint | null = rawAllowance;
    let decimals = 18;
    let symbol = "ASSET";
    let priceBase: bigint | null = null;

    if (kind === "erc4626") {
      shares = rawBalance;
      // p2Data[0] is convertToAssets(shares), p2Data[1] is convertToAssets(allowance)
      const convAssetsRes = p2Data?.[0];
      const convAllowRes = p2Data?.[1];
      const decRes = p2Data?.[2];
      const symRes = p2Data?.[3];
      const priceRes = p2Data?.[4];

      assetsValue =
        convAssetsRes?.status === "success"
          ? (convAssetsRes.result as bigint)
          : rawBalance; // 1:1 fallback
      allowanceAssets =
        convAllowRes?.status === "success"
          ? (convAllowRes.result as bigint)
          : rawAllowance;
      rawAllowanceResult = rawAllowance;

      if (decRes?.status === "success") decimals = Number(decRes.result);
      if (symRes?.status === "success") symbol = symRes.result as string;
      if (priceRes?.status === "success") priceBase = priceRes.result as bigint;
    } else if (kind === "atoken") {
      shares = null;
      assetsValue = rawBalance;
      allowanceAssets = rawAllowance;
      rawAllowanceResult = rawAllowance;

      const decRes = p2Data?.[0];
      const symRes = p2Data?.[1];
      const priceRes = p2Data?.[2];

      if (decRes?.status === "success") decimals = Number(decRes.result);
      if (symRes?.status === "success") symbol = symRes.result as string;
      if (priceRes?.status === "success") priceBase = priceRes.result as bigint;
    }

    const valueUsd = calculateTokenValueUsd(assetsValue ?? 0n, decimals, priceBase);
    const l2CapacityUsd = calculateL2CapacityUsd({
      assetsValue,
      capPerAction,
      allowance: allowanceAssets,
      decimals,
      priceBase,
    });

    const assetMeta: ReserveAsset | null = underlyingAddress
      ? { symbol, address: underlyingAddress, decimals }
      : null;

    return {
      enabled: true,
      kind,
      source,
      asset: assetMeta,
      shares,
      assetsValue,
      valueUsd,
      capPerAction,
      allowance: rawAllowanceResult,
      l2CapacityUsd,
      isLoading: isGuardianLoading || isP1Loading || isP2Loading,
      error: p1Error ?? p2Error ?? null,
    };
  }, [
    isConfigured,
    source,
    kind,
    capPerAction,
    underlyingAddress,
    rawBalance,
    rawAllowance,
    p2Data,
    isGuardianLoading,
    isP1Loading,
    isP2Loading,
    guardianError,
    p1Error,
    p2Error,
  ]);

  return state;
}
