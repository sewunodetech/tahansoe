/**
 * Utilitas deduplikasi sinyal deterministik (layer Emitter & Fusion Read).
 *
 * Memberikan stable dedupe key untuk setiap sinyal deterministik:
 * - "ONCHAIN:T11:kink:${asset}"
 * - "ONCHAIN:T11:spike:${asset}"
 * - "ONCHAIN:T11:carry:${collateral}-${debt}"
 * - "ORACLE:T10:sequencer"
 * - "ORACLE:T8:stale:${feed}"
 * - "ORACLE:T8:deviation:${asset}"
 * - "ONCHAIN:T4:depeg:${asset}"
 * - "MACRO:${tag}:${date}"
 *
 * Mencegah akumulasi baris duplikat di DB dan penumpukan skor risiko di fusion.
 */

import type { Signal, SignalEvidence } from "@tahansoe/domain";

export interface RawSignalRow {
  id: string;
  module: string;
  paths: unknown;
  assets: unknown;
  direction: string;
  severity: string | number;
  confidence: string | number;
  horizonHours: number;
  observedAt: Date;
  expiresAt: Date;
  evidence: unknown;
}

/**
 * Mendapatkan atau menghasilkan stable dedupe key untuk sinyal deterministik.
 */
export function getSignalDedupeKey(signal: Signal): string | undefined {
  if (signal.dedupeKey) {
    return signal.dedupeKey;
  }
  const evDedupe = (signal.evidence[0] as { dedupeKey?: string } | undefined)?.dedupeKey;
  if (evDedupe) {
    return evDedupe;
  }

  const firstTitle = signal.evidence[0]?.title ?? "";

  // 1. Sequencer (T10)
  if (signal.module === "ORACLE" && signal.paths?.includes("T10")) {
    return "ORACLE:T10:sequencer";
  }

  // 2. Oracle Staleness & Deviation (T8)
  if (signal.module === "ORACLE" && signal.paths?.includes("T8")) {
    const staleMatch = firstTitle.match(/Chainlink\s+([A-Za-z0-9/]+)\s+feed stale/i);
    if (staleMatch?.[1]) {
      return `ORACLE:T8:stale:${staleMatch[1]}`;
    }
    const devMatch = firstTitle.match(/Oracle deviation for\s+([A-Za-z0-9.]+):/i);
    if (devMatch?.[1]) {
      return `ORACLE:T8:deviation:${devMatch[1]}`;
    }
    if (signal.assets[0]) {
      return `ORACLE:T8:deviation:${signal.assets[0]}`;
    }
  }

  // 3. Stablecoin Depeg (T4)
  if (signal.module === "ONCHAIN" && signal.paths?.includes("T4")) {
    const depegMatch = firstTitle.match(/Stablecoin\s+([A-Za-z0-9.]+)\s+depeg/i);
    const asset = depegMatch?.[1] ?? signal.assets[0];
    if (asset) {
      return `ONCHAIN:T4:depeg:${asset}`;
    }
  }

  // 4. Carry & Interest (T11)
  if (signal.module === "ONCHAIN" && signal.paths?.includes("T11")) {
    const kinkMatch = firstTitle.match(/Reserve\s+([A-Za-z0-9.]+)\s+utilization\s+at/i);
    if (kinkMatch?.[1]) {
      return `ONCHAIN:T11:kink:${kinkMatch[1]}`;
    }
    const spikeMatch = firstTitle.match(/Reserve\s+([A-Za-z0-9.]+)\s+borrow APR spiked/i);
    if (spikeMatch?.[1]) {
      return `ONCHAIN:T11:spike:${spikeMatch[1]}`;
    }
    const carryMatch = firstTitle.match(/Negative carry on\s+([A-Za-z0-9.]+)->([A-Za-z0-9.]+)/i);
    if (carryMatch?.[1] && carryMatch?.[2]) {
      return `ONCHAIN:T11:carry:${carryMatch[1]}-${carryMatch[2]}`;
    }
  }

  // 5. Macro (T1/T2)
  if (signal.module === "MACRO") {
    const upper = firstTitle.toUpperCase();
    let tag = "EVENT";
    if (upper.includes("FOMC")) tag = "FOMC";
    else if (upper.includes("CPI")) tag = "CPI";
    else if (upper.includes("NFP")) tag = "NFP";

    const dateMatch = firstTitle.match(/\((\d{4}-\d{2}-\d{2})T/);
    if (dateMatch?.[1]) {
      return `MACRO:${tag}:${dateMatch[1]}`;
    }
    const targetDate = new Date(signal.observedAt.getTime() + signal.horizonHours * 3_600_000);
    return `MACRO:${tag}:${targetDate.toISOString().slice(0, 10)}`;
  }

  return undefined;
}

/**
 * Filter defensif sinyal: mendeduplikasi sinyal berdasarkan dedupeKey,
 * mempertahankan sinyal yang paling baru (observedAt terbaru).
 * Sinyal tanpa dedupeKey dipertahankan tanpa dideduplikasi satu sama lain.
 */
export function dedupeSignals(signals: Signal[]): Signal[] {
  // Urutkan dari yang terbaru (observedAt descending)
  const sorted = [...signals].sort((a, b) => {
    const diff = b.observedAt.getTime() - a.observedAt.getTime();
    if (diff !== 0) return diff;
    return b.severity - a.severity;
  });

  const seen = new Set<string>();
  const out: Signal[] = [];

  for (const s of sorted) {
    const key = getSignalDedupeKey(s);
    if (!key) {
      out.push(s);
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(s);
  }

  return out;
}

/**
 * Petakan baris DB `signals` → Signal domain (dengan dedupeKey jika ada/terekstraksi).
 */
export function rowToSignal(row: RawSignalRow): Signal {
  const paths = Array.isArray(row.paths) ? (row.paths as Signal["paths"]) : undefined;
  const assets = Array.isArray(row.assets) ? (row.assets as string[]) : [];
  const direction = (["DOWN", "UP", "VOLATILITY"] as const).includes(row.direction as never)
    ? (row.direction as Signal["direction"])
    : "DOWN";
  const evidence = Array.isArray(row.evidence) ? (row.evidence as SignalEvidence[]) : [];
  const storedDedupeKey = (evidence[0] as { dedupeKey?: string } | undefined)?.dedupeKey;

  const sig: Signal = {
    id: row.id,
    module: row.module as Signal["module"],
    paths,
    assets,
    direction,
    severity: Number(row.severity),
    confidence: Number(row.confidence),
    horizonHours: row.horizonHours,
    observedAt: row.observedAt,
    expiresAt: row.expiresAt,
    evidence,
    dedupeKey: storedDedupeKey,
  };

  if (!sig.dedupeKey) {
    sig.dedupeKey = getSignalDedupeKey(sig);
  }

  return sig;
}
