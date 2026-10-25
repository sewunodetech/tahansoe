import {
  encodeFunctionData,
  keccak256,
  stringToBytes,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { ARBITRUM_SEPOLIA, type ChainConfig } from "@tahansoe/domain";
import { reputationRegistryAbi } from "./abi.ts";

export type ReputationTag = "protection" | "preempt" | "false-positive" | "missed";

export interface ReputationSummary {
  count: bigint;
  summaryValue: bigint;
  summaryValueDecimals: number;
}

export interface PreparedFeedbackCall {
  to: Address;
  data: Hex;
  agentId: bigint;
  value: bigint;
  valueDecimals: number;
  tag1: string;
  tag2: string;
  endpoint: string;
  feedbackURI: string;
  feedbackHash: Hex;
}

export interface ProtectionOutcomeInput {
  agentId?: bigint;
  tag?: ReputationTag | string;
  /** Label from settlement (spec §3.5). */
  label?: "TRUE_POSITIVE" | "FALSE_POSITIVE" | "MISSED" | "TRUE_NEGATIVE" | string;
  /** Whether the action taken was preemptive before standard trigger. */
  isPreempt?: boolean;
  value?: bigint | number;
  valueDecimals?: number;
  tag2?: string;
  endpoint?: string;
  feedbackURI?: string;
  feedbackHash?: Hex;
  chainConfig?: ChainConfig;
}

export const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

/**
 * Maps an outcome or settlement label to canonical ERC-8004 feedback tags and default values.
 */
export function mapOutcomeToFeedbackValues(outcome: ProtectionOutcomeInput): {
  tag1: ReputationTag;
  defaultValue: bigint;
  defaultDecimals: number;
} {
  if (outcome.tag) {
    const t = outcome.tag.toLowerCase();
    if (t === "preempt") return { tag1: "preempt", defaultValue: 100n, defaultDecimals: 0 };
    if (t === "false-positive") return { tag1: "false-positive", defaultValue: -50n, defaultDecimals: 0 };
    if (t === "missed") return { tag1: "missed", defaultValue: -100n, defaultDecimals: 0 };
    return { tag1: "protection", defaultValue: 100n, defaultDecimals: 0 };
  }

  if (outcome.label) {
    switch (outcome.label) {
      case "TRUE_POSITIVE":
        return outcome.isPreempt
          ? { tag1: "preempt", defaultValue: 100n, defaultDecimals: 0 }
          : { tag1: "protection", defaultValue: 100n, defaultDecimals: 0 };
      case "FALSE_POSITIVE":
        return { tag1: "false-positive", defaultValue: -50n, defaultDecimals: 0 };
      case "MISSED":
        return { tag1: "missed", defaultValue: -100n, defaultDecimals: 0 };
      default:
        return { tag1: "protection", defaultValue: 100n, defaultDecimals: 0 };
    }
  }

  if (outcome.isPreempt) {
    return { tag1: "preempt", defaultValue: 100n, defaultDecimals: 0 };
  }

  return { tag1: "protection", defaultValue: 100n, defaultDecimals: 0 };
}

/**
 * Builds the unsigned giveFeedback calldata for a settlement outcome (spec §3.7, ADR 0017).
 * Unsigned calldata only; coordinator wires the signer later.
 */
export function buildFeedback(
  outcome: ProtectionOutcomeInput,
  overrideChainConfig?: ChainConfig
): PreparedFeedbackCall {
  const chain = overrideChainConfig ?? outcome.chainConfig ?? ARBITRUM_SEPOLIA;
  const reputationAddress = chain.erc8004?.reputation;
  if (!reputationAddress) {
    throw new Error(
      `Chain ${chain.name} (ID ${chain.chainId}) does not have an ERC-8004 Reputation Registry configured`
    );
  }

  const agentId = outcome.agentId ?? 1n;
  const { tag1, defaultValue, defaultDecimals } = mapOutcomeToFeedbackValues(outcome);

  const value = outcome.value !== undefined ? BigInt(outcome.value) : defaultValue;
  const valueDecimals = outcome.valueDecimals ?? defaultDecimals;
  const tag2 = outcome.tag2 ?? "settlement";
  const endpoint = outcome.endpoint ?? "";
  const feedbackURI = outcome.feedbackURI ?? "";

  let feedbackHash = outcome.feedbackHash;
  if (!feedbackHash) {
    if (feedbackURI && feedbackURI.length > 0) {
      feedbackHash = keccak256(stringToBytes(feedbackURI));
    } else {
      feedbackHash = ZERO_BYTES32;
    }
  }

  const data = encodeFunctionData({
    abi: reputationRegistryAbi,
    functionName: "giveFeedback",
    args: [
      agentId,
      value,
      valueDecimals,
      tag1,
      tag2,
      endpoint,
      feedbackURI,
      feedbackHash,
    ],
  });

  return {
    to: reputationAddress,
    data,
    agentId,
    value,
    valueDecimals,
    tag1,
    tag2,
    endpoint,
    feedbackURI,
    feedbackHash,
  };
}

/**
 * Reads aggregated reputation summary from the Reputation Registry for an agent.
 * Respects Sybil protection: requires a non-empty list of client addresses.
 * Returns zeros if clients list is empty.
 */
export async function getReputationSummary(
  client: PublicClient,
  chainConfig: ChainConfig,
  agentId: bigint,
  clients: Address[],
  tag1 = "",
  tag2 = ""
): Promise<ReputationSummary> {
  const reputationAddress = chainConfig.erc8004?.reputation;
  if (!reputationAddress) {
    throw new Error(
      `Chain ${chainConfig.name} (ID ${chainConfig.chainId}) does not have an ERC-8004 Reputation Registry configured`
    );
  }

  // The ERC-8004 Reputation contract reverts with "clientAddresses required" if empty
  if (clients.length === 0) {
    return {
      count: 0n,
      summaryValue: 0n,
      summaryValueDecimals: 0,
    };
  }

  const result = await client.readContract({
    address: reputationAddress,
    abi: reputationRegistryAbi,
    functionName: "getSummary",
    args: [agentId, clients, tag1, tag2],
  });

  return {
    count: result[0],
    summaryValue: result[1],
    summaryValueDecimals: result[2],
  };
}

/**
 * Reads all client addresses that have submitted feedback for an agent.
 */
export async function getClients(
  client: PublicClient,
  chainConfig: ChainConfig,
  agentId: bigint
): Promise<Address[]> {
  const reputationAddress = chainConfig.erc8004?.reputation;
  if (!reputationAddress) {
    throw new Error(
      `Chain ${chainConfig.name} (ID ${chainConfig.chainId}) does not have an ERC-8004 Reputation Registry configured`
    );
  }

  const clients = await client.readContract({
    address: reputationAddress,
    abi: reputationRegistryAbi,
    functionName: "getClients",
    args: [agentId],
  });

  return [...clients];
}
