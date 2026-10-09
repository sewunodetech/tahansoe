/**
 * Pembaca bunga & utilization reserve Aave V3 (spec m3-carry-interest-monitoring §3.2, jalur T11).
 *
 * Sumber utama ON-CHAIN (Pool Aave target, I5): `getReservesList` + `getReserveData`
 * per reserve, total utang variable dari variableDebtToken, likuiditas tersedia dari
 * saldo underlying di aToken, serta parameter kurva bunga dari interest rate strategy
 * (V2 per-reserve getter, fallback getter V1). Alamat dari @tahansoe/domain, RPC dari env.
 *
 * Fungsi murni (konversi ray, utilization, HF drift) diekspor terpisah agar teruji tanpa RPC.
 * Fetch tidak pernah melempar: reserve yang gagal dibaca dilewati dan dicatat di `warnings` (I6).
 */

import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { arbitrum } from "viem/chains";
import { ARBITRUM_ONE } from "@tahansoe/domain";

export const RAY = 10n ** 27n;
export const SECONDS_PER_YEAR = 31_536_000;

/** Rate ray Aave (per tahun, linear) → desimal, mis. 0.056 = 5,6%. */
export function rayToRate(ray: bigint): number {
  // Bagi bertahap agar presisi aman di Number.
  return Number((ray * 1_000_000n) / RAY) / 1_000_000;
}

/** APR linear → APY dengan compounding per detik (cara Aave UI menampilkan APY). */
export function aprToApy(apr: number): number {
  return Math.pow(1 + apr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1;
}

/** Utilization = utang / (utang + likuiditas tersedia). 0 bila pool kosong. */
export function utilization(totalDebt: bigint, availableLiquidity: bigint): number {
  const denom = totalDebt + availableLiquidity;
  if (denom === 0n) return 0;
  return Number((totalDebt * 1_000_000n) / denom) / 1_000_000;
}

/**
 * Laju perubahan HF per tahun (kontinu) untuk pasangan collateral→utang:
 * HF(t) = HF0 · exp((s − b) · t). Negatif = carry negatif (HF turun).
 * `supplyApr`/`borrowApr` dalam desimal per tahun (rate Aave linear ≈ laju kontinu).
 */
export function netCarry(supplyApr: number, borrowApr: number): number {
  return supplyApr - borrowApr;
}

/**
 * Hari sampai HF turun dari `hfFrom` ke `hfTo` pada carry tertentu.
 * `null` bila carry ≥ 0 (HF tidak turun karena bunga) atau input tidak valid.
 */
export function daysUntilHf(hfFrom: number, hfTo: number, carryPerYear: number): number | null {
  if (!(hfFrom > hfTo) || hfTo <= 0 || carryPerYear >= 0) return null;
  const years = Math.log(hfFrom / hfTo) / -carryPerYear;
  return years * 365;
}

/**
 * Perkiraan borrow APR bila utilization naik ke `targetUtil` (model kurva Aave dua segmen).
 * Dipakai untuk skenario "jika pool melewati kink".
 */
export function borrowAprAt(
  targetUtil: number,
  curve: { baseRate: number; slope1: number; slope2: number; optimalUtil: number },
): number {
  const { baseRate, slope1, slope2, optimalUtil } = curve;
  if (targetUtil <= optimalUtil) return baseRate + (slope1 * targetUtil) / optimalUtil;
  const excess = (targetUtil - optimalUtil) / (1 - optimalUtil);
  return baseRate + slope1 + slope2 * excess;
}

export interface ReserveRate {
  asset: string;
  address: Address;
  supplyApr: number;
  supplyApy: number;
  borrowApr: number;
  borrowApy: number;
  utilization: number;
  /** null bila strategy tidak bisa dibaca. */
  curve: { baseRate: number; slope1: number; slope2: number; optimalUtil: number } | null;
}

export interface AaveRatesResult {
  reserves: ReserveRate[];
  warnings: string[];
  sampledAt: Date;
}

const POOL_ABI = [
  {
    type: "function",
    name: "getReservesList",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "getReserveData",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "configuration", type: "tuple", components: [{ name: "data", type: "uint256" }] },
          { name: "liquidityIndex", type: "uint128" },
          { name: "currentLiquidityRate", type: "uint128" },
          { name: "variableBorrowIndex", type: "uint128" },
          { name: "currentVariableBorrowRate", type: "uint128" },
          { name: "currentStableBorrowRate", type: "uint128" },
          { name: "lastUpdateTimestamp", type: "uint40" },
          { name: "id", type: "uint16" },
          { name: "aTokenAddress", type: "address" },
          { name: "stableDebtTokenAddress", type: "address" },
          { name: "variableDebtTokenAddress", type: "address" },
          { name: "interestRateStrategyAddress", type: "address" },
          { name: "accruedToTreasury", type: "uint128" },
          { name: "unbacked", type: "uint128" },
          { name: "isolationModeTotalDebt", type: "uint128" },
        ],
      },
    ],
  },
] as const;

