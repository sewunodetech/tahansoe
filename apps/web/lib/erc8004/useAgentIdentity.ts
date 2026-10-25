"use client";

import { useEffect, useState, useCallback } from "react";
import { usePublicClient } from "wagmi";
import type { Address } from "viem";
import { LIVE_CHAIN_CONFIG } from "@/lib/contracts";
import { identityRegistryAbi, reputationRegistryAbi } from "./abi";
import { filterClientsWithGuardianPolicy } from "./sybil";
import type {
  AgentIdentityState,
  AgentRegistrationFile,
} from "./types";

const DEFAULT_AGENT_ID = 1n;

const INITIAL_STATE: AgentIdentityState = {
  loading: true,
  registered: false,
  agentId: null,
  owner: null,
  agentWallet: null,
  agentURI: null,
  metadata: null,
  reputation: {
    count: 0n,
    summaryValue: 0n,
    summaryValueDecimals: 0,
    totalClients: 0,
    verifiedClientsCount: 0,
  },
  error: null,
};

function resolveUriToHttp(uri: string): string {
  if (uri.startsWith("ipfs://")) {
    const hash = uri.slice(7);
    return `https://gateway.pinata.cloud/ipfs/${hash}`;
  }
  return uri;
}

export function useAgentIdentity(customAgentId: bigint = DEFAULT_AGENT_ID) {
  // Always read the registry on the live chain, never the wallet's current chain (the wagmi
  // default is Arbitrum One, where the Sepolia registry address has no code).
  const publicClient = usePublicClient({ chainId: LIVE_CHAIN_CONFIG.chainId });
  const [state, setState] = useState<AgentIdentityState>(INITIAL_STATE);

  const fetchIdentity = useCallback(async () => {
    const chainConfig = LIVE_CHAIN_CONFIG;
    const identityAddress = chainConfig.erc8004?.identity;
    const reputationAddress = chainConfig.erc8004?.reputation;

    if (!publicClient || !identityAddress || !reputationAddress) {
      setState((prev) => ({
        ...prev,
        loading: false,
        registered: false,
        error: "ERC-8004 registries not configured for this network",
      }));
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      // 1. Read Agent Identity from Identity Registry
      let owner: Address;

      // Only ownerOf decides registration; wallet and URI are optional extras.
      try {
        owner = await publicClient.readContract({
          address: identityAddress,
          abi: identityRegistryAbi,
          functionName: "ownerOf",
          args: [customAgentId],
        });
      } catch {
        // Agent is not minted / registered yet
        setState({
          ...INITIAL_STATE,
          loading: false,
          registered: false,
          agentId: customAgentId,
        });
        return;
      }
      const [agentWallet, agentURI] = await Promise.all([
        publicClient
          .readContract({
            address: identityAddress,
            abi: identityRegistryAbi,
            functionName: "getAgentWallet",
            args: [customAgentId],
          })
          .catch(() => owner),
        publicClient
          .readContract({
            address: identityAddress,
            abi: identityRegistryAbi,
            functionName: "tokenURI",
            args: [customAgentId],
          })
          .catch(() => ""),
      ]);

      // 2. Fetch Registration Metadata File
      let metadata: AgentRegistrationFile | null = null;
      if (agentURI) {
        try {
          const httpUrl = resolveUriToHttp(agentURI);
          const res = await fetch(httpUrl, { signal: AbortSignal.timeout(4000) });
          if (res.ok) {
            metadata = (await res.json()) as AgentRegistrationFile;
          }
        } catch {
          // Do not silently fall back to local mock fixtures; preserve on-chain URI integrity
          metadata = null;
        }
      }

      // 3. Read Reputation and Apply Sybil Filter (ADR 0017)
      let rawClients: Address[] = [];
      let verifiedClients: Address[] = [];
      let count = 0n;
      let summaryValue = 0n;
      let summaryValueDecimals = 0;

      try {
        const clients = await publicClient.readContract({
          address: reputationAddress,
          abi: reputationRegistryAbi,
          functionName: "getClients",
          args: [customAgentId],
        });
        rawClients = [...clients];

        // Sybil filter: retain only verified Guardian policyholders
        verifiedClients = await filterClientsWithGuardianPolicy(
          publicClient,
          chainConfig,
          rawClients
        );

        if (verifiedClients.length > 0) {
          const summary = await publicClient.readContract({
            address: reputationAddress,
            abi: reputationRegistryAbi,
            functionName: "getSummary",
            args: [customAgentId, verifiedClients, "", ""],
          });
          count = summary[0];
          summaryValue = summary[1];
          summaryValueDecimals = summary[2];
        }
      } catch {
        // Reputation calls may be empty or uninitialized
      }

      setState({
        loading: false,
        registered: true,
        agentId: customAgentId,
        owner,
        agentWallet,
        agentURI,
        metadata,
        reputation: {
          count,
          summaryValue,
          summaryValueDecimals,
          totalClients: rawClients.length,
          verifiedClientsCount: verifiedClients.length,
        },
        error: null,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load agent identity",
      }));
    }
  }, [publicClient, customAgentId]);

  useEffect(() => {
    void fetchIdentity();
  }, [fetchIdentity]);

  return {
    ...state,
    refetch: fetchIdentity,
  };
}
