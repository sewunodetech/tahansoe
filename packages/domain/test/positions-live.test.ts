/**
 * Test baca nyata ke Arbitrum One. Di-skip bila ARB_ONE_RPC_URL tidak di-set.
 *
 * Alamat publik dengan posisi (dicek 24 Okt 2026, bisa berubah):
 * - Aave V3: 0xb143F6cA55358Fac056eCa7aC1A228a1f018B048 (collateral ~$43k, utang ~$8,4k, HF ~4,0)
 * - Morpho Blue: 0xFC9861875E0d33A54DCC26B352A3af7e8B6C74eC (market 0x93af0a75…, 0xf4052a56…)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, http } from "viem";
import { arbitrum } from "viem/chains";
import { createAaveV3Reader, createMorphoBlueReader, ARBITRUM_ONE } from "../src";

const RPC = process.env.ARB_ONE_RPC_URL;
const AAVE_USER = "0xb143F6cA55358Fac056eCa7aC1A228a1f018B048";
const MORPHO_USER = "0xFC9861875E0d33A54DCC26B352A3af7e8B6C74eC";

describe("positions live (Arbitrum One)", { skip: !RPC && "ARB_ONE_RPC_URL not set", timeout: 120_000 }, () => {
  const client = createPublicClient({ chain: arbitrum, transport: http(RPC) });

  it("reads an Aave V3 position as monitor only", async () => {
    const positions = await createAaveV3Reader(client, ARBITRUM_ONE).read(AAVE_USER);
    for (const p of positions) {
      assert.equal(p.monitorOnly, true);
      assert.ok(p.collateral.length > 0 || p.debt.length > 0);
      if (p.debt.length > 0) assert.ok(p.healthFactor > 10n ** 18n);
    }
  });

  it("reads Morpho Blue positions via API discovery with on-chain values", async () => {
    const positions = await createMorphoBlueReader(client, ARBITRUM_ONE).read(MORPHO_USER);
    for (const p of positions) {
      assert.equal(p.protocol, "morpho-blue");
      assert.equal(p.monitorOnly, true);
      assert.match(p.marketId ?? "", /^0x[0-9a-f]{64}$/);
    }
  });
});
