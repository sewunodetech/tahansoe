import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import {
  getGuardianV4Address,
  getGuardianV4Deployment,
  isGuardianV4Available,
} from "./deployments";

describe("Guardian v4 deployments & address resolution", () => {
  const SEPOLIA_CHAIN_ID = 421614;
  const EXPECTED_AAVE_V4_ADDRESS = "0xa7Bbab6366a723e17cd2f220D708757e449571b4";
  const EXPECTED_AAVE_V4_DEPLOYED_BLOCK = 322451784;

  describe("Live mode on Arbitrum Sepolia", () => {
    it("resolves Aave v4 address via domain helpers", () => {
      const address = getGuardianV4Address({
        chainId: SEPOLIA_CHAIN_ID,
        protocol: "aave-v3",
      });
      assert.equal(address, EXPECTED_AAVE_V4_ADDRESS);
    });

    it("resolves Aave v4 full deployment with deployedBlock and features", () => {
      const deployment = getGuardianV4Deployment({
        chainId: SEPOLIA_CHAIN_ID,
        protocol: "aave-v3",
      });
      assert.ok(deployment);
      assert.equal(deployment.version, 4);
      assert.equal(deployment.address, EXPECTED_AAVE_V4_ADDRESS);
      assert.equal(deployment.deployedBlock, EXPECTED_AAVE_V4_DEPLOYED_BLOCK);
      assert.equal(deployment.protocol, "aave-v3");
      assert.deepEqual(deployment.features, { layer2: true, layer3: true, triggerBand: true });
    });

    it("returns null for Morpho on Arbitrum Sepolia since it has no Morpho deployment", () => {
      const address = getGuardianV4Address({
        chainId: SEPOLIA_CHAIN_ID,
        protocol: "morpho-blue",
      });
      assert.equal(address, null);

      const deployment = getGuardianV4Deployment({
        chainId: SEPOLIA_CHAIN_ID,
        protocol: "morpho-blue",
      });
      assert.equal(deployment, null);
    });

    it("reports Guardian v4 available on Arbitrum Sepolia", () => {
      const available = isGuardianV4Available({
        chainId: SEPOLIA_CHAIN_ID,
      });
      assert.equal(available, true);
    });
  });

  describe("Unknown / unsupported chain", () => {
    it("returns null and false for unregistered chains", () => {
      const address = getGuardianV4Address({
        chainId: 999999,
        protocol: "aave-v3",
      });
      assert.equal(address, null);

      const available = isGuardianV4Available({
        chainId: 999999,
      });
      assert.equal(available, false);
    });
  });

  describe("Simulation mode", () => {
    const mockAaveV4 = "0x1111111111111111111111111111111111111111" as Address;
    const mockMorphoV4 = "0x2222222222222222222222222222222222222222" as Address;

    it("resolves simulation contract addresses from simContracts", () => {
      const aaveAddr = getGuardianV4Address({
        chainId: 4216199,
        protocol: "aave-v3",
        isSimulation: true,
        simContracts: { guardianAaveV4: mockAaveV4 },
      });
      assert.equal(aaveAddr, mockAaveV4);

      const morphoAddr = getGuardianV4Address({
        chainId: 4216199,
        protocol: "morpho-blue",
        isSimulation: true,
        simContracts: { guardianMorpho: mockMorphoV4 },
      });
      assert.equal(morphoAddr, mockMorphoV4);
    });

    it("returns null when simContracts has zero address or is missing", () => {
      const addr = getGuardianV4Address({
        chainId: 4216199,
        protocol: "aave-v3",
        isSimulation: true,
        simContracts: null,
      });
      assert.equal(addr, null);

      const zeroAddr = getGuardianV4Address({
        chainId: 4216199,
        protocol: "aave-v3",
        isSimulation: true,
        simContracts: { guardianAaveV4: "0x0000000000000000000000000000000000000000" },
      });
      assert.equal(zeroAddr, null);
    });
  });
});
