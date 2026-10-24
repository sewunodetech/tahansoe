import type { Address } from "viem";
import { getChainConfig } from "@tahansoe/domain";
import type { ProtocolType } from "./types";

export interface SimContractsV4Like {
  guardian?: Address;
  guardianAaveV4?: Address;
  guardianMorpho?: Address;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/**
 * Gets the v4 Guardian address for a given protocol on the target chain.
 *
 * TODO: When Task B lands with `protocol` and v4 in `@tahansoe/domain`,
 * and Task E lands with `guardianAaveV4` / `guardianMorpho` in simnet contracts,
 * update this lookup to use the official domain helpers.
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
  if (!chainConfig || !chainConfig.guardians) return null;

  // Look for a v4 deployment matching the protocol
  const found = chainConfig.guardians.find((g) => {
    const deploymentProtocol = (g as { protocol?: string }).protocol;
    return g.version === 4 && (deploymentProtocol ? deploymentProtocol === protocol : protocol === "aave-v3");
  });

  return found ? found.address : null;
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
