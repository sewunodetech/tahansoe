// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TahansoeGuardianAaveV4, L2_NONE, L2_ERC4626, L2_ATOKEN} from "../src/TahansoeGuardianAaveV4.sol";
import {GuardianCore} from "../src/lib/GuardianCore.sol";
import {IPoolAddressesProvider} from "../src/interfaces/IAave.sol";
import {MockSwapRouter} from "../src/testnet/MockSwapRouter.sol";
import {TestVault} from "../src/testnet/TestVault.sol";
import {MockToken, MockOracle, MockPool, MockProvider, MockAToken} from "./mocks/MockAave.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TahansoeGuardianAaveV4Test is Test {
    TahansoeGuardianAaveV4 public guardian;
    MockProvider public provider;
    MockPool public pool;
    MockOracle public oracle;
    MockSwapRouter public swapRouter;

    MockToken public usdc;
    MockToken public weth;
    MockToken public dai;
    MockAToken public aUsdc;
    MockAToken public aWeth;
    MockAToken public aDai;
    TestVault public vault;

    address public treasury = makeAddr("treasury");
    address public riskAgent = makeAddr("riskAgent");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    uint24 public constant SWAP_FEE = 500;
    uint256 public constant LT_WETH = 8250; // 82.5%
    uint256 public constant LT_USDC = 8500; // 85%

    function setUp() public {
        usdc = new MockToken("USDC", 6);
        weth = new MockToken("WETH", 18);
        dai = new MockToken("DAI", 18);

        aUsdc = new MockAToken("aUSDC", address(usdc));
        aWeth = new MockAToken("aWETH", address(weth));
        aDai = new MockAToken("aDAI", address(dai));

        oracle = new MockOracle();
        oracle.setPrice(address(usdc), 1e8); // $1
        oracle.setPrice(address(weth), 2000e8); // $2000
        oracle.setPrice(address(dai), 1e8); // $1

        pool = new MockPool(oracle);
        aUsdc.setPool(pool);
        aWeth.setPool(pool);
        aDai.setPool(pool);

        pool.setReserve(address(usdc), address(aUsdc), LT_USDC);
        pool.setReserve(address(weth), address(aWeth), LT_WETH);
        pool.setReserve(address(dai), address(aDai), LT_USDC);

        provider = new MockProvider(address(pool), address(oracle));
        swapRouter = new MockSwapRouter(address(oracle), 0);
        vault = new TestVault(IERC20(address(usdc)), "Vault USDC", "vUSDC");

        guardian = new TahansoeGuardianAaveV4(
            IPoolAddressesProvider(address(provider)),
            address(swapRouter),
            SWAP_FEE,
            treasury
        );

        // Fund Alice: $20,000 collateral (10 WETH), $12,000 debt
        // HF = 20,000 * 0.825 / 12,000 = 1.375e18
        pool.setAccount(alice, 20_000e8, 12_000e8, LT_WETH);

        usdc.mint(alice, 10_000e6);
        dai.mint(alice, 10_000e18);
        weth.mint(alice, 20e18);
        aWeth.mint(alice, 10e18);
        aUsdc.mint(alice, 5_000e6);

        vm.startPrank(alice);
        usdc.approve(address(guardian), type(uint256).max);
        dai.approve(address(guardian), type(uint256).max);
        weth.approve(address(guardian), type(uint256).max);
        aWeth.approve(address(guardian), type(uint256).max);
        aUsdc.approve(address(guardian), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(3_000e6, alice);
        IERC20(address(vault)).approve(address(guardian), type(uint256).max);
        vm.stopPrank();

        // Liquidity for swap router
        usdc.mint(address(swapRouter), 1_000_000e6);
        weth.mint(address(swapRouter), 1_000e18);

        // Liquidity for pool withdrawals
        usdc.mint(address(pool), 1_000_000e6);
        weth.mint(address(pool), 10_000e18);
        dai.mint(address(pool), 1_000_000e18);
    }

    // ─── Constructor & Policy Validations ────────────────────────────────────

    function test_constructor_validations() public {
        vm.expectRevert(GuardianCore.InvalidTreasury.selector);
        new TahansoeGuardianAaveV4(
            IPoolAddressesProvider(address(provider)), address(swapRouter), SWAP_FEE, address(0)
        );

        assertEq(address(guardian.addressesProvider()), address(provider));
        assertEq(address(guardian.swapRouter()), address(swapRouter));
        assertEq(guardian.swapFee(), SWAP_FEE);
        assertEq(guardian.treasury(), treasury);
    }

    function test_setPolicy_validations() public {
        vm.startPrank(alice);

        // Zero address debt asset
        vm.expectRevert(GuardianCore.InvalidPolicy.selector);
        guardian.setPolicy(address(0), 1.2e18, 1.6e18, 1000e6);

        // Trigger below min
        vm.expectRevert(GuardianCore.InvalidPolicy.selector);
        guardian.setPolicy(address(usdc), 1.04e18, 1.6e18, 1000e6);

        // Target <= trigger
        vm.expectRevert(GuardianCore.InvalidPolicy.selector);
        guardian.setPolicy(address(usdc), 1.5e18, 1.5e18, 1000e6);

        // Target > max
        vm.expectRevert(GuardianCore.InvalidPolicy.selector);
        guardian.setPolicy(address(usdc), 1.5e18, 3.1e18, 1000e6);

        // maxRepay == 0
        vm.expectRevert(GuardianCore.InvalidPolicy.selector);
        guardian.setPolicy(address(usdc), 1.2e18, 1.6e18, 0);

        // Valid
        guardian.setPolicy(address(usdc), 1.2e18, 1.6e18, 1000e6);
        vm.stopPrank();

        (bool enabled, uint256 trig, uint256 target, uint256 cap) = guardian.policyOf(alice, address(usdc));
        assertTrue(enabled);
        assertEq(trig, 1.2e18);
        assertEq(target, 1.6e18);
        assertEq(cap, 1000e6);

        assertEq(guardian.positionCount(), 1);
        address[] memory debts = guardian.debtAssetsOf(alice);
        assertEq(debts.length, 1);
        assertEq(debts[0], address(usdc));
    }

    function test_disablePolicy() public {
        vm.startPrank(alice);
        guardian.setPolicy(address(usdc), 1.5e18, 1.8e18, 1000e6);
        assertTrue(guardian.needsProtection(alice, address(usdc)));

        guardian.disablePolicy(address(usdc));
        (bool enabled,,,) = guardian.policyOf(alice, address(usdc));
        assertFalse(enabled);
        assertFalse(guardian.needsProtection(alice, address(usdc)));

        vm.expectRevert(GuardianCore.NoPolicy.selector);
        guardian.protect(alice, address(usdc));
        vm.stopPrank();
    }

    function test_setLayer2_validations() public {
        vm.startPrank(alice);
        vm.expectRevert(GuardianCore.NoPolicy.selector);
        guardian.setLayer2(address(usdc), L2_ERC4626, address(vault), 500e6);

        guardian.setPolicy(address(usdc), 1.2e18, 1.6e18, 1000e6);

        // Zero cap
        vm.expectRevert(GuardianCore.InvalidLayer2.selector);
        guardian.setLayer2(address(usdc), L2_ERC4626, address(vault), 0);

        // Invalid source (vault of wrong asset)
        TestVault wethVault = new TestVault(IERC20(address(weth)), "vWETH", "vWETH");
        vm.expectRevert(GuardianCore.InvalidSource.selector);
        guardian.setLayer2(address(usdc), L2_ERC4626, address(wethVault), 500e6);

        // aToken of wrong asset
        vm.expectRevert(GuardianCore.InvalidSource.selector);
        guardian.setLayer2(address(usdc), L2_ATOKEN, address(aWeth), 500e6);

        // Valid ERC-4626
        guardian.setLayer2(address(usdc), L2_ERC4626, address(vault), 500e6);
        (uint8 kind, address src, uint256 cap) = guardian.layer2Of(alice, address(usdc));
        assertEq(kind, L2_ERC4626);
        assertEq(src, address(vault));
        assertEq(cap, 500e6);

        // Valid aToken
        guardian.setLayer2(address(usdc), L2_ATOKEN, address(aUsdc), 400e6);
        (kind, src, cap) = guardian.layer2Of(alice, address(usdc));
        assertEq(kind, L2_ATOKEN);
        assertEq(src, address(aUsdc));
        assertEq(cap, 400e6);

        // Disable L2
        guardian.setLayer2(address(usdc), L2_NONE, address(0), 0);
        (kind, src, cap) = guardian.layer2Of(alice, address(usdc));
        assertEq(kind, L2_NONE);
        vm.stopPrank();
    }

    function test_setLayer3_validations() public {
        vm.startPrank(alice);
        vm.expectRevert(GuardianCore.NoPolicy.selector);
        guardian.setLayer3(address(usdc), true, address(weth), 5e18, 300);

        guardian.setPolicy(address(usdc), 1.2e18, 1.6e18, 1000e6);

        // Zero cap
        vm.expectRevert(GuardianCore.InvalidLayer3.selector);
        guardian.setLayer3(address(usdc), true, address(weth), 0, 300);

        // Collateral same as debt
        vm.expectRevert(GuardianCore.InvalidCollateral.selector);
        guardian.setLayer3(address(usdc), true, address(usdc), 5e18, 300);

        // Slippage > 10_000
        vm.expectRevert(GuardianCore.InvalidLayer3.selector);
        guardian.setLayer3(address(usdc), true, address(weth), 5e18, 10_001);

        // Valid L3
        guardian.setLayer3(address(usdc), true, address(weth), 5e18, 300);
        (bool enabled, address col, uint256 maxCol, uint16 slip) = guardian.layer3Of(alice, address(usdc));
        assertTrue(enabled);
        assertEq(col, address(weth));
        assertEq(maxCol, 5e18);
        assertEq(slip, 300);
        vm.stopPrank();
    }

    function test_setTriggerBand_andDynamicTrigger() public {
        vm.startPrank(alice);
        guardian.setPolicy(address(usdc), 1.2e18, 1.6e18, 1000e6);

        // Band max >= target
        vm.expectRevert(GuardianCore.InvalidBand.selector);
        guardian.setTriggerBand(address(usdc), 1.1e18, 1.6e18, riskAgent);

        // Valid band
        guardian.setTriggerBand(address(usdc), 1.1e18, 1.5e18, riskAgent);
        vm.stopPrank();

        // Unauthorized agent
        vm.prank(bob);
        vm.expectRevert(GuardianCore.Unauthorized.selector);
        guardian.setDynamicTrigger(alice, address(usdc), 1.3e18, uint64(block.timestamp + 1 hours));

        // Valid dynamic trigger
        vm.prank(riskAgent);
        guardian.setDynamicTrigger(alice, address(usdc), 1.35e18, uint64(block.timestamp + 1 hours));
        assertEq(guardian.effectiveTrigger(alice, address(usdc)), 1.35e18);

        // Expired dynamic trigger
        vm.warp(block.timestamp + 2 hours);
        assertEq(guardian.effectiveTrigger(alice, address(usdc)), 1.2e18);
    }

    function test_debtPriority() public {
        vm.startPrank(alice);
        guardian.setPolicy(address(usdc), 1.2e18, 1.6e18, 1000e6);
        guardian.setPolicy(address(dai), 1.3e18, 1.7e18, 2000e18);

        address[] memory currentDebts = guardian.debtAssetsOf(alice);
        assertEq(currentDebts.length, 2);
        assertEq(currentDebts[0], address(usdc));
        assertEq(currentDebts[1], address(dai));

        // Unknown asset in priority list
        address[] memory badPriority = new address[](2);
        badPriority[0] = address(weth);
        badPriority[1] = address(dai);
        vm.expectRevert(GuardianCore.InvalidDebtPriority.selector);
        guardian.setDebtPriority(badPriority);

        // Duplicate asset
        address[] memory dupPriority = new address[](2);
        dupPriority[0] = address(usdc);
        dupPriority[1] = address(usdc);
        vm.expectRevert(GuardianCore.InvalidDebtPriority.selector);
        guardian.setDebtPriority(dupPriority);

        // Wrong length
        address[] memory shortPriority = new address[](1);
        shortPriority[0] = address(usdc);
        vm.expectRevert(GuardianCore.InvalidDebtPriority.selector);
        guardian.setDebtPriority(shortPriority);

        // Valid reorder: DAI first, then USDC
        address[] memory newPriority = new address[](2);
        newPriority[0] = address(dai);
        newPriority[1] = address(usdc);
        guardian.setDebtPriority(newPriority);

        address[] memory updatedDebts = guardian.debtAssetsOf(alice);
        assertEq(updatedDebts[0], address(dai));
        assertEq(updatedDebts[1], address(usdc));
        vm.stopPrank();
    }

    function test_positionsPage_and_positionCount() public {
        vm.startPrank(alice);
        guardian.setPolicy(address(usdc), 1.2e18, 1.6e18, 1000e6);
        guardian.setPolicy(address(dai), 1.3e18, 1.7e18, 2000e18);
        vm.stopPrank();

        assertEq(guardian.positionCount(), 2);
        (address[] memory users, address[] memory debts) = guardian.positionsPage(0, 10);
        assertEq(users.length, 2);
        assertEq(users[0], alice);
        assertEq(debts[0], address(usdc));
        assertEq(users[1], alice);
        assertEq(debts[1], address(dai));

        // Offset 1, limit 1
        (users, debts) = guardian.positionsPage(1, 1);
        assertEq(users.length, 1);
        assertEq(debts[0], address(dai));
    }

    // ─── Protection Execution ────────────────────────────────────────────────

    function test_protect_layer1Only() public {
        // HF = 1.375e18. Trigger = 1.50e18, target = 1.60e18.
        vm.prank(alice);
        guardian.setPolicy(address(usdc), 1.5e18, 1.6e18, 5000e6);

        assertTrue(guardian.needsProtection(alice, address(usdc)));
        uint256 hfBefore = guardian.healthFactor(alice);

        (uint256 qL1, uint256 qL2, uint256 qL3,) = guardian.quoteProtect(alice, address(usdc));
        assertGt(qL1, 0);
        assertEq(qL2, 0);
        assertEq(qL3, 0);

        uint256 repaid = guardian.protect(alice, address(usdc));
        assertEq(repaid, qL1);

        uint256 hfAfter = guardian.healthFactor(alice);
        assertGt(hfAfter, hfBefore);
        assertGe(hfAfter, 1.6e18);

        assertEq(usdc.balanceOf(address(guardian)), 0);
    }

    function test_protect_layer2_ERC4626() public {
        // Empty Alice's wallet USDC
        uint256 bal = usdc.balanceOf(alice);
        vm.prank(alice);
        usdc.transfer(bob, bal);
        assertEq(usdc.balanceOf(alice), 0);

        vm.startPrank(alice);
        guardian.setPolicy(address(usdc), 1.5e18, 1.6e18, 5000e6);
        guardian.setLayer2(address(usdc), L2_ERC4626, address(vault), 5000e6);
        vm.stopPrank();

        (uint256 qL1, uint256 qL2, uint256 qL3,) = guardian.quoteProtect(alice, address(usdc));
        assertEq(qL1, 0);
        assertGt(qL2, 0);

        uint256 vaultSharesBefore = IERC20(address(vault)).balanceOf(alice);
        uint256 repaid = guardian.protect(alice, address(usdc));
        assertEq(repaid, qL2);

        assertLt(IERC20(address(vault)).balanceOf(alice), vaultSharesBefore);
        assertGe(guardian.healthFactor(alice), 1.6e18);
        assertEq(usdc.balanceOf(address(guardian)), 0);
    }

    function test_protect_layer2_aToken() public {
        // Empty Alice's wallet USDC
        uint256 bal = usdc.balanceOf(alice);
        vm.prank(alice);
        usdc.transfer(bob, bal);

        vm.startPrank(alice);
        guardian.setPolicy(address(usdc), 1.5e18, 1.6e18, 5000e6);
        guardian.setLayer2(address(usdc), L2_ATOKEN, address(aUsdc), 5000e6);
        vm.stopPrank();

        uint256 aUsdcBefore = aUsdc.balanceOf(alice);
        uint256 repaid = guardian.protect(alice, address(usdc));
        assertGt(repaid, 0);

        assertLt(aUsdc.balanceOf(alice), aUsdcBefore);
        assertGe(guardian.healthFactor(alice), 1.6e18);
        assertEq(usdc.balanceOf(address(guardian)), 0);
    }

    function test_protect_layer3_flashLoan() public {
        // Empty Alice wallet USDC and remove L2
        uint256 bal = usdc.balanceOf(alice);
        vm.prank(alice);
        usdc.transfer(bob, bal);

        vm.startPrank(alice);
        guardian.setPolicy(address(usdc), 1.5e18, 1.6e18, 5000e6);
        guardian.setLayer3(address(usdc), true, address(weth), 10e18, 300);
        vm.stopPrank();

        (uint256 qL1, uint256 qL2, uint256 qL3,) = guardian.quoteProtect(alice, address(usdc));
        assertEq(qL1, 0);
        assertEq(qL2, 0);
        assertGt(qL3, 0);

        uint256 aWethBefore = aWeth.balanceOf(alice);
        uint256 repaid = guardian.protect(alice, address(usdc));
        assertGt(repaid, 0);

        assertLt(aWeth.balanceOf(alice), aWethBefore);
        assertGe(guardian.healthFactor(alice), 1.6e18);
        assertEq(usdc.balanceOf(address(guardian)), 0);
        assertEq(weth.balanceOf(address(guardian)), 0);
    }

    // ─── Fee Handling (ADR 0013) ─────────────────────────────────────────────

    function test_fee_eligible_chargesFee() public {
        // HF = 1.375e18 < static trigger 1.50e18 and < 1.50e18 ceiling -> Eligible!
        vm.prank(alice);
        guardian.setPolicy(address(usdc), 1.5e18, 1.6e18, 5000e6);

        (bool eligible, uint256 expectedFee) = guardian.quoteFee(alice, address(usdc));
        assertTrue(eligible);
        assertGt(expectedFee, 0);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 repaid = guardian.protect(alice, address(usdc));

        uint256 expectedActualFee = (repaid * 15) / 10_000;
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, expectedActualFee);
    }

    function test_fee_notEligible_dynamicTriggerOnly() public {
        // HF = 1.375e18. Static trigger = 1.30e18 (Alice is safe).
        // Dynamic trigger raised to 1.45e18 -> Protect runs, fee is 0.
        vm.startPrank(alice);
        guardian.setPolicy(address(usdc), 1.3e18, 1.6e18, 5000e6);
        guardian.setTriggerBand(address(usdc), 1.2e18, 1.5e18, riskAgent);
        vm.stopPrank();

        vm.prank(riskAgent);
        guardian.setDynamicTrigger(alice, address(usdc), 1.45e18, uint64(block.timestamp + 1 hours));

        (bool eligible, uint256 expectedFee) = guardian.quoteFee(alice, address(usdc));
        assertFalse(eligible);
        assertEq(expectedFee, 0);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        guardian.protect(alice, address(usdc));
        assertEq(usdc.balanceOf(treasury), treasuryBefore);
    }

    function test_fee_waived_whenAllowanceExhausted() public {
        vm.prank(alice);
        guardian.setPolicy(address(usdc), 1.5e18, 1.6e18, 5000e6);

        (uint256 qL1,,,) = guardian.quoteProtect(alice, address(usdc));
        // Alice only approves exact repay amount
        vm.prank(alice);
        usdc.approve(address(guardian), qL1);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 repaid = guardian.protect(alice, address(usdc));
        assertEq(repaid, qL1);
        // Fee waived without reverting
        assertEq(usdc.balanceOf(treasury), treasuryBefore);
    }

    // ─── Fuzz Tests ──────────────────────────────────────────────────────────

    function testFuzz_protect_neverOverspends(uint32 repayCap) public {
        vm.assume(repayCap >= 10e6 && repayCap <= 5000e6);

        vm.prank(alice);
        guardian.setPolicy(address(usdc), 1.5e18, 1.6e18, repayCap);

        uint256 repaid = guardian.protect(alice, address(usdc));
        assertLe(repaid, repayCap);
        assertEq(usdc.balanceOf(address(guardian)), 0);
    }
}
