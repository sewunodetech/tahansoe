// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TahansoeGuardianV2, L2_NONE, L2_ERC4626, L2_ATOKEN} from "../src/TahansoeGuardianV2.sol";
import {MockSwapRouter} from "../src/testnet/MockSwapRouter.sol";
import {TestVault} from "../src/testnet/TestVault.sol";
import {IPoolAddressesProvider, IAaveOracle, IPool, ReserveData} from "../src/interfaces/IAave.sol";

interface IPoolFull {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)
        external;
    function getReserveData(address asset) external view returns (ReserveData memory);
}

/// End-to-end against the real Aave V3 deployment on Arbitrum Sepolia.
/// Runs only when ARB_SEPOLIA_RPC_URL is set:
///   ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc forge test --match-contract TahansoeGuardianV2ForkTest -vv
contract TahansoeGuardianV2ForkTest is Test {
    IPoolAddressesProvider constant PROVIDER = IPoolAddressesProvider(0xB25a5D144626a0D488e52AE717A051a2E9997076);
    address constant USDC = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
    address constant WETH = 0x1dF462e2712496373A347f8ad10802a5E95f053D;

    TahansoeGuardianV2 guardian;
    MockSwapRouter router;
    TestVault vault;
    IPoolFull aave;
    address aTokenWeth;
    address aTokenUsdc;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        string memory rpc = vm.envOr("ARB_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);

        aave = IPoolFull(PROVIDER.getPool());
        address oracle = PROVIDER.getPriceOracle();

        // Deploy MockSwapRouter priced by Aave oracle
        router = new MockSwapRouter(oracle, 30);

        // Deploy Guardian v2
        guardian = new TahansoeGuardianV2(PROVIDER, address(router), 500);

        // Deploy TestVault
        vault = new TestVault(IERC20(USDC), "USDC Vault", "vUSDC");

        // Fund router with USDC for flash loan swaps
        deal(USDC, address(router), 1_000_000e6);

        // Get aToken addresses
        aTokenWeth = aave.getReserveData(WETH).aTokenAddress;
        aTokenUsdc = aave.getReserveData(USDC).aTokenAddress;
    }

    function test_fork_v2_protect_layer1() public {
        deal(WETH, alice, 1e18);
        deal(USDC, alice, 5_000e6);
        uint256 ethPrice = IAaveOracle(PROVIDER.getPriceOracle()).getAssetPrice(WETH);

        vm.startPrank(alice);
        IERC20(WETH).approve(address(aave), 1e18);
        aave.supply(WETH, 1e18, alice, 0);
        uint256 borrowUsd = (ethPrice * 50) / 100;
        aave.borrow(USDC, borrowUsd / 100, 2, 0, alice);

        IERC20(USDC).approve(address(guardian), 5_000e6);
        guardian.setPolicy(USDC, 1.3e18, 1.6e18, 5_000e6);
        vm.stopPrank();

        assertFalse(guardian.needsProtection(alice));

        // Drop ETH by 25%
        vm.mockCall(
            PROVIDER.getPriceOracle(),
            abi.encodeCall(IAaveOracle.getAssetPrice, (WETH)),
            abi.encode((ethPrice * 75) / 100)
        );

        assertTrue(guardian.needsProtection(alice));

        uint256 repaid = guardian.protect(alice);
        uint256 hfAfter = guardian.healthFactor(alice);

        assertGt(repaid, 0);
        assertGe(hfAfter, 1.6e18);
        assertEq(IERC20(USDC).balanceOf(address(guardian)), 0);
    }

    function test_fork_v2_protect_layer2_vault() public {
        deal(WETH, alice, 2e18);
        deal(USDC, alice, 5_000e6);
        uint256 ethPrice = IAaveOracle(PROVIDER.getPriceOracle()).getAssetPrice(WETH);

        vm.startPrank(alice);
        // Deposit into vault
        IERC20(USDC).approve(address(vault), 5_000e6);
        vault.deposit(5_000e6, alice);

        IERC20(WETH).approve(address(aave), 2e18);
        aave.supply(WETH, 2e18, alice, 0);
        uint256 borrowUsd = (ethPrice * 100) / 100;
        aave.borrow(USDC, borrowUsd / 100, 2, 0, alice);

        // Configure L1 with 0 allowance and L2 with vault shares
        vault.approve(address(guardian), 5_000e6);
        guardian.setPolicy(USDC, 1.3e18, 1.6e18, 5_000e6);
        guardian.setLayer2(L2_ERC4626, address(vault), 5_000e6);
        vm.stopPrank();

        // Drop ETH by 25%
        vm.mockCall(
            PROVIDER.getPriceOracle(),
            abi.encodeCall(IAaveOracle.getAssetPrice, (WETH)),
            abi.encode((ethPrice * 75) / 100)
        );

        assertTrue(guardian.needsProtection(alice));

        uint256 repaid = guardian.protect(alice);
        uint256 hfAfter = guardian.healthFactor(alice);

        assertGt(repaid, 0);
        assertGe(hfAfter, 1.6e18);
        assertEq(IERC20(USDC).balanceOf(address(guardian)), 0);
        assertEq(vault.balanceOf(address(guardian)), 0);
    }

    function test_fork_v2_protect_layer3_flashLoan() public {
        deal(WETH, alice, 2e18);
        deal(USDC, alice, 100e6);
        uint256 ethPrice = IAaveOracle(PROVIDER.getPriceOracle()).getAssetPrice(WETH);

        vm.startPrank(alice);
        IERC20(WETH).approve(address(aave), 2e18);
        aave.supply(WETH, 2e18, alice, 0);
        uint256 borrowUsd = (ethPrice * 100) / 100;
        aave.borrow(USDC, borrowUsd / 100, 2, 0, alice);

        // Approve collateral aToken to Guardian for L3
        IERC20(aTokenWeth).approve(address(guardian), type(uint256).max);

        guardian.setPolicy(USDC, 1.3e18, 1.6e18, 5_000e6);
        guardian.setLayer3(true, WETH, 1.5e18, 300);
        vm.stopPrank();

        // Drop ETH by 25%
        vm.mockCall(
            PROVIDER.getPriceOracle(),
            abi.encodeCall(IAaveOracle.getAssetPrice, (WETH)),
            abi.encode((ethPrice * 75) / 100)
        );

        assertTrue(guardian.needsProtection(alice));

        uint256 hfBefore = guardian.healthFactor(alice);
        uint256 repaid = guardian.protect(alice);
        uint256 hfAfter = guardian.healthFactor(alice);

        assertGt(repaid, 0);
        assertGt(hfAfter, hfBefore);
        assertEq(IERC20(USDC).balanceOf(address(guardian)), 0);
        assertEq(IERC20(WETH).balanceOf(address(guardian)), 0);
        assertEq(IERC20(aTokenWeth).balanceOf(address(guardian)), 0);
    }
}
