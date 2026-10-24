// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TahansoeGuardianAaveV4} from "../src/TahansoeGuardianAaveV4.sol";
import {MockSwapRouter} from "../src/testnet/MockSwapRouter.sol";
import {IPoolAddressesProvider} from "../src/interfaces/IAave.sol";

/// @title DeployAaveV4
/// @notice Deploys TahansoeGuardianAaveV4 against Aave V3 on Arbitrum Sepolia.
///
/// Usage:
///   forge script script/DeployAaveV4.s.sol:DeployAaveV4 --rpc-url arbitrum_sepolia \
///     --account tahansoe-deployer --broadcast --verify
contract DeployAaveV4 is Script {
    address constant AAVE_V3_PROVIDER_ARB_SEPOLIA = 0xB25a5D144626a0D488e52AE717A051a2E9997076;
    uint24 constant SWAP_FEE = 500; // 0.05%
    uint16 constant SPREAD_BPS = 30; // 0.3%

    function run() external returns (TahansoeGuardianAaveV4 guardian, address router) {
        require(block.chainid == 421614, "DeployAaveV4: expected Arbitrum Sepolia (421614)");

        IPoolAddressesProvider provider = IPoolAddressesProvider(AAVE_V3_PROVIDER_ARB_SEPOLIA);
        address oracle = provider.getPriceOracle();

        address routerEnv = vm.envOr("SWAP_ROUTER", address(0));
        address treasury = vm.envOr("TREASURY", msg.sender);

        vm.startBroadcast();

        // 1. Use existing SwapRouter or deploy MockSwapRouter
        if (routerEnv != address(0)) {
            router = routerEnv;
        } else {
            router = address(new MockSwapRouter(oracle, SPREAD_BPS));
        }

        // 2. Deploy TahansoeGuardianAaveV4
        guardian = new TahansoeGuardianAaveV4(provider, router, SWAP_FEE, treasury);

        vm.stopBroadcast();

        console.log("--------------------------------------------------");
        console.log("MockSwapRouter:", router);
        console.log("TahansoeGuardianAaveV4 deployed at:", address(guardian));
        console.log("Treasury address:", treasury);
        console.log("Aave Pool:", address(guardian.pool()));
        console.log("--------------------------------------------------");
    }
}
