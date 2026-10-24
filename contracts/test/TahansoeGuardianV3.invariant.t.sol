// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {L2_ATOKEN} from "../src/TahansoeGuardianV2.sol";
import {TahansoeGuardianV3} from "../src/TahansoeGuardianV3.sol";
import {MockSwapRouter} from "../src/testnet/MockSwapRouter.sol";
import {MockToken, MockOracle, MockPool, MockProvider, MockAToken} from "./mocks/MockAave.sol";
import {IPoolAddressesProvider} from "../src/interfaces/IAave.sol";

contract GuardianV3Handler is Test {
    TahansoeGuardianV3 public guardian;
    MockToken public usdc;
    MockToken public weth;
    MockAToken public aUsdc;
    MockAToken public aWeth;
    MockOracle public oracle;
    MockPool public aave;
    address public treasury;

    address public riskAgent = makeAddr("riskAgent");
    address[] public users;

    uint256 public constant LT_WETH = 8250;

    uint256 public ghost_totalRepaid;
    uint256 public ghost_maxFee; // sum of floor(repaid * 15 / 10_000) over eligible actions
    uint256 public ghost_protectSuccesses;

    constructor(
        TahansoeGuardianV3 _guardian,
        MockToken _usdc,
        MockToken _weth,
        MockAToken _aUsdc,
        MockAToken _aWeth,
        MockOracle _oracle,
        MockPool _aave
    ) {
        guardian = _guardian;
        usdc = _usdc;
        weth = _weth;
        aUsdc = _aUsdc;
        aWeth = _aWeth;
        oracle = _oracle;
        aave = _aave;
        treasury = _guardian.treasury();

        users.push(makeAddr("alice"));
        users.push(makeAddr("bob"));

        for (uint256 i = 0; i < users.length; i++) {
            address u = users[i];
            usdc.mint(u, 100_000e6);
            aWeth.mint(u, 25e18);
            aUsdc.mint(u, 25_000e6);

            vm.startPrank(u);
            usdc.approve(address(guardian), type(uint256).max);
            aUsdc.approve(address(guardian), type(uint256).max);
            aWeth.approve(address(guardian), type(uint256).max);
            guardian.setPolicy(address(usdc), 1.3e18, 1.6e18, 5_000e6);
            guardian.setLayer2(L2_ATOKEN, address(aUsdc), 5_000e6);
            guardian.setLayer3(true, address(weth), 10e18, 300);
            guardian.setTriggerBand(1.1e18, 1.5e18, riskAgent);
            vm.stopPrank();
        }
    }

    function setAtRisk(uint256 userIndex, uint256 collateralUsd, uint256 debtUsd) external {
        address user = users[userIndex % users.length];
        collateralUsd = bound(collateralUsd, 10_000e8, 50_000e8);
        debtUsd = bound(debtUsd, 8_000e8, 45_000e8);
        aave.setAccount(user, collateralUsd, debtUsd, LT_WETH);
    }

    function setWethPrice(uint256 priceUsd) external {
        priceUsd = bound(priceUsd, 500e8, 5_000e8);
        oracle.setPrice(address(weth), priceUsd);
    }

    /// The risk agent moves the dynamic trigger inside the band; actions it alone causes must be free.
    function setDynamicTrigger(uint256 userIndex, uint256 trig) external {
        address user = users[userIndex % users.length];
        trig = bound(trig, 1.1e18, 1.5e18);
        vm.prank(riskAgent);
        guardian.setDynamicTrigger(user, trig, uint64(block.timestamp + 1 hours));
    }

    /// Wallet allowance left for the fee varies, including none at all.
    function setAllowance(uint256 userIndex, uint256 amount) external {
        address user = users[userIndex % users.length];
        amount = bound(amount, 0, 20_000e6);
        vm.prank(user);
        usdc.approve(address(guardian), amount);
    }

    function protectUser(uint256 userIndex) external {
        address user = users[userIndex % users.length];
        if (!guardian.needsProtection(user)) return;

        uint256 hfBefore = guardian.healthFactor(user);
        (,, uint256 staticTrigger,,) = guardian.policies(user);
        bool eligible = hfBefore < staticTrigger && hfBefore < guardian.FEE_HF_CEILING();
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        try guardian.protect(user) returns (uint256 repaid) {
            ghost_protectSuccesses++;
            ghost_totalRepaid += repaid;
            uint256 charged = usdc.balanceOf(treasury) - treasuryBefore;
            if (eligible) {
                ghost_maxFee += (repaid * 15) / 10_000;
                assertLe(charged, (repaid * 15) / 10_000, "fee above 15 bps");
            } else {
                assertEq(charged, 0, "fee on a non-eligible action");
            }
            assertGt(guardian.healthFactor(user), hfBefore, "HF did not increase after protect");
        } catch {
            // Slippage or insufficient sources can revert, exactly as in V2; never the fee.
        }
    }
}

contract TahansoeGuardianV3InvariantTest is Test {
    TahansoeGuardianV3 guardian;
    MockToken usdc;
    MockToken weth;
    MockAToken aUsdc;
    MockAToken aWeth;
    GuardianV3Handler handler;
    address treasury = makeAddr("treasury");

    function setUp() public {
        usdc = new MockToken("USDC", 6);
        weth = new MockToken("WETH", 18);

        MockOracle oracle = new MockOracle();
        oracle.setPrice(address(usdc), 1e8);
        oracle.setPrice(address(weth), 2000e8);

        MockPool aave = new MockPool(oracle);
        MockProvider provider = new MockProvider(address(aave), address(oracle));

        aUsdc = new MockAToken("aUSDC", address(usdc));
        aUsdc.setPool(aave);
        aWeth = new MockAToken("aWETH", address(weth));
        aWeth.setPool(aave);

        aave.setReserve(address(usdc), address(aUsdc), 8500);
        aave.setReserve(address(weth), address(aWeth), 8250);

        MockSwapRouter router = new MockSwapRouter(address(oracle), 30);
        guardian = new TahansoeGuardianV3(IPoolAddressesProvider(address(provider)), address(router), 500, treasury);

        usdc.mint(address(router), 10_000_000e6);
        usdc.mint(address(aave), 10_000_000e6);
        weth.mint(address(aave), 100_000e18);

        handler = new GuardianV3Handler(guardian, usdc, weth, aUsdc, aWeth, oracle, aave);
        targetContract(address(handler));
    }

    function invariant_guardianHoldsZeroTokens() public view {
        assertEq(usdc.balanceOf(address(guardian)), 0, "Guardian holds USDC");
        assertEq(weth.balanceOf(address(guardian)), 0, "Guardian holds WETH");
        assertEq(aUsdc.balanceOf(address(guardian)), 0, "Guardian holds aUSDC");
        assertEq(aWeth.balanceOf(address(guardian)), 0, "Guardian holds aWETH");
    }

    function invariant_treasuryBoundedBySuccessFee() public view {
        assertLe(usdc.balanceOf(treasury), handler.ghost_maxFee(), "treasury above sum of eligible fees");
        assertLe(usdc.balanceOf(treasury), (handler.ghost_totalRepaid() * 15) / 10_000, "treasury above 15 bps");
    }

    function invariant_treasuryReceivesOnlyDebtAsset() public view {
        assertEq(weth.balanceOf(treasury), 0);
        assertEq(aUsdc.balanceOf(treasury), 0);
        assertEq(aWeth.balanceOf(treasury), 0);
    }
}
