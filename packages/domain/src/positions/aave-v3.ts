/**
 * Reader posisi Aave V3, baca saja (docs/specs/m1-positions-holdings-guardian-view.md §3.2).
 *
 * HF dan LT agregat berasal dari `getUserAccountData` (I5). Breakdown per reserve dan
 * nilai USD hanya untuk tampilan dan `priceAtHf`.
 */

import type { PublicClient } from "viem";
import { currentGuardian, type ChainConfig } from "../chains";
import type { Address } from "../types";
import { aaveOracleAbi, aavePoolAbi, erc20Abi } from "./abis";
import {
  multicallStrict,
  readTokenMetadata,
  toDisplayValue,
  type ContractCall,
  type PositionReaderClient,
  type ReaderCallOptions,
} from "./client";
import { makePriceAtHf, pickMainCollateral } from "./price-at-hf";
import type { AssetAmount, PositionDetail, PositionReader } from "./types";

export interface AaveV3ReaderOptions extends ReaderCallOptions {
  /** Override status `monitorOnly`; default: true bila chain tidak punya Guardian di registry. */
  monitorOnly?: boolean;
}

interface ReserveData {
  configuration: { data: bigint };
  id: number;
  aTokenAddress: Address;
  variableDebtTokenAddress: Address;
}

type AccountData = readonly [bigint, bigint, bigint, bigint, bigint, bigint];

/** LT reserve dari bit 16–31 konfigurasi Aave (bps). */
export function reserveLiquidationThresholdBps(configuration: bigint): number {
  return Number((configuration >> 16n) & 0xffffn);
}

/** Bit collateral reserve `id` di `getUserConfiguration` (bit 2·id + 1). */
export function isUsingAsCollateral(userConfig: bigint, reserveId: number): boolean {
  return ((userConfig >> (BigInt(reserveId) * 2n + 1n)) & 1n) === 1n;
}

export function hasGuardian(chain: ChainConfig): boolean {
  return Boolean(chain.guardian ?? currentGuardian(chain)?.address);
}

export function createAaveV3Reader(
  client: PublicClient | PositionReaderClient,
  chain: ChainConfig,
  opts: AaveV3ReaderOptions = {}
): PositionReader {
  const pool = chain.aave?.pool;
  const oracle = chain.aave?.oracle;
  const monitorOnly = opts.monitorOnly ?? !hasGuardian(chain);

  async function read(user: Address): Promise<PositionDetail[]> {
    if (!pool || !oracle) return [];

    const reserves = (await client.readContract({
      address: pool,
      abi: aavePoolAbi,
      functionName: "getReservesList",
    })) as readonly Address[];
    if (reserves.length === 0) return [];

    const head: ContractCall[] = [
      { address: pool, abi: aavePoolAbi, functionName: "getUserAccountData", args: [user] },
      { address: pool, abi: aavePoolAbi, functionName: "getUserConfiguration", args: [user] },
      { address: pool, abi: aavePoolAbi, functionName: "getUserEMode", args: [user] },
      { address: oracle, abi: aaveOracleAbi, functionName: "BASE_CURRENCY_UNIT" },
      { address: oracle, abi: aaveOracleAbi, functionName: "getAssetsPrices", args: [reserves] },
      ...reserves.map(
        (asset): ContractCall => ({ address: pool, abi: aavePoolAbi, functionName: "getReserveData", args: [asset] })
      ),
    ];
    const headRes = await multicallStrict(client, head, opts);
    const account = headRes[0] as AccountData;
    const userConfig = (headRes[1] as { data: bigint }).data;
    const eMode = headRes[2] as bigint;
    const baseUnit = headRes[3] as bigint;
    const prices = headRes[4] as readonly bigint[];
    const reserveData = headRes.slice(5) as ReserveData[];

    const balances = await multicallStrict(
      client,
      reserveData.flatMap((r): ContractCall[] => [
        { address: r.aTokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [user] },
        { address: r.variableDebtTokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [user] },
      ]),
      opts
    );

    const held = reserves
      .map((asset, i) => ({
        asset,
        data: reserveData[i]!,
        price: prices[i] ?? 0n,
        supplied: balances[i * 2] as bigint,
        borrowed: balances[i * 2 + 1] as bigint,
      }))
      .filter((r) => r.supplied > 0n || r.borrowed > 0n);
    if (held.length === 0) return [];

    const meta = await readTokenMetadata(client, chain.chainId, held.map((r) => r.asset), opts);
    const [totalCollateralBase, totalDebtBase, , currentLtBps, , healthFactor] = account;
    const base = Number(baseUnit) || 1e8;
    const aggregateLtBps = Number(currentLtBps);

    const collateral: AssetAmount[] = [];
    const debt: AssetAmount[] = [];
    for (const r of held) {
      const m = meta.get(r.asset.toLowerCase())!;
      const pricePerToken = Number(r.price) / base;
      const asset = { symbol: m.symbol, address: r.asset, decimals: m.decimals };
      if (r.supplied > 0n && isUsingAsCollateral(userConfig, r.data.id)) {
        collateral.push({
          ...asset,
          amount: r.supplied,
          valueUsd: toDisplayValue(r.supplied, m.decimals, pricePerToken),
          // E-mode mengganti LT per aset; tanpa membaca kategori, pakai LT agregat akun.
          liquidationThresholdBps:
            eMode === 0n ? reserveLiquidationThresholdBps(r.data.configuration.data) : aggregateLtBps,
        });
      }
      if (r.borrowed > 0n) {
        debt.push({
          ...asset,
          amount: r.borrowed,
          valueUsd: toDisplayValue(r.borrowed, m.decimals, pricePerToken),
        });
      }
    }

    const mainCollateral = pickMainCollateral(collateral);
    const debtUsd = debt.reduce((sum, d) => sum + d.valueUsd, 0);
    const toE8 = (v: bigint) => (baseUnit === 100_000_000n ? v : (v * 100_000_000n) / (baseUnit || 1n));
    const userKey = user.toLowerCase() as Address;

    return [
      {
        protocol: "aave-v3",
        chainId: chain.chainId,
        user,
        healthFactor,
        liquidationThreshold: currentLtBps,
        collateralValueUsd: toE8(totalCollateralBase),
        debtValueUsd: toE8(totalDebtBase),
        oracleSource: oracle,
        id: `aave-v3:${chain.chainId}:pool:${userKey}`,
        collateral,
        debt,
        liquidationThresholdBps: aggregateLtBps,
        priceAtHf: makePriceAtHf(collateral, debtUsd, aggregateLtBps, mainCollateral),
        mainCollateral,
        monitorOnly,
      },
    ];
  }

  return { protocol: "aave-v3", chainId: chain.chainId, read };
}
