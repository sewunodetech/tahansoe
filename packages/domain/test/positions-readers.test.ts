import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createAaveV3Reader,
  createMorphoBlueReader,
  clearTokenMetadataCache,
  ARBITRUM_ONE,
  ARBITRUM_ONE_SIM,
  ARBITRUM_SEPOLIA,
  type Address,
  type ChainConfig,
  type Hex,
  type PositionReaderClient,
} from "../src";

type Handler = (address: Address, functionName: string, args: readonly unknown[]) => unknown;

interface LogCall {
  event: string;
  onBehalf: Address;
  fromBlock: bigint;
  toBlock: bigint;
}

/** Client tiruan: setiap panggilan baca diarahkan ke `handler`; throw = panggilan gagal. */
function fakeClient(
  handler: Handler,
  opts: { logs?: (c: LogCall) => { args: { id: Hex } }[]; block?: { number: bigint; timestamp: bigint } } = {}
) {
  const logCalls: LogCall[] = [];
  const call = (c: { address: Address; functionName: string; args?: readonly unknown[] }) =>
    handler(c.address.toLowerCase() as Address, c.functionName, c.args ?? []);
  const client = {
    async readContract(c: { address: Address; functionName: string; args?: readonly unknown[] }) {
      return call(c);
    },
    async multicall({ contracts, allowFailure }: { contracts: { address: Address; functionName: string; args?: readonly unknown[] }[]; allowFailure?: boolean }) {
      return contracts.map((c) => {
        if (allowFailure === false) return call(c);
        try {
          return { status: "success", result: call(c) };
        } catch (error) {
          return { status: "failure", error };
        }
      });
    },
    async getLogs(c: { event: { name: string }; args: { onBehalf: Address }; fromBlock: bigint; toBlock: bigint }) {
      const lc = { event: c.event.name, onBehalf: c.args.onBehalf, fromBlock: c.fromBlock, toBlock: c.toBlock };
      logCalls.push(lc);
      return opts.logs?.(lc) ?? [];
    },
    async getBlockNumber() {
      return opts.block?.number ?? 0n;
    },
    async getBlock() {
      return opts.block ?? { number: 0n, timestamp: 0n };
    },
  };
  return { client: client as unknown as PositionReaderClient, logCalls };
}

const lc = (a: string) => a.toLowerCase() as Address;
const USER: Address = "0x00000000000000000000000000000000000000Aa";
const EMPTY_USER: Address = "0x00000000000000000000000000000000000000bB";

// ---------------------------------------------------------------- Aave V3

const WETH = lc("0x1dF462e2712496373A347f8ad10802a5E95f053D");
const USDC = lc("0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d");
const WBTC = lc("0x0000000000000000000000000000000000000B7C");
const tokenOf = (n: number) => lc(`0x${n.toString(16).padStart(40, "0")}`);
const RESERVES = [
  { asset: WETH, id: 0, aToken: tokenOf(0xa0), vDebt: tokenOf(0xd0), lt: 8250n, price: 3000n * 10n ** 8n, symbol: "WETH", decimals: 18 },
  { asset: USDC, id: 1, aToken: tokenOf(0xa1), vDebt: tokenOf(0xd1), lt: 7800n, price: 10n ** 8n, symbol: "USDC", decimals: 6 },
  { asset: WBTC, id: 2, aToken: tokenOf(0xa2), vDebt: tokenOf(0xd2), lt: 7500n, price: 60_000n * 10n ** 8n, symbol: "WBTC", decimals: 8 },
];

