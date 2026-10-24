// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TahansoeGuardianV2} from "../src/TahansoeGuardianV2.sol";
import {TahansoeGuardianV3} from "../src/TahansoeGuardianV3.sol";
import {SimPriceFeed} from "../src/testnet/SimPriceFeed.sol";
import {IPoolAddressesProvider, IAaveOracle, ReserveData} from "../src/interfaces/IAave.sol";
import {DeploySim} from "../script/DeploySim.s.sol";

interface IPoolFullOne {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)
        external;
    function getReserveData(address asset) external view returns (ReserveData memory);
}

/// End-to-end against real Aave V3 + Uniswap SwapRouter02 on an Arbitrum One fork, deployed through
/// DeploySim exactly as simnet does. Runs only when ARB_ONE_RPC_URL is set:
///   ARB_ONE_RPC_URL=https://arb1.arbitrum.io/rpc forge test --match-contract TahansoeGuardianV3ForkTest -vv
contract TahansoeGuardianV3ForkTest is Test {
    IPoolAddressesProvider constant PROVIDER = IPoolAddressesProvider(0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb);
    address constant USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    address constant WETH = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;
    address constant SWAP_ROUTER02 = 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45;
    address constant AAVE_EXECUTOR = 0xFF1137243698CaA18EE364Cc966CF0e02A4e6327;
    uint256 constant SIM_CHAIN_ID = 4216199;

    DeploySim script;
    DeploySim.Deployment d;
    TahansoeGuardianV3 guardian;
    TahansoeGuardianV2 v2;
    SimPriceFeed feed;
    IPoolFullOne aave;

    address deployer = makeAddr("deployer");
    address treasury = makeAddr("treasury");
    address updater = makeAddr("updater");
    address alice = makeAddr("alice");
    address keeper = makeAddr("keeper");

    function setUp() public {
        string memory rpc = vm.envOr("ARB_ONE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        vm.chainId(SIM_CHAIN_ID);

        script = new DeploySim();
        d = script.deploy(
            DeploySim.Config({
                deployer: deployer,
                oracleAdmin: AAVE_EXECUTOR,
                treasury: treasury,
                priceUpdater: updater,
                deployTestVault: true
            })
        );
        guardian = TahansoeGuardianV3(d.guardianV3);
        feed = SimPriceFeed(d.simPriceFeed);
        v2 = new TahansoeGuardianV2(PROVIDER, SWAP_ROUTER02, 500);
        aave = IPoolFullOne(PROVIDER.getPool());
    }

    function _wethPrice() internal view returns (uint256) {
        return IAaveOracle(PROVIDER.getPriceOracle()).getAssetPrice(WETH);
    }

    /// 1 WETH supplied, ~50% of its value borrowed in USDC (HF ~1.6 on Arbitrum One parameters).
    function _openPosition() internal {
        deal(WETH, alice, 1e18);
        vm.startPrank(alice);
        IERC20(WETH).approve(address(aave), 1e18);
        aave.supply(WETH, 1e18, alice, 0);
        aave.borrow(USDC, (_wethPrice() * 50) / 100 / 100, 2, 0, alice);
        vm.stopPrank();
    }

    function _crash(uint256 pct) internal {
        int256 next = int256((d.initialPrice * (100 - pct)) / 100);
        vm.prank(updater);
        feed.setAnswer(next);
    }

    function test_fork_sim_deployment() public {
        assertEq(guardian.treasury(), treasury);
        assertEq(address(guardian.swapRouter()), SWAP_ROUTER02);
        assertEq(guardian.swapFee(), 500);
        assertEq(feed.updater(), updater);
        assertEq(feed.decimals(), 8);
        assertEq(_wethPrice(), d.initialPrice, "AaveOracle reads SimPriceFeed");
        assertTrue(d.testVault != address(0));
        assertTrue(d.previousWethSource != d.simPriceFeed);
        string memory json = script.toJson(d);
        assertEq(vm.parseJsonAddress(json, ".guardianV3"), d.guardianV3, "SIM_DEPLOYMENT json");
        assertEq(vm.parseJsonUint(json, ".chainId"), SIM_CHAIN_ID);
    }

    function test_fork_sim_priceFeedDrivesAaveOracle() public {
        _crash(30);
        assertEq(_wethPrice(), (d.initialPrice * 70) / 100);
        (uint80 roundId, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        assertEq(roundId, 2);
        assertEq(uint256(answer), _wethPrice());
        assertEq(updatedAt, block.timestamp);

        vm.expectRevert(SimPriceFeed.Unauthorized.selector);
        feed.setAnswer(1);
    }

    function test_fork_sim_runRequiresSimChainId() public {
        vm.chainId(42161);
        vm.expectRevert(bytes("DeploySim: block.chainid != SIM_CHAIN_ID"));
        script.run();
    }

    function test_fork_v3_layer1_feeAndParityWithV2() public {
        _openPosition();
        deal(USDC, alice, 5_000e6);
        vm.startPrank(alice);
        IERC20(USDC).approve(address(guardian), 5_000e6);
        IERC20(USDC).approve(address(v2), 5_000e6);
        guardian.setPolicy(USDC, 1.3e18, 1.6e18, 5_000e6);
        v2.setPolicy(USDC, 1.3e18, 1.6e18, 5_000e6);
        vm.stopPrank();
        assertFalse(guardian.needsProtection(alice));

        _crash(25);
        assertTrue(guardian.needsProtection(alice));
        (bool eligible, uint256 quoted) = guardian.quoteFee(alice);
        assertTrue(eligible);

        uint256 snap = vm.snapshotState();
        vm.prank(keeper);
        uint256 repaidV2 = v2.protect(alice);
        uint256 hfV2 = v2.healthFactor(alice);
        uint256 walletV2 = IERC20(USDC).balanceOf(alice);
        vm.revertToState(snap);

        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);
        uint256 fee = (repaid * 15) / 10_000;

        assertEq(repaid, repaidV2, "repay identical to V2");
        assertEq(guardian.healthFactor(alice), hfV2, "HF identical to V2");
        assertEq(IERC20(USDC).balanceOf(treasury), fee, "exact success fee");
        assertEq(fee, quoted, "quoteFee matches");
        assertEq(IERC20(USDC).balanceOf(alice) + fee, walletV2);
        assertGe(guardian.healthFactor(alice), 1.6e18);
        assertEq(IERC20(USDC).balanceOf(address(guardian)), 0);
    }

    function test_fork_v3_layer3_realUniswap_withFee() public {
        _openPosition();
        address aWeth = aave.getReserveData(WETH).aTokenAddress;
        deal(USDC, alice, 100e6); // small wallet reserve: L1 capped at 1 USDC, rest available for the fee
        vm.startPrank(alice);
        IERC20(USDC).approve(address(guardian), 100e6);
        IERC20(aWeth).approve(address(guardian), 1e18);
        guardian.setPolicy(USDC, 1.3e18, 1.6e18, 1e6);
        guardian.setLayer3(true, WETH, 1e18, 300);
        vm.stopPrank();

        _crash(25);
        assertTrue(guardian.needsProtection(alice));
        uint256 hfBefore = guardian.healthFactor(alice);

        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        assertGt(repaid, 1e6, "L3 repaid beyond the L1 cap");
        assertGt(guardian.healthFactor(alice), hfBefore);
        assertEq(IERC20(USDC).balanceOf(treasury), (repaid * 15) / 10_000, "fee from leftover + wallet");
        assertEq(IERC20(USDC).balanceOf(address(guardian)), 0);
        assertEq(IERC20(WETH).balanceOf(address(guardian)), 0);
        assertEq(IERC20(aWeth).balanceOf(address(guardian)), 0);
    }
}
