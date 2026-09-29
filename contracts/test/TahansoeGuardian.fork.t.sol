// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TahansoeGuardian} from "../src/TahansoeGuardian.sol";
import {IPoolAddressesProvider, IAaveOracle} from "../src/interfaces/IAave.sol";

interface IPoolFull {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external;
}

/// End-to-end against the real Aave V3 deployment on Arbitrum Sepolia.
/// Runs only when ARB_SEPOLIA_RPC_URL is set:
///   ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc forge test --match-contract Fork -vv
contract TahansoeGuardianForkTest is Test {
    // bgd-labs/aave-address-book: AaveV3ArbitrumSepolia
    IPoolAddressesProvider constant PROVIDER = IPoolAddressesProvider(0xB25a5D144626a0D488e52AE717A051a2E9997076);
    address constant USDC = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
    address constant WETH = 0x1dF462e2712496373A347f8ad10802a5E95f053D;

    TahansoeGuardian guardian;
    IPoolFull aave;
    address alice = makeAddr("alice");

    function setUp() public {
        string memory rpc = vm.envOr("ARB_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);

        guardian = new TahansoeGuardian(PROVIDER);
        aave = IPoolFull(PROVIDER.getPool());
    }

    function test_fork_protectsRealAavePosition() public {
        // Open a position: 1 WETH collateral, borrow USDC against half its value.
        deal(WETH, alice, 1e18);
        deal(USDC, alice, 5_000e6); // the hot reserve Tahansoe may use
        uint256 ethPrice = IAaveOracle(PROVIDER.getPriceOracle()).getAssetPrice(WETH);

        vm.startPrank(alice);
        IERC20(WETH).approve(address(aave), 1e18);
        aave.supply(WETH, 1e18, alice, 0);
        uint256 borrowUsd = (ethPrice * 50) / 100; // 50% of collateral value, 8 decimals
        aave.borrow(USDC, borrowUsd / 100, 2, 0, alice); // 8 → 6 decimals

        IERC20(USDC).approve(address(guardian), type(uint256).max);
        guardian.setPolicy(USDC, 1.3e18, 1.6e18, 5_000e6);
        vm.stopPrank();

        uint256 hfOpen = guardian.healthFactor(alice);
        emit log_named_decimal_uint("HF after borrow", hfOpen, 18);
        assertFalse(guardian.needsProtection(alice), "starts above trigger");

        // ETH drops 25%: mock the Aave oracle's WETH price.
        vm.mockCall(
            PROVIDER.getPriceOracle(),
            abi.encodeCall(IAaveOracle.getAssetPrice, (WETH)),
            abi.encode((ethPrice * 75) / 100)
        );
        uint256 hfCrash = guardian.healthFactor(alice);
        emit log_named_decimal_uint("HF after ETH -25%", hfCrash, 18);
        assertTrue(guardian.needsProtection(alice), "now at risk");

        uint256 repaid = guardian.protect(alice);
        uint256 hfAfter = guardian.healthFactor(alice);
        emit log_named_decimal_uint("USDC repaid", repaid, 6);
        emit log_named_decimal_uint("HF after Tahansoe", hfAfter, 18);

        assertGe(hfAfter, 1.6e18, "restored to target");
        assertEq(IERC20(USDC).balanceOf(address(guardian)), 0);
    }
}
