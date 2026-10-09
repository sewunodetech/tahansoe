/**
 * Adapter snapshot on-chain Arbitrum One via viem.
 *
 * Mengambil data pasar dan infrastruktur penting di Arbitrum One:
 *  - Harga WETH dan USDC dari AaveOracle.getAssetPrice (sumber eksekusi, I5).
 *  - Harga referensi dari proxy Chainlink ETH/USD dan USDC/USD (peringatan dini).
 *  - Deviasi antara AaveOracle vs Chainlink.
 *  - Status Chainlink Sequencer Uptime Feed (deteksi Sequencer down/up).
 *  - Menyusun chainNotes khusus Arbitrum One (USDC capped, tanpa PriceOracleSentinel).
 *
 * Invarian:
 *  - Alamat kontrak diambil dari @tahansoe/domain (ARBITRUM_ONE), tidak di-hardcode.
 *  - RPC dari env ARBITRUM_RPC_URL (fallback: https://arb1.arbitrum.io/rpc).
 *  - Output sinyal module "ORACLE" dan "ONCHAIN" dengan confidence di-cap ke 0.6.
 *  - Graceful degradation: timeout / RPC failure menghasilkan warning tanpa throw (I6).
 */

import {
  createPublicClient,
  http,
  type Address,
  type PublicClient,
} from "viem";
import { ARBITRUM_ONE } from "@tahansoe/domain";
import type { ContextSignal } from "../agents/context.ts";

export interface OnchainSnapshotOptions {
  /** RPC URL Arbitrum One (default: process.env.ARBITRUM_RPC_URL || https://arb1.arbitrum.io/rpc). */
  rpcUrl?: string;
  /** Custom viem PublicClient (berguna untuk mock/testing tanpa network). */
  client?: PublicClient;
  /** Batas waktu pemanggilan dalam ms (default: 10_000). */
  timeoutMs?: number;
  now?: Date;
  /** Data snapshot mentah langsung (opsional untuk unit test). */
  rawSnapshot?: OnchainRawSnapshot;
}

export interface OnchainRawSnapshot {
  wethAavePrice: bigint;
  usdcAavePrice: bigint;
  ethChainlinkAnswer: bigint;
  ethChainlinkStartedAt: bigint;
  ethChainlinkUpdatedAt?: bigint;
  usdcChainlinkAnswer: bigint;
  usdcChainlinkStartedAt: bigint;
  usdcChainlinkUpdatedAt?: bigint;
  usdtChainlinkAnswer?: bigint;
  usdtChainlinkStartedAt?: bigint;
  usdtChainlinkUpdatedAt?: bigint;
  sequencerAnswer: bigint;
  sequencerStartedAt: bigint;
  /** Peta harga AaveOracle per aset (simbol -> bigint 8 desimal USD). */
  aavePrices?: Record<string, bigint>;
}

export interface OnchainResult {
  signals: ContextSignal[];
  chainNotes: string[];
  warning?: string;
  rawSnapshot?: OnchainRawSnapshot;
}

