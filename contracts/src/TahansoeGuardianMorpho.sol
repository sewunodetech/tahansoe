// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {
    IMorpho,
    IMorphoOracle,
    IMorphoIrm,
    MarketParams,
    Position,
    Market
} from "./interfaces/IMorpho.sol";
import {GuardianCore} from "./lib/GuardianCore.sol";

/// @title TahansoeGuardianMorpho
/// @notice Non-custodial liquidation protection for Morpho Blue positions with per-(user, marketId) policies,
/// Layer 1 (wallet loan token) and Layer 2 (ERC-4626 yield vault) protection, dynamic trigger bands,
/// and 0.15% success fee (ADR 0013, ADR 0015).
///
/// Invariant: tokens only move from the user (wallet loan token, vault shares) into Morpho Blue to repay
/// that user's debt in that specific market, with unused loan tokens returned to the user.
/// This contract NEVER calls Morpho's `borrow`, `withdraw`, `withdrawCollateral`, or `setAuthorization`.
contract TahansoeGuardianMorpho is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Layer2Config {
        address vault;
        uint256 maxAssetsPerAction;
    }

    struct PositionRef {
        address user;
        bytes32 marketId;
    }

    IMorpho public immutable morpho;
    address public immutable treasury;

    mapping(address user => mapping(bytes32 marketId => GuardianCore.Policy)) internal _policies;
    mapping(address user => mapping(bytes32 marketId => Layer2Config)) internal _layer2;
    mapping(address user => mapping(bytes32 marketId => GuardianCore.TriggerBand)) internal _triggerBands;

    mapping(address user => bytes32[]) internal _userMarkets;
    mapping(address user => mapping(bytes32 => bool)) internal _isMarketRegistered;

    PositionRef[] internal _positions;
    mapping(address user => mapping(bytes32 => bool)) internal _isPositionRegistered;

    event PolicySet(
        address indexed user,
        bytes32 indexed marketId,
        uint256 triggerHF,
        uint256 targetHF,
        uint256 maxRepayPerAction
    );
    event PolicyDisabled(address indexed user, bytes32 indexed marketId);
    event LayerUsed(
        address indexed user,
        bytes32 indexed marketId,
        uint8 indexed layer,
        uint256 amountIn,
        uint256 debtRepaid
    );
    event Protected(
        address indexed user,
        bytes32 indexed marketId,
        address indexed caller,
        uint256 repaid,
        uint256 healthFactorBefore,
        uint256 healthFactorAfter
    );
    event FeeCharged(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 waived);
    event DynamicTriggerSet(
        address indexed user,
        bytes32 indexed marketId,
        address agent,
        uint256 triggerHF,
        uint64 validUntil
    );

    constructor(IMorpho morpho_, address treasury_) {
        if (address(morpho_) == address(0) || treasury_ == address(0)) revert GuardianCore.InvalidTreasury();
        morpho = morpho_;
        treasury = treasury_;
    }

    // ─── Policy Management ───────────────────────────────────────────────────

    function setPolicy(bytes32 marketId, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction) external {
        MarketParams memory mp = morpho.idToMarketParams(marketId);
        if (mp.loanToken == address(0)) revert GuardianCore.InvalidMarket();

        GuardianCore.validatePolicy(
            triggerHF, targetHF, maxRepayPerAction, _triggerBands[msg.sender][marketId]
        );

        if (!_isPositionRegistered[msg.sender][marketId]) {
            _isPositionRegistered[msg.sender][marketId] = true;
            _positions.push(PositionRef({user: msg.sender, marketId: marketId}));
            _userMarkets[msg.sender].push(marketId);
            _isMarketRegistered[msg.sender][marketId] = true;
        }

        _policies[msg.sender][marketId] = GuardianCore.Policy({
            enabled: true,
            triggerHF: triggerHF,
            targetHF: targetHF,
            maxRepayPerAction: maxRepayPerAction
        });

        emit PolicySet(msg.sender, marketId, triggerHF, targetHF, maxRepayPerAction);
    }

    function disablePolicy(bytes32 marketId) external {
        _policies[msg.sender][marketId].enabled = false;
        emit PolicyDisabled(msg.sender, marketId);
    }

    function setLayer2(bytes32 marketId, address vault, uint256 maxAssetsPerAction) external {
        if (vault == address(0)) {
            _layer2[msg.sender][marketId] = Layer2Config(address(0), 0);
            return;
        }

        GuardianCore.Policy memory p = _policies[msg.sender][marketId];
        if (!p.enabled) revert GuardianCore.NoPolicy();
        if (maxAssetsPerAction == 0) revert GuardianCore.InvalidLayer2();

        MarketParams memory mp = morpho.idToMarketParams(marketId);
        if (IERC4626(vault).asset() != mp.loanToken) revert GuardianCore.InvalidSource();

        _layer2[msg.sender][marketId] = Layer2Config(vault, maxAssetsPerAction);
    }

    function setTriggerBand(bytes32 marketId, uint256 minTriggerHF, uint256 maxTriggerHF, address riskAgent) external {
        GuardianCore.Policy memory p = _policies[msg.sender][marketId];
        GuardianCore.setTriggerBand(
            _triggerBands[msg.sender][marketId],
            minTriggerHF,
            maxTriggerHF,
            riskAgent,
            p.targetHF,
            p.enabled
        );
    }

    function setDynamicTrigger(address user, bytes32 marketId, uint256 triggerHF, uint64 validUntil) external {
        GuardianCore.Policy memory p = _policies[user][marketId];
        GuardianCore.setDynamicTrigger(
            _triggerBands[user][marketId],
            triggerHF,
            validUntil,
            p.targetHF,
            p.enabled
        );
        emit DynamicTriggerSet(user, marketId, msg.sender, triggerHF, validUntil);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function policyOf(address user, bytes32 marketId)
        external
        view
        returns (bool enabled, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction)
    {
        GuardianCore.Policy memory p = _policies[user][marketId];
        return (p.enabled, p.triggerHF, p.targetHF, p.maxRepayPerAction);
    }

    function layer2Of(address user, bytes32 marketId)
        external
        view
        returns (address vault, uint256 maxAssetsPerAction)
    {
        Layer2Config memory l2 = _layer2[user][marketId];
        return (l2.vault, l2.maxAssetsPerAction);
    }

    function marketsOf(address user) external view returns (bytes32[] memory) {
        return _userMarkets[user];
    }

    function healthFactor(address user, bytes32 marketId) public view returns (uint256) {
        MarketParams memory mp = morpho.idToMarketParams(marketId);
        Position memory pos = morpho.position(marketId, user);
        if (pos.borrowShares == 0) return type(uint256).max;

        Market memory m = morpho.market(marketId);
        _accrueInterestView(mp, m);

        uint256 borrowedAssets = _toAssetsUp(pos.borrowShares, m.totalBorrowAssets, m.totalBorrowShares);
        if (borrowedAssets == 0) return type(uint256).max;

        uint256 price = IMorphoOracle(mp.oracle).price();
        return _computeHF(pos.collateral, price, mp.lltv, borrowedAssets);
    }

    function effectiveTrigger(address user, bytes32 marketId) public view returns (uint256) {
        return GuardianCore.effectiveTrigger(
            _triggerBands[user][marketId], _policies[user][marketId].triggerHF
        );
    }

    function needsProtection(address user, bytes32 marketId) public view returns (bool) {
        GuardianCore.Policy memory p = _policies[user][marketId];
        if (!p.enabled) return false;

        Position memory pos = morpho.position(marketId, user);
        if (pos.borrowShares == 0) return false;

        uint256 hf = healthFactor(user, marketId);
        return hf < effectiveTrigger(user, marketId);
    }

    function positionCount() external view returns (uint256) {
        return _positions.length;
    }

    function positionsPage(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory users, bytes32[] memory marketIds)
    {
        uint256 total = _positions.length;
        if (offset >= total || limit == 0) {
            return (new address[](0), new bytes32[](0));
        }
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint256 len = end - offset;
        users = new address[](len);
        marketIds = new bytes32[](len);
        for (uint256 i = 0; i < len; ++i) {
            PositionRef storage pos = _positions[offset + i];
            users[i] = pos.user;
            marketIds[i] = pos.marketId;
        }
    }

    function quoteFee(address user, bytes32 marketId) external view returns (bool eligible, uint256 fee) {
        if (!needsProtection(user, marketId)) return (false, 0);
        uint256 hf = healthFactor(user, marketId);
        eligible = GuardianCore.isFeeEligible(hf, _policies[user][marketId].triggerHF);
        if (!eligible) return (false, 0);
        (uint256 l1, uint256 l2,) = quoteProtect(user, marketId);
        fee = GuardianCore.calculateFee(l1 + l2);
    }

    function _quoteL1(address user, address loanToken, uint256 needed) internal view returns (uint256 l1Repay) {
        uint256 l1Bal = IERC20(loanToken).balanceOf(user);
        uint256 l1Allow = IERC20(loanToken).allowance(user, address(this));
        l1Repay = GuardianCore.min(needed, GuardianCore.min(l1Bal, l1Allow));
    }

    function _quoteL2(address user, bytes32 marketId, uint256 needed) internal view returns (uint256 l2Repay) {
        Layer2Config memory l2 = _layer2[user][marketId];
        if (needed == 0 || l2.vault == address(0)) return 0;
        uint256 usableShares = GuardianCore.min(
            IERC20(l2.vault).balanceOf(user), IERC20(l2.vault).allowance(user, address(this))
        );
        uint256 avail = IERC4626(l2.vault).previewRedeem(usableShares);
        l2Repay = GuardianCore.min(GuardianCore.min(needed, l2.maxAssetsPerAction), avail);
    }

    function quoteProtect(address user, bytes32 marketId)
        public
        view
        returns (uint256 l1Repay, uint256 l2Repay, uint256 expectedHf)
    {
        GuardianCore.Policy memory p = _policies[user][marketId];
        if (!p.enabled) return (0, 0, healthFactor(user, marketId));

        MarketParams memory mp = morpho.idToMarketParams(marketId);
        Position memory pos = morpho.position(marketId, user);
        if (pos.borrowShares == 0) return (0, 0, type(uint256).max);

        Market memory m = morpho.market(marketId);
        _accrueInterestView(mp, m);

        uint256 borrowedAssets = _toAssetsUp(pos.borrowShares, m.totalBorrowAssets, m.totalBorrowShares);
        if (borrowedAssets == 0) return (0, 0, type(uint256).max);

        uint256 maxBorrow = _computeMaxBorrow(pos.collateral, IMorphoOracle(mp.oracle).price(), mp.lltv);
        uint256 curHf = (maxBorrow * GuardianCore.WAD) / borrowedAssets;
        if (curHf >= effectiveTrigger(user, marketId)) return (0, 0, curHf);

        uint256 targetBorrow = (maxBorrow * GuardianCore.WAD) / (p.targetHF + GuardianCore.TARGET_BUFFER);
        if (borrowedAssets <= targetBorrow) return (0, 0, curHf);

        uint256 needed = GuardianCore.min(
            GuardianCore.min(borrowedAssets - targetBorrow, p.maxRepayPerAction), borrowedAssets
        );

        l1Repay = _quoteL1(user, mp.loanToken, needed);
        l2Repay = _quoteL2(user, marketId, needed - l1Repay);
        uint256 totalRepaid = l1Repay + l2Repay;

        expectedHf = totalRepaid >= borrowedAssets
            ? type(uint256).max
            : (maxBorrow * GuardianCore.WAD) / (borrowedAssets - totalRepaid);
    }

    // ─── Protection Execution ────────────────────────────────────────────────

    function _executeLayer1(
        address user,
        bytes32 marketId,
        MarketParams memory mp,
        uint256 needed
    ) internal returns (uint256 repaidL1) {
        uint256 l1Avail = GuardianCore.min(
            IERC20(mp.loanToken).balanceOf(user), IERC20(mp.loanToken).allowance(user, address(this))
        );
        uint256 l1Amount = GuardianCore.min(needed, l1Avail);
        if (l1Amount == 0) return 0;

        IERC20(mp.loanToken).safeTransferFrom(user, address(this), l1Amount);
        IERC20(mp.loanToken).forceApprove(address(morpho), l1Amount);
        (repaidL1,) = morpho.repay(mp, l1Amount, 0, user, "");
        IERC20(mp.loanToken).forceApprove(address(morpho), 0);
        emit LayerUsed(user, marketId, 1, l1Amount, repaidL1);
    }

    function _executeLayer2(
        address user,
        bytes32 marketId,
        MarketParams memory mp,
        uint256 remNeeded
    ) internal returns (uint256 repaidL2) {
        Layer2Config storage l2 = _layer2[user][marketId];
        if (l2.vault == address(0) || remNeeded == 0) return 0;

        uint256 usableShares = GuardianCore.min(
            IERC20(l2.vault).balanceOf(user), IERC20(l2.vault).allowance(user, address(this))
        );
        uint256 availAssets = IERC4626(l2.vault).previewRedeem(usableShares);
        uint256 l2Amount = GuardianCore.min(GuardianCore.min(remNeeded, l2.maxAssetsPerAction), availAssets);
        if (l2Amount == 0) return 0;

        IERC4626(l2.vault).withdraw(l2Amount, address(this), user);
        IERC20(mp.loanToken).forceApprove(address(morpho), l2Amount);
        (repaidL2,) = morpho.repay(mp, l2Amount, 0, user, "");
        IERC20(mp.loanToken).forceApprove(address(morpho), 0);
        emit LayerUsed(user, marketId, 2, l2Amount, repaidL2);
    }

    struct ProtectPrecheck {
        uint256 hfBefore;
        uint256 targetBorrow;
        uint256 needed;
    }

    function _precheckProtect(
        address user,
        bytes32 marketId,
        GuardianCore.Policy memory p,
        MarketParams memory mp
    ) internal view returns (ProtectPrecheck memory pre) {
        Position memory pos = morpho.position(marketId, user);
        if (pos.borrowShares == 0) revert GuardianCore.NothingToRepay();

        Market memory m = morpho.market(marketId);
        uint256 borrowedAssets = _toAssetsUp(pos.borrowShares, m.totalBorrowAssets, m.totalBorrowShares);
        if (borrowedAssets == 0) revert GuardianCore.NothingToRepay();

        uint256 maxBorrow = _computeMaxBorrow(pos.collateral, IMorphoOracle(mp.oracle).price(), mp.lltv);
        pre.hfBefore = (maxBorrow * GuardianCore.WAD) / borrowedAssets;
        uint256 trig = effectiveTrigger(user, marketId);
        if (pre.hfBefore >= trig) revert GuardianCore.NotAtRisk(pre.hfBefore, trig);

        pre.targetBorrow = (maxBorrow * GuardianCore.WAD) / (p.targetHF + GuardianCore.TARGET_BUFFER);
        if (borrowedAssets <= pre.targetBorrow) revert GuardianCore.NothingToRepay();

        pre.needed = GuardianCore.min(
            GuardianCore.min(borrowedAssets - pre.targetBorrow, p.maxRepayPerAction), borrowedAssets
        );
    }

    function _shouldExecuteLayer2(
        address user,
        bytes32 marketId,
        MarketParams memory mp,
        uint256 targetHF,
        uint256 targetBorrow
    ) internal view returns (bool, uint256 remNeeded) {
        Position memory pos = morpho.position(marketId, user);
        if (pos.borrowShares == 0) return (false, 0);
        Market memory m = morpho.market(marketId);
        uint256 borrowed = _toAssetsUp(pos.borrowShares, m.totalBorrowAssets, m.totalBorrowShares);
        if (borrowed == 0) return (false, 0);
        uint256 hf = _computeHF(pos.collateral, IMorphoOracle(mp.oracle).price(), mp.lltv, borrowed);
        if (hf < targetHF && borrowed > targetBorrow) {
            return (true, borrowed - targetBorrow);
        }
        return (false, 0);
    }

    function protect(address user, bytes32 marketId) external nonReentrant returns (uint256 repaid) {
        GuardianCore.Policy memory p = _policies[user][marketId];
        if (!p.enabled) revert GuardianCore.NoPolicy();

        MarketParams memory mp = morpho.idToMarketParams(marketId);
        // Accrue interest on-chain before calculating amounts
        morpho.accrueInterest(mp);

        ProtectPrecheck memory pre = _precheckProtect(user, marketId, p, mp);

        // 1. Layer 1 Execution
        repaid += _executeLayer1(user, marketId, mp, pre.needed);

        // 2. Layer 2 Execution if target HF not reached
        (bool needL2, uint256 remNeeded) = _shouldExecuteLayer2(user, marketId, mp, p.targetHF, pre.targetBorrow);
        if (needL2) {
            uint256 remainingCap = p.maxRepayPerAction > repaid ? p.maxRepayPerAction - repaid : 0;
            repaid += _executeLayer2(user, marketId, mp, GuardianCore.min(remNeeded, remainingCap));
        }

        if (repaid == 0) revert GuardianCore.NothingToRepay();

        // Success fee handling per ADR 0013
        if (GuardianCore.isFeeEligible(pre.hfBefore, p.triggerHF)) {
            uint256 fee = GuardianCore.calculateFee(repaid);
            (uint256 charged, uint256 waived) =
                GuardianCore.chargeFee(IERC20(mp.loanToken), user, treasury, fee);
            emit FeeCharged(user, marketId, charged, waived);
        }

        // Return leftover loan tokens to user
        uint256 remLoan = IERC20(mp.loanToken).balanceOf(address(this));
        if (remLoan > 0) {
            IERC20(mp.loanToken).safeTransfer(user, remLoan);
        }

        // Invariant checks
        GuardianCore.checkGuardianBalanceZero(IERC20(mp.loanToken));
        uint256 hfAfter = healthFactor(user, marketId);
        GuardianCore.checkHealthFactorImproved(pre.hfBefore, hfAfter);

        emit Protected(user, marketId, msg.sender, repaid, pre.hfBefore, hfAfter);
    }

    // ─── Internal Morpho Math ────────────────────────────────────────────────

    function _computeMaxBorrow(uint256 collateral, uint256 price, uint256 lltv) internal pure returns (uint256) {
        // collateral * price / 1e36 * lltv / 1e18
        uint256 collateralVal = (collateral * price) / 1e36;
        return (collateralVal * lltv) / GuardianCore.WAD;
    }

    function _computeHF(uint256 collateral, uint256 price, uint256 lltv, uint256 borrowedAssets)
        internal
        pure
        returns (uint256)
    {
        if (borrowedAssets == 0) return type(uint256).max;
        uint256 maxBorrow = _computeMaxBorrow(collateral, price, lltv);
        return (maxBorrow * GuardianCore.WAD) / borrowedAssets;
    }

    /// @dev Morpho Blue SharesMathLib.toAssetsUp: (shares * (totalAssets + 1) + (totalShares + 1e6 - 1)) / (totalShares + 1e6)
    function _toAssetsUp(uint256 shares, uint256 totalAssets, uint256 totalShares) internal pure returns (uint256) {
        if (shares == 0) return 0;
        uint256 n = shares * (totalAssets + 1);
        uint256 d = totalShares + 1e6;
        return (n + (d - 1)) / d;
    }

    /// @dev View approximation for interest accrual using Morpho Irm borrowRateView if present
    function _accrueInterestView(MarketParams memory mp, Market memory m) internal view {
        if (mp.irm != address(0) && block.timestamp > m.lastUpdate && m.totalBorrowAssets > 0) {
            try IMorphoIrm(mp.irm).borrowRateView(mp, m) returns (uint256 rate) {
                if (rate > 0) {
                    uint256 elapsed = block.timestamp - m.lastUpdate;
                    uint256 firstTerm = rate * elapsed;
                    uint256 secondTerm = (firstTerm * firstTerm) / (2 * GuardianCore.WAD);
                    uint256 thirdTerm = (secondTerm * firstTerm) / (3 * GuardianCore.WAD);
                    uint256 interest =
                        (uint256(m.totalBorrowAssets) * (firstTerm + secondTerm + thirdTerm)) / GuardianCore.WAD;
                    m.totalBorrowAssets += uint128(interest);
                }
            } catch {}
        }
    }
}
