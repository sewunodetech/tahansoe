import {
  encodeFunctionData,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { ChainConfig } from "@tahansoe/domain";
import { identityRegistryAbi } from "./abi.ts";

export interface PreparedTransaction {
  to: Address;
  data: Hex;
}

export interface AgentIdentityData {
  agentId: bigint;
  owner: Address;
  agentWallet: Address;
  agentURI: string;
}

export interface PrepareRegisterParams {
  agentURI: string;
  chainConfig: ChainConfig;
}

export interface PrepareSetAgentWalletParams {
  agentId: bigint;
  newWallet: Address;
  deadline: bigint;
  signature: Hex;
  chainConfig: ChainConfig;
}

/**
 * Prepares the unsigned calldata for registering a new agent on the ERC-8004 Identity Registry.
 * Does not sign or submit transactions (Invariant #2 & Task D instructions).
 */
export function prepareRegister(params: PrepareRegisterParams): PreparedTransaction {
  const identityAddress = params.chainConfig.erc8004?.identity;
  if (!identityAddress) {
    throw new Error(
      `Chain ${params.chainConfig.name} (ID ${params.chainConfig.chainId}) does not have an ERC-8004 Identity Registry configured`
    );
  }

  const data = encodeFunctionData({
    abi: identityRegistryAbi,
    functionName: "register",
    args: [params.agentURI],
  });

  return {
    to: identityAddress,
    data,
  };
}

/**
 * Prepares the unsigned calldata for updating the agent wallet on the ERC-8004 Identity Registry.
 * Does not sign or submit transactions.
 */
export function prepareSetAgentWallet(
  params: PrepareSetAgentWalletParams
): PreparedTransaction {
  const identityAddress = params.chainConfig.erc8004?.identity;
  if (!identityAddress) {
    throw new Error(
      `Chain ${params.chainConfig.name} (ID ${params.chainConfig.chainId}) does not have an ERC-8004 Identity Registry configured`
    );
  }

  const data = encodeFunctionData({
    abi: identityRegistryAbi,
    functionName: "setAgentWallet",
    args: [params.agentId, params.newWallet, params.deadline, params.signature],
  });

  return {
    to: identityAddress,
    data,
  };
}

/**
 * Reads an agent's on-chain identity records (owner, agent wallet, agent URI).
 * Returns null if the agentId does not exist or has not been registered.
 */
export async function getAgent(
  client: PublicClient,
  chainConfig: ChainConfig,
  agentId: bigint
): Promise<AgentIdentityData | null> {
  const identityAddress = chainConfig.erc8004?.identity;
  if (!identityAddress) {
    throw new Error(
      `Chain ${chainConfig.name} (ID ${chainConfig.chainId}) does not have an ERC-8004 Identity Registry configured`
    );
  }

  try {
    const [owner, agentWallet, agentURI] = await Promise.all([
      client.readContract({
        address: identityAddress,
        abi: identityRegistryAbi,
        functionName: "ownerOf",
        args: [agentId],
      }),
      client.readContract({
        address: identityAddress,
        abi: identityRegistryAbi,
        functionName: "getAgentWallet",
        args: [agentId],
      }),
      client.readContract({
        address: identityAddress,
        abi: identityRegistryAbi,
        functionName: "tokenURI",
        args: [agentId],
      }),
    ]);

    return {
      agentId,
      owner,
      agentWallet,
      agentURI,
    };
  } catch {
    // If token does not exist or call fails, gracefully return null
    return null;
  }
}
