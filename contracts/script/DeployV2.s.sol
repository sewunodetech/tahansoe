// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TahansoeGuardianV2} from "../src/TahansoeGuardianV2.sol";
import {MockSwapRouter} from "../src/testnet/MockSwapRouter.sol";
import {TestVault} from "../src/testnet/TestVault.sol";
import {IPoolAddressesProvider} from "../src/interfaces/IAave.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Deploys TahansoeGuardianV2, MockSwapRouter, and TestVault against Aave V3 on Arbitrum Sepolia.
///
///   forge script script/DeployV2.s.sol --rpc-url arbitrum_sepolia \
///     --account <keystore-name> --broadcast --verify
contract DeployV2 is Script {
    address constant AAVE_V3_PROVIDER_ARB_SEPOLIA = 0xB25a5D144626a0D488e52AE717A051a2E9997076;
    address constant USDC_ARB_SEPOLIA = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
    uint24 constant SWAP_FEE = 500; // 0.05%
    uint16 constant SPREAD_BPS = 30; // 0.3%

    function run() external returns (TahansoeGuardianV2 guardian, MockSwapRouter router, TestVault vault) {
        require(block.chainid == 421614, "DeployV2: expected Arbitrum Sepolia (421614)");

        IPoolAddressesProvider provider = IPoolAddressesProvider(AAVE_V3_PROVIDER_ARB_SEPOLIA);
        address oracle = provider.getPriceOracle();

        vm.startBroadcast();

        // 1. Deploy MockSwapRouter (uses Aave oracle for testnet swaps)
        router = new MockSwapRouter(oracle, SPREAD_BPS);

        // 2. Deploy TahansoeGuardianV2
        guardian = new TahansoeGuardianV2(provider, address(router), SWAP_FEE);

        // 3. Deploy TestVault over USDC for Layer 2 ERC-4626 testing
        vault = new TestVault(IERC20(USDC_ARB_SEPOLIA), "Tahansoe Test USDC Vault", "vUSDC");

        vm.stopBroadcast();

        console.log("MockSwapRouter deployed at:", address(router));
        console.log("TahansoeGuardianV2 deployed at:", address(guardian));
        console.log("TestVault deployed at:", address(vault));
        console.log("Aave Pool:", address(guardian.pool()));
    }
}
