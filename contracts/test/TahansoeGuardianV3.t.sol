// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {TahansoeGuardianV2, L2_NONE, L2_ERC4626, L2_ATOKEN} from "../src/TahansoeGuardianV2.sol";
import {TahansoeGuardianV3} from "../src/TahansoeGuardianV3.sol";
import {MockSwapRouter} from "../src/testnet/MockSwapRouter.sol";
import {TestVault} from "../src/testnet/TestVault.sol";
import {MockToken, MockOracle, MockPool, MockProvider, MockAToken} from "./mocks/MockAave.sol";
import {IPoolAddressesProvider} from "../src/interfaces/IAave.sol";

/// @dev Debt token that refuses transfers to one blocked address (e.g. a blocklisted treasury).
contract BlocklistToken is MockToken {
    address public immutable blocked;

    constructor(address blocked_) MockToken("BLK", 6) {
        blocked = blocked_;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(to != blocked, "blocked");
        super._update(from, to, value);
    }
}

/// Spec m4-guardian-success-fee §5 acceptance criteria → tests:
///   - exact floor(repaid * 15 / 10_000) to treasury ........ test_fee_eligible_chargesExactFee_walletOnly
///   - dynamic-trigger-only action is free .................. test_fee_notCharged_dynamicTriggerOnly
///   - HF >= 1.50 is free even below static trigger ......... test_fee_notCharged_atOrAboveCeiling
///   - insufficient funds: success, waived > 0, no revert ... test_fee_waived_* , test_fee_blocklistedTreasury_neverReverts
///   - repay / HF / refunds identical to V2 ................. test_parity_* , testFuzz_v3MatchesV2_andNeverRevertsOnFee
///   - Guardian balance zero after protect .................. every test + TahansoeGuardianV3.invariant.t.sol
contract TahansoeGuardianV3Test is Test {
    TahansoeGuardianV3 guardian;
    TahansoeGuardianV2 v2;
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
    address treasury = makeAddr("treasury");

    uint256 constant TRIGGER = 1.3e18;
    uint256 constant TARGET = 1.6e18;
    uint256 constant LT_USDC = 8500;
    uint256 constant LT_WETH = 8250;
    uint24 constant SWAP_FEE = 500;

    event FeeCharged(address indexed user, address indexed debtAsset, uint256 amount, uint256 waived);

    function setUp() public {
        usdc = new MockToken("USDC", 6);
        weth = new MockToken("WETH", 18);

        oracle = new MockOracle();
        oracle.setPrice(address(usdc), 1e8);
        oracle.setPrice(address(weth), 2000e8);

        aave = new MockPool(oracle);
        provider = new MockProvider(address(aave), address(oracle));

        aUsdc = new MockAToken("aUSDC", address(usdc));
        aUsdc.setPool(aave);
        aWeth = new MockAToken("aWETH", address(weth));
        aWeth.setPool(aave);

        aave.setReserve(address(usdc), address(aUsdc), LT_USDC);
        aave.setReserve(address(weth), address(aWeth), LT_WETH);

        router = new MockSwapRouter(address(oracle), 30);
        IPoolAddressesProvider p = IPoolAddressesProvider(address(provider));
        guardian = new TahansoeGuardianV3(p, address(router), SWAP_FEE, treasury);
        v2 = new TahansoeGuardianV2(p, address(router), SWAP_FEE);
        vault = new TestVault(usdc, "USDC Vault", "vUSDC");

        usdc.mint(address(router), 1_000_000e6);
        usdc.mint(address(aave), 1_000_000e6);
        weth.mint(address(aave), 10_000e18);

        usdc.mint(alice, 100_000e6);
        aWeth.mint(alice, 50e18);
        aUsdc.mint(alice, 50_000e6);

        _setPolicyBoth(TRIGGER, TARGET, 20_000e6);
        _approveUsdcBoth(50_000e6);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _setPolicyBoth(uint256 trig, uint256 targ, uint256 cap) internal {
        vm.startPrank(alice);
        guardian.setPolicy(address(usdc), trig, targ, cap);
        v2.setPolicy(address(usdc), trig, targ, cap);
        vm.stopPrank();
    }

    function _approveUsdcBoth(uint256 amount) internal {
        vm.startPrank(alice);
        usdc.approve(address(guardian), amount);
        usdc.approve(address(v2), amount);
        vm.stopPrank();
    }

    /// $20k collateral, $14k debt -> HF 1.1786 (below static trigger 1.3 and ceiling 1.5)
    function _setAtRiskPosition() internal {
        aave.setAccount(alice, 20_000e8, 14_000e8, LT_WETH);
    }

    function _fee(uint256 repaid) internal pure returns (uint256) {
        return (repaid * 15) / 10_000;
    }

    function _countFeeEvents(Vm.Log[] memory logs) internal view returns (uint256 n) {
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter == address(guardian) && logs[i].topics[0] == FeeCharged.selector) n++;
        }
    }

    function _assertGuardianEmpty() internal view {
        assertEq(usdc.balanceOf(address(guardian)), 0, "guardian holds USDC");
        assertEq(weth.balanceOf(address(guardian)), 0, "guardian holds WETH");
        assertEq(aUsdc.balanceOf(address(guardian)), 0, "guardian holds aUSDC");
        assertEq(aWeth.balanceOf(address(guardian)), 0, "guardian holds aWETH");
        assertEq(vault.balanceOf(address(guardian)), 0, "guardian holds vault shares");
    }

    // ─── Constructor & constants ─────────────────────────────────────────────

    function test_constructor_setsTreasuryAndConstants() public view {
        assertEq(guardian.treasury(), treasury);
        assertEq(guardian.SUCCESS_FEE_BPS(), 15);
        assertEq(guardian.FEE_HF_CEILING(), 1.5e18);
    }

    function test_constructor_rejectsZeroTreasury() public {
        vm.expectRevert(TahansoeGuardianV3.InvalidTreasury.selector);
        new TahansoeGuardianV3(IPoolAddressesProvider(address(provider)), address(router), SWAP_FEE, address(0));
    }

    // ─── Eligibility ─────────────────────────────────────────────────────────

    /// Source B only: no leftover in the Guardian, fee comes from the wallet within allowance.
    function test_fee_eligible_chargesExactFee_walletOnly() public {
        _setAtRiskPosition();
        (uint256 l1,,,,) = guardian.quoteProtect(alice);
        uint256 expectedFee = _fee(l1);
        assertGt(expectedFee, 0);

        uint256 walletBefore = usdc.balanceOf(alice);
        uint256 allowanceBefore = usdc.allowance(alice, address(guardian));

        vm.expectEmit(true, true, false, true, address(guardian));
        emit FeeCharged(alice, address(usdc), expectedFee, 0);
        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        assertEq(repaid, l1);
        assertEq(usdc.balanceOf(treasury), _fee(repaid), "fee = floor(repaid * 15 / 10_000)");
        assertEq(walletBefore - usdc.balanceOf(alice), repaid + expectedFee);
        assertEq(allowanceBefore - usdc.allowance(alice, address(guardian)), repaid + expectedFee);
        assertGe(guardian.healthFactor(alice), TARGET);
        _assertGuardianEmpty();
    }

    function test_fee_notCharged_dynamicTriggerOnly() public {
        vm.prank(alice);
        guardian.setTriggerBand(1.1e18, 1.5e18, riskAgent);
        vm.prank(riskAgent);
        guardian.setDynamicTrigger(alice, 1.45e18, uint64(block.timestamp + 1 hours));

        // HF ~1.398: above the static trigger (1.3), below the dynamic trigger (1.45) and the ceiling.
        aave.setAccount(alice, 20_000e8, 11_800e8, LT_WETH);
        assertTrue(guardian.needsProtection(alice));

        (bool eligible, uint256 quoted) = guardian.quoteFee(alice);
        assertFalse(eligible);
        assertEq(quoted, 0);

        uint256 walletBefore = usdc.balanceOf(alice);
        vm.recordLogs();
        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        assertGt(repaid, 0, "protection still runs");
        assertEq(_countFeeEvents(vm.getRecordedLogs()), 0, "no FeeCharged");
        assertEq(usdc.balanceOf(treasury), 0);
        assertEq(walletBefore - usdc.balanceOf(alice), repaid);
        _assertGuardianEmpty();
    }

    function test_fee_notCharged_atOrAboveCeiling() public {
        // Static trigger above the ceiling: actions between 1.50 and 1.55 are free.
        vm.prank(alice);
        guardian.setPolicy(address(usdc), 1.55e18, 1.8e18, 20_000e6);

        uint256[2] memory debts = [uint256(11_000e8), 10_855e8]; // HF exactly 1.50, and ~1.52
        for (uint256 i = 0; i < debts.length; ++i) {
            aave.setAccount(alice, 20_000e8, debts[i], LT_WETH);
            assertGe(guardian.healthFactor(alice), 1.5e18);
            assertTrue(guardian.needsProtection(alice));

            vm.recordLogs();
            vm.prank(keeper);
            uint256 repaid = guardian.protect(alice);

            assertGt(repaid, 0);
            assertEq(_countFeeEvents(vm.getRecordedLogs()), 0);
            assertEq(usdc.balanceOf(treasury), 0);
        }
        _assertGuardianEmpty();
    }

    function test_fee_charged_justBelowCeiling() public {
        vm.prank(alice);
        guardian.setPolicy(address(usdc), 1.55e18, 1.8e18, 20_000e6);
        aave.setAccount(alice, 20_000e8, 11_010e8, LT_WETH); // HF ~1.4986
        assertLt(guardian.healthFactor(alice), 1.5e18);

        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);
        assertEq(usdc.balanceOf(treasury), _fee(repaid));
        assertGt(usdc.balanceOf(treasury), 0);
    }

    function test_fee_charged_dynamicTriggerActive_butBelowStatic() public {
        // Dynamic trigger is active, yet HF is also below the static trigger: a real rescue, fee applies.
        vm.prank(alice);
        guardian.setTriggerBand(1.1e18, 1.5e18, riskAgent);
        vm.prank(riskAgent);
        guardian.setDynamicTrigger(alice, 1.45e18, uint64(block.timestamp + 1 hours));
        _setAtRiskPosition();

        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);
        assertEq(usdc.balanceOf(treasury), _fee(repaid));
    }

    // ─── Fee sources ─────────────────────────────────────────────────────────

    function test_fee_sourceA_only() public {
        _setAtRiskPosition();
        (uint256 l1,,,,) = guardian.quoteProtect(alice);
        uint256 expectedFee = _fee(l1);
        uint256 leftover = 1_000e6; // debt tokens sitting in the Guardian during this call
        usdc.mint(address(guardian), leftover);

        uint256 walletBefore = usdc.balanceOf(alice);
        uint256 allowanceBefore = usdc.allowance(alice, address(guardian));

        vm.expectEmit(true, true, false, true, address(guardian));
        emit FeeCharged(alice, address(usdc), expectedFee, 0);
        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        assertEq(usdc.balanceOf(treasury), expectedFee);
        // Wallet: pays repay, gets the leftover back minus the fee. Allowance only used for repay.
        assertEq(usdc.balanceOf(alice), walletBefore - repaid + leftover - expectedFee);
        assertEq(allowanceBefore - usdc.allowance(alice, address(guardian)), repaid);
        _assertGuardianEmpty();
    }

    function test_fee_sourceA_and_B() public {
        _setAtRiskPosition();
        (uint256 l1,,,,) = guardian.quoteProtect(alice);
        uint256 expectedFee = _fee(l1);
        uint256 leftover = expectedFee / 2;
        usdc.mint(address(guardian), leftover);

        uint256 walletBefore = usdc.balanceOf(alice);
        uint256 allowanceBefore = usdc.allowance(alice, address(guardian));

        vm.expectEmit(true, true, false, true, address(guardian));
        emit FeeCharged(alice, address(usdc), expectedFee, 0);
        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        assertEq(usdc.balanceOf(treasury), expectedFee);
        assertEq(walletBefore - usdc.balanceOf(alice), repaid + (expectedFee - leftover));
        assertEq(allowanceBefore - usdc.allowance(alice, address(guardian)), repaid + (expectedFee - leftover));
        _assertGuardianEmpty();
    }

    /// Source A from a real flow: L3 swap proceeds exceed the remaining debt, so the excess stays in
    /// the Guardian and pays the fee before the rest is refunded. No wallet allowance at all.
    function test_fee_sourceA_fromL3SwapExcess() public {
        _approveUsdcBoth(0);
        vm.startPrank(alice);
        aWeth.approve(address(guardian), 10e18);
        guardian.setPolicy(address(usdc), TRIGGER, 3e18, 20_000e6);
        guardian.setLayer3(true, address(weth), 10e18, 3000); // wide slippage -> large swap excess
        vm.stopPrank();
        _setAtRiskPosition();

        uint256 walletBefore = usdc.balanceOf(alice);
        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        uint256 expectedFee = _fee(repaid);
        assertGt(expectedFee, 0);
        assertEq(usdc.balanceOf(treasury), expectedFee, "fee fully paid from swap excess");
        assertGt(usdc.balanceOf(alice), walletBefore, "remaining excess refunded to user");
        _assertGuardianEmpty();
    }

    // ─── Waivers ─────────────────────────────────────────────────────────────

    function test_fee_waived_allowanceExhausted() public {
        _setAtRiskPosition();
        (uint256 l1,,,,) = guardian.quoteProtect(alice);
        vm.prank(alice);
        usdc.approve(address(guardian), l1); // exactly the repay, nothing left for the fee
        uint256 expectedFee = _fee(l1);

        vm.expectEmit(true, true, false, true, address(guardian));
        emit FeeCharged(alice, address(usdc), 0, expectedFee);
        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        assertEq(repaid, l1, "repay not reduced by the fee");
        assertEq(usdc.balanceOf(treasury), 0);
        assertGe(guardian.healthFactor(alice), TARGET);
        _assertGuardianEmpty();
    }

    function test_fee_waived_partial() public {
        _setAtRiskPosition();
        (uint256 l1,,,,) = guardian.quoteProtect(alice);
        uint256 expectedFee = _fee(l1);
        uint256 spare = expectedFee / 3;
        vm.prank(alice);
        usdc.approve(address(guardian), l1 + spare);

        vm.expectEmit(true, true, false, true, address(guardian));
        emit FeeCharged(alice, address(usdc), spare, expectedFee - spare);
        vm.prank(keeper);
        guardian.protect(alice);

        assertEq(usdc.balanceOf(treasury), spare);
        _assertGuardianEmpty();
    }

    function test_fee_waived_walletEmpty() public {
        _setAtRiskPosition();
        (uint256 l1,,,,) = guardian.quoteProtect(alice);
        vm.startPrank(alice);
        usdc.transfer(bob, usdc.balanceOf(alice) - l1); // wallet holds exactly the repay
        vm.stopPrank();

        vm.expectEmit(true, true, false, true, address(guardian));
        emit FeeCharged(alice, address(usdc), 0, _fee(l1));
        vm.prank(keeper);
        guardian.protect(alice);

        assertEq(usdc.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(treasury), 0);
        _assertGuardianEmpty();
    }

    function test_fee_blocklistedTreasury_neverReverts() public {
        BlocklistToken blk = new BlocklistToken(treasury);
        oracle.setPrice(address(blk), 1e8);
        blk.mint(alice, 100_000e6);
        vm.startPrank(alice);
        blk.approve(address(guardian), type(uint256).max);
        guardian.setPolicy(address(blk), TRIGGER, TARGET, 20_000e6);
        vm.stopPrank();
        _setAtRiskPosition();

        (uint256 l1,,,,) = guardian.quoteProtect(alice);
        uint256 leftover = 500e6;
        blk.mint(address(guardian), leftover); // source A attempt fails too, then refunded to user

        uint256 walletBefore = blk.balanceOf(alice);
        vm.expectEmit(true, true, false, true, address(guardian));
        emit FeeCharged(alice, address(blk), 0, _fee(l1));
        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        assertEq(repaid, l1);
        assertEq(blk.balanceOf(alice), walletBefore - repaid + leftover);
        assertEq(blk.balanceOf(address(guardian)), 0);
    }

    // ─── Rounding ────────────────────────────────────────────────────────────

    function test_fee_rounding_floor() public {
        _setPolicyBoth(TRIGGER, TARGET, 1_000_001); // repay 1.000001 USDC -> 1500.0015 units
        _setAtRiskPosition();

        vm.prank(keeper);
        uint256 repaid = guardian.protect(alice);

        assertEq(repaid, 1_000_001);
        assertEq(usdc.balanceOf(treasury), 1500, "rounded down in the user's favor");
    }

    function test_fee_rounding_tinyRepayIsFree() public {
        _setPolicyBoth(TRIGGER, TARGET, 666); // 666 * 15 / 10_000 = 0.999 -> 0
        _setAtRiskPosition();

        vm.expectEmit(true, true, false, true, address(guardian));
        emit FeeCharged(alice, address(usdc), 0, 0);
        vm.prank(keeper);
        guardian.protect(alice);

        assertEq(usdc.balanceOf(treasury), 0);
    }

    // ─── quoteFee ────────────────────────────────────────────────────────────

    function test_quoteFee_matchesExecution() public {
        aave.setAccount(alice, 32_000e8, 14_000e8, LT_WETH); // safe
        (bool eligible, uint256 quoted) = guardian.quoteFee(alice);
        assertFalse(eligible);
        assertEq(quoted, 0);

        _setAtRiskPosition();
        (eligible, quoted) = guardian.quoteFee(alice);
        assertTrue(eligible);

        vm.prank(keeper);
        guardian.protect(alice);
        assertEq(usdc.balanceOf(treasury), quoted);
    }

    // ─── Parity with V2 ──────────────────────────────────────────────────────

    struct Outcome {
        uint256 repaid;
        uint256 hfAfter;
        uint256 walletUsdc;
        uint256 aUsdcBal;
        uint256 aWethBal;
        uint256 vaultShares;
    }

    function _run(TahansoeGuardianV2 g) internal returns (Outcome memory o) {
        vm.prank(keeper);
        o.repaid = g.protect(alice);
        o.hfAfter = g.healthFactor(alice);
        o.walletUsdc = usdc.balanceOf(alice);
        o.aUsdcBal = aUsdc.balanceOf(alice);
        o.aWethBal = aWeth.balanceOf(alice);
        o.vaultShares = vault.balanceOf(alice);
    }

    function _assertParity() internal {
        _setAtRiskPosition();
        uint256 snap = vm.snapshotState();
        Outcome memory a = _run(v2);
        vm.revertToState(snap);
        Outcome memory b = _run(guardian);
        uint256 charged = usdc.balanceOf(treasury);

        assertEq(b.repaid, a.repaid, "repaid");
        assertEq(b.hfAfter, a.hfAfter, "hf after");
        assertEq(b.walletUsdc + charged, a.walletUsdc, "wallet differs only by the fee");
        assertEq(b.aUsdcBal, a.aUsdcBal, "aUSDC");
        assertEq(b.aWethBal, a.aWethBal, "aWETH");
        assertEq(b.vaultShares, a.vaultShares, "vault shares");
        assertLe(charged, _fee(b.repaid));
        _assertGuardianEmpty();
    }

    function test_parity_layer1() public {
        _assertParity();
    }

    function test_parity_layer2_ERC4626() public {
        vm.startPrank(alice);
        usdc.transfer(bob, usdc.balanceOf(alice) - 10_000e6);
        usdc.approve(address(vault), 10_000e6);
        vault.deposit(10_000e6, alice);
        vault.approve(address(guardian), 10_000e6);
        vault.approve(address(v2), 10_000e6);
        guardian.setLayer2(L2_ERC4626, address(vault), 5_000e6);
        v2.setLayer2(L2_ERC4626, address(vault), 5_000e6);
        vm.stopPrank();
        _assertParity();
    }

    function test_parity_layer2_aToken() public {
        vm.startPrank(alice);
        usdc.transfer(bob, usdc.balanceOf(alice));
        aUsdc.approve(address(guardian), 10_000e6);
        aUsdc.approve(address(v2), 10_000e6);
        guardian.setLayer2(L2_ATOKEN, address(aUsdc), 5_000e6);
        v2.setLayer2(L2_ATOKEN, address(aUsdc), 5_000e6);
        vm.stopPrank();
        _assertParity();
    }

    function test_parity_layer3() public {
        vm.startPrank(alice);
        usdc.transfer(bob, usdc.balanceOf(alice));
        aWeth.approve(address(guardian), 10e18);
        aWeth.approve(address(v2), 10e18);
        guardian.setLayer3(true, address(weth), 10e18, 100);
        v2.setLayer3(true, address(weth), 10e18, 100);
        vm.stopPrank();
        _assertParity();
    }

    function test_parity_layer3_swapExcess() public {
        _approveUsdcBoth(0);
        _setPolicyBoth(TRIGGER, 3e18, 20_000e6);
        vm.startPrank(alice);
        aWeth.approve(address(guardian), 10e18);
        aWeth.approve(address(v2), 10e18);
        guardian.setLayer3(true, address(weth), 10e18, 3000);
        v2.setLayer3(true, address(weth), 10e18, 3000);
        vm.stopPrank();
        _assertParity();
    }

    function test_parity_fullCascade() public {
        _setPolicyBoth(TRIGGER, TARGET, 500e6);
        vm.startPrank(alice);
        usdc.transfer(bob, usdc.balanceOf(alice) - 1_000e6);
        usdc.approve(address(vault), 500e6);
        vault.deposit(500e6, alice);
        vault.approve(address(guardian), 500e6);
        vault.approve(address(v2), 500e6);
        guardian.setLayer2(L2_ERC4626, address(vault), 500e6);
        v2.setLayer2(L2_ERC4626, address(vault), 500e6);
        aWeth.approve(address(guardian), 5e18);
        aWeth.approve(address(v2), 5e18);
        guardian.setLayer3(true, address(weth), 5e18, 100);
        v2.setLayer3(true, address(weth), 5e18, 100);
        vm.stopPrank();
        _assertParity();
    }

    // ─── Fuzz ────────────────────────────────────────────────────────────────

    /// Whenever V2 succeeds, V3 succeeds with the same repay and HF; the fee is bounded by 15 bps and
    /// comes only from leftover + wallet allowance. Whenever V2 reverts, V3 reverts too.
    function testFuzz_v3MatchesV2_andNeverRevertsOnFee(
        uint96 collateral,
        uint96 debt,
        uint64 cap,
        uint64 walletBal,
        uint64 allowanceExtra,
        uint64 leftover,
        bool useL3
    ) public {
        collateral = uint96(bound(collateral, 1_000e8, 1_000_000e8));
        debt = uint96(bound(debt, 100e8, collateral));
        cap = uint64(bound(cap, 1, 1_000_000e6));
        walletBal = uint64(bound(walletBal, 0, 1_000_000e6));
        allowanceExtra = uint64(bound(allowanceExtra, 0, 10_000e6));
        leftover = uint64(bound(leftover, 0, 1_000e6));

        vm.startPrank(alice);
        usdc.transfer(bob, usdc.balanceOf(alice));
        vm.stopPrank();
        usdc.mint(alice, walletBal);
        _setPolicyBoth(TRIGGER, TARGET, cap);
        _approveUsdcBoth(uint256(cap) + allowanceExtra);
        if (useL3) {
            vm.startPrank(alice);
            aWeth.approve(address(guardian), 10e18);
            aWeth.approve(address(v2), 10e18);
            guardian.setLayer3(true, address(weth), 10e18, 300);
            v2.setLayer3(true, address(weth), 10e18, 300);
            vm.stopPrank();
        }
        aave.setAccount(alice, collateral, debt, LT_WETH);
        vm.assume(guardian.needsProtection(alice));
        uint256 hfBefore = guardian.healthFactor(alice);

        uint256 snap = vm.snapshotState();
        usdc.mint(address(v2), leftover);
        bool okV2;
        uint256 repaidV2;
        uint256 hfV2;
        uint256 walletV2;
        vm.prank(keeper);
        try v2.protect(alice) returns (uint256 r) {
            (okV2, repaidV2, hfV2, walletV2) = (true, r, v2.healthFactor(alice), usdc.balanceOf(alice));
        } catch {}
        vm.revertToState(snap);

        usdc.mint(address(guardian), leftover);
        vm.prank(keeper);
        try guardian.protect(alice) returns (uint256 r) {
            assertTrue(okV2, "V3 succeeded where V2 reverted");
            uint256 charged = usdc.balanceOf(treasury);
            assertEq(r, repaidV2, "repaid");
            assertEq(guardian.healthFactor(alice), hfV2, "hf");
            assertEq(usdc.balanceOf(alice) + charged, walletV2, "wallet");
            assertLe(charged, _fee(r), "fee <= 15 bps");
            if (hfBefore >= 1.5e18) assertEq(charged, 0);
            _assertGuardianEmpty();
        } catch {
            assertFalse(okV2, "V3 reverted where V2 succeeded");
        }
    }
}
