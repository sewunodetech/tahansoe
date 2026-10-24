import type { Address } from "viem";
import {
  getChainConfig,
  latestGuardian,
  isPerPositionGuardian,
  type GuardianDeployment,
} from "@tahansoe/domain";
import type { ProtocolType } from "./types";

export interface SimContractsV4Like {
  guardian?: Address;
  guardianAaveV4?: Address;
  guardianMorpho?: Address;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/**
 * Gets the v4 Guardian deployment for a given protocol on the target chain.
 * Uses official domain helpers `latestGuardian` and `isPerPositionGuardian`.
 */
export function getGuardianV4Deployment({
  chainId,
  protocol,
  isSimulation,
  simContracts,
}: {
  chainId: number;
  protocol: ProtocolType;
  isSimulation?: boolean;
  simContracts?: SimContractsV4Like | null;
}): GuardianDeployment | null {
  if (isSimulation) {
    const address = getGuardianV4Address({ chainId, protocol, isSimulation, simContracts });
    if (!address) return null;
    return {
      version: 4,
      address,
      deployedBlock: 0,
      protocol,
      features: { layer2: true, layer3: true, triggerBand: true },
    };
  }

  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) return null;

  const deployment = latestGuardian(chainConfig, protocol);
  if (deployment && isPerPositionGuardian(deployment)) {
    return deployment;
  }

  return null;
}

/**
 * Gets the v4 Guardian address for a given protocol on the target chain.
 * Uses domain helpers `latestGuardian` and `isPerPositionGuardian`.
 */
export function getGuardianV4Address({
  chainId,
  protocol,
  isSimulation,
  simContracts,
}: {
  chainId: number;
  protocol: ProtocolType;
  isSimulation?: boolean;
  simContracts?: SimContractsV4Like | null;
}): Address | null {
  if (isSimulation) {
    if (protocol === "aave-v3") {
      const addr = simContracts?.guardianAaveV4;
      if (addr && addr !== ZERO_ADDRESS) return addr;
      return null;
    }
    if (protocol === "morpho-blue") {
      const addr = simContracts?.guardianMorpho;
      if (addr && addr !== ZERO_ADDRESS) return addr;
      return null;
    }
    return null;
  }

  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) return null;

  const deployment = latestGuardian(chainConfig, protocol);
  if (deployment && isPerPositionGuardian(deployment)) {
    return deployment.address;
  }

  return null;
}

/**
 * Checks if v4 Guardian contracts are available on this chain / session.
 */
export function isGuardianV4Available({
  chainId,
  isSimulation,
  simContracts,
}: {
  chainId: number;
  isSimulation?: boolean;
  simContracts?: SimContractsV4Like | null;
}): boolean {
  const aaveV4 = getGuardianV4Address({ chainId, protocol: "aave-v3", isSimulation, simContracts });
  const morphoV4 = getGuardianV4Address({ chainId, protocol: "morpho-blue", isSimulation, simContracts });
  return Boolean(aaveV4 || morphoV4);
}
