/**
 * Deterministic Oracle Signal Module (spec m2-deterministic-signal-modules §3.1 & §3.2).
 *
 * Mengidentifikasi:
 * 1. Sequencer Uptime (Path T10):
 *    - answer == 1 (down) -> severity 1.0
 *    - answer == 0 && startedAt < 1h lalu (grace period pasca-pulih) -> severity 0.7
 *    - normal -> tidak ada sinyal
 *
 * 2. Oracle Staleness (Path T8):
 *    - updatedAt lebih tua dari heartbeat * 1.5 -> severity 0.6 - 1.0 proporsional delay
 *
 * 3. Oracle Deviation (Path T8):
 *    - AaveOracle vs Chainlink direct feed
 *    - >= 0.5% -> 0.6; >= 1% -> 0.8; >= 2% -> 1.0
 *    - Deviasi ke atas $1 diabaikan untuk USDC (capped feed architecture)
 *
 * Fungsi MURNI tanpa I/O.
 */

import type { Signal, SignalEvidence, TransmissionPath } from "@tahansoe/domain";

export interface SequencerData {
  answer: bigint | number;
  startedAt: bigint | number | Date;
}

export interface ChainlinkFeedSample {
  feed: string; // mis. "ETH/USD", "USDC/USD", "USDT/USD"
  asset: string; // mis. "ETH", "USDC", "USDT"
  answer: bigint | number;
  updatedAt: bigint | number | Date;
  heartbeatSec?: number; // default: ETH = 3600, stablecoin = 86400
}

export interface OracleDeviationSample {
  asset: string;
  aavePrice: bigint | number; // 8 decimals (USD)
  chainlinkPrice: bigint | number; // 8 decimals (USD)
  isCappedUsdc?: boolean;
}

export interface OracleSignalParams {
  chainId?: number;
  now?: Date;
  sequencer?: SequencerData | null;
  feeds?: ChainlinkFeedSample[];
  deviations?: OracleDeviationSample[];
}

let signalSeq = 0;
function genId(): string {
  signalSeq = (signalSeq + 1) % 1_000_000;
  return `sig-oracle-${Date.now()}-${signalSeq}`;
}

function toSeconds(ts: bigint | number | Date): number {
  if (ts instanceof Date) return Math.floor(ts.getTime() / 1000);
  if (typeof ts === "bigint") return Number(ts);
  return Math.floor(ts);
}

export const ORACLE_DEFAULT_HEARTBEATS: Record<string, number> = {
  "ETH/USD": 3600,
  "USDC/USD": 86400,
  "USDT/USD": 86400,
};

export const ORACLE_CONFIDENCE = 0.9;
export const ORACLE_TTL_MS = 30 * 60 * 1000; // 30 menit

/**
 * Hitung sinyal deterministik ORACLE (T10 & T8).
 */
