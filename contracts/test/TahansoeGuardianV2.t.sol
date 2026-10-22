// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TahansoeGuardianV2, L2_NONE, L2_ERC4626, L2_ATOKEN} from "../src/TahansoeGuardianV2.sol";
import {MockSwapRouter} from "../src/testnet/MockSwapRouter.sol";
import {TestVault} from "../src/testnet/TestVault.sol";
import {MockToken, MockOracle, MockPool, MockProvider, MockAToken} from "./mocks/MockAave.sol";
import {IPoolAddressesProvider} from "../src/interfaces/IAave.sol";

contract TahansoeGuardianV2Test is Test {
    TahansoeGuardianV2 guardian;
    MockToken usdc;
    MockToken weth;
    MockAToken aUsdc;
    MockAToken aWeth;
    MockOracle oracle;
    MockPool aave;
    MockProvider provider;
    MockSwapRouter router;
    TestVault vault;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address riskAgent = makeAddr("riskAgent");
    address keeper = makeAddr("keeper");

    uint256 constant TRIGGER = 1.3e18;
    uint256 constant TARGET = 1.6e18;
    uint256 constant LT_USDC = 8500;
    uint256 constant LT_WETH = 8250;
    uint24 constant SWAP_FEE = 500;

    function setUp() public {
        usdc = new MockToken("USDC", 6);
        weth = new MockToken("WETH", 18);

        oracle = new MockOracle();
        oracle.setPrice(address(usdc), 1e8); // $1 (8 decimals)
        oracle.setPrice(address(weth), 2000e8); // $2000 (8 decimals)

        aave = new MockPool(oracle);
        provider = new MockProvider(address(aave), address(oracle));

        aUsdc = new MockAToken("aUSDC", address(usdc));
        aUsdc.setPool(aave);
        aWeth = new MockAToken("aWETH", address(weth));
        aWeth.setPool(aave);

        aave.setReserve(address(usdc), address(aUsdc), LT_USDC);
        aave.setReserve(address(weth), address(aWeth), LT_WETH);

        router = new MockSwapRouter(address(oracle), 30); // 30 bps spread
        guardian = new TahansoeGuardianV2(IPoolAddressesProvider(address(provider)), address(router), SWAP_FEE);
        vault = new TestVault(usdc, "USDC Vault", "vUSDC");

        // Fund router with USDC for swaps
        usdc.mint(address(router), 1_000_000e6);
        // Fund pool with WETH and USDC for borrows / withdrawals
        usdc.mint(address(aave), 1_000_000e6);
        weth.mint(address(aave), 10_000e18);

        // Setup alice
        usdc.mint(alice, 100_000e6);
        weth.mint(alice, 100e18);
        aWeth.mint(alice, 50e18);
        aUsdc.mint(alice, 50_000e6);

        vm.startPrank(alice);
        usdc.approve(address(guardian), 50_000e6);
        guardian.setPolicy(address(usdc), TRIGGER, TARGET, 20_000e6);
        vm.stopPrank();
    }

    /// Helper: at-risk position ($20k collateral, $14k debt -> HF = 1.1786)
    function _setAtRiskPosition(address user) internal {
        aave.setAccount(user, 20_000e8, 14_000e8, LT_WETH);
    }

    /// Helper: safe position ($32k collateral, $14k debt -> HF = 1.8857)
    function _setSafePosition(address user) internal {
        aave.setAccount(user, 32_000e8, 14_000e8, LT_WETH);
    }

    // ─── Policy & Registry Tests ─────────────────────────────────────────────

    function test_setPolicy_validations() public {
        vm.startPrank(bob);
        vm.expectRevert(TahansoeGuardianV2.InvalidPolicy.selector);
        guardian.setPolicy(address(0), TRIGGER, TARGET, 100e6); // zero debtAsset

        vm.expectRevert(TahansoeGuardianV2.InvalidPolicy.selector);
        guardian.setPolicy(address(usdc), 1.0e18, TARGET, 100e6); // trigger < MIN_TRIGGER_HF

        vm.expectRevert(TahansoeGuardianV2.InvalidPolicy.selector);
        guardian.setPolicy(address(usdc), TARGET, TRIGGER, 100e6); // target <= trigger

        vm.expectRevert(TahansoeGuardianV2.InvalidPolicy.selector);
        guardian.setPolicy(address(usdc), TRIGGER, 3.5e18, 100e6); // target > MAX_TARGET_HF

        vm.expectRevert(TahansoeGuardianV2.InvalidPolicy.selector);
        guardian.setPolicy(address(usdc), TRIGGER, TARGET, 0); // maxRepay == 0

        guardian.setPolicy(address(usdc), TRIGGER, TARGET, 100e6);
        vm.stopPrank();

        (bool enabled, address debtAsset, uint256 trig, uint256 targ, uint256 cap) = guardian.policies(bob);
        assertTrue(enabled);
        assertEq(debtAsset, address(usdc));
        assertEq(trig, TRIGGER);
        assertEq(targ, TARGET);
        assertEq(cap, 100e6);
    }

    function test_userRegistry_pagination() public {
        // alice is already registered in setUp()
        assertEq(guardian.userCount(), 1);
        address[] memory p1 = guardian.usersPage(0, 10);
        assertEq(p1.length, 1);
        assertEq(p1[0], alice);

        // Register bob
        vm.prank(bob);
        guardian.setPolicy(address(usdc), TRIGGER, TARGET, 500e6);
        assertEq(guardian.userCount(), 2);

        // Calling setPolicy again does not duplicate user
        vm.prank(bob);
        guardian.setPolicy(address(usdc), 1.2e18, TARGET, 600e6);
        assertEq(guardian.userCount(), 2);

        address[] memory page = guardian.usersPage(0, 1);
        assertEq(page.length, 1);
        assertEq(page[0], alice);

        page = guardian.usersPage(1, 1);
        assertEq(page.length, 1);
        assertEq(page[0], bob);

        page = guardian.usersPage(2, 5);
        assertEq(page.length, 0);

        page = guardian.usersPage(0, 0);
        assertEq(page.length, 0);
    }

    function test_disablePolicy() public {
        vm.prank(alice);
        guardian.disablePolicy();

        (bool enabled,,,,) = guardian.policies(alice);
        assertFalse(enabled);
        assertFalse(guardian.needsProtection(alice));

        _setAtRiskPosition(alice);
        vm.expectRevert(TahansoeGuardianV2.NoPolicy.selector);
        guardian.protect(alice);
    }

    // ─── Trigger Band & Dynamic Trigger Tests ────────────────────────────────

    function test_triggerBand_andDynamicTrigger() public {
        vm.startPrank(alice);
        vm.expectRevert(TahansoeGuardianV2.InvalidBand.selector);
        guardian.setTriggerBand(1.0e18, 1.4e18, riskAgent); // min < MIN_TRIGGER_HF

        vm.expectRevert(TahansoeGuardianV2.InvalidBand.selector);
        guardian.setTriggerBand(1.4e18, 1.2e18, riskAgent); // min > max

        vm.expectRevert(TahansoeGuardianV2.InvalidBand.selector);
        guardian.setTriggerBand(1.1e18, 1.6e18, riskAgent); // max >= targetHF (1.6e18)

        guardian.setTriggerBand(1.1e18, 1.5e18, riskAgent);
        vm.stopPrank();

        (uint256 minTrig, uint256 maxTrig, address agent, uint256 dynTrig, uint64 valid) = guardian.triggerBands(alice);
        assertEq(minTrig, 1.1e18);
        assertEq(maxTrig, 1.5e18);
        assertEq(agent, riskAgent);
        assertEq(dynTrig, 0);
        assertEq(valid, 0);

        // Before dynamic trigger set, effectiveTrigger returns static policy trigger
        assertEq(guardian.effectiveTrigger(alice), TRIGGER);

        // Unauthorized agent cannot set dynamic trigger
        vm.prank(bob);
        vm.expectRevert(TahansoeGuardianV2.Unauthorized.selector);
        guardian.setDynamicTrigger(alice, 1.4e18, uint64(block.timestamp + 3600));

        // Outside band
        vm.startPrank(riskAgent);
        vm.expectRevert(TahansoeGuardianV2.InvalidTrigger.selector);
        guardian.setDynamicTrigger(alice, 1.05e18, uint64(block.timestamp + 3600)); // < min

        vm.expectRevert(TahansoeGuardianV2.InvalidTrigger.selector);
        guardian.setDynamicTrigger(alice, 1.55e18, uint64(block.timestamp + 3600)); // > max

        // Expired timestamp
        vm.expectRevert(TahansoeGuardianV2.InvalidExpiry.selector);
        guardian.setDynamicTrigger(alice, 1.4e18, uint64(block.timestamp));

        // Valid dynamic trigger
        uint64 expiry = uint64(block.timestamp + 1 hours);
        guardian.setDynamicTrigger(alice, 1.45e18, expiry);
        vm.stopPrank();

        assertEq(guardian.effectiveTrigger(alice), 1.45e18);

        // Warp past expiry -> falls back to static trigger
        vm.warp(block.timestamp + 1 hours + 1);
        assertEq(guardian.effectiveTrigger(alice), TRIGGER);

        // Turn off band
        vm.prank(alice);
        guardian.setTriggerBand(0, 0, address(0));
        assertEq(guardian.effectiveTrigger(alice), TRIGGER);
    }

    // ─── Layer 2 & 3 Configuration Tests ────────────────────────────────────

    function test_setLayer2_validations() public {
        vm.startPrank(alice);
        // Vault with wrong asset
        MockToken randomToken = new MockToken("RND", 18);
        TestVault badVault = new TestVault(randomToken, "Bad Vault", "bV");

        vm.expectRevert(TahansoeGuardianV2.InvalidSource.selector);
        guardian.setLayer2(L2_ERC4626, address(badVault), 5_000e6);

        // Valid ERC4626
        guardian.setLayer2(L2_ERC4626, address(vault), 5_000e6);
        (uint8 kind, address source, uint256 maxAssets) = guardian.layer2(alice);
        assertEq(kind, L2_ERC4626);
        assertEq(source, address(vault));
        assertEq(maxAssets, 5_000e6);

        // Valid aToken
        guardian.setLayer2(L2_ATOKEN, address(aUsdc), 10_000e6);
        (kind, source, maxAssets) = guardian.layer2(alice);
        assertEq(kind, L2_ATOKEN);
        assertEq(source, address(aUsdc));
        assertEq(maxAssets, 10_000e6);

        // Disable L2
        guardian.setLayer2(L2_NONE, address(0), 0);
        (kind, source, maxAssets) = guardian.layer2(alice);
        assertEq(kind, L2_NONE);
        vm.stopPrank();
    }

    function test_setLayer3_validations() public {
        vm.startPrank(alice);
        vm.expectRevert(TahansoeGuardianV2.InvalidLayer3.selector);
        guardian.setLayer3(true, address(0), 5e18, 100);

        vm.expectRevert(TahansoeGuardianV2.InvalidLayer3.selector);
        guardian.setLayer3(true, address(weth), 0, 100);

        vm.expectRevert(TahansoeGuardianV2.InvalidLayer3.selector);
        guardian.setLayer3(true, address(weth), 5e18, 10_001); // slippage > 10000

        vm.expectRevert(TahansoeGuardianV2.InvalidCollateral.selector);
        guardian.setLayer3(true, address(usdc), 5e18, 100); // collateral == debtAsset

        guardian.setLayer3(true, address(weth), 5e18, 100);
        (bool enabled, address colAsset, uint256 maxCol, uint16 slip) = guardian.layer3(alice);
        assertTrue(enabled);
        assertEq(colAsset, address(weth));
        assertEq(maxCol, 5e18);
        assertEq(slip, 100);

        guardian.setLayer3(false, address(0), 0, 0);
        (enabled,,,) = guardian.layer3(alice);
        assertFalse(enabled);
        vm.stopPrank();
    }

    // ─── Layer 1 Execution ───────────────────────────────────────────────────

    function test_protect_layer1Only() public {
        _setAtRiskPosition(alice);
        assertTrue(guardian.needsProtection(alice));

        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        assertGt(repaid, 0);
        uint256 hfAfter = guardian.healthFactor(alice);
        assertGe(hfAfter, TARGET);
        assertEq(usdc.balanceOf(address(guardian)), 0);
    }

    // ─── Layer 2 Execution (ERC4626) ─────────────────────────────────────────

    function test_protect_layer2_ERC4626() public {
        // Alice has no wallet USDC, but has USDC in TestVault
        vm.startPrank(alice);
        usdc.transfer(bob, usdc.balanceOf(alice)); // empty wallet USDC
        usdc.mint(alice, 10_000e6);
        usdc.approve(address(vault), 10_000e6);
        vault.deposit(10_000e6, alice);

        vault.approve(address(guardian), 10_000e6);
        guardian.setLayer2(L2_ERC4626, address(vault), 5_000e6);
        vm.stopPrank();

        _setAtRiskPosition(alice);
        assertTrue(guardian.needsProtection(alice));

        (uint256 qL1, uint256 qL2,,,) = guardian.quoteProtect(alice);
        assertEq(qL1, 0, "no wallet USDC");
        assertGt(qL2, 0, "vault has assets");

        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        assertGt(repaid, 0);
        assertGe(guardian.healthFactor(alice), TARGET);
        assertEq(usdc.balanceOf(address(guardian)), 0);
        assertEq(vault.balanceOf(address(guardian)), 0);
    }

    // ─── Layer 2 Execution (aToken) ──────────────────────────────────────────

    function test_protect_layer2_aToken() public {
        vm.startPrank(alice);
        usdc.transfer(bob, usdc.balanceOf(alice)); // empty wallet USDC
        aUsdc.approve(address(guardian), 10_000e6);
        guardian.setLayer2(L2_ATOKEN, address(aUsdc), 5_000e6);
        vm.stopPrank();

        _setAtRiskPosition(alice);
        assertTrue(guardian.needsProtection(alice));

        (uint256 qL1, uint256 qL2,,,) = guardian.quoteProtect(alice);
        assertEq(qL1, 0);
        assertGt(qL2, 0);

        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        assertGt(repaid, 0);
        assertGe(guardian.healthFactor(alice), TARGET);
        assertEq(usdc.balanceOf(address(guardian)), 0);
        assertEq(aUsdc.balanceOf(address(guardian)), 0);
    }

    // ─── Layer 3 Execution (Flash-Loan Deleverage) ───────────────────────────

    function test_protect_layer3_flashLoanDeleverage() public {
        vm.startPrank(alice);
        usdc.transfer(bob, usdc.balanceOf(alice)); // empty wallet USDC
        guardian.setLayer2(L2_NONE, address(0), 0); // no L2

        // Enable L3 with WETH collateral
        aWeth.approve(address(guardian), 10e18);
        guardian.setLayer3(true, address(weth), 10e18, 100); // 1% max slippage
        vm.stopPrank();

        _setAtRiskPosition(alice);
        assertTrue(guardian.needsProtection(alice));

        (uint256 qL1, uint256 qL2, uint256 qL3Col, uint256 qL3Rep, uint256 expHF) = guardian.quoteProtect(alice);
        assertEq(qL1, 0);
        assertEq(qL2, 0);
        assertGt(qL3Col, 0, "L3 collateral quoted");
        assertGt(qL3Rep, 0, "L3 repay quoted");
        assertGe(expHF, TARGET, "expected HF reaches target");

        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        assertGt(repaid, 0);
        assertGe(guardian.healthFactor(alice), TARGET);
        assertEq(usdc.balanceOf(address(guardian)), 0, "zero debtAsset in guardian");
        assertEq(weth.balanceOf(address(guardian)), 0, "zero collateral in guardian");
        assertEq(aWeth.balanceOf(address(guardian)), 0, "zero aToken in guardian");
    }

    // ─── Full Cascade L1 -> L2 -> L3 ─────────────────────────────────────────

    function test_protect_fullCascade() public {
        // Configure partial capacities across all 3 layers:
        // L1 cap = 500 USDC
        // L2 cap = 500 USDC (via vault)
        // L3 cap = 5 WETH (covers rest)
        vm.startPrank(alice);
        guardian.setPolicy(address(usdc), TRIGGER, TARGET, 500e6); // L1 cap 500

        usdc.transfer(bob, usdc.balanceOf(alice) - 500e6); // Alice has only 500 USDC in wallet
        usdc.mint(alice, 500e6);
        usdc.approve(address(vault), 500e6);
        vault.deposit(500e6, alice);
        vault.approve(address(guardian), 500e6);
        guardian.setLayer2(L2_ERC4626, address(vault), 500e6); // L2 cap 500

        aWeth.approve(address(guardian), 5e18);
        guardian.setLayer3(true, address(weth), 5e18, 100); // L3 handles remaining
        vm.stopPrank();

        _setAtRiskPosition(alice);
        assertTrue(guardian.needsProtection(alice));

        (uint256 qL1, uint256 qL2, uint256 qL3Col, uint256 qL3Rep,) = guardian.quoteProtect(alice);
        assertEq(qL1, 500e6);
        assertEq(qL2, 500e6);
        assertGt(qL3Col, 0);
        assertGt(qL3Rep, 0);

        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        // Repaid should be sum of L1 + L2 + L3
        assertGe(repaid, 1000e6);
        assertGe(guardian.healthFactor(alice), TARGET);
        assertEq(usdc.balanceOf(address(guardian)), 0);
        assertEq(weth.balanceOf(address(guardian)), 0);
    }

    // ─── Revert Paths ────────────────────────────────────────────────────────

    function test_revertPaths() public {
        _setSafePosition(alice);
        vm.expectRevert();
        vm.prank(keeper);
        guardian.protect(alice); // NotAtRisk

        _setAtRiskPosition(alice);
        vm.prank(alice);
        usdc.approve(address(guardian), 0); // No allowance and no L2/L3

        vm.expectRevert(TahansoeGuardianV2.NothingToRepay.selector);
        vm.prank(keeper);
        guardian.protect(alice);

        // executeOperation unauthorized caller
        vm.expectRevert(TahansoeGuardianV2.Unauthorized.selector);
        guardian.executeOperation(address(usdc), 1000e6, 5e6, address(guardian), "");

        // executeOperation unauthorized initiator
        vm.prank(address(aave));
        vm.expectRevert(TahansoeGuardianV2.Unauthorized.selector);
        guardian.executeOperation(address(usdc), 1000e6, 5e6, alice, "");
    }

    // ─── Automation: checkUpkeep / performUpkeep ─────────────────────────────

    function test_automation_checkUpkeepAndPerformUpkeep() public {
        _setAtRiskPosition(alice);

        bytes memory checkData = abi.encode(0, 10);
        (bool needed, bytes memory performData) = guardian.checkUpkeep(checkData);
        assertTrue(needed);
        assertEq(abi.decode(performData, (address)), alice);

        guardian.performUpkeep(performData);
        assertGe(guardian.healthFactor(alice), TARGET);

        (needed,) = guardian.checkUpkeep(checkData);
        assertFalse(needed);
    }

    // ─── Fuzz Tests ──────────────────────────────────────────────────────────

    function testFuzz_layer1_neverOverspends(uint96 collateral, uint96 debt, uint64 cap) public {
        collateral = uint96(bound(collateral, 1_000e8, 1_000_000e8));
        debt = uint96(bound(debt, 100e8, collateral));
        cap = uint64(bound(cap, 1e6, 1_000_000e6));

        aave.setAccount(alice, collateral, debt, LT_WETH);
        vm.prank(alice);
        guardian.setPolicy(address(usdc), TRIGGER, TARGET, cap);
        vm.assume(guardian.needsProtection(alice));

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        assertLe(repaid, cap);
        assertEq(balBefore - usdc.balanceOf(alice), repaid);
        assertEq(usdc.balanceOf(address(guardian)), 0);
    }
}
