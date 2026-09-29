// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TahansoeGuardian} from "../src/TahansoeGuardian.sol";
import {IPoolAddressesProvider} from "../src/interfaces/IAave.sol";

/// Deploys TahansoeGuardian against Aave V3 on Arbitrum Sepolia.
///
///   forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia \
///     --account <keystore-name> --broadcast --verify
contract Deploy is Script {
    // bgd-labs/aave-address-book: AaveV3ArbitrumSepolia.POOL_ADDRESSES_PROVIDER
    address constant AAVE_V3_PROVIDER_ARB_SEPOLIA = 0xB25a5D144626a0D488e52AE717A051a2E9997076;

    function run() external returns (TahansoeGuardian guardian) {
        require(block.chainid == 421614, "Deploy: expected Arbitrum Sepolia (421614)");

        vm.startBroadcast();
        guardian = new TahansoeGuardian(IPoolAddressesProvider(AAVE_V3_PROVIDER_ARB_SEPOLIA));
        vm.stopBroadcast();

        console.log("TahansoeGuardian deployed at", address(guardian));
        console.log("Aave pool", address(guardian.pool()));
    }
}
