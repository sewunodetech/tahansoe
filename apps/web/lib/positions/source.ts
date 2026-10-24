/**
 * Where usePositions gets its readers (spec m1-positions-holdings-guardian-view §3.2, §3.3).
 * Readers live in @tahansoe/domain; this file only picks them per chain and protocol.
 */

import type { PublicClient } from "viem";
import { arbitrum } from "wagmi/chains";
import {
  createAaveV3Reader,
  createMorphoBlueReader,
  wadToNumber,
  type AssetAmount,
  type ChainConfig,
  type Position,
  type PositionDetail,
  type PositionReader,
} from "@tahansoe/domain";

export type Protocol = Position["protocol"];

/** Below this a supplied or borrowed amount is dust, not something to show. */
const DUST_USD = 0.01;

/** Protocols the dashboard can read on a chain. */
export function protocolsOn(chain: ChainConfig): Protocol[] {
  const list: Protocol[] = [];
  if (chain.aave?.pool) list.push("aave-v3");
  if (chain.morpho?.blue) list.push("morpho-blue");
  return list;
}

/**
 * Reader for one protocol on one chain. `canProtect` is false where no Guardian is deployed;
 * the simulation fork registers its Guardian per session, so it passes true explicitly.
 */
export function readerFor(client: PublicClient, chain: ChainConfig, protocol: Protocol, canProtect: boolean): PositionReader {
  // The fork's viem chain has no Multicall3 entry, but it is a copy of Arbitrum One state.
  const multicallAddress = chain.isSimulation ? arbitrum.contracts.multicall3.address : undefined;
  return protocol === "aave-v3"
    ? createAaveV3Reader(client, chain, { monitorOnly: !canProtect, multicallAddress })
    : createMorphoBlueReader(client, chain, { multicallAddress });
}

/** Readers report maxUint256 when there is no debt (Aave convention). */
const NO_DEBT_HF = 2n ** 255n;

/** Health Factor as a number, null when the position has no debt. */
export function healthFactorOf(p: PositionDetail): number | null {
  if (p.healthFactor >= NO_DEBT_HF) return null;
  if (p.debtValueUsd === 0n && !p.debt.some((d) => d.amount > 0n)) return null;
  return wadToNumber(p.healthFactor);
}

/**
 * Hides dust on Aave. Morpho rows without a USD price (loan token not an Aave reserve) report
 * `valueUsd` 0 and are kept.
 */
export function visibleAssets(p: PositionDetail, list: AssetAmount[]): AssetAmount[] {
  return list.filter((a) => a.amount > 0n && (p.protocol !== "aave-v3" || a.valueUsd >= DUST_USD));
}
