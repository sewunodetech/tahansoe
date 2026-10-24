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

contract MorphoGuardianHandler is Test {
    TahansoeGuardianMorpho public guardian;
    MockMorpho public morpho;
    MockMorphoOracle public oracle;
    MockToken public usdc;
    MockToken public weth;
    TestVault public vault;
    bytes32 public marketId;
    address public treasury;
    address public riskAgent = makeAddr("riskAgent");

    address[] public users;

    uint256 public ghost_totalRepaid;
    uint256 public ghost_maxFee;
    uint256 public ghost_protectSuccesses;

    constructor(
        TahansoeGuardianMorpho _guardian,
        MockMorpho _morpho,
        MockMorphoOracle _oracle,
        MockToken _usdc,
        MockToken _weth,
        TestVault _vault,
        bytes32 _marketId
    ) {
        guardian = _guardian;
        morpho = _morpho;
        oracle = _oracle;
        usdc = _usdc;
        weth = _weth;
        vault = _vault;
        marketId = _marketId;
        treasury = _guardian.treasury();

        users.push(makeAddr("alice"));
        users.push(makeAddr("bob"));

        for (uint256 i = 0; i < users.length; i++) {
            address u = users[i];
            usdc.mint(u, 100_000e6);
            weth.mint(u, 50e18);

            vm.startPrank(u);
            usdc.approve(address(vault), type(uint256).max);
            vault.deposit(10_000e6, u);
            usdc.approve(address(guardian), type(uint256).max);
            IERC20(address(vault)).approve(address(guardian), type(uint256).max);

            guardian.setPolicy(marketId, 1.3e18, 1.6e18, 5_000e6);
            guardian.setLayer2(marketId, address(vault), 5_000e6);
            guardian.setTriggerBand(marketId, 1.1e18, 1.5e18, riskAgent);
            vm.stopPrank();

            // Setup initial position: 2 WETH collateral ($4000), 2400 USDC borrow. HF = 4000 * 0.86 / 2400 = 1.433
            morpho.setPosition(
                marketId,
                u,
                Position({supplyShares: 0, borrowShares: 2400e6, collateral: 2e18})
            );
        }
    }

    function setAtRisk(uint256 userIndex, uint256 borrowAmount) external {
        address user = users[userIndex % users.length];
        borrowAmount = bound(borrowAmount, 2300e6, 3200e6);
        Position memory pos = morpho.position(marketId, user);
        pos.borrowShares = uint128(borrowAmount);
        morpho.setPosition(marketId, user, pos);
    }

    function setOraclePrice(uint256 priceUsd) external {
        // Price between $1200 and $2500 per WETH -> priceValue = priceUsd * 10^24
        priceUsd = bound(priceUsd, 1200, 2500);
        oracle.setPrice(priceUsd * 1e24);
    }

    function setDynamicTrigger(uint256 userIndex, uint256 trig) external {
        address user = users[userIndex % users.length];
        trig = bound(trig, 1.1e18, 1.5e18);
        vm.prank(riskAgent);
        guardian.setDynamicTrigger(user, marketId, trig, uint64(block.timestamp + 1 hours));
    }

    function setAllowance(uint256 userIndex, uint256 amount) external {
        address user = users[userIndex % users.length];
        amount = bound(amount, 0, 20_000e6);
        vm.prank(user);
        usdc.approve(address(guardian), amount);
    }

    function protectUser(uint256 userIndex) external {
        address user = users[userIndex % users.length];
        if (!guardian.needsProtection(user, marketId)) return;

        uint256 hfBefore = guardian.healthFactor(user, marketId);
        (bool feeEligible, uint256 expectedFee) = guardian.quoteFee(user, marketId);

        uint256 repaid = guardian.protect(user, marketId);

        ghost_totalRepaid += repaid;
        if (feeEligible) {
            ghost_maxFee += expectedFee;
        }
        ghost_protectSuccesses++;

        uint256 hfAfter = guardian.healthFactor(user, marketId);
        assertTrue(hfAfter > hfBefore, "HF must improve");
    }
}

contract TahansoeGuardianMorphoInvariantTest is Test {
    TahansoeGuardianMorpho public guardian;
    MockMorpho public morpho;
    MockMorphoOracle public oracle;
    MockMorphoIrm public irm;
    MockToken public usdc;
    MockToken public weth;
    TestVault public vault;
    bytes32 public marketId;
    address public treasury = makeAddr("treasury");
    MorphoGuardianHandler public handler;

    function setUp() public {
        usdc = new MockToken("USDC", 6);
        weth = new MockToken("WETH", 18);
        vault = new TestVault(IERC20(address(usdc)), "Vault USDC", "vUSDC");

        oracle = new MockMorphoOracle(2000e24);
        irm = new MockMorphoIrm();
        morpho = new MockMorpho();

        MarketParams memory mp = MarketParams({
            loanToken: address(usdc),
            collateralToken: address(weth),
            oracle: address(oracle),
            irm: address(irm),
            lltv: 0.86e18
        });
        marketId = keccak256(abi.encode(mp));
        morpho.setMarketParams(marketId, mp);

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

        handler = new MorphoGuardianHandler(guardian, morpho, oracle, usdc, weth, vault, marketId);
        targetContract(address(handler));
    }

    /// @notice Invariant 1: Guardian contract NEVER holds tokens after any call.
    function invariant_guardianHoldsZeroTokens() public view {
        assertEq(usdc.balanceOf(address(guardian)), 0, "Guardian USDC balance != 0");
        assertEq(weth.balanceOf(address(guardian)), 0, "Guardian WETH balance != 0");
        assertEq(vault.balanceOf(address(guardian)), 0, "Guardian Vault balance != 0");
    }

    /// @notice Invariant 2: Morpho contract NEVER receives calls to forbidden selectors
    /// (borrow, withdraw, withdrawCollateral, setAuthorization).
    function invariant_morphoNeverReceivesForbiddenCalls() public view {
        assertFalse(morpho.forbiddenCallAttempted(), "Forbidden selector called on Morpho");
    }

    /// @notice Invariant 3: Treasury only receives success fee <= 15 bps of repaid debt.
    function invariant_treasuryBoundedBySuccessFee() public view {
        uint256 treasuryBal = usdc.balanceOf(treasury);
        assertLe(treasuryBal, handler.ghost_maxFee(), "Treasury received more than maximum eligible fee");
    }
}
