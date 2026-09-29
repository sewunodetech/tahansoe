// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPool, IPoolAddressesProvider, IAaveOracle} from "./interfaces/IAave.sol";

/// @title TahansoeGuardian
/// @notice Non-custodial liquidation protection for Aave V3 borrowers.
///
/// A user sets a policy (trigger HF, target HF, debt asset, per-action cap) and
/// approves this contract to spend that asset from their wallet (the "hot
/// reserve"). When the user's Health Factor falls below the trigger, anyone
/// (a keeper, Chainlink Automation, or the user) can call {protect}; the
/// Guardian repays exactly enough debt to bring HF back to the target.
///
/// Invariant: tokens only ever move from the user's wallet into Aave to repay
/// that same user's debt, with any unused remainder returned to the user. The
/// Guardian holds no funds between calls and has no admin or withdraw path.
contract TahansoeGuardian is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant WAD = 1e18;
    uint256 private constant BPS = 1e4;
    uint256 private constant VARIABLE_RATE = 2;

    /// @dev Aim 0.01% above the target so Aave's rounding and a stablecoin
    /// priced slightly off $1 still land the position at or above target.
    uint256 private constant TARGET_BUFFER = 1e14;

    uint256 public constant MIN_TRIGGER_HF = 1.05e18;
    uint256 public constant MAX_TARGET_HF = 3e18;

    struct Policy {
        bool enabled;
        address debtAsset;
        uint128 triggerHF; // WAD
        uint128 targetHF; // WAD
        uint256 maxRepayPerAction; // in debtAsset units
    }

    IPoolAddressesProvider public immutable addressesProvider;
    mapping(address user => Policy) public policies;

    event PolicySet(address indexed user, address indexed debtAsset, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction);
    event PolicyDisabled(address indexed user);
    event Protected(
        address indexed user,
        address indexed debtAsset,
        address indexed caller,
        uint256 repaid,
        uint256 healthFactorBefore,
        uint256 healthFactorAfter
    );

    error InvalidPolicy();
    error NoPolicy();
    error NotAtRisk(uint256 healthFactor, uint256 triggerHF);
    error NothingToRepay();
    error HealthFactorNotImproved(uint256 before, uint256 afterRepay);

    constructor(IPoolAddressesProvider provider) {
        addressesProvider = provider;
    }

    // ─── Policy ──────────────────────────────────────────────────────────────

    function setPolicy(address debtAsset, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction) external {
        if (
            debtAsset == address(0) || triggerHF < MIN_TRIGGER_HF || targetHF <= triggerHF || targetHF > MAX_TARGET_HF
                || maxRepayPerAction == 0
        ) revert InvalidPolicy();

        policies[msg.sender] = Policy({
            enabled: true,
            debtAsset: debtAsset,
            // Both are bounded by MAX_TARGET_HF above, so they fit in uint128.
            // forge-lint: disable-next-line(unsafe-typecast)
            triggerHF: uint128(triggerHF),
            // forge-lint: disable-next-line(unsafe-typecast)
            targetHF: uint128(targetHF),
            maxRepayPerAction: maxRepayPerAction
        });
        emit PolicySet(msg.sender, debtAsset, triggerHF, targetHF, maxRepayPerAction);
    }

    function disablePolicy() external {
        policies[msg.sender].enabled = false;
        emit PolicyDisabled(msg.sender);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function pool() public view returns (IPool) {
        return IPool(addressesProvider.getPool());
    }

    function healthFactor(address user) public view returns (uint256 hf) {
        (,,,,, hf) = pool().getUserAccountData(user);
    }

    function needsProtection(address user) public view returns (bool) {
        Policy memory p = policies[user];
        if (!p.enabled) return false;
        (, uint256 debt,,,, uint256 hf) = pool().getUserAccountData(user);
        return debt > 0 && hf < p.triggerHF;
    }

    /// @notice Amount of `debtAsset` that would be repaid right now, after the
    /// per-action cap and the user's balance and allowance are applied.
    function quoteRepay(address user) public view returns (uint256 amount) {
        Policy memory p = policies[user];
        if (!p.enabled) return 0;

        (uint256 collateralBase, uint256 debtBase,, uint256 liqThresholdBps,,) = pool().getUserAccountData(user);

        // Debt the position can carry at the target HF: collateral * LT / targetHF
        uint256 targetDebtBase = (collateralBase * liqThresholdBps * WAD) / (BPS * (p.targetHF + TARGET_BUFFER));
        if (debtBase <= targetDebtBase) return 0;
        uint256 repayBase = debtBase - targetDebtBase;

        uint256 price = IAaveOracle(addressesProvider.getPriceOracle()).getAssetPrice(p.debtAsset);
        uint256 unit = 10 ** IERC20Metadata(p.debtAsset).decimals();
        amount = (repayBase * unit + price - 1) / price; // round up so the target is reached

        amount = _min(amount, p.maxRepayPerAction);
        amount = _min(amount, IERC20(p.debtAsset).balanceOf(user));
        amount = _min(amount, IERC20(p.debtAsset).allowance(user, address(this)));
    }

    // ─── Protection ──────────────────────────────────────────────────────────

    /// @notice Repay part of `user`'s Aave debt from their approved reserve so
    /// their Health Factor returns to the policy target. Callable by anyone.
    function protect(address user) public nonReentrant returns (uint256 repaid) {
        Policy memory p = policies[user];
        if (!p.enabled) revert NoPolicy();

        IPool aave = pool();
        (,,,,, uint256 hfBefore) = aave.getUserAccountData(user);
        if (hfBefore >= p.triggerHF) revert NotAtRisk(hfBefore, p.triggerHF);

        uint256 amount = quoteRepay(user);
        if (amount == 0) revert NothingToRepay();

        IERC20 token = IERC20(p.debtAsset);
        token.safeTransferFrom(user, address(this), amount);
        token.forceApprove(address(aave), amount);
        repaid = aave.repay(p.debtAsset, amount, VARIABLE_RATE, user);
        token.forceApprove(address(aave), 0);

        // Aave repays at most the outstanding debt; return anything unused.
        uint256 leftover = token.balanceOf(address(this));
        if (leftover > 0) token.safeTransfer(user, leftover);

        (,,,,, uint256 hfAfter) = aave.getUserAccountData(user);
        if (hfAfter <= hfBefore) revert HealthFactorNotImproved(hfBefore, hfAfter);

        emit Protected(user, p.debtAsset, msg.sender, repaid, hfBefore, hfAfter);
    }

    // ─── Chainlink Automation ────────────────────────────────────────────────

    /// @param checkData abi-encoded `address[]` of users to watch
    function checkUpkeep(bytes calldata checkData) external view returns (bool upkeepNeeded, bytes memory performData) {
        address[] memory users = abi.decode(checkData, (address[]));
        for (uint256 i; i < users.length; ++i) {
            if (needsProtection(users[i]) && quoteRepay(users[i]) > 0) {
                return (true, abi.encode(users[i]));
            }
        }
        return (false, "");
    }

    function performUpkeep(bytes calldata performData) external {
        protect(abi.decode(performData, (address)));
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
