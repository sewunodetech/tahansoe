// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TahansoeGuardianAaveV4, L2_ATOKEN} from "../src/TahansoeGuardianAaveV4.sol";
import {MockSwapRouter} from "../src/testnet/MockSwapRouter.sol";
import {MockToken, MockOracle, MockPool, MockProvider, MockAToken} from "./mocks/MockAave.sol";
import {IPoolAddressesProvider} from "../src/interfaces/IAave.sol";

contract GuardianAaveV4Handler is Test {
    TahansoeGuardianAaveV4 public guardian;
    MockToken public usdc;
    MockToken public weth;
    MockToken public dai;
    MockAToken public aUsdc;
    MockAToken public aWeth;
    MockAToken public aDai;
    MockOracle public oracle;
    MockPool public aave;
    address public treasury;

    address public riskAgent = makeAddr("riskAgent");
    address[] public users;

    uint256 public constant LT_WETH = 8250;
    uint256 public constant LT_USDC = 8500;

    uint256 public ghost_totalRepaid;
    uint256 public ghost_maxFee;
    uint256 public ghost_protectSuccesses;

    constructor(
        TahansoeGuardianAaveV4 _guardian,
        MockToken _usdc,
        MockToken _weth,
        MockToken _dai,
        MockAToken _aUsdc,
        MockAToken _aWeth,
        MockAToken _aDai,
        MockOracle _oracle,
        MockPool _aave
    ) {
        guardian = _guardian;
        usdc = _usdc;
        weth = _weth;
        dai = _dai;
        aUsdc = _aUsdc;
        aWeth = _aWeth;
        aDai = _aDai;
        oracle = _oracle;
        aave = _aave;
        treasury = _guardian.treasury();

        users.push(makeAddr("alice"));
        users.push(makeAddr("bob"));

        for (uint256 i = 0; i < users.length; i++) {
            address u = users[i];
            usdc.mint(u, 100_000e6);
            dai.mint(u, 100_000e18);
            aWeth.mint(u, 25e18);
            aUsdc.mint(u, 25_000e6);

            vm.startPrank(u);
            usdc.approve(address(guardian), type(uint256).max);
            dai.approve(address(guardian), type(uint256).max);
            aUsdc.approve(address(guardian), type(uint256).max);
            aWeth.approve(address(guardian), type(uint256).max);

            guardian.setPolicy(address(usdc), 1.3e18, 1.6e18, 5_000e6);
            guardian.setLayer2(address(usdc), L2_ATOKEN, address(aUsdc), 5_000e6);
            guardian.setLayer3(address(usdc), true, address(weth), 10e18, 300);
            guardian.setTriggerBand(address(usdc), 1.1e18, 1.5e18, riskAgent);

            guardian.setPolicy(address(dai), 1.25e18, 1.6e18, 5_000e18);
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

    function setDynamicTrigger(uint256 userIndex, uint256 trig) external {
        address user = users[userIndex % users.length];
        trig = bound(trig, 1.1e18, 1.5e18);
        vm.prank(riskAgent);
        guardian.setDynamicTrigger(user, address(usdc), trig, uint64(block.timestamp + 1 hours));
    }

    function setAllowance(uint256 userIndex, uint256 amount) external {
        address user = users[userIndex % users.length];
        amount = bound(amount, 0, 20_000e6);
        vm.prank(user);
        usdc.approve(address(guardian), amount);
    }

    function protectUser(uint256 userIndex, uint8 debtSelect) external {
        address user = users[userIndex % users.length];
        address debtAsset = debtSelect % 2 == 0 ? address(usdc) : address(dai);
        if (!guardian.needsProtection(user, debtAsset)) return;

        (,,,,, uint256 hfBefore) = aave.getUserAccountData(user);
        (, uint256 staticTrigger,,) = guardian.policyOf(user, debtAsset);
        bool eligible = hfBefore < staticTrigger && hfBefore < 1.5e18;
        uint256 treasuryBefore = IERC20(debtAsset).balanceOf(treasury);

        try guardian.protect(user, debtAsset) returns (uint256 repaid) {
            ghost_protectSuccesses++;
            ghost_totalRepaid += repaid;
            uint256 charged = IERC20(debtAsset).balanceOf(treasury) - treasuryBefore;
            if (eligible) {
                ghost_maxFee += (repaid * 15) / 10_000;
                assertLe(charged, (repaid * 15) / 10_000, "fee above 15 bps");
            } else {
                assertEq(charged, 0, "fee on a non-eligible action");
            }
            (,,,,, uint256 hfAfter) = aave.getUserAccountData(user);
            assertTrue(hfAfter > hfBefore, "HF must improve");
        } catch {}
    }
}

contract TahansoeGuardianAaveV4InvariantTest is Test {
    TahansoeGuardianAaveV4 public guardian;
    MockToken public usdc;
    MockToken public weth;
    MockToken public dai;
    MockAToken public aUsdc;
    MockAToken public aWeth;
    MockAToken public aDai;
    MockOracle public oracle;
    MockPool public aave;
    MockProvider public provider;
    MockSwapRouter public swapRouter;
    address public treasury = makeAddr("treasury");

    GuardianAaveV4Handler public handler;

    function setUp() public {
        usdc = new MockToken("USDC", 6);
        weth = new MockToken("WETH", 18);
        dai = new MockToken("DAI", 18);

        oracle = new MockOracle();
        oracle.setPrice(address(usdc), 1e8);
        oracle.setPrice(address(weth), 2000e8);
        oracle.setPrice(address(dai), 1e8);

        aave = new MockPool(oracle);
        aUsdc = new MockAToken("aUSDC", address(usdc));
        aWeth = new MockAToken("aWETH", address(weth));
        aDai = new MockAToken("aDAI", address(dai));
        aUsdc.setPool(aave);
        aWeth.setPool(aave);
        aDai.setPool(aave);

        aave.setReserve(address(usdc), address(aUsdc), 8500);
        aave.setReserve(address(weth), address(aWeth), 8250);
        aave.setReserve(address(dai), address(aDai), 8500);

        provider = new MockProvider(address(aave), address(oracle));
        swapRouter = new MockSwapRouter(address(oracle), 0);

        // Seed liquidity for swaps & withdrawals
        usdc.mint(address(swapRouter), 1_000_000e6);
        weth.mint(address(swapRouter), 1_000e18);
        dai.mint(address(swapRouter), 1_000_000e18);
        usdc.mint(address(aave), 1_000_000e6);
        weth.mint(address(aave), 10_000e18);
        dai.mint(address(aave), 1_000_000e18);

        guardian = new TahansoeGuardianAaveV4(
            IPoolAddressesProvider(address(provider)), address(swapRouter), 500, treasury
        );

        handler = new GuardianAaveV4Handler(
            guardian, usdc, weth, dai, aUsdc, aWeth, aDai, oracle, aave
        );
        targetContract(address(handler));
    }

    /// @notice Invariant 1: Guardian contract NEVER holds tokens after calls.
    function invariant_guardianHoldsZeroTokens() public view {
        assertEq(usdc.balanceOf(address(guardian)), 0, "Guardian USDC != 0");
        assertEq(weth.balanceOf(address(guardian)), 0, "Guardian WETH != 0");
        assertEq(dai.balanceOf(address(guardian)), 0, "Guardian DAI != 0");
        assertEq(aUsdc.balanceOf(address(guardian)), 0, "Guardian aUSDC != 0");
        assertEq(aWeth.balanceOf(address(guardian)), 0, "Guardian aWETH != 0");
    }

    /// @notice Invariant 2: Treasury receives only success fee bounded by 15 bps of repaid debt.
    function invariant_treasuryBoundedBySuccessFee() public view {
        uint256 treasuryFees = usdc.balanceOf(treasury) + dai.balanceOf(treasury);
        assertLe(treasuryFees, handler.ghost_maxFee(), "Treasury received more than max eligible fee");
    }
}