export function computeOracleSignals(params: OracleSignalParams): Signal[] {
  const now = params.now ?? new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const expiresAt = new Date(now.getTime() + ORACLE_TTL_MS);
  const signals: Signal[] = [];

  // 1. Sequencer Uptime (Path T10)
  if (params.sequencer) {
    const ans = Number(params.sequencer.answer);
    const startedSec = toSeconds(params.sequencer.startedAt);
    const startedDate = new Date(startedSec * 1000);

    if (ans === 1) {
      // Sequencer DOWN -> severity 1.0
      const dedupeKey = "ORACLE:T10:sequencer";
      signals.push({
        id: genId(),
        module: "ORACLE",
        paths: ["T10" as TransmissionPath],
        assets: ["ETH"],
        direction: "DOWN",
        severity: 1.0,
        confidence: ORACLE_CONFIDENCE,
        horizonHours: 24,
        observedAt: now,
        expiresAt,
        dedupeKey,
        evidence: [
          {
            title: `Arbitrum sequencer is DOWN (uptime feed answer=1 since ${startedDate.toISOString()})`,
            source: "chainlink_sequencer",
            dedupeKey,
          },
        ],
      });
    } else if (ans === 0) {
      const elapsedSec = nowSec - startedSec;
      // answer == 0 tetapi startedAt < 1 jam lalu (masa tenggang) -> severity 0.7
      if (elapsedSec >= 0 && elapsedSec < 3600) {
        const dedupeKey = "ORACLE:T10:sequencer";
        signals.push({
          id: genId(),
          module: "ORACLE",
          paths: ["T10" as TransmissionPath],
          assets: ["ETH"],
          direction: "DOWN",
          severity: 0.7,
          confidence: ORACLE_CONFIDENCE,
          horizonHours: 24,
          observedAt: now,
          expiresAt,
          dedupeKey,
          evidence: [
            {
              title: `Arbitrum sequencer recovered within grace period (${Math.floor(elapsedSec / 60)}m ago < 1h; price volatility expected)`,
              source: "chainlink_sequencer",
              dedupeKey,
            },
          ],
        });
      }
    }
  }

  // 2. Oracle Staleness (Path T8)
  if (params.feeds) {
    for (const f of params.feeds) {
      const updatedSec = toSeconds(f.updatedAt);
      const defaultHb = f.asset === "ETH" || f.feed.includes("ETH") ? 3600 : 86400;
      const heartbeat = f.heartbeatSec ?? ORACLE_DEFAULT_HEARTBEATS[f.feed] ?? defaultHb;
      const thresholdSec = heartbeat * 1.5;
      const delaySec = nowSec - updatedSec;

      if (delaySec > thresholdSec) {
        const excessRatio = (delaySec - thresholdSec) / thresholdSec;
        const severity = Math.min(1.0, Math.max(0.6, 0.6 + excessRatio * 0.4));
        const dedupeKey = `ORACLE:T8:stale:${f.feed}`;

        signals.push({
          id: genId(),
          module: "ORACLE",
          paths: ["T8" as TransmissionPath],
          assets: [f.asset],
          direction: "DOWN",
          severity,
          confidence: ORACLE_CONFIDENCE,
          horizonHours: 24,
          observedAt: now,
          expiresAt,
          dedupeKey,
          evidence: [
            {
              title: `Chainlink ${f.feed} feed stale: last updated ${Math.floor(delaySec / 60)}m ago (heartbeat ${Math.floor(heartbeat / 60)}m × 1.5 threshold exceeded)`,
              source: "chainlink_feed",
              dedupeKey,
            },
          ],
        });
      }
    }
  }

  // 3. Oracle Deviation (Path T8)
  if (params.deviations) {
    for (const d of params.deviations) {
      const aave = Number(d.aavePrice) / 1e8;
      const cl = Number(d.chainlinkPrice) / 1e8;
      if (aave <= 0 || cl <= 0) continue;

      const isCappedUsdc = d.isCappedUsdc ?? d.asset === "USDC";

      // USDC di Aave memakai capped feed: deviasi ke atas $1 diabaikan
      if (isCappedUsdc) {
        // Jika Chainlink > 1.0 dan Aave >= 1.0 (capped di 1.0), deviasi ke atas adalah desain normal
        if (cl >= 1.0 && aave >= 0.999) {
          continue;
        }
      }

      const diffPct = Math.abs(aave - cl) / aave;

      let severity: number | null = null;
      if (diffPct >= 0.02) {
        severity = 1.0;
      } else if (diffPct >= 0.01) {
        severity = 0.8;
      } else if (diffPct >= 0.005) {
        severity = 0.6;
      }

      if (severity !== null) {
        const dedupeKey = `ORACLE:T8:deviation:${d.asset}`;
        signals.push({
          id: genId(),
          module: "ORACLE",
          paths: ["T8" as TransmissionPath],
          assets: [d.asset],
          direction: "DOWN",
          severity,
          confidence: ORACLE_CONFIDENCE,
          horizonHours: 24,
          observedAt: now,
          expiresAt,
          dedupeKey,
          evidence: [
            {
              title: `Oracle deviation for ${d.asset}: AaveOracle $${aave.toFixed(4)} vs Chainlink $${cl.toFixed(4)} (diff ${(diffPct * 100).toFixed(2)}%)`,
              source: "aave_oracle",
              dedupeKey,
            },
          ],
        });
      }
    }
  }

  return signals;
}