const ERC20_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** Strategy V2 (Aave v3.2+): getter per reserve, nilai dalam ray. */
const STRATEGY_V2_ABI = [
  "getOptimalUsageRatio",
  "getBaseVariableBorrowRate",
  "getVariableRateSlope1",
  "getVariableRateSlope2",
].map((name) => ({
  type: "function" as const,
  name,
  stateMutability: "view" as const,
  inputs: [{ name: "reserve", type: "address" as const }],
  outputs: [{ type: "uint256" as const }],
}));

/** Strategy V1 (Aave v3.0/3.1): getter tanpa argumen. */
const STRATEGY_V1_ABI = [
  "OPTIMAL_USAGE_RATIO",
  "getBaseVariableBorrowRate",
  "getVariableRateSlope1",
  "getVariableRateSlope2",
].map((name) => ({
  type: "function" as const,
  name,
  stateMutability: "view" as const,
  inputs: [],
  outputs: [{ type: "uint256" as const }],
}));

async function readCurve(
  client: PublicClient,
  strategy: Address,
  reserve: Address,
): Promise<ReserveRate["curve"]> {
  const toCurve = (vals: bigint[]) => {
    const [optimal, base, s1, s2] = vals.map(rayToRate) as [number, number, number, number];
    return { optimalUtil: optimal, baseRate: base, slope1: s1, slope2: s2 };
  };
  try {
    const vals = await Promise.all(
      STRATEGY_V2_ABI.map((fn) =>
        client.readContract({ address: strategy, abi: [fn], functionName: fn.name, args: [reserve] }) as unknown as Promise<bigint>,
      ),
    );
    return toCurve(vals);
  } catch {
    try {
      const vals = await Promise.all(
        STRATEGY_V1_ABI.map((fn) =>
          client.readContract({ address: strategy, abi: [fn], functionName: fn.name }) as unknown as Promise<bigint>,
        ),
      );
      return toCurve(vals);
    } catch {
      return null;
    }
  }
}

export interface FetchAaveRatesOptions {
  rpcUrl?: string;
  timeoutMs?: number;
  client?: PublicClient;
  now?: Date;
}

/** Baca semua reserve Aave V3 Arbitrum One. Tidak pernah melempar. */
export async function fetchAaveRates(opts: FetchAaveRatesOptions = {}): Promise<AaveRatesResult> {
  const sampledAt = opts.now ?? new Date();
  const warnings: string[] = [];
  const pool = ARBITRUM_ONE.aave?.pool as Address | undefined;
  if (!pool) return { reserves: [], warnings: ["AaveRates: pool address missing in chain registry"], sampledAt };

  const rpcUrl = opts.rpcUrl ?? (process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc");
  const client =
    opts.client ??
    (createPublicClient({ chain: arbitrum, transport: http(rpcUrl, { timeout: opts.timeoutMs ?? 15_000 }) }) as PublicClient);

  let list: readonly Address[];
  try {
    list = (await client.readContract({ address: pool, abi: POOL_ABI, functionName: "getReservesList" })) as readonly Address[];
  } catch (err) {
    return { reserves: [], warnings: [`AaveRates: getReservesList failed: ${(err as Error).message?.slice(0, 120)}`], sampledAt };
  }

  const results = await Promise.allSettled(
    list.map(async (asset): Promise<ReserveRate> => {
      const d = (await client.readContract({
        address: pool,
        abi: POOL_ABI,
        functionName: "getReserveData",
        args: [asset],
      })) as {
        currentLiquidityRate: bigint;
        currentVariableBorrowRate: bigint;
        aTokenAddress: Address;
        variableDebtTokenAddress: Address;
        interestRateStrategyAddress: Address;
      };
      const [symbol, debt, available, curve] = await Promise.all([
        client.readContract({ address: asset, abi: ERC20_ABI, functionName: "symbol" }) as Promise<string>,
        client.readContract({ address: d.variableDebtTokenAddress, abi: ERC20_ABI, functionName: "totalSupply" }) as Promise<bigint>,
        client.readContract({ address: asset, abi: ERC20_ABI, functionName: "balanceOf", args: [d.aTokenAddress] }) as Promise<bigint>,
        readCurve(client, d.interestRateStrategyAddress, asset),
      ]);
      const supplyApr = rayToRate(d.currentLiquidityRate);
      // Label dari registry bila alamat dikenal (mis. USDC.e vs USDC native, keduanya bersimbol "USDC").
      const registryLabel = Object.entries(ARBITRUM_ONE.tokens ?? {}).find(
        ([, addr]) => typeof addr === "string" && addr.toLowerCase() === asset.toLowerCase(),
      )?.[0];
      const borrowApr = rayToRate(d.currentVariableBorrowRate);
      return {
        asset: registryLabel ?? symbol,
        address: asset,
        supplyApr,
        supplyApy: aprToApy(supplyApr),
        borrowApr,
        borrowApy: aprToApy(borrowApr),
        utilization: utilization(debt, available),
        curve,
      };
    }),
  );

  const reserves: ReserveRate[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") reserves.push(r.value);
    else warnings.push(`AaveRates: reserve ${list[i]} skipped: ${String(r.reason?.message ?? r.reason).slice(0, 120)}`);
  });
  return { reserves, warnings, sampledAt };
}