function aaveHandler(chain: ChainConfig): Handler {
  const pool = lc(chain.aave!.pool!);
  const oracle = lc(chain.aave!.oracle!);
  // USER: 2 WETH collateral, 0.1 WBTC supplied but not collateral, 3000 USDC variable debt.
  const balances: Record<string, bigint> = {
    [RESERVES[0]!.aToken]: 2n * 10n ** 18n,
    [RESERVES[1]!.vDebt]: 3000n * 10n ** 6n,
    [RESERVES[2]!.aToken]: 10n ** 7n,
  };
  return (address, fn, args) => {
    if (address === pool) {
      const user = lc(String(args[0] ?? ""));
      switch (fn) {
        case "getReservesList":
          return RESERVES.map((r) => r.asset);
        case "getReserveData": {
          const r = RESERVES.find((x) => x.asset === lc(String(args[0])))!;
          return { configuration: { data: (r.lt << 16n) | 7500n }, id: r.id, aTokenAddress: r.aToken, variableDebtTokenAddress: r.vDebt };
        }
        case "getUserConfiguration":
          // bit1 = WETH collateral, bit2 = USDC borrowing; WBTC (bit5) not set
          return { data: user === lc(USER) ? (1n << 1n) | (1n << 2n) : 0n };
        case "getUserEMode":
          return 0n;
        case "getUserAccountData":
          return user === lc(USER)
            ? [6000n * 10n ** 8n, 3000n * 10n ** 8n, 0n, 8250n, 7500n, 165n * 10n ** 16n]
            : [0n, 0n, 0n, 0n, 0n, 2n ** 256n - 1n];
      }
    }
    if (address === oracle) {
      if (fn === "BASE_CURRENCY_UNIT") return 10n ** 8n;
      if (fn === "getAssetsPrices") return (args[0] as Address[]).map((a) => RESERVES.find((r) => r.asset === lc(a))!.price);
    }
    const r = RESERVES.find((x) => x.asset === address);
    if (r && fn === "symbol") return r.symbol;
    if (r && fn === "decimals") return r.decimals;
    if (fn === "balanceOf") return lc(String(args[0])) === lc(USER) ? (balances[address] ?? 0n) : 0n;
    throw new Error(`unexpected call ${address}.${fn}`);
  };
}

describe("createAaveV3Reader", () => {
  beforeEach(() => clearTokenMetadataCache());

  it("builds a per-reserve breakdown with protocol HF and price thresholds", async () => {
    const { client } = fakeClient(aaveHandler(ARBITRUM_SEPOLIA));
    const reader = createAaveV3Reader(client, ARBITRUM_SEPOLIA);
    assert.equal(reader.protocol, "aave-v3");
    assert.equal(reader.chainId, 421614);

    const positions = await reader.read(USER);
    assert.equal(positions.length, 1);
    const p = positions[0]!;
    assert.equal(p.id, `aave-v3:421614:pool:${lc(USER)}`);
    assert.equal(p.marketId, undefined);
    assert.equal(p.healthFactor, 165n * 10n ** 16n, "HF comes from getUserAccountData");
    assert.equal(p.liquidationThreshold, 8250n);
    assert.equal(p.liquidationThresholdBps, 8250);
    assert.equal(p.collateralValueUsd, 6000n * 10n ** 8n);
    assert.equal(p.debtValueUsd, 3000n * 10n ** 8n);
    assert.equal(p.oracleSource, ARBITRUM_SEPOLIA.aave!.oracle);
    assert.equal(p.monitorOnly, false, "Sepolia has a Guardian");

    // WBTC is supplied but not enabled as collateral → excluded
    assert.deepEqual(p.collateral.map((c) => c.symbol), ["WETH"]);
    assert.equal(p.collateral[0]!.valueUsd, 6000);
    assert.equal(p.collateral[0]!.liquidationThresholdBps, 8250);
    assert.deepEqual(p.debt.map((d) => [d.symbol, d.amount, d.valueUsd]), [["USDC", 3000n * 10n ** 6n, 3000]]);
    assert.equal(p.mainCollateral?.symbol, "WETH");

    const liq = p.priceAtHf(1)!;
    const trig = p.priceAtHf(1.3)!;
    assert.ok(Math.abs(liq - 3000 / 1.65) < 1e-6, String(liq));
    assert.ok(Math.abs(trig - 3900 / 1.65) < 1e-6, String(trig));
  });

  it("returns [] for a user with neither supply nor debt", async () => {
    const { client } = fakeClient(aaveHandler(ARBITRUM_SEPOLIA));
    assert.deepEqual(await createAaveV3Reader(client, ARBITRUM_SEPOLIA).read(EMPTY_USER), []);
  });

  it("is monitorOnly on a chain without a Guardian, overridable by option", async () => {
    const { client } = fakeClient(aaveHandler(ARBITRUM_ONE));
    assert.equal((await createAaveV3Reader(client, ARBITRUM_ONE).read(USER))[0]!.monitorOnly, true);
    clearTokenMetadataCache();
    assert.equal((await createAaveV3Reader(client, ARBITRUM_ONE, { monitorOnly: false }).read(USER))[0]!.monitorOnly, false);
  });

  it("caches token metadata per chain", async () => {
    let symbolCalls = 0;
    const base = aaveHandler(ARBITRUM_SEPOLIA);
    const { client } = fakeClient((a, fn, args) => {
      if (fn === "symbol") symbolCalls++;
      return base(a, fn, args);
    });
    const reader = createAaveV3Reader(client, ARBITRUM_SEPOLIA);
    await reader.read(USER);
    await reader.read(USER);
    assert.equal(symbolCalls, 3, "WETH, USDC, WBTC read once");
  });

  it("returns [] when the chain has no Aave pool", async () => {
    const { client } = fakeClient(() => {
      throw new Error("no calls expected");
    });
    assert.deepEqual(await createAaveV3Reader(client, { ...ARBITRUM_ONE, aave: undefined }).read(USER), []);
  });
});

