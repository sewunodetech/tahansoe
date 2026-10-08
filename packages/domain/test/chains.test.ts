import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SUPPORTED_CHAINS,
  CHAINS,
  ARBITRUM_SEPOLIA,
  ARBITRUM_ONE,
  getChainConfig,
  type ChainConfig,
} from "../src/chains";
import type { Address } from "../src/types";

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

describe("sanity chains registry", () => {
  it("memiliki entri untuk Arbitrum Sepolia (421614) dan Arbitrum One (42161)", () => {
    assert.equal(SUPPORTED_CHAINS.length, 2);
    assert.equal(CHAINS[421614]?.name, "Arbitrum Sepolia");
    assert.equal(CHAINS[42161]?.name, "Arbitrum One");
  });

  it("memastikan chainId unik lintas semua konfigurasi", () => {
    const chainIds = SUPPORTED_CHAINS.map((c) => c.chainId);
    const uniqueIds = new Set(chainIds);
    assert.equal(uniqueIds.size, chainIds.length, "Semua chainId harus unik");
  });

  it("semua alamat kontrak dan feeds berformat 0x + 40 hex karakter", () => {
    function assertAddress(addr: Address | undefined, label: string) {
      if (addr !== undefined) {
        assert.match(
          addr,
          ADDRESS_REGEX,
          `Alamat ${label} (${addr}) harus berupa 0x + 40 hex karakter`
        );
      }
    }

    for (const chain of SUPPORTED_CHAINS) {
      if (chain.aave) {
        assertAddress(
          chain.aave.poolAddressesProvider,
          `${chain.name} aave.poolAddressesProvider`
        );
        assertAddress(chain.aave.pool, `${chain.name} aave.pool`);
        assertAddress(chain.aave.oracle, `${chain.name} aave.oracle`);
      }

      if (chain.morpho) {
        assertAddress(chain.morpho.morpho, `${chain.name} morpho.morpho`);
      }

      assertAddress(chain.guardian, `${chain.name} guardian`);
      assertAddress(chain.sequencerUptimeFeed, `${chain.name} sequencerUptimeFeed`);

      for (const [key, feedAddress] of Object.entries(chain.priceFeeds)) {
        assertAddress(feedAddress, `${chain.name} priceFeeds[${key}]`);
      }
    }
  });

  it("alamat Aave & Guardian Arbitrum Sepolia sesuai contracts/README.md", () => {
    assert.equal(
      ARBITRUM_SEPOLIA.aave?.poolAddressesProvider,
      "0xB25a5D144626a0D488e52AE717A051a2E9997076"
    );
    assert.equal(
      ARBITRUM_SEPOLIA.aave?.pool,
      "0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff"
    );
    assert.equal(
      ARBITRUM_SEPOLIA.guardian,
      "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E"
    );
  });

  it("alamat Arbitrum One sesuai docs/knowledge/risk-transmission.md §4", () => {
    assert.equal(
      ARBITRUM_ONE.aave?.poolAddressesProvider,
      "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb"
    );
    assert.equal(
      ARBITRUM_ONE.aave?.pool,
      "0x794a61358D6845594F94dc1DB02A252b5b4814aD"
    );
    assert.equal(
      ARBITRUM_ONE.aave?.oracle,
      "0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7"
    );
    assert.equal(
      ARBITRUM_ONE.sequencerUptimeFeed,
      "0xFdB631F5EE196F0ed6FAa767959853A9F217697D"
    );
  });

  it("RPC URL tidak di-hardcode dan dapat disuntikkan lewat parameter/env", () => {
    // Di registry statis, rpcUrls kosong
    assert.deepEqual(ARBITRUM_SEPOLIA.rpcUrls, []);
    assert.deepEqual(ARBITRUM_ONE.rpcUrls, []);

    // Melalui helper getChainConfig, rpcUrls dapat disuntikkan secara dinamis
    const customRpc = "https://arbitrum-one.publicnode.com";
    const customConfig = getChainConfig(42161, customRpc);
    assert.ok(customConfig);
    assert.deepEqual(customConfig.rpcUrls, [customRpc]);

    const multipleRpcs = [
      "https://arb1.arbitrum.io/rpc",
      "https://arbitrum.llamarpc.com",
    ];
    const multiConfig = getChainConfig(42161, multipleRpcs);
    assert.ok(multiConfig);
    assert.deepEqual(multiConfig.rpcUrls, multipleRpcs);

    // Chain yang tidak dikenali mengembalikan undefined
    assert.equal(getChainConfig(123456), undefined);
  });
});
