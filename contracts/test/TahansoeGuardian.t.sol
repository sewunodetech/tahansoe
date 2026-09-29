// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TahansoeGuardian} from "../src/TahansoeGuardian.sol";
import {IPoolAddressesProvider} from "../src/interfaces/IAave.sol";
import {MockToken, MockOracle, MockPool, MockProvider} from "./mocks/MockAave.sol";

contract TahansoeGuardianTest is Test {
    TahansoeGuardian guardian;
    MockToken usdc;
    MockOracle oracle;
    MockPool aave;

    address alice = makeAddr("alice");
    address keeper = makeAddr("keeper");

    uint256 constant TRIGGER = 1.3e18;
    uint256 constant TARGET = 1.6e18;
    uint256 constant LT = 8250; // 82.5%

    function setUp() public {
        usdc = new MockToken("USDC", 6);
        oracle = new MockOracle();
        oracle.setPrice(address(usdc), 1e8); // $1, 8-decimal base currency
        aave = new MockPool(oracle);
        guardian = new TahansoeGuardian(IPoolAddressesProvider(address(new MockProvider(address(aave), address(oracle)))));

        usdc.mint(alice, 50_000e6);
        vm.startPrank(alice);
        usdc.approve(address(guardian), type(uint256).max);
        guardian.setPolicy(address(usdc), TRIGGER, TARGET, 20_000e6);
        vm.stopPrank();
    }

    /// $32k collateral, $14k debt → HF 1.8857 (safe)
    function _safePosition() internal {
        aave.setAccount(alice, 32_000e8, 14_000e8, LT);
    }

    /// Collateral fell to $20k → HF 1.1786 (below trigger)
    function _atRiskPosition() internal {
        aave.setAccount(alice, 20_000e8, 14_000e8, LT);
    }

    // ─── Policy ──────────────────────────────────────────────────────────────

    function test_setPolicy_rejectsInvalid() public {
        vm.startPrank(alice);
        vm.expectRevert(TahansoeGuardian.InvalidPolicy.selector);
        guardian.setPolicy(address(0), TRIGGER, TARGET, 1);
        vm.expectRevert(TahansoeGuardian.InvalidPolicy.selector);
        guardian.setPolicy(address(usdc), 1.0e18, TARGET, 1); // trigger too low
        vm.expectRevert(TahansoeGuardian.InvalidPolicy.selector);
        guardian.setPolicy(address(usdc), TARGET, TRIGGER, 1); // target <= trigger
        vm.expectRevert(TahansoeGuardian.InvalidPolicy.selector);
        guardian.setPolicy(address(usdc), TRIGGER, 3.5e18, 1); // target too high
        vm.expectRevert(TahansoeGuardian.InvalidPolicy.selector);
        guardian.setPolicy(address(usdc), TRIGGER, TARGET, 0); // zero cap
        vm.stopPrank();
    }

    // ─── Protection ──────────────────────────────────────────────────────────

    function test_protect_revertsWhenSafe() public {
        _safePosition();
        assertFalse(guardian.needsProtection(alice));
        vm.expectRevert();
        vm.prank(keeper);
        guardian.protect(alice);
    }

    function test_protect_restoresTargetHealthFactor() public {
        _atRiskPosition();
        assertTrue(guardian.needsProtection(alice));
        uint256 hfBefore = guardian.healthFactor(alice);

        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        uint256 hfAfter = guardian.healthFactor(alice);
        assertLt(hfBefore, TRIGGER);
        assertGe(hfAfter, TARGET, "reaches target");
        assertApproxEqRel(hfAfter, TARGET, 0.001e18, "does not overshoot");
        // debt target = 20000 * 0.825 / 1.6 = 10312.5 → repay ≈ 3687.5 USDC
        assertApproxEqAbs(repaid, 3_687.5e6, 1e6);
        assertEq(usdc.balanceOf(alice), 50_000e6 - repaid);
    }

    function test_protect_respectsPerActionCap() public {
        vm.prank(alice);
        guardian.setPolicy(address(usdc), TRIGGER, TARGET, 1_000e6);
        _atRiskPosition();

        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);
        assertEq(repaid, 1_000e6);
        assertGt(guardian.healthFactor(alice), 1.1786e18);
    }

    function test_protect_limitedByAllowance() public {
        vm.prank(alice);
        usdc.approve(address(guardian), 500e6);
        _atRiskPosition();

        vm.prank(keeper);
        assertEq(guardian.protect(alice), 500e6);
    }

    function test_protect_noFundsLeftInGuardianAndKeeperPaysNothing() public {
        _atRiskPosition();
        vm.prank(keeper);
        guardian.protect(alice);

        assertEq(usdc.balanceOf(address(guardian)), 0, "guardian holds nothing");
        assertEq(usdc.allowance(address(guardian), address(aave)), 0, "pool approval cleared");
        assertEq(usdc.balanceOf(keeper), 0);
    }

    function test_protect_refundsWhenDebtSmallerThanQuote() public {
        // Tiny debt: pool repays only what is owed, the rest must come back to alice.
        aave.setAccount(alice, 100e8, 90e8, LT); // HF 0.9167
        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        assertLe(repaid, 90e6);
        assertEq(usdc.balanceOf(address(guardian)), 0);
        assertEq(usdc.balanceOf(alice), 50_000e6 - repaid);
    }

    function test_protect_disabledPolicy() public {
        vm.prank(alice);
        guardian.disablePolicy();
        _atRiskPosition();

        assertFalse(guardian.needsProtection(alice));
        vm.expectRevert(TahansoeGuardian.NoPolicy.selector);
        guardian.protect(alice);
    }

    function test_protect_noAllowanceMeansNothingToRepay() public {
        vm.prank(alice);
        usdc.approve(address(guardian), 0);
        _atRiskPosition();

        vm.expectRevert(TahansoeGuardian.NothingToRepay.selector);
        guardian.protect(alice);
    }

    // ─── Automation ──────────────────────────────────────────────────────────

    function test_automation_findsAndProtectsAtRiskUser() public {
        address bob = makeAddr("bob");
        aave.setAccount(bob, 32_000e8, 14_000e8, LT); // bob has no policy
        _atRiskPosition();

        address[] memory users = new address[](2);
        users[0] = bob;
        users[1] = alice;

        (bool needed, bytes memory data) = guardian.checkUpkeep(abi.encode(users));
        assertTrue(needed);
        assertEq(abi.decode(data, (address)), alice);

        guardian.performUpkeep(data);
        assertGe(guardian.healthFactor(alice), TARGET);

        (needed,) = guardian.checkUpkeep(abi.encode(users));
        assertFalse(needed, "nothing left to do");
    }

    // ─── Fuzz ────────────────────────────────────────────────────────────────

    /// For any at-risk position, protect never moves more than the user approved
    /// and never leaves funds in the Guardian.
    function testFuzz_protect_neverOverspends(uint96 collateral, uint96 debt, uint64 cap) public {
        collateral = uint96(bound(collateral, 1_000e8, 1_000_000e8));
        debt = uint96(bound(debt, 100e8, collateral));
        cap = uint64(bound(cap, 1e6, 1_000_000e6));
        aave.setAccount(alice, collateral, debt, LT);
        vm.prank(alice);
        guardian.setPolicy(address(usdc), TRIGGER, TARGET, cap);
        vm.assume(guardian.needsProtection(alice));

        uint256 before = usdc.balanceOf(alice);
        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        assertLe(repaid, cap);
        assertEq(before - usdc.balanceOf(alice), repaid);
        assertEq(usdc.balanceOf(address(guardian)), 0);
    }
}