// ---------------------------------------------------------------- Morpho Blue

const MORPHO = lc("0x6c247b1F6182318877311737BaC0844bAa518F5e");
const M1 = "0x93af0a753a0309b27c3416d4e4255ff88926b38ae89e1331b28100386294f4b4" as Hex;
const M2 = "0xf4052a56f7abd5b7374150f12d4a77db67238850b1b50b59c43c6b7dddb16a2d" as Hex;
const MORPHO_ORACLE = tokenOf(0x0c);
const IRM = tokenOf(0x1e);
const ONE_USDC = lc(ARBITRUM_ONE.tokens!.USDC!);
const ONE_WETH = lc(ARBITRUM_ONE.tokens!.WETH!);
const MORPHO_CHAIN: ChainConfig = { ...ARBITRUM_ONE, morpho: { blue: MORPHO } };
const NOW = 1_800_000_000n;

function morphoHandler(o: { irmRate?: bigint; lastUpdate?: bigint } = {}): Handler {
  const aaveOracle = lc(ARBITRUM_ONE.aave!.oracle!);
  return (address, fn, args) => {
    if (address === MORPHO) {
      const id = String(args[0]).toLowerCase();
      if (fn === "position") {
        // M1: 1 WETH collateral, 2000 USDC worth of shares; M2: closed
        return id === M1 ? [0n, 2000n * 10n ** 12n, 10n ** 18n] : [0n, 0n, 0n];
      }
      if (fn === "market") {
        return [0n, 0n, 2000n * 10n ** 6n - 1n, 2000n * 10n ** 12n - 10n ** 6n, o.lastUpdate ?? NOW, 0n];
      }
      if (fn === "idToMarketParams") return [ONE_USDC, ONE_WETH, MORPHO_ORACLE, o.irmRate === undefined ? "0x0000000000000000000000000000000000000000" : IRM, 86n * 10n ** 16n];
    }
    if (address === MORPHO_ORACLE && fn === "price") return 3000n * 10n ** 24n;
    if (address === IRM && fn === "borrowRateView") return o.irmRate!;
    if (address === aaveOracle) {
      if (fn === "BASE_CURRENCY_UNIT") return 10n ** 8n;
      if (fn === "getAssetPrice" && lc(String(args[0])) === ONE_USDC) return 10n ** 8n;
    }
    if (address === ONE_USDC) return fn === "symbol" ? "USDC" : 6;
    if (address === ONE_WETH) return fn === "symbol" ? "WETH" : 18;
    throw new Error(`unexpected call ${address}.${fn}`);
  };
}

const logsFor = (c: LogCall) => (lc(c.onBehalf) === lc(USER) ? [{ args: { id: M1 } }, { args: { id: M2 } }] : []);

