/**
 * Where usePositions gets its readers (spec m1-positions-holdings-guardian-view §3.2).
 *
 * TODO(pos-a-domain): this is a thin interim Aave V3 reader so the Positions page and the
 * Guardian view can ship before Task A. It reads only the reserves listed in the chain
 * registry (`tokens`) and folds anything else into an "Other assets" row, using
 * getUserAccountData as the source of truth for HF and totals (I5). Replace `readersFor` with
 * `createAaveV3Reader(client, chain)` and `createMorphoBlueReader(client, chain)` from
 * @tahansoe/domain once that branch is merged, and delete the interim reader below.
 */

import { erc20Abi, type PublicClient } from "viem";
import { wadToNumber, type Address, type ChainConfig } from "@tahansoe/domain";
import { aaveOracleAbi, aavePoolAbi } from "@/lib/contracts";
import { priceForHealthFactor } from "./price-at-hf";
import type { AssetAmount, PositionDetail, PositionReader } from "./types";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
/** Aave base currency: USD with 8 decimals. */
const BASE_UNIT = 1e8;
/** Totals not covered by registry tokens below this many dollars are rounding, not assets. */
const OTHER_MIN_USD = 0.5;

const userConfigurationAbi = [
  {
    type: "function",
    name: "getUserConfiguration",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "tuple", components: [{ name: "data", type: "uint256" }] }],
  },
] as const;

const tokenMeta = new Map<string, Promise<{ symbol: string; decimals: number }>>();

function metaFor(client: PublicClient, chainId: number, address: Address, fallbackSymbol: string) {
  const key = `${chainId}:${address.toLowerCase()}`;
  let hit = tokenMeta.get(key);
  if (!hit) {
    hit = Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address, abi: erc20Abi, functionName: "symbol" }).catch(() => fallbackSymbol),
    ]).then(([decimals, symbol]) => ({ decimals: Number(decimals), symbol: fallbackSymbol || symbol }));
    hit.catch(() => tokenMeta.delete(key));
    tokenMeta.set(key, hit);
  }
  return hit;
}

function usdValue(amount: bigint, decimals: number, priceBase: bigint): number {
  return (Number(amount) / 10 ** decimals) * (Number(priceBase) / BASE_UNIT);
}

/** Interim Aave V3 reader over the registry's reserves; see the TODO at the top of this file. */
export function createInterimAaveReader(client: PublicClient, chain: ChainConfig, opts: { monitorOnly: boolean }): PositionReader {
  const pool = chain.aave?.pool;
  const oracle = chain.aave?.oracle;
  return {
    protocol: "aave-v3",
    chainId: chain.chainId,
    async read(user) {
      if (!pool || !oracle) return [];
      const [account, config] = await Promise.all([
        client.readContract({ address: pool, abi: aavePoolAbi, functionName: "getUserAccountData", args: [user] }),
        client.readContract({ address: pool, abi: userConfigurationAbi, functionName: "getUserConfiguration", args: [user] }),
      ]);
      const [collateralBase, debtBase, , ltBps, , hfWad] = account;
      if (collateralBase === 0n && debtBase === 0n) return [];

      const bitmap = config.data;
      const tokens = Object.entries(chain.tokens ?? {}) as [string, Address][];
      const rows = await Promise.all(
        tokens.map(async ([symbol, asset]) => {
          const reserve = await client
            .readContract({ address: pool, abi: aavePoolAbi, functionName: "getReserveData", args: [asset] })
            .catch(() => null);
          if (!reserve || reserve.aTokenAddress === ZERO) return null;
          const id = BigInt(reserve.id);
          const usedAsCollateral = ((bitmap >> (id * 2n + 1n)) & 1n) === 1n;
          const [supplied, borrowed, priceBase, meta] = await Promise.all([
            client.readContract({ address: reserve.aTokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [user] }),
            client.readContract({ address: reserve.variableDebtTokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [user] }),
            client.readContract({ address: oracle, abi: aaveOracleAbi, functionName: "getAssetPrice", args: [asset] }),
            metaFor(client, chain.chainId, asset, symbol),
          ]);
          const base = { symbol: meta.symbol, address: asset, decimals: meta.decimals };
          return {
            collateral: usedAsCollateral && supplied > 0n ? { ...base, amount: supplied, valueUsd: usdValue(supplied, meta.decimals, priceBase) } : null,
            debt: borrowed > 0n ? { ...base, amount: borrowed, valueUsd: usdValue(borrowed, meta.decimals, priceBase) } : null,
          };
        })
      );

      const collateral: AssetAmount[] = rows.flatMap((r) => (r?.collateral ? [r.collateral] : []));
      const debt: AssetAmount[] = rows.flatMap((r) => (r?.debt ? [r.debt] : []));
      appendOther(collateral, Number(collateralBase) / BASE_UNIT);
      appendOther(debt, Number(debtBase) / BASE_UNIT);
      collateral.sort((a, b) => b.valueUsd - a.valueUsd);
      debt.sort((a, b) => b.valueUsd - a.valueUsd);

      const mainCollateral = collateral.find((a) => a.address !== ZERO);
      const lt = Number(ltBps) / 10_000;
      const detail: PositionDetail = {
        id: `aave-v3:${chain.chainId}:pool:${user}`,
        protocol: "aave-v3",
        chainId: chain.chainId,
        user,
        healthFactor: hfWad,
        liquidationThreshold: ltBps,
        collateralValueUsd: collateralBase,
        debtValueUsd: debtBase,
        oracleSource: oracle,
        collateral,
        debt,
        liquidationThresholdBps: Number(ltBps),
        mainCollateral,
        monitorOnly: opts.monitorOnly,
        priceAtHf: (hf) => (mainCollateral ? priceForHealthFactor({ collateral, debt, lt, mainCollateral, hf }) : null),
      };
      return [detail];
    },
  };
}

/** Adds the part of an aggregate total the registry tokens do not explain. */
function appendOther(list: AssetAmount[], totalUsd: number) {
  const known = list.reduce((s, a) => s + a.valueUsd, 0);
  const rest = totalUsd - known;
  if (rest > OTHER_MIN_USD) list.push({ symbol: "Other assets", address: ZERO, decimals: 0, amount: 0n, valueUsd: rest });
}

/** Health Factor as a number, null when the position has no debt. */
export function healthFactorOf(p: PositionDetail): number | null {
  return p.debtValueUsd === 0n ? null : wadToNumber(p.healthFactor);
}

export function isPlaceholderAsset(a: AssetAmount): boolean {
  return a.address === ZERO;
}

/**
 * Readers for one chain. `canProtect` is false where no Guardian is deployed, so every
 * position read there is Monitor only.
 */
export function readersFor(client: PublicClient, chain: ChainConfig, canProtect: boolean): PositionReader[] {
  // TODO(pos-a-domain): createAaveV3Reader(client, chain) and, where chain.morpho is set,
  // createMorphoBlueReader(client, chain).
  return chain.aave?.pool ? [createInterimAaveReader(client, chain, { monitorOnly: !canProtect })] : [];
}
