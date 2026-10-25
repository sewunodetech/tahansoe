import type { Address } from "viem";

export interface AgentService {
  name: string;
  endpoint: string;
  version?: string;
}

export interface SupportedGuardianInfo {
  version: number;
  address: Address;
  protocol?: string;
}

export interface AgentRegistrationFile {
  type: string;
  name: string;
  description: string;
  image?: string;
  services: AgentService[];
  x402Support?: boolean;
  active?: boolean;
  supportedTrust: string[];
  strategyVersion?: string;
  supportedGuardians?: SupportedGuardianInfo[];
}

export interface ReputationSummaryData {
  count: bigint;
  summaryValue: bigint;
  summaryValueDecimals: number;
  totalClients: number;
  verifiedClientsCount: number;
}

export interface AgentIdentityState {
  loading: boolean;
  registered: boolean;
  agentId: bigint | null;
  owner: Address | null;
  agentWallet: Address | null;
  agentURI: string | null;
  metadata: AgentRegistrationFile | null;
  reputation: ReputationSummaryData;
  error: string | null;
}
