// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TahansoeGuardianMorpho} from "../src/TahansoeGuardianMorpho.sol";
import {GuardianCore} from "../src/lib/GuardianCore.sol";
import {
    IMorpho,
    MarketParams,
    Position,
    Market
} from "../src/interfaces/IMorpho.sol";
import {MockMorpho, MockMorphoOracle, MockMorphoIrm} from "./mocks/MockMorpho.sol";
import {MockToken} from "./mocks/MockAave.sol";
import {TestVault} from "../src/testnet/TestVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TahansoeGuardianMorphoTest is Test {
    TahansoeGuardianMorpho public guardian;
    MockMorpho public morpho;
    MockMorphoOracle public oracle;
    MockMorphoIrm public irm;

    MockToken public usdc; // Loan token (6 decimals)
    MockToken public weth; // Collateral token (18 decimals)
    TestVault public vault; // ERC-4626 vault over USDC

    address public treasury = makeAddr("treasury");
    address public riskAgent = makeAddr("riskAgent");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    bytes32 public marketId;
    MarketParams public marketParams;

    // 1 WETH = $2000 USDC
    // Oracle price in Morpho: 1 unit of collateral in loan token units * 1e36
    // WETH 18 dec, USDC 6 dec: price = 2000 * 10^(36 + 6 - 18) = 2000 * 10^24 = 2e27
    uint256 public constant INITIAL_ORACLE_PRICE = 2000e24;
    uint256 public constant LLTV = 0.86e18; // 86% LLTV

    function setUp() public {
        usdc = new MockToken("USDC", 6);
        weth = new MockToken("WETH", 18);
        vault = new TestVault(IERC20(address(usdc)), "Vault USDC", "vUSDC");

        oracle = new MockMorphoOracle(INITIAL_ORACLE_PRICE);
        irm = new MockMorphoIrm();
        morpho = new MockMorpho();

        marketParams = MarketParams({
            loanToken: address(usdc),
            collateralToken: address(weth),
            oracle: address(oracle),
            irm: address(irm),
            lltv: LLTV
        });
        marketId = keccak256(abi.encode(marketParams));
        morpho.setMarketParams(marketId, marketParams);

        // Initial market state: 1,000,000 USDC borrowed
        morpho.setMarket(
            marketId,
            Market({
                totalSupplyAssets: 10_000_000e6,
                totalSupplyShares: 10_000_000e6,
                totalBorrowAssets: 1_000_000e6,
                totalBorrowShares: 1_000_000e6,
                lastUpdate: uint128(block.timestamp),
                fee: 0
            })
        );

        guardian = new TahansoeGuardianMorpho(IMorpho(address(morpho)), treasury);

        // Setup Alice: 1 WETH collateral ($2000), 1200 USDC borrowed
        // maxBorrow = 2000e6 * 0.86 = 1720e6. HF = 1720 / 1200 = 1.433e18.
        morpho.setPosition(
            marketId,
            alice,
            Position({supplyShares: 0, borrowShares: 1200e6, collateral: 1e18})
        );

        usdc.mint(alice, 10_000e6);
        weth.mint(alice, 10e18);

        vm.startPrank(alice);
        usdc.approve(address(guardian), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(5_000e6, alice);
        IERC20(address(vault)).approve(address(guardian), type(uint256).max);
        vm.stopPrank();
    }

    // ─── Constructor & Setup ─────────────────────────────────────────────────

    function test_constructor_validations() public {
        vm.expectRevert(GuardianCore.InvalidTreasury.selector);
        new TahansoeGuardianMorpho(IMorpho(address(0)), treasury);

        vm.expectRevert(GuardianCore.InvalidTreasury.selector);
        new TahansoeGuardianMorpho(IMorpho(address(morpho)), address(0));

        assertEq(address(guardian.morpho()), address(morpho));
        assertEq(guardian.treasury(), treasury);
    }

    // ─── Policy Management ───────────────────────────────────────────────────

    function test_setPolicy_validations() public {
        vm.startPrank(alice);

        // Invalid market
        bytes32 badId = keccak256("badMarket");
        vm.expectRevert(GuardianCore.InvalidMarket.selector);
        guardian.setPolicy(badId, 1.2e18, 1.6e18, 1000e6);

        // Trigger below min
        vm.expectRevert(GuardianCore.InvalidPolicy.selector);
        guardian.setPolicy(marketId, 1.04e18, 1.6e18, 1000e6);

        // Target <= trigger
        vm.expectRevert(GuardianCore.InvalidPolicy.selector);
        guardian.setPolicy(marketId, 1.5e18, 1.5e18, 1000e6);

        // Target > max
        vm.expectRevert(GuardianCore.InvalidPolicy.selector);
        guardian.setPolicy(marketId, 1.5e18, 3.1e18, 1000e6);

        // maxRepay == 0
        vm.expectRevert(GuardianCore.InvalidPolicy.selector);
        guardian.setPolicy(marketId, 1.2e18, 1.6e18, 0);

        // Valid policy
        guardian.setPolicy(marketId, 1.2e18, 1.6e18, 1000e6);
        vm.stopPrank();

        (bool enabled, uint256 trig, uint256 target, uint256 cap) = guardian.policyOf(alice, marketId);
        assertTrue(enabled);
        assertEq(trig, 1.2e18);
        assertEq(target, 1.6e18);
        assertEq(cap, 1000e6);

        assertEq(guardian.positionCount(), 1);
        bytes32[] memory mkts = guardian.marketsOf(alice);
        assertEq(mkts.length, 1);
        assertEq(mkts[0], marketId);
    }

    function test_disablePolicy() public {
        vm.startPrank(alice);
        guardian.setPolicy(marketId, 1.5e18, 1.8e18, 1000e6);
        assertTrue(guardian.needsProtection(alice, marketId));

        guardian.disablePolicy(marketId);
        (bool enabled,,,) = guardian.policyOf(alice, marketId);
        assertFalse(enabled);
        assertFalse(guardian.needsProtection(alice, marketId));

        vm.expectRevert(GuardianCore.NoPolicy.selector);
        guardian.protect(alice, marketId);
        vm.stopPrank();
    }

    function test_setLayer2_validations() public {
        vm.startPrank(alice);
        // Before policy
        vm.expectRevert(GuardianCore.NoPolicy.selector);
        guardian.setLayer2(marketId, address(vault), 500e6);

        guardian.setPolicy(marketId, 1.2e18, 1.6e18, 1000e6);

        // Zero cap
        vm.expectRevert(GuardianCore.InvalidLayer2.selector);
        guardian.setLayer2(marketId, address(vault), 0);

        // Invalid underlying asset (e.g. vault over WETH instead of USDC)
        TestVault wethVault = new TestVault(IERC20(address(weth)), "vWETH", "vWETH");
        vm.expectRevert(GuardianCore.InvalidSource.selector);
        guardian.setLayer2(marketId, address(wethVault), 500e6);

        // Valid
        guardian.setLayer2(marketId, address(vault), 500e6);
        (address v, uint256 cap) = guardian.layer2Of(alice, marketId);
        assertEq(v, address(vault));
        assertEq(cap, 500e6);

        // Disabling layer2
        guardian.setLayer2(marketId, address(0), 0);
        (v, cap) = guardian.layer2Of(alice, marketId);
        assertEq(v, address(0));
        assertEq(cap, 0);
        vm.stopPrank();
    }

    function test_setTriggerBand_andDynamicTrigger() public {
        vm.startPrank(alice);
        guardian.setPolicy(marketId, 1.2e18, 1.6e18, 1000e6);

        // Invalid band: maxTrigger >= targetHF
        vm.expectRevert(GuardianCore.InvalidBand.selector);
        guardian.setTriggerBand(marketId, 1.1e18, 1.6e18, riskAgent);

        // Valid band
        guardian.setTriggerBand(marketId, 1.1e18, 1.5e18, riskAgent);
        vm.stopPrank();

        // Unauthorized caller
        vm.prank(bob);
        vm.expectRevert(GuardianCore.Unauthorized.selector);
        guardian.setDynamicTrigger(alice, marketId, 1.3e18, uint64(block.timestamp + 1 hours));

        // Trigger above band
        vm.prank(riskAgent);
        vm.expectRevert(GuardianCore.InvalidTrigger.selector);
        guardian.setDynamicTrigger(alice, marketId, 1.55e18, uint64(block.timestamp + 1 hours));

        // Past expiry
        vm.prank(riskAgent);
        vm.expectRevert(GuardianCore.InvalidExpiry.selector);
        guardian.setDynamicTrigger(alice, marketId, 1.3e18, uint64(block.timestamp));

        // Valid dynamic trigger
        vm.prank(riskAgent);
        guardian.setDynamicTrigger(alice, marketId, 1.35e18, uint64(block.timestamp + 1 hours));
        assertEq(guardian.effectiveTrigger(alice, marketId), 1.35e18);

        // When expired, falls back to static
        vm.warp(block.timestamp + 2 hours);
        assertEq(guardian.effectiveTrigger(alice, marketId), 1.2e18);
    }

    function test_positionsPage_and_positionCount() public {
        vm.prank(alice);
        guardian.setPolicy(marketId, 1.2e18, 1.6e18, 1000e6);

        assertEq(guardian.positionCount(), 1);
        (address[] memory users, bytes32[] memory ids) = guardian.positionsPage(0, 10);
        assertEq(users.length, 1);
        assertEq(users[0], alice);
        assertEq(ids[0], marketId);

        // Out of bounds
        (users, ids) = guardian.positionsPage(1, 10);
        assertEq(users.length, 0);

        // Zero limit
        (users, ids) = guardian.positionsPage(0, 0);
        assertEq(users.length, 0);
    }

    // ─── Protection Execution ────────────────────────────────────────────────

    function test_protect_layer1Only() public {
        // HF = 1.433e18. Set trigger = 1.50e18, target = 1.70e18.
        vm.prank(alice);
        guardian.setPolicy(marketId, 1.5e18, 1.7e18, 1000e6);

        assertTrue(guardian.needsProtection(alice, marketId));
        uint256 hfBefore = guardian.healthFactor(alice, marketId);

        (uint256 qL1, uint256 qL2, uint256 expHf) = guardian.quoteProtect(alice, marketId);
        assertGt(qL1, 0);
        assertEq(qL2, 0);

        uint256 aliceBalBefore = usdc.balanceOf(alice);
        uint256 repaid = guardian.protect(alice, marketId);
        assertEq(repaid, qL1);

        uint256 hfAfter = guardian.healthFactor(alice, marketId);
        assertGt(hfAfter, hfBefore);
        assertGe(hfAfter, 1.7e18);

        // Zero balance in Guardian
        assertEq(usdc.balanceOf(address(guardian)), 0);
        // Alice balance decreased by repaid + fee
        assertLt(usdc.balanceOf(alice), aliceBalBefore);
    }

    function test_protect_layer2_ERC4626() public {
        // Empty Alice wallet USDC so L1 cannot repay
        uint256 bal = usdc.balanceOf(alice);
        vm.prank(alice);
        usdc.transfer(bob, bal);
        assertEq(usdc.balanceOf(alice), 0);

        vm.startPrank(alice);
        guardian.setPolicy(marketId, 1.5e18, 1.7e18, 1000e6);
        guardian.setLayer2(marketId, address(vault), 1000e6);
        vm.stopPrank();

        (uint256 qL1, uint256 qL2, uint256 expHf) = guardian.quoteProtect(alice, marketId);
        assertEq(qL1, 0);
        assertGt(qL2, 0);

        uint256 vaultSharesBefore = IERC20(address(vault)).balanceOf(alice);
        uint256 repaid = guardian.protect(alice, marketId);
        assertEq(repaid, qL2);

        assertLt(IERC20(address(vault)).balanceOf(alice), vaultSharesBefore);
        assertGe(guardian.healthFactor(alice, marketId), 1.7e18);
        assertEq(usdc.balanceOf(address(guardian)), 0);
    }

    // ─── Fee Handling (ADR 0013) ─────────────────────────────────────────────

    function test_fee_eligible_chargesFee() public {
        // HF = 1.433e18 < static trigger 1.50e18 and < FEE_HF_CEILING 1.50e18 -> Eligible!
        vm.prank(alice);
        guardian.setPolicy(marketId, 1.5e18, 1.7e18, 1000e6);

        (bool eligible, uint256 expectedFee) = guardian.quoteFee(alice, marketId);
        assertTrue(eligible);
        assertGt(expectedFee, 0);

        uint256 treasuryBalBefore = usdc.balanceOf(treasury);
        uint256 repaid = guardian.protect(alice, marketId);

        uint256 expectedActualFee = (repaid * 15) / 10_000;
        assertEq(usdc.balanceOf(treasury) - treasuryBalBefore, expectedActualFee);
    }

    function test_fee_notEligible_dynamicTriggerOnly() public {
        // Static trigger 1.40e18. Current HF = 1.433e18. Alice is SAFE under static.
        // Risk agent raises dynamic trigger to 1.48e18 -> Protect runs, but fee MUST be 0!
        vm.startPrank(alice);
        guardian.setPolicy(marketId, 1.4e18, 1.7e18, 1000e6);
        guardian.setTriggerBand(marketId, 1.3e18, 1.5e18, riskAgent);
        vm.stopPrank();

        vm.prank(riskAgent);
        guardian.setDynamicTrigger(alice, marketId, 1.48e18, uint64(block.timestamp + 1 hours));

        (bool eligible, uint256 expectedFee) = guardian.quoteFee(alice, marketId);
        assertFalse(eligible);
        assertEq(expectedFee, 0);

        uint256 treasuryBalBefore = usdc.balanceOf(treasury);
        guardian.protect(alice, marketId);
        // Zero fee to treasury!
        assertEq(usdc.balanceOf(treasury), treasuryBalBefore);
    }

    function test_fee_waived_whenAllowanceOrWalletExhausted() public {
        vm.prank(alice);
        guardian.setPolicy(marketId, 1.5e18, 1.7e18, 1000e6);

        (uint256 qL1,,) = guardian.quoteProtect(alice, marketId);
        // Set Alice's allowance to exactly qL1 so no allowance remains for fee
        vm.prank(alice);
        usdc.approve(address(guardian), qL1);

        uint256 treasuryBalBefore = usdc.balanceOf(treasury);
        // Protect should succeed, NOT revert, and waive fee
        uint256 repaid = guardian.protect(alice, marketId);
        assertEq(repaid, qL1);
        assertEq(usdc.balanceOf(treasury), treasuryBalBefore);
    }

    function test_protect_revertsWhenSafe() public {
        // HF = 1.433. Trigger = 1.30. Safe!
        vm.prank(alice);
        guardian.setPolicy(marketId, 1.3e18, 1.6e18, 1000e6);

        assertFalse(guardian.needsProtection(alice, marketId));
        vm.expectRevert();
        guardian.protect(alice, marketId);
    }

    function test_protect_respectsCap() public {
        // Sizing requires ~200 USDC to reach 1.70. Cap = 50 USDC.
        vm.prank(alice);
        guardian.setPolicy(marketId, 1.5e18, 1.7e18, 50e6);

        uint256 repaid = guardian.protect(alice, marketId);
        assertEq(repaid, 50e6);
    }

    // ─── Fuzz Tests ──────────────────────────────────────────────────────────

    function testFuzz_protect_neverOverspends(uint32 repayCap) public {
        vm.assume(repayCap >= 1e6 && repayCap <= 2000e6);

        vm.prank(alice);
        guardian.setPolicy(marketId, 1.5e18, 1.7e18, repayCap);

        uint256 repaid = guardian.protect(alice, marketId);
        assertLe(repaid, repayCap);
        assertEq(usdc.balanceOf(address(guardian)), 0);
    }
}
