import { ARBITRUM_SEPOLIA, type Address, type ChainConfig, type GuardianDeployment } from "@tahansoe/domain";

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
  x402Support: boolean;
  active: boolean;
  supportedTrust: string[];
  strategyVersion: string;
  supportedGuardians: SupportedGuardianInfo[];
}

export interface BuildRegistrationFileParams {
  name?: string;
  description?: string;
  image?: string;
  strategyVersion?: string;
  webUrl?: string;
  scorecardUrl?: string;
  chainConfig?: ChainConfig;
}

export const DEFAULT_AGENT_NAME = "Tahansoe Protection Agent";
export const DEFAULT_AGENT_DESCRIPTION =
  "Autonomous non-custodial risk agent protecting on-chain borrow positions from liquidation";
export const DEFAULT_STRATEGY_VERSION = "pp-2026.11.1";
export const DEFAULT_WEB_URL = "https://tahansoe.xyz";
export const DEFAULT_SCORECARD_URL = "https://tahansoe.xyz/scorecard";
export const DEFAULT_AGENT_IMAGE = "https://tahansoe.xyz/brand/agent-avatar.png";

/**
 * Builds the ERC-8004 Agent Registration File (spec m4 §3.7, ADR 0017).
 */
export function buildRegistrationFile(
  params: BuildRegistrationFileParams = {}
): AgentRegistrationFile {
  const chain = params.chainConfig ?? ARBITRUM_SEPOLIA;
  const webUrl = params.webUrl ?? DEFAULT_WEB_URL;
  const scorecardUrl = params.scorecardUrl ?? DEFAULT_SCORECARD_URL;

  // Extract supported guardians from chain configuration
  const supportedGuardians: SupportedGuardianInfo[] = [];
  if (chain.guardians && chain.guardians.length > 0) {
    for (const g of chain.guardians) {
      supportedGuardians.push({
        version: g.version,
        address: g.address,
        protocol: g.protocol ?? "aave-v3",
      });
    }
  } else if (chain.guardian) {
    supportedGuardians.push({
      version: 1,
      address: chain.guardian,
      protocol: "aave-v3",
    });
  }

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: params.name ?? DEFAULT_AGENT_NAME,
    description: params.description ?? DEFAULT_AGENT_DESCRIPTION,
    image: params.image ?? DEFAULT_AGENT_IMAGE,
    services: [
      {
        name: "web",
        endpoint: webUrl,
        version: "1.0.0",
      },
      {
        name: "scorecard",
        endpoint: scorecardUrl,
        version: "1.0.0",
      },
    ],
    x402Support: false,
    active: true,
    supportedTrust: ["reputation"],
    strategyVersion: params.strategyVersion ?? DEFAULT_STRATEGY_VERSION,
    supportedGuardians,
  };
}
