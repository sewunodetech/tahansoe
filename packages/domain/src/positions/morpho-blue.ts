/**
 * Reader posisi Morpho Blue, baca saja (docs/specs/m1-positions-holdings-guardian-view.md §3.3).
 * Semua posisi `monitorOnly: true` (proteksi Morpho baru di M5).
 *
 * Penemuan market:
 * 1. API GraphQL publik Morpho (opsional, divalidasi Zod). Hanya dipakai untuk daftar
 *    market id; angka posisi tetap dibaca on-chain (I5). Gagal → jalur 2.
 * 2. Log `SupplyCollateral` dan `Borrow` dengan topic `onBehalf = user`, dipecah per
 *    `chunkSize` block. RPC publik Arbitrum One membatasi 10.000.000 block per
 *    eth_getLogs (diuji 24 Okt 2026); default chunk 5.000.000 dan lookback 20.000.000
 *    block (~58 hari pada 250 ms/block). Saat API berhasil, log tetap dipindai untuk
 *    `recentBlocks` terakhir agar posisi baru yang belum terindeks API ikut terbaca.
 */

import type { PublicClient } from "viem";
import { z } from "zod";
import type { ChainConfig } from "../chains";
import type { Address, Hex } from "../types";
import { aaveOracleAbi, morphoBlueAbi, morphoIrmAbi, morphoOracleAbi } from "./abis";
import {
  multicallLoose,
  multicallStrict,
  readTokenMetadata,
  toDisplayValue,
  usdToE8,
  type ContractCall,
  type PositionReaderClient,
  type ReaderCallOptions,
} from "./client";
import { accrueBorrowAssets, morphoHealthFactor, toAssetsUp } from "./morpho-math";
import { makePriceAtHf } from "./price-at-hf";
import type { AssetAmount, PositionDetail, PositionReader } from "./types";

export const MORPHO_API_URL = "https://api.morpho.org/graphql";
export const MORPHO_DEFAULT_LOOKBACK_BLOCKS = 20_000_000n;
export const MORPHO_DEFAULT_CHUNK_BLOCKS = 5_000_000n;
export const MORPHO_DEFAULT_RECENT_BLOCKS = 200_000n;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface MorphoApiOptions {
  url?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface MorphoBlueReaderOptions extends ReaderCallOptions {
  /** Batas bawah absolut pemindaian log; default max(deployedBlock, latest − lookbackBlocks). */
  fromBlock?: bigint;
  lookbackBlocks?: bigint;
  chunkSize?: bigint;
  /** Jendela log yang tetap dipindai saat API berhasil. */
  recentBlocks?: bigint;
  /** `false` mematikan API; default aktif dengan `MORPHO_API_URL` (bukan untuk chain simulasi). */
  api?: false | MorphoApiOptions;
  /** Market id tambahan yang sudah diketahui pemanggil (mis. dari DB). */
  marketIds?: readonly Hex[];
  /**
   * Harga USD token pinjaman, hanya untuk tampilan. Default: oracle Aave di chain yang
   * sama bila token itu reserve Aave; selain itu null (nilai USD 0, `priceAtHf` null).
   */
  loanTokenPriceUsd?: (token: Address) => Promise<number | null>;
}

const marketIdSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const morphoApiPositionsSchema = z.object({
  data: z.object({
    marketPositions: z.object({
      items: z.array(z.object({ market: z.object({ marketId: marketIdSchema }) })),
    }),
  }),
});

const API_QUERY = `query Positions($user: String!, $chainId: Int!) {
  marketPositions(first: 100, where: { userAddress_in: [$user], chainId_in: [$chainId] }) {
    items { market { marketId } }
  }
}`;

/** Market id posisi user dari API Morpho. Melempar error bila respons tidak valid. */
export async function fetchMorphoMarketIds(
  user: Address,
  chainId: number,
  api: MorphoApiOptions = {}
): Promise<Hex[]> {
  const doFetch = api.fetch ?? globalThis.fetch;
  if (!doFetch) throw new Error("fetch is not available");
  const res = await doFetch(api.url ?? MORPHO_API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: API_QUERY, variables: { user: user.toLowerCase(), chainId } }),
    signal: AbortSignal.timeout(api.timeoutMs ?? 5_000),
  });
  if (!res.ok) throw new Error(`Morpho API HTTP ${res.status}`);
  const parsed = morphoApiPositionsSchema.parse(await res.json());
  return parsed.data.marketPositions.items.map((i) => i.market.marketId.toLowerCase() as Hex);
}

const supplyCollateralEvent = morphoBlueAbi.find(
  (x) => x.type === "event" && x.name === "SupplyCollateral"
)!;
const borrowEvent = morphoBlueAbi.find((x) => x.type === "event" && x.name === "Borrow")!;

