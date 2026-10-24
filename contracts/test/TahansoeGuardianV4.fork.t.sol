// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TahansoeGuardianAaveV4} from "../src/TahansoeGuardianAaveV4.sol";
import {TahansoeGuardianMorpho} from "../src/TahansoeGuardianMorpho.sol";
import {SimPriceFeed} from "../src/testnet/SimPriceFeed.sol";
import {
    IPoolAddressesProvider,
    IAaveOracle,
    ReserveData
} from "../src/interfaces/IAave.sol";
import {
    IMorpho,
    MarketParams,
    Position,
    Market
} from "../src/interfaces/IMorpho.sol";
import {MockMorphoOracle} from "./mocks/MockMorpho.sol";
import {DeploySim} from "../script/DeploySim.s.sol";

interface IPoolFull {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function borrow(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        uint16 referralCode,
        address onBehalfOf
    ) external;
    function getReserveData(address asset) external view returns (ReserveData memory);
}

interface IMorphoFull {
    function owner() external view returns (address);
    function isLltvEnabled(uint256 lltv) external view returns (bool);
    function enableLltv(uint256 lltv) external;
    function createMarket(MarketParams memory marketParams) external;
    function supply(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        bytes memory data
    ) external returns (uint256, uint256);
    function supplyCollateral(
        MarketParams memory marketParams,
        uint256 assets,
        address onBehalf,
        bytes memory data
    ) external;
    function borrow(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        address receiver
    ) external returns (uint256, uint256);
    function position(bytes32 id, address user) external view returns (Position memory);
}

