"use client";

import { useMemo } from "react";
import { erc20Abi, type Address } from "viem";
import { useAccount, usePublicClient, useReadContracts } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { CHAINS, ARBITRUM_SEPOLIA, ARBITRUM_ONE } from "@tahansoe/domain";
import { aaveOracleAbi } from "@/lib/contracts";
import { useLiveTarget } from "@/lib/live-target";
import { useGuardian } from "@/hooks/useGuardian";
import { getGuardianV4Address } from "@/lib/guardian-v4";
import {
  type HoldingRow,
  buildHoldingRow,
  calculateL1CapacityUsd,
  calculateTokenValueUsd,
} from "@/lib/holdings";

const STALE_TIME_MS = 30_000;

export interface TokenMeta {
  symbol: string;
  address: Address;
  decimals: number;
}

const DEFAULT_DECIMALS: Record<string, number> = {
  USDC: 6,
  "USDC.e": 6,
  USDT: 6,
  DAI: 18,
  GHO: 18,
  WETH: 18,
};

export function useHoldings(): {
  items: HoldingRow[];
  l1CapacityUsd: number | null;
  isLoading: boolean;
  error: unknown;
} {
  const { address: user } = useAccount();
  const target = useLiveTarget();
  const { chain, oracle, guardian, weth, debtAssets, ready } = target;
  const publicClient = usePublicClient({ chainId: chain.id });
  const { policy, isLoading: isGuardianLoading, readError: guardianError } = useGuardian();

  const aaveV4Address = useMemo(
    () =>
      getGuardianV4Address({
        chainId: chain.id,
        protocol: "aave-v3",
        isSimulation: target.isSimulation,
      }),
    [chain.id, target.isSimulation]
  );
  const activeGuardianAddress = aaveV4Address ?? guardian.address;

  // Active chain token list from registry, plus any active debt assets from target
  const tokenList: TokenMeta[] = useMemo(() => {
    const chainConfig =
      CHAINS[chain.id] ?? (target.isSimulation ? ARBITRUM_ONE : ARBITRUM_SEPOLIA);
    const registryTokens = chainConfig?.tokens ?? {};

    const list: TokenMeta[] = Object.entries(registryTokens).map(([sym, addr]) => {
      // If live-target specifies an address for this debt asset (e.g. sim fork deployment), use it
      const override = debtAssets.find((d) => d.symbol.toLowerCase() === sym.toLowerCase());
      return {
        symbol: sym,
        address: (override?.address ?? addr) as Address,
        decimals: override?.decimals ?? DEFAULT_DECIMALS[sym] ?? 18,
      };
    });

    // Also include any debt assets from target not already in registry list
    for (const d of debtAssets) {
      if (!list.some((item) => item.address.toLowerCase() === d.address.toLowerCase())) {
        list.push({
          symbol: d.symbol,
          address: d.address,
          decimals: d.decimals,
        });
      }
    }

    return list;
  }, [chain.id, target.isSimulation, debtAssets]);

  // Multicall queries for ERC20s and AaveOracle prices
  const contracts = useMemo(() => {
    if (!user || !ready) return [];

    const calls = [];
    for (const token of tokenList) {
      calls.push(
        {
          chainId: chain.id,
          address: token.address,
          abi: erc20Abi,
          functionName: "balanceOf" as const,
          args: [user] as const,
        },
        {
          chainId: chain.id,
          address: token.address,
          abi: erc20Abi,
          functionName: "allowance" as const,
          args: [user, activeGuardianAddress] as const,
        },
        {
          chainId: chain.id,
          address: token.address,
          abi: erc20Abi,
          functionName: "decimals" as const,
        },
        {
          chainId: chain.id,
          address: oracle,
          abi: aaveOracleAbi,
          functionName: "getAssetPrice" as const,
          args: [token.address] as const,
        }
      );
    }

    // Also query WETH price from AaveOracle to price native ETH
    calls.push({
      chainId: chain.id,
      address: oracle,
      abi: aaveOracleAbi,
      functionName: "getAssetPrice" as const,
      args: [weth] as const,
    });

    return calls;
  }, [user, ready, tokenList, chain.id, activeGuardianAddress, oracle, weth]);

  const enabled = Boolean(user && ready && contracts.length > 0);

  const {
    data: multicallData,
    isLoading: isMulticallLoading,
    error: multicallError,
  } = useReadContracts({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: contracts as any,
    allowFailure: true,
    query: {
      enabled,
      staleTime: STALE_TIME_MS,
    },
  });

  // Query native ETH balance using publicClient
  const {
    data: nativeEthBalance,
    isLoading: isEthLoading,
    error: ethError,
  } = useQuery({
    queryKey: ["nativeEthBalance", chain.id, user],
    queryFn: async () => {
      if (!publicClient || !user) return 0n;
      return publicClient.getBalance({ address: user });
    },
    enabled: Boolean(publicClient && user && ready),
    staleTime: STALE_TIME_MS,
  });

  const { items, l1CapacityUsd } = useMemo(() => {
    if (!user) {
      return { items: [], l1CapacityUsd: null };
    }

    const rows: HoldingRow[] = [];
    const tokenCount = tokenList.length;

    // Price of WETH for native ETH comes from the last call in multicall
    let ethPriceBase: bigint | null = null;
    if (multicallData && multicallData.length > tokenCount * 4) {
      const wethPriceRes = multicallData[tokenCount * 4];
      if (wethPriceRes?.status === "success") {
        ethPriceBase = wethPriceRes.result as bigint;
      }
    }

    // Native ETH row
    rows.push({
      symbol: "ETH",
      address: "native",
      decimals: 18,
      balance: nativeEthBalance ?? 0n,
      valueUsd: calculateTokenValueUsd(nativeEthBalance ?? 0n, 18, ethPriceBase),
      allowanceToGuardian: null,
      usedByLayer1: false,
    });

    let policyDebtAssetPriceBase: bigint | null = null;
    let policyDebtAssetRow: HoldingRow | null = null;

    for (let i = 0; i < tokenCount; i++) {
      const token = tokenList[i];
      const baseIdx = i * 4;

      const balRes = multicallData?.[baseIdx];
      const allowRes = multicallData?.[baseIdx + 1];
      const decRes = multicallData?.[baseIdx + 2];
      const priceRes = multicallData?.[baseIdx + 3];

      const balance = balRes?.status === "success" ? (balRes.result as bigint) : 0n;
      const allowance = allowRes?.status === "success" ? (allowRes.result as bigint) : 0n;
      const decimals = decRes?.status === "success" ? Number(decRes.result) : token.decimals;
      const priceBase = priceRes?.status === "success" ? (priceRes.result as bigint) : null;

      const row = buildHoldingRow({
        symbol: token.symbol,
        address: token.address,
        decimals,
        balance,
        priceBase,
        allowanceToGuardian: allowance,
        policyDebtAsset: policy?.debtAsset,
        policyEnabled: policy?.enabled,
      });

      rows.push(row);

      if (policy?.debtAsset && token.address.toLowerCase() === policy.debtAsset.toLowerCase()) {
        policyDebtAssetPriceBase = priceBase;
        policyDebtAssetRow = row;
      }
    }

    // Calculate Layer 1 capacity
    let capUsd: number | null = null;
    if (policy && policyDebtAssetRow) {
      capUsd = calculateL1CapacityUsd({
        balance: policyDebtAssetRow.balance,
        allowance: policyDebtAssetRow.allowanceToGuardian ?? 0n,
        maxRepayPerAction: policy.maxRepayPerAction,
        decimals: policyDebtAssetRow.decimals,
        priceBase: policyDebtAssetPriceBase,
        policyEnabled: policy.enabled,
      });
    }

    return { items: rows, l1CapacityUsd: capUsd };
  }, [user, tokenList, multicallData, nativeEthBalance, policy]);

  const isLoading = (enabled && (isMulticallLoading || isEthLoading)) || isGuardianLoading;
  const error = multicallError ?? ethError ?? guardianError ?? null;

  return {
    items,
    l1CapacityUsd,
    isLoading,
    error,
  };
}