/** Market id dari log `SupplyCollateral`/`Borrow` milik user pada [fromBlock, toBlock]. */
export async function scanMorphoMarketIds(
  client: PublicClient | PositionReaderClient,
  morpho: Address,
  user: Address,
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint = MORPHO_DEFAULT_CHUNK_BLOCKS
): Promise<Hex[]> {
  const ids = new Set<Hex>();
  const step = chunkSize > 0n ? chunkSize : MORPHO_DEFAULT_CHUNK_BLOCKS;
  for (let start = fromBlock; start <= toBlock; start += step) {
    const end = start + step - 1n < toBlock ? start + step - 1n : toBlock;
    const [supplies, borrows] = await Promise.all([
      client.getLogs({ address: morpho, event: supplyCollateralEvent, args: { onBehalf: user }, fromBlock: start, toBlock: end }),
      client.getLogs({ address: morpho, event: borrowEvent, args: { onBehalf: user }, fromBlock: start, toBlock: end }),
    ]);
    for (const log of [...supplies, ...borrows]) {
      const id = (log as { args?: { id?: Hex } }).args?.id;
      if (id) ids.add(id.toLowerCase() as Hex);
    }
  }
  return [...ids];
}

type MarketParams = readonly [Address, Address, Address, Address, bigint];
type MarketState = readonly [bigint, bigint, bigint, bigint, bigint, bigint];
type UserPosition = readonly [bigint, bigint, bigint];