/// @notice End-to-end tests against real Aave V3 + Morpho Blue on Arbitrum One fork.
/// Gated by ARB_ONE_RPC_URL:
///   ARB_ONE_RPC_URL=https://arb1.arbitrum.io/rpc forge test --match-contract TahansoeGuardianV4ForkTest -vv
contract TahansoeGuardianV4ForkTest is Test {
    IPoolAddressesProvider constant PROVIDER = IPoolAddressesProvider(0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb);
    address constant USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    address constant WETH = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;
    address constant USDT = 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9;
    address constant SWAP_ROUTER02 = 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45;
    address constant AAVE_EXECUTOR = 0xFF1137243698CaA18EE364Cc966CF0e02A4e6327;
    address constant MORPHO_BLUE = 0x6c247b1F6182318877311737BaC0844bAa518F5e;
    uint256 constant SIM_CHAIN_ID = 4216199;

    DeploySim script;
    DeploySim.Deployment d;
    TahansoeGuardianAaveV4 guardianAaveV4;
    TahansoeGuardianMorpho guardianMorpho;
    SimPriceFeed feed;
    IPoolFull aave;
    IMorphoFull morpho;

    address deployer = makeAddr("deployer");
    address treasury = makeAddr("treasury");
    address updater = makeAddr("updater");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
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

        guardianAaveV4 = TahansoeGuardianAaveV4(d.guardianAaveV4);
        guardianMorpho = TahansoeGuardianMorpho(d.guardianMorpho);
        feed = SimPriceFeed(d.simPriceFeed);
        aave = IPoolFull(PROVIDER.getPool());
        morpho = IMorphoFull(MORPHO_BLUE);
    }

    function _wethPrice() internal view returns (uint256) {
        return IAaveOracle(PROVIDER.getPriceOracle()).getAssetPrice(WETH);
    }

    function _crash(uint256 pct) internal {
        int256 next = int256((d.initialPrice * (100 - pct)) / 100);
        vm.prank(updater);
        feed.setAnswer(next);
    }

    function test_fork_v4_sim_deployment() public {
        assertEq(address(guardianAaveV4.addressesProvider()), address(PROVIDER));
        assertEq(guardianAaveV4.treasury(), treasury);
        assertEq(address(guardianMorpho.morpho()), MORPHO_BLUE);
        assertEq(guardianMorpho.treasury(), treasury);

        string memory json = script.toJson(d);
        assertEq(vm.parseJsonAddress(json, ".guardianAaveV4"), d.guardianAaveV4);
        assertEq(vm.parseJsonAddress(json, ".guardianMorpho"), d.guardianMorpho);
    }

    /// @notice Aave V3 multi-debt test:
    /// Alice borrows two debt assets (USDC and USDT). When price drops, protecting USDC only
    /// repays USDC debt, leaving USDT debt unchanged, and restores HF.
    function test_fork_aave_multiDebt_isolation() public {
        // 1. Alice supplies 2 WETH collateral
        deal(WETH, alice, 2e18);
        vm.startPrank(alice);
        IERC20(WETH).approve(address(aave), 2e18);
        aave.supply(WETH, 2e18, alice, 0);

        // 2. Alice borrows 1000 USDC and 1000 USDT
        aave.borrow(USDC, 1000e6, 2, 0, alice);
        aave.borrow(USDT, 1000e6, 2, 0, alice);

        // 3. Alice sets policies on both debt assets
        guardianAaveV4.setPolicy(USDC, 1.4e18, 1.6e18, 5000e6);
        guardianAaveV4.setPolicy(USDT, 1.3e18, 1.5e18, 5000e6);

        address[] memory prio = new address[](2);
        prio[0] = USDC;
        prio[1] = USDT;
        guardianAaveV4.setDebtPriority(prio);

        // Alice funds USDC in wallet for L1 protection
        deal(USDC, alice, 5000e6);
        IERC20(USDC).approve(address(guardianAaveV4), type(uint256).max);
        vm.stopPrank();

        // Check debt priority
        address[] memory debts = guardianAaveV4.debtAssetsOf(alice);
        assertEq(debts[0], USDC);
        assertEq(debts[1], USDT);

        // 4. Simulate crash so HF drops below 1.40
        _crash(35);
        uint256 hfBefore = guardianAaveV4.healthFactor(alice);
        assertLt(hfBefore, 1.4e18, "HF should drop below trigger");
        assertTrue(guardianAaveV4.needsProtection(alice, USDC));

        // Read USDT debt before
        ReserveData memory usdtReserve = aave.getReserveData(USDT);
        uint256 usdtDebtBefore = IERC20(usdtReserve.variableDebtTokenAddress).balanceOf(alice);

        // 5. Keeper protects USDC
        vm.prank(keeper);
        uint256 repaid = guardianAaveV4.protect(alice, USDC);
        assertGt(repaid, 0);

        // 6. Verify isolation: USDT debt is completely unchanged!
        uint256 usdtDebtAfter = IERC20(usdtReserve.variableDebtTokenAddress).balanceOf(alice);
        assertEq(usdtDebtAfter, usdtDebtBefore, "USDT debt must not be affected by USDC rescue");

        // 7. Verify HF improved and target reached
        uint256 hfAfter = guardianAaveV4.healthFactor(alice);
        assertGt(hfAfter, hfBefore);
        assertGe(hfAfter, 1.6e18);

        // 8. Guardian balance is 0
        assertEq(IERC20(USDC).balanceOf(address(guardianAaveV4)), 0);
    }

    /// @notice Morpho Blue fork test:
    /// Creates/funds a real position on Morpho Blue Arbitrum One, alice triggers protection,
    /// guardianMorpho executes L1 repay on Morpho Blue, and restores HF.
    function test_fork_morpho_blue_position_protection() public {
        // Oracle for the Morpho market
        MockMorphoOracle oracle = new MockMorphoOracle(2000e24); // $2000 / WETH

        uint256 lltv = 0.86e18; // 86% LLTV
        if (!morpho.isLltvEnabled(lltv)) {
            address morphoOwner = morpho.owner();
            vm.prank(morphoOwner);
            morpho.enableLltv(lltv);
        }

        MarketParams memory mp = MarketParams({
            loanToken: USDC,
            collateralToken: WETH,
            oracle: address(oracle),
            irm: address(0),
            lltv: lltv
        });
        bytes32 marketId = keccak256(abi.encode(mp));

        // Create market
        morpho.createMarket(mp);

        // Bob supplies 50,000 USDC liquidity to the market
        deal(USDC, bob, 50_000e6);
        vm.startPrank(bob);
        IERC20(USDC).approve(MORPHO_BLUE, 50_000e6);
        morpho.supply(mp, 50_000e6, 0, bob, "");
        vm.stopPrank();

        // Alice supplies 2 WETH ($4000) and borrows 2400 USDC ($2400).
        // Max borrow = 4000 * 0.86 = 3440. HF = 3440 / 2400 = 1.433
        deal(WETH, alice, 2e18);
        deal(USDC, alice, 5000e6);

        vm.startPrank(alice);
        IERC20(WETH).approve(MORPHO_BLUE, 2e18);
        morpho.supplyCollateral(mp, 2e18, alice, "");
        morpho.borrow(mp, 2400e6, 0, alice, alice);

        // Configure policy
        guardianMorpho.setPolicy(marketId, 1.5e18, 1.7e18, 5000e6);
        IERC20(USDC).approve(address(guardianMorpho), type(uint256).max);
        vm.stopPrank();

        uint256 hfBefore = guardianMorpho.healthFactor(alice, marketId);
        assertLt(hfBefore, 1.5e18, "Alice should be at risk");
        assertTrue(guardianMorpho.needsProtection(alice, marketId));

        Position memory posBefore = morpho.position(marketId, alice);

        // Keeper executes protection
        vm.prank(keeper);
        uint256 repaid = guardianMorpho.protect(alice, marketId);
        assertGt(repaid, 0);

        // Verifications
        uint256 hfAfter = guardianMorpho.healthFactor(alice, marketId);
        assertGt(hfAfter, hfBefore);
        assertGe(hfAfter, 1.7e18);

        Position memory posAfter = morpho.position(marketId, alice);
        assertLt(posAfter.borrowShares, posBefore.borrowShares);
        assertEq(IERC20(USDC).balanceOf(address(guardianMorpho)), 0);
    }
}
