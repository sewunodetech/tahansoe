// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TahansoeGuardianV2, L2_NONE, L2_ERC4626, L2_ATOKEN} from "../src/TahansoeGuardianV2.sol";
import {MockSwapRouter} from "../src/testnet/MockSwapRouter.sol";
import {TestVault} from "../src/testnet/TestVault.sol";
import {MockToken, MockOracle, MockPool, MockProvider, MockAToken} from "./mocks/MockAave.sol";
import {IPoolAddressesProvider} from "../src/interfaces/IAave.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract GuardianV2Handler is Test {
    TahansoeGuardianV2 public guardian;
    MockToken public usdc;
    MockToken public weth;
    MockAToken public aUsdc;
    MockAToken public aWeth;
    MockOracle public oracle;
    MockPool public aave;
    TestVault public vault;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address[] public users;

    uint256 public constant LT_WETH = 8250;
    uint256 public constant LT_USDC = 8500;

    uint256 public ghost_protectCalls;
    uint256 public ghost_protectSuccesses;

    constructor(
        TahansoeGuardianV2 _guardian,
        MockToken _usdc,
        MockToken _weth,
        MockAToken _aUsdc,
        MockAToken _aWeth,
        MockOracle _oracle,
        MockPool _aave,
        TestVault _vault
    ) {
        guardian = _guardian;
        usdc = _usdc;
        weth = _weth;
        aUsdc = _aUsdc;
        aWeth = _aWeth;
        oracle = _oracle;
        aave = _aave;
        vault = _vault;

        users.push(alice);
        users.push(bob);

        for (uint256 i = 0; i < users.length; i++) {
            address u = users[i];
            usdc.mint(u, 100_000e6);
            weth.mint(u, 50e18);
            aWeth.mint(u, 25e18);
            aUsdc.mint(u, 25_000e6);

            vm.startPrank(u);
            usdc.approve(address(guardian), type(uint256).max);
            aUsdc.approve(address(guardian), type(uint256).max);
            aWeth.approve(address(guardian), type(uint256).max);

            // Vault shares
            usdc.approve(address(vault), 10_000e6);
            vault.deposit(10_000e6, u);
            vault.approve(address(guardian), type(uint256).max);

            guardian.setPolicy(address(usdc), 1.3e18, 1.6e18, 5_000e6);
            guardian.setLayer2(L2_ATOKEN, address(aUsdc), 5_000e6);
            guardian.setLayer3(true, address(weth), 10e18, 300);
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

    function protectUser(uint256 userIndex) external {
        address user = users[userIndex % users.length];
        ghost_protectCalls++;

        if (!guardian.needsProtection(user)) {
            return;
        }

        uint256 hfBefore = guardian.healthFactor(user);
        try guardian.protect(user) returns (uint256 repaid) {
            ghost_protectSuccesses++;
            uint256 hfAfter = guardian.healthFactor(user);
            // Invariant: HF strictly increases if protect succeeds
            assertGt(hfAfter, hfBefore, "HF did not increase after protect");
            assertGt(repaid, 0, "Repaid zero in successful protect");
        } catch {
            // Can revert if conditions (slippage, insufficient output, etc.) fail
        }
    }
}

contract TahansoeGuardianV2InvariantTest is Test {
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
    GuardianV2Handler handler;

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

        aave.setReserve(address(usdc), address(aUsdc), 8500);
        aave.setReserve(address(weth), address(aWeth), 8250);

        router = new MockSwapRouter(address(oracle), 30);
        guardian = new TahansoeGuardianV2(IPoolAddressesProvider(address(provider)), address(router), 500);
        vault = new TestVault(usdc, "USDC Vault", "vUSDC");

        usdc.mint(address(router), 10_000_000e6);
        usdc.mint(address(aave), 10_000_000e6);
        weth.mint(address(aave), 100_000e18);

        handler = new GuardianV2Handler(guardian, usdc, weth, aUsdc, aWeth, oracle, aave, vault);

        targetContract(address(handler));
    }

    /// Invariant: Guardian balance of any token must ALWAYS be 0 at the end of every transaction
    function invariant_guardianHoldsZeroTokens() public view {
        assertEq(usdc.balanceOf(address(guardian)), 0, "Guardian holds USDC");
        assertEq(weth.balanceOf(address(guardian)), 0, "Guardian holds WETH");
        assertEq(aUsdc.balanceOf(address(guardian)), 0, "Guardian holds aUSDC");
        assertEq(aWeth.balanceOf(address(guardian)), 0, "Guardian holds aWETH");
        assertEq(vault.balanceOf(address(guardian)), 0, "Guardian holds vault shares");
    }
}
