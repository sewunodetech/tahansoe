// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TahansoeGuardianV2, L2_ERC4626} from "../src/TahansoeGuardianV2.sol";
import {TestVault} from "../src/testnet/TestVault.sol";
import {IPoolAddressesProvider, IAaveOracle, IPool, ReserveData} from "../src/interfaces/IAave.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPoolFull {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)
        external;
    function getReserveData(address asset) external view returns (ReserveData memory);
}

/// Sets up a demo borrower position on Arbitrum Sepolia with all 3 protection layers configured.
///
/// Run:
///   GUARDIAN_V2=0x... TEST_VAULT=0x... forge script script/DemoScenario.s.sol \
///     --rpc-url arbitrum_sepolia --account <keystore-name> --broadcast
contract DemoScenario is Script {
    address constant AAVE_V3_PROVIDER_ARB_SEPOLIA = 0xB25a5D144626a0D488e52AE717A051a2E9997076;
    address constant USDC = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
    address constant WETH = 0x1dF462e2712496373A347f8ad10802a5E95f053D;

    function run() external {
        address guardianAddr = vm.envAddress("GUARDIAN_V2");
        address vaultAddr = vm.envOr("TEST_VAULT", address(0));

        TahansoeGuardianV2 guardian = TahansoeGuardianV2(guardianAddr);
        IPoolFull aave = IPoolFull(IPoolAddressesProvider(AAVE_V3_PROVIDER_ARB_SEPOLIA).getPool());
        address aTokenWeth = aave.getReserveData(WETH).aTokenAddress;

        vm.startBroadcast();

        address me = msg.sender;
        console.log("Demo user:", me);

        // 1. Supply 0.05 WETH collateral
        uint256 supplyAmt = 0.05e18;
        if (IERC20(WETH).balanceOf(me) >= supplyAmt) {
            IERC20(WETH).approve(address(aave), supplyAmt);
            aave.supply(WETH, supplyAmt, me, 0);
            console.log("Supplied WETH:", supplyAmt);
        }

        // 2. Borrow 50 USDC against collateral
        uint256 borrowAmt = 50e6;
        try aave.borrow(USDC, borrowAmt, 2, 0, me) {
            console.log("Borrowed USDC:", borrowAmt);
        } catch {
            console.log("Borrow skipped or already borrowed");
        }

        // 3. Set Layer 1 Policy: trigger HF = 1.3, target HF = 1.6, maxRepay = 20 USDC
        IERC20(USDC).approve(address(guardian), 20e6);
        guardian.setPolicy(USDC, 1.3e18, 1.6e18, 20e6);
        console.log("Configured Layer 1 policy");

        // 4. Set Layer 2 Policy (ERC4626 vault if provided)
        if (vaultAddr != address(0) && IERC20(USDC).balanceOf(me) >= 10e6) {
            TestVault vault = TestVault(vaultAddr);
            IERC20(USDC).approve(vaultAddr, 10e6);
            vault.deposit(10e6, me);
            vault.approve(address(guardian), 10e6);
            guardian.setLayer2(L2_ERC4626, vaultAddr, 10e6);
            console.log("Configured Layer 2 vault policy");
        }

        // 5. Set Layer 3 Policy (Flash loan deleverage)
        IERC20(aTokenWeth).approve(address(guardian), type(uint256).max);
        guardian.setLayer3(true, WETH, 0.02e18, 300); // max 0.02 WETH collateral sold, 3% slippage
        console.log("Configured Layer 3 flash loan policy");

        // 6. Check health factor
        uint256 hf = guardian.healthFactor(me);
        console.log("Current Health Factor:", hf);

        if (guardian.needsProtection(me)) {
            console.log("Position needs protection, triggering protect()...");
            uint256 repaid = guardian.protect(me);
            console.log("Repaid total debt:", repaid);
            console.log("New Health Factor:", guardian.healthFactor(me));
        } else {
            console.log("Position is currently safe (above trigger HF)");
        }

        vm.stopBroadcast();
    }
}