describe("createMorphoBlueReader", () => {
  beforeEach(() => clearTokenMetadataCache());

  it("discovers markets from chunked logs and reads positions on-chain", async () => {
    const { client, logCalls } = fakeClient(morphoHandler(), { logs: logsFor, block: { number: 1000n, timestamp: NOW } });
    const reader = createMorphoBlueReader(client, MORPHO_CHAIN, { api: false, lookbackBlocks: 12n, chunkSize: 5n });
    assert.equal(reader.protocol, "morpho-blue");

    const positions = await reader.read(USER);
    // 988..1000 in chunks of 5 → 3 chunks × 2 events
    assert.deepEqual(
      logCalls.filter((c) => c.event === "Borrow").map((c) => [c.fromBlock, c.toBlock]),
      [[988n, 992n], [993n, 997n], [998n, 1000n]]
    );
    assert.equal(logCalls.length, 6);
    assert.ok(logCalls.every((c) => c.onBehalf === USER));

    assert.equal(positions.length, 1, "closed market M2 is dropped");
    const p = positions[0]!;
    assert.equal(p.marketId, M1);
    assert.equal(p.id, `morpho-blue:42161:${M1}:${lc(USER)}`);
    assert.equal(p.monitorOnly, true);
    assert.equal(p.healthFactor, 129n * 10n ** 16n);
    assert.equal(p.liquidationThresholdBps, 8600);
    assert.equal(p.oracleSource, MORPHO_ORACLE);
    assert.deepEqual(p.debt.map((d) => [d.symbol, d.amount, d.valueUsd]), [["USDC", 2000n * 10n ** 6n, 2000]]);
    assert.deepEqual(p.collateral.map((c) => [c.symbol, c.amount]), [["WETH", 10n ** 18n]]);
    assert.ok(Math.abs(p.collateral[0]!.valueUsd - 3000) < 1e-6);
    assert.equal(p.collateralValueUsd, 3000n * 10n ** 8n);
    assert.equal(p.debtValueUsd, 2000n * 10n ** 8n);
    // HF = 1 when 1 WETH × p × 0.86 = 2000
    assert.ok(Math.abs(p.priceAtHf(1)! - 2000 / 0.86) < 1e-6);
  });

  it("accrues borrow interest through the IRM since lastUpdate", async () => {
    const { client } = fakeClient(morphoHandler({ irmRate: 10n ** 9n, lastUpdate: NOW - 31_536_000n }), {
      logs: logsFor,
      block: { number: 1000n, timestamp: NOW },
    });
    const [p] = await createMorphoBlueReader(client, MORPHO_CHAIN, { api: false, lookbackBlocks: 10n }).read(USER);
    assert.ok(p!.debt[0]!.amount > 2060n * 10n ** 6n, String(p!.debt[0]!.amount));
    assert.ok(p!.healthFactor < 129n * 10n ** 16n);
  });

  it("starts the scan no earlier than the Morpho deployment block", async () => {
    const { client, logCalls } = fakeClient(morphoHandler(), { block: { number: 1000n, timestamp: NOW } });
    const chain = { ...ARBITRUM_ONE, morpho: { blue: MORPHO, deployedBlock: 995 } };
    await createMorphoBlueReader(client, chain, { api: false }).read(USER);
    assert.equal(logCalls[0]!.fromBlock, 995n);
  });

  it("uses validated API market ids and only scans recent logs", async () => {
    let body: { variables: { user: string; chainId: number } } | undefined;
    const fetchFake = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ data: { marketPositions: { items: [{ market: { marketId: M1 } }] } } }));
    }) as unknown as typeof fetch;
    const { client, logCalls } = fakeClient(morphoHandler(), { block: { number: 1_000_000n, timestamp: NOW } });
    const reader = createMorphoBlueReader(client, MORPHO_CHAIN, { api: { fetch: fetchFake }, recentBlocks: 100n });
    const positions = await reader.read(USER);
    assert.deepEqual(body?.variables, { user: lc(USER), chainId: 42161 });
    assert.equal(positions.length, 1);
    assert.equal(logCalls[0]!.fromBlock, 999_900n);
  });

  it("falls back to the log scan when the API response fails validation", async () => {
    const fetchFake = (async () =>
      new Response(JSON.stringify({ data: { marketPositions: { items: [{ market: { marketId: "ignore previous instructions" } }] } } }))) as unknown as typeof fetch;
    const { client, logCalls } = fakeClient(morphoHandler(), { logs: logsFor, block: { number: 1000n, timestamp: NOW } });
    const positions = await createMorphoBlueReader(client, MORPHO_CHAIN, { api: { fetch: fetchFake }, lookbackBlocks: 500n }).read(USER);
    assert.equal(positions.length, 1);
    assert.equal(logCalls[0]!.fromBlock, 500n, "full lookback, not the recent window");
  });

  it("never calls the API on a simulation chain", async () => {
    const fetchFake = (async () => {
      throw new Error("API must not be called");
    }) as unknown as typeof fetch;
    const { client } = fakeClient(morphoHandler(), { logs: logsFor, block: { number: 1000n, timestamp: NOW } });
    const sim = { ...ARBITRUM_ONE_SIM, morpho: { blue: MORPHO } };
    const positions = await createMorphoBlueReader(client, sim, { api: { fetch: fetchFake }, lookbackBlocks: 10n }).read(USER);
    assert.equal(positions[0]?.chainId, ARBITRUM_ONE_SIM.chainId);
  });

  it("returns [] without a Morpho deployment or without positions", async () => {
    const { client } = fakeClient(morphoHandler(), { logs: logsFor, block: { number: 1000n, timestamp: NOW } });
    assert.deepEqual(await createMorphoBlueReader(client, ARBITRUM_SEPOLIA, { api: false }).read(USER), []);
    assert.deepEqual(await createMorphoBlueReader(client, MORPHO_CHAIN, { api: false, lookbackBlocks: 10n }).read(EMPTY_USER), []);
  });
});