export function createMorphoBlueReader(
  client: PublicClient | PositionReaderClient,
  chain: ChainConfig,
  opts: MorphoBlueReaderOptions = {}
): PositionReader {
  const morpho = chain.morpho?.blue;

  async function discoverMarkets(user: Address, latest: bigint): Promise<Hex[]> {
    const lookback = opts.lookbackBlocks ?? MORPHO_DEFAULT_LOOKBACK_BLOCKS;
    const floor = BigInt(chain.morpho?.deployedBlock ?? 0);
    let from = opts.fromBlock ?? (latest > lookback ? latest - lookback : 0n);
    if (from < floor) from = floor;

    const ids = new Set<Hex>((opts.marketIds ?? []).map((id) => id.toLowerCase() as Hex));
    if (opts.api !== false && !chain.isSimulation) {
      try {
        for (const id of await fetchMorphoMarketIds(user, chain.chainId, opts.api ?? {})) ids.add(id);
        const recent = opts.recentBlocks ?? MORPHO_DEFAULT_RECENT_BLOCKS;
        if (latest - recent > from) from = latest - recent;
      } catch {
        // API mati, lambat, atau skemanya berubah: pindai log penuh.
      }
    }
    for (const id of await scanMorphoMarketIds(client, morpho!, user, from, latest, opts.chunkSize)) ids.add(id);
    return [...ids];
  }

  async function loanPricesUsd(tokens: Address[]): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    if (opts.loanTokenPriceUsd) {
      for (const t of tokens) out.set(t.toLowerCase(), await opts.loanTokenPriceUsd(t));
      return out;
    }
    const oracle = chain.aave?.oracle;
    if (!oracle) return out;
    const res = await multicallLoose(
      client,
      [
        { address: oracle, abi: aaveOracleAbi, functionName: "BASE_CURRENCY_UNIT" },
        ...tokens.map((t): ContractCall => ({ address: oracle, abi: aaveOracleAbi, functionName: "getAssetPrice", args: [t] })),
      ],
      opts
    );
    const unit = res[0]?.status === "success" ? Number(res[0].result as bigint) : 0;
    tokens.forEach((t, i) => {
      const r = res[i + 1];
      const p = r?.status === "success" ? Number(r.result as bigint) : 0;
      out.set(t.toLowerCase(), unit > 0 && p > 0 ? p / unit : null);
    });
    return out;
  }

  async function read(user: Address): Promise<PositionDetail[]> {
    if (!morpho) return [];
    const block = await client.getBlock();
    const ids = await discoverMarkets(user, block.number);
    if (ids.length === 0) return [];

    const base = await multicallStrict(
      client,
      ids.flatMap((id): ContractCall[] => [
        { address: morpho, abi: morphoBlueAbi, functionName: "position", args: [id, user] },
        { address: morpho, abi: morphoBlueAbi, functionName: "market", args: [id] },
        { address: morpho, abi: morphoBlueAbi, functionName: "idToMarketParams", args: [id] },
      ]),
      opts
    );
    const open = ids
      .map((id, i) => ({
        id,
        position: base[i * 3] as UserPosition,
        market: base[i * 3 + 1] as MarketState,
        params: base[i * 3 + 2] as MarketParams,
      }))
      .filter((m) => m.position[1] > 0n || m.position[2] > 0n);
    if (open.length === 0) return [];

    const toParamsStruct = (p: MarketParams) => ({ loanToken: p[0], collateralToken: p[1], oracle: p[2], irm: p[3], lltv: p[4] });
    const toMarketStruct = (m: MarketState) => ({
      totalSupplyAssets: m[0], totalSupplyShares: m[1], totalBorrowAssets: m[2],
      totalBorrowShares: m[3], lastUpdate: m[4], fee: m[5],
    });
    const withIrm = open.filter((m) => m.params[3] !== ZERO_ADDRESS);
    const priced = await multicallLoose(
      client,
      [
        ...open.map((m): ContractCall => ({ address: m.params[2], abi: morphoOracleAbi, functionName: "price" })),
        ...withIrm.map((m): ContractCall => ({
          address: m.params[3],
          abi: morphoIrmAbi,
          functionName: "borrowRateView",
          args: [toParamsStruct(m.params), toMarketStruct(m.market)],
        })),
      ],
      opts
    );

    const tokens = [...new Set(open.flatMap((m) => [m.params[0], m.params[1]]))];
    const meta = await readTokenMetadata(client, chain.chainId, tokens, opts);
    const loanUsd = await loanPricesUsd([...new Set(open.map((m) => m.params[0]))]);

    const out: PositionDetail[] = [];
    open.forEach((m, i) => {
      const priceRes = priced[i];
      if (priceRes?.status !== "success") return; // tanpa harga oracle market, HF tidak bisa dihitung
      const price = priceRes.result as bigint;
      const irmIndex = withIrm.indexOf(m);
      const rateRes = irmIndex >= 0 ? priced[open.length + irmIndex] : undefined;
      // Rate IRM gagal dibaca → tanpa akrual bunga sejak lastUpdate (utang sedikit di bawah nyata).
      const rate = rateRes?.status === "success" ? (rateRes.result as bigint) : 0n;

      const [loanToken, collateralToken, oracle, , lltv] = m.params;
      const [, , totalBorrowAssets, totalBorrowShares, lastUpdate] = m.market;
      const [, borrowShares, collateralAmount] = m.position;
      const accrued = accrueBorrowAssets(totalBorrowAssets, rate, block.timestamp - lastUpdate);
      const borrowAssets = borrowShares === 0n ? 0n : toAssetsUp(borrowShares, accrued, totalBorrowShares);
      const healthFactor = morphoHealthFactor({ collateral: collateralAmount, price, lltv, borrowAssets });

      const loanMeta = meta.get(loanToken.toLowerCase())!;
      const collMeta = meta.get(collateralToken.toLowerCase())!;
      const loanPrice = loanUsd.get(loanToken.toLowerCase()) ?? null;
      const lltvBps = Number(lltv / 10n ** 14n);
      // price: unit loan per unit collateral × 1e36 → loan token per collateral token
      const collateralInLoan = Number(price) / 1e36 * 10 ** (collMeta.decimals - loanMeta.decimals);
      const collateralPriceUsd = loanPrice === null ? 0 : collateralInLoan * loanPrice;

      const collateral: AssetAmount[] =
        collateralAmount > 0n
          ? [{
              symbol: collMeta.symbol, address: collateralToken, decimals: collMeta.decimals,
              amount: collateralAmount,
              valueUsd: toDisplayValue(collateralAmount, collMeta.decimals, collateralPriceUsd),
              liquidationThresholdBps: lltvBps,
            }]
          : [];
      const debt: AssetAmount[] =
        borrowAssets > 0n
          ? [{
              symbol: loanMeta.symbol, address: loanToken, decimals: loanMeta.decimals,
              amount: borrowAssets,
              valueUsd: toDisplayValue(borrowAssets, loanMeta.decimals, loanPrice ?? 0),
            }]
          : [];
      const collateralUsd = collateral[0]?.valueUsd ?? 0;
      const debtUsd = debt[0]?.valueUsd ?? 0;
      const mainCollateral = collateral[0];

      out.push({
        protocol: "morpho-blue",
        chainId: chain.chainId,
        user,
        healthFactor,
        liquidationThreshold: BigInt(lltvBps),
        collateralValueUsd: usdToE8(collateralUsd),
        debtValueUsd: usdToE8(debtUsd),
        oracleSource: oracle,
        marketId: m.id,
        id: `morpho-blue:${chain.chainId}:${m.id}:${user.toLowerCase()}`,
        collateral,
        debt,
        liquidationThresholdBps: lltvBps,
        priceAtHf: makePriceAtHf(collateral, debtUsd, lltvBps, mainCollateral),
        mainCollateral,
        monitorOnly: true,
      });
    });
    return out;
  }

  return { protocol: "morpho-blue", chainId: chain.chainId, read };
}