const AAVE_ORACLE_ABI = [
  {
    type: "function",
    name: "getAssetPrice",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const AGGREGATOR_V3_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

/**
 * Catatan statis arsitektur Arbitrum One yang wajib diketahui engine & research agent.
 * Sumber: docs/knowledge/risk-transmission.md §4.
 */
export const ARBITRUM_STATIC_CHAIN_NOTES = [
  "Arbitrum One: AaveOracle USDC uses capped feed (0xb0c9a7122aab68f75cffd9851e867144dbff113b, 'Capped USDC/USD'); upward depeg not visible to Aave, downward depeg visible.",
  "Arbitrum One: PriceOracleSentinel is NOT installed (getPriceOracleSentinel() = 0x0); no grace period after sequencer recovers, positions can be liquidated immediately in first blocks.",
];

/**
 * Normalisasi raw snapshot on-chain menjadi ContextSignal dan chainNotes.
 */
export function normalizeOnchainSnapshot(
  snapshot: OnchainRawSnapshot,
  now: Date = new Date(),
): { signals: ContextSignal[]; chainNotes: string[] } {
  const expiresAt = new Date(now.getTime() + 24 * 3600 * 1000);
  const signals: ContextSignal[] = [];

  // 1. Sequencer Uptime Signal
  const isSequencerDown = snapshot.sequencerAnswer === 1n;
  const startedAtDate = new Date(Number(snapshot.sequencerStartedAt) * 1000);
  const startedAtIso = isNaN(startedAtDate.getTime())
    ? now.toISOString()
    : startedAtDate.toISOString();

  if (isSequencerDown) {
    signals.push({
      id: "onchain-arbitrum-sequencer",
      module: "ONCHAIN",
      severity: 1.0, // Critical
      confidence: 0.6,
      paths: ["T10"], // T10: Sequencer down / infrastruktur
      summary: `CRITICAL: Arbitrum Sequencer is DOWN since ${startedAtIso}! PriceOracleSentinel is NOT installed; positions face immediate liquidation risk upon sequencer recovery.`,
      createdAt: now,
      expiresAt,
    });
  } else {
    signals.push({
      id: "onchain-arbitrum-sequencer",
      module: "ONCHAIN",
      severity: 0.05,
      confidence: 0.6,
      summary: `Arbitrum Sequencer is UP (healthy, status verified since ${startedAtIso}).`,
      createdAt: now,
      expiresAt,
    });
  }

  // 2. WETH Price & Deviation
  // AaveOracle mengembalikan unit 8 desimal (USD). Chainlink ETH/USD juga 8 desimal.
  const aaveEthUsd = Number(snapshot.wethAavePrice) / 1e8;
  const clEthUsd = Number(snapshot.ethChainlinkAnswer) / 1e8;
  let wethDiffPct = 0;
  if (aaveEthUsd > 0) {
    wethDiffPct = Math.abs(aaveEthUsd - clEthUsd) / aaveEthUsd;
  }

  let wethSeverity = 0.05;
  if (wethDiffPct > 0.02) wethSeverity = 0.6; // Deviasi > 2%
  else if (wethDiffPct > 0.005) wethSeverity = 0.3; // Deviasi > 0.5%

  signals.push({
    id: "oracle-arbitrum-weth",
    module: "ORACLE",
    severity: wethSeverity,
    confidence: 0.6,
    summary: `WETH Price: AaveOracle $${aaveEthUsd.toFixed(2)}, Chainlink $${clEthUsd.toFixed(2)} (diff ${(wethDiffPct * 100).toFixed(3)}%)`,
    createdAt: now,
    expiresAt,
  });

  // 3. USDC Price & Deviation (Peg health)
  const aaveUsdcUsd = Number(snapshot.usdcAavePrice) / 1e8;
  const clUsdcUsd = Number(snapshot.usdcChainlinkAnswer) / 1e8;
  let usdcDiffPct = 0;
  if (aaveUsdcUsd > 0) {
    usdcDiffPct = Math.abs(aaveUsdcUsd - clUsdcUsd) / aaveUsdcUsd;
  }

  // Depeg jika harga menyimpang > 1% dari $1.00
  const isDepeg = clUsdcUsd < 0.99 || clUsdcUsd > 1.01 || aaveUsdcUsd < 0.99;
  let usdcSeverity = 0.05;
  if (isDepeg) {
    usdcSeverity = 0.7; // T4: Stablecoin depeg
  } else if (usdcDiffPct > 0.003) {
    usdcSeverity = 0.2;
  }

  signals.push({
    id: "oracle-arbitrum-usdc",
    module: "ORACLE",
    severity: usdcSeverity,
    confidence: 0.6,
    paths: isDepeg ? ["T4"] : undefined,
    summary: `USDC Peg: AaveOracle $${aaveUsdcUsd.toFixed(4)}, Chainlink $${clUsdcUsd.toFixed(4)} (diff ${(usdcDiffPct * 100).toFixed(3)}%)`,
    createdAt: now,
    expiresAt,
  });

  // 4. Chain Notes
  const chainNotes = [
    ...ARBITRUM_STATIC_CHAIN_NOTES,
    `Arbitrum One: Sequencer is currently ${isSequencerDown ? "DOWN" : "UP"}.`,
  ];

  return { signals, chainNotes };
}

/**
 * Fetch snapshot Arbitrum One dari kontrak RPC via viem.
 */
export async function fetchOnchainSnapshot(
  options: OnchainSnapshotOptions = {},
): Promise<OnchainResult> {
  const { now = new Date() } = options;

  // Jika snapshot mentah langsung disediakan (untuk pengujian)
  if (options.rawSnapshot) {
    const { signals, chainNotes } = normalizeOnchainSnapshot(
      options.rawSnapshot,
      now,
    );
    return { signals, chainNotes, rawSnapshot: options.rawSnapshot };
  }

  const rpcUrl =
    options.rpcUrl ||
    process.env.ARBITRUM_RPC_URL ||
    "https://arb1.arbitrum.io/rpc";

  const aaveOracleAddress = ARBITRUM_ONE.aave?.oracle as Address | undefined;
  const wethAddress = ARBITRUM_ONE.tokens?.WETH as Address | undefined;
  const usdcAddress = ARBITRUM_ONE.tokens?.USDC as Address | undefined;
  const chainlinkEthAddress = ARBITRUM_ONE.priceFeeds["ETH/USD"] as
    | Address
    | undefined;
  const chainlinkUsdcAddress = ARBITRUM_ONE.priceFeeds["USDC/USD"] as
    | Address
    | undefined;
  const sequencerFeedAddress = ARBITRUM_ONE.sequencerUptimeFeed as
    | Address
    | undefined;

  if (
    !aaveOracleAddress ||
    !wethAddress ||
    !usdcAddress ||
    !chainlinkEthAddress ||
    !chainlinkUsdcAddress ||
    !sequencerFeedAddress
  ) {
    return {
      signals: [],
      chainNotes: [...ARBITRUM_STATIC_CHAIN_NOTES],
      warning:
        "Onchain: Konfigurasi alamat Arbitrum One di @tahansoe/domain tidak lengkap",
    };
  }

  try {
    const client =
      options.client ||
      createPublicClient({
        transport: http(rpcUrl, {
          timeout: options.timeoutMs ?? 10_000,
        }),
      });

    // Panggil fungsi view kontrak dasar secara paralel
    const [
      wethAavePrice,
      usdcAavePrice,
      ethRound,
      usdcRound,
      sequencerRound,
    ] = await Promise.all([
      client.readContract({
        address: aaveOracleAddress,
        abi: AAVE_ORACLE_ABI,
        functionName: "getAssetPrice",
        args: [wethAddress],
      }),
      client.readContract({
        address: aaveOracleAddress,
        abi: AAVE_ORACLE_ABI,
        functionName: "getAssetPrice",
        args: [usdcAddress],
      }),
      client.readContract({
        address: chainlinkEthAddress,
        abi: AGGREGATOR_V3_ABI,
        functionName: "latestRoundData",
      }),
      client.readContract({
        address: chainlinkUsdcAddress,
        abi: AGGREGATOR_V3_ABI,
        functionName: "latestRoundData",
      }),
      client.readContract({
        address: sequencerFeedAddress,
        abi: AGGREGATOR_V3_ABI,
        functionName: "latestRoundData",
      }),
    ]);

    const aavePrices: Record<string, bigint> = {
      WETH: wethAavePrice,
      USDC: usdcAavePrice,
    };

    // Baca harga stablecoin lain (USDC.e, USDT, DAI, GHO) & feed USDT secara resilient (I6)
    const extraTokens = ["USDC.e", "USDT", "DAI", "GHO"] as const;
    const extraAaveJobs = extraTokens.map(async (tok) => {
      const addr = ARBITRUM_ONE.tokens?.[tok] as Address | undefined;
      if (!addr) return;
      try {
        const p = (await client.readContract({
          address: aaveOracleAddress,
          abi: AAVE_ORACLE_ABI,
          functionName: "getAssetPrice",
          args: [addr],
        })) as bigint;
        aavePrices[tok] = p;
      } catch {
        // Abaikan kegagalan token individual (mis. mock test parsial)
      }
    });

    const chainlinkUsdtAddress = ARBITRUM_ONE.priceFeeds["USDT/USD"] as Address | undefined;
    let usdtRound: readonly [bigint, bigint, bigint, bigint, bigint] | null = null;
    const usdtJob = (async () => {
      if (!chainlinkUsdtAddress) return;
      try {
        usdtRound = (await client.readContract({
          address: chainlinkUsdtAddress,
          abi: AGGREGATOR_V3_ABI,
          functionName: "latestRoundData",
        })) as readonly [bigint, bigint, bigint, bigint, bigint];
      } catch {
        // Abaikan jika tidak tersedia
      }
    })();

    await Promise.allSettled([...extraAaveJobs, usdtJob]);

    const rawSnapshot: OnchainRawSnapshot = {
      wethAavePrice,
      usdcAavePrice,
      ethChainlinkAnswer: ethRound[1],
      ethChainlinkStartedAt: ethRound[2],
      ethChainlinkUpdatedAt: ethRound[3],
      usdcChainlinkAnswer: usdcRound[1],
      usdcChainlinkStartedAt: usdcRound[2],
      usdcChainlinkUpdatedAt: usdcRound[3],
      usdtChainlinkAnswer: usdtRound ? usdtRound[1] : undefined,
      usdtChainlinkStartedAt: usdtRound ? usdtRound[2] : undefined,
      usdtChainlinkUpdatedAt: usdtRound ? usdtRound[3] : undefined,
      sequencerAnswer: sequencerRound[1],
      sequencerStartedAt: sequencerRound[2],
      aavePrices,
    };

    const { signals, chainNotes } = normalizeOnchainSnapshot(rawSnapshot, now);
    return { signals, chainNotes, rawSnapshot };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      signals: [],
      chainNotes: [...ARBITRUM_STATIC_CHAIN_NOTES],
      warning: `Onchain: Gagal membaca RPC Arbitrum One (${message})`,
    };
  }
}
