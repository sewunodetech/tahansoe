// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {
    IPool,
    IPoolAddressesProvider,
    IAaveOracle,
    IFlashLoanSimpleReceiver,
    ReserveData,
    IAToken
} from "./interfaces/IAave.sol";
import {ISwapRouter02} from "./interfaces/ISwapRouter02.sol";
import {GuardianCore} from "./lib/GuardianCore.sol";

uint8 constant L2_NONE = 0;
uint8 constant L2_ERC4626 = 1;
uint8 constant L2_ATOKEN = 2;

/// @title TahansoeGuardianAaveV4
/// @notice Non-custodial liquidation protection for Aave V3 positions with per-(user, debtAsset) policies,
/// user-chosen debt priority, 3-layer protection, dynamic trigger bands, and 0.15% success fee (ADR 0013, ADR 0015).
contract TahansoeGuardianAaveV4 is ReentrancyGuard, IFlashLoanSimpleReceiver {
    using SafeERC20 for IERC20;

    uint256 private constant VARIABLE_RATE = 2;

    struct Layer2Config {
        uint8 kind;
        address source;
        uint256 maxAssetsPerAction;
    }

    struct Layer3Config {
        bool enabled;
        address collateralAsset;
        uint256 maxCollateralPerAction;
        uint16 maxSlippageBps;
    }

    struct PositionRef {
        address user;
        address debtAsset;
    }

    struct FlashParams {
        address user;
        address collateralAsset;
        uint256 collateralAmount;
        uint16 maxSlippageBps;
    }

    struct AccountData {
        uint256 colBase;
        uint256 debtBase;
        uint256 liqThresholdBps;
        uint256 hf;
    }

    struct QuoteResult {
        uint256 l1Repay;
        uint256 l2Repay;
        uint256 l3Repay;
        uint256 expectedHf;
    }

    struct QuoteState {
        uint256 colBase;
        uint256 debtBase;
        uint256 liqThresholdBps;
        uint256 remainingNeededTokens;
        uint256 priceDebt;
        uint256 unitDebt;
    }

    IPoolAddressesProvider public immutable addressesProvider;
    ISwapRouter02 public immutable swapRouter;
    uint24 public immutable swapFee;
    address public immutable treasury;

    mapping(address user => mapping(address debtAsset => GuardianCore.Policy)) internal _policies;
    mapping(address user => mapping(address debtAsset => Layer2Config)) internal _layer2;
    mapping(address user => mapping(address debtAsset => Layer3Config)) internal _layer3;
    mapping(address user => mapping(address debtAsset => GuardianCore.TriggerBand)) internal _triggerBands;

    mapping(address user => address[]) internal _userDebtAssets;
    mapping(address user => mapping(address debtAsset => bool)) internal _isDebtAssetRegistered;

    PositionRef[] internal _positions;
    mapping(address user => mapping(address debtAsset => bool)) internal _isPositionRegistered;

    uint256 private _lastL3DebtRepaid;

    event PolicySet(
        address indexed user,
        address indexed debtAsset,
        uint256 triggerHF,
        uint256 targetHF,
        uint256 maxRepayPerAction
    );
    event PolicyDisabled(address indexed user, address indexed debtAsset);
    event LayerUsed(
        address indexed user,
        address indexed debtAsset,
        uint8 indexed layer,
        uint256 amountIn,
        uint256 debtRepaid
    );
    event Protected(
        address indexed user,
        address indexed debtAsset,
        address indexed caller,
        uint256 repaid,
        uint256 healthFactorBefore,
        uint256 healthFactorAfter
    );
    event FeeCharged(address indexed user, address indexed debtAsset, uint256 amount, uint256 waived);
    event DynamicTriggerSet(
        address indexed user,
        address indexed debtAsset,
        address agent,
        uint256 triggerHF,
        uint64 validUntil
    );

    error InsufficientSwapOutput(uint256 received, uint256 minRequired);

    constructor(IPoolAddressesProvider provider, address swapRouter_, uint24 swapFee_, address treasury_) {
        if (treasury_ == address(0)) revert GuardianCore.InvalidTreasury();
        addressesProvider = provider;
        swapRouter = ISwapRouter02(swapRouter_);
        swapFee = swapFee_;
        treasury = treasury_;
    }

    // ─── Policy Management ───────────────────────────────────────────────────

    function setPolicy(address debtAsset, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction) external {
        if (debtAsset == address(0)) revert GuardianCore.InvalidPolicy();
        GuardianCore.validatePolicy(
            triggerHF, targetHF, maxRepayPerAction, _triggerBands[msg.sender][debtAsset]
        );

        if (!_isPositionRegistered[msg.sender][debtAsset]) {
            _isPositionRegistered[msg.sender][debtAsset] = true;
            _positions.push(PositionRef({user: msg.sender, debtAsset: debtAsset}));
            _userDebtAssets[msg.sender].push(debtAsset);
            _isDebtAssetRegistered[msg.sender][debtAsset] = true;
        }

        _policies[msg.sender][debtAsset] = GuardianCore.Policy({
            enabled: true,
            triggerHF: triggerHF,
            targetHF: targetHF,
            maxRepayPerAction: maxRepayPerAction
        });

        emit PolicySet(msg.sender, debtAsset, triggerHF, targetHF, maxRepayPerAction);
    }

    function disablePolicy(address debtAsset) external {
        _policies[msg.sender][debtAsset].enabled = false;
        emit PolicyDisabled(msg.sender, debtAsset);
    }

    function setLayer2(address debtAsset, uint8 kind, address source, uint256 maxAssetsPerAction) external {
        if (kind == L2_NONE) {
            _layer2[msg.sender][debtAsset] = Layer2Config(L2_NONE, address(0), 0);
            return;
        }

        GuardianCore.Policy memory p = _policies[msg.sender][debtAsset];
        if (!p.enabled) revert GuardianCore.NoPolicy();
        if (source == address(0) || maxAssetsPerAction == 0) revert GuardianCore.InvalidLayer2();

        if (kind == L2_ERC4626) {
            if (IERC4626(source).asset() != debtAsset) revert GuardianCore.InvalidSource();
        } else if (kind == L2_ATOKEN) {
            if (IAToken(source).UNDERLYING_ASSET_ADDRESS() != debtAsset) revert GuardianCore.InvalidSource();
        } else {
            revert GuardianCore.InvalidLayer2();
        }

        _layer2[msg.sender][debtAsset] = Layer2Config(kind, source, maxAssetsPerAction);
    }

    function setLayer3(
        address debtAsset,
        bool enabled,
        address collateralAsset,
        uint256 maxCollateralPerAction,
        uint16 maxSlippageBps
    ) external {
        if (!enabled) {
            _layer3[msg.sender][debtAsset] = Layer3Config(false, address(0), 0, 0);
            return;
        }

        GuardianCore.Policy memory p = _policies[msg.sender][debtAsset];
        if (!p.enabled) revert GuardianCore.NoPolicy();
        if (collateralAsset == address(0) || maxCollateralPerAction == 0 || maxSlippageBps > GuardianCore.BPS) {
            revert GuardianCore.InvalidLayer3();
        }
        if (collateralAsset == debtAsset) revert GuardianCore.InvalidCollateral();

        _layer3[msg.sender][debtAsset] =
            Layer3Config(true, collateralAsset, maxCollateralPerAction, maxSlippageBps);
    }

    function setTriggerBand(address debtAsset, uint256 minTriggerHF, uint256 maxTriggerHF, address riskAgent) external {
        GuardianCore.Policy memory p = _policies[msg.sender][debtAsset];
        GuardianCore.setTriggerBand(
            _triggerBands[msg.sender][debtAsset],
            minTriggerHF,
            maxTriggerHF,
            riskAgent,
            p.targetHF,
            p.enabled
        );
    }

    function setDynamicTrigger(address user, address debtAsset, uint256 triggerHF, uint64 validUntil) external {
        GuardianCore.Policy memory p = _policies[user][debtAsset];
        GuardianCore.setDynamicTrigger(
            _triggerBands[user][debtAsset],
            triggerHF,
            validUntil,
            p.targetHF,
            p.enabled
        );
        emit DynamicTriggerSet(user, debtAsset, msg.sender, triggerHF, validUntil);
    }

    function setDebtPriority(address[] calldata debtAssets) external {
        uint256 len = debtAssets.length;
        if (len == 0 || len != _userDebtAssets[msg.sender].length) revert GuardianCore.InvalidDebtPriority();

        for (uint256 i = 0; i < len; ++i) {
            address asset = debtAssets[i];
            if (!_isDebtAssetRegistered[msg.sender][asset]) revert GuardianCore.InvalidDebtPriority();
            for (uint256 j = i + 1; j < len; ++j) {
                if (asset == debtAssets[j]) revert GuardianCore.InvalidDebtPriority();
            }
        }

        _userDebtAssets[msg.sender] = debtAssets;
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function pool() public view returns (IPool) {
        return IPool(addressesProvider.getPool());
    }

    function policyOf(address user, address debtAsset)
        external
        view
        returns (bool enabled, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction)
    {
        GuardianCore.Policy memory p = _policies[user][debtAsset];
        return (p.enabled, p.triggerHF, p.targetHF, p.maxRepayPerAction);
    }

    function layer2Of(address user, address debtAsset)
        external
        view
        returns (uint8 kind, address source, uint256 maxAssetsPerAction)
    {
        Layer2Config memory l2 = _layer2[user][debtAsset];
        return (l2.kind, l2.source, l2.maxAssetsPerAction);
    }

    function layer3Of(address user, address debtAsset)
        external
        view
        returns (bool enabled, address collateralAsset, uint256 maxCollateralPerAction, uint16 maxSlippageBps)
    {
        Layer3Config memory l3 = _layer3[user][debtAsset];
        return (l3.enabled, l3.collateralAsset, l3.maxCollateralPerAction, l3.maxSlippageBps);
    }

    function debtAssetsOf(address user) external view returns (address[] memory) {
        return _userDebtAssets[user];
    }

    function healthFactor(address user) public view returns (uint256 hf) {
        (,,,,, hf) = pool().getUserAccountData(user);
    }

    function effectiveTrigger(address user, address debtAsset) public view returns (uint256) {
        return GuardianCore.effectiveTrigger(
            _triggerBands[user][debtAsset], _policies[user][debtAsset].triggerHF
        );
    }

    function needsProtection(address user, address debtAsset) public view returns (bool) {
        GuardianCore.Policy memory p = _policies[user][debtAsset];
        if (!p.enabled) return false;
        (, uint256 debtBase,,,, uint256 hf) = pool().getUserAccountData(user);
        if (debtBase == 0 || hf >= effectiveTrigger(user, debtAsset)) return false;

        // If variable debt token is available, check that user actually owes debtAsset
        try pool().getReserveData(debtAsset) returns (ReserveData memory reserve) {
            if (reserve.variableDebtTokenAddress != address(0)) {
                if (IERC20(reserve.variableDebtTokenAddress).balanceOf(user) == 0) return false;
            }
        } catch {}

        return true;
    }

    function positionCount() external view returns (uint256) {
        return _positions.length;
    }

    function positionsPage(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory users, address[] memory debtAssets)
    {
        uint256 total = _positions.length;
        if (offset >= total || limit == 0) {
            return (new address[](0), new address[](0));
        }
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint256 len = end - offset;
        users = new address[](len);
        debtAssets = new address[](len);
        for (uint256 i = 0; i < len; ++i) {
            PositionRef storage pos = _positions[offset + i];
            users[i] = pos.user;
            debtAssets[i] = pos.debtAsset;
        }
    }

    function quoteFee(address user, address debtAsset) external view returns (bool eligible, uint256 fee) {
        if (!needsProtection(user, debtAsset)) return (false, 0);
        uint256 hf = healthFactor(user);
        eligible = GuardianCore.isFeeEligible(hf, _policies[user][debtAsset].triggerHF);
        if (!eligible) return (false, 0);
        (uint256 l1, uint256 l2, uint256 l3,) = quoteProtect(user, debtAsset);
        fee = GuardianCore.calculateFee(l1 + l2 + l3);
    }

    function quoteProtect(address user, address debtAsset)
        public
        view
        returns (uint256 l1Repay, uint256 l2Repay, uint256 l3Repay, uint256 expectedHf)
    {
        QuoteResult memory r = _quoteProtectInternal(user, debtAsset);
        return (r.l1Repay, r.l2Repay, r.l3Repay, r.expectedHf);
    }

    function _quoteProtectInternal(address user, address debtAsset) internal view returns (QuoteResult memory r) {
        GuardianCore.Policy memory p = _policies[user][debtAsset];
        if (!p.enabled) {
            r.expectedHf = healthFactor(user);
            return r;
        }

        AccountData memory acc = _getAccountData(user);
        if (acc.debtBase == 0 || acc.hf >= effectiveTrigger(user, debtAsset)) {
            r.expectedHf = acc.hf;
            return r;
        }

        uint256 targetDebtBase = (acc.colBase * acc.liqThresholdBps * GuardianCore.WAD)
            / (GuardianCore.BPS * (p.targetHF + GuardianCore.TARGET_BUFFER));
        if (acc.debtBase <= targetDebtBase) {
            r.expectedHf = acc.hf;
            return r;
        }

        QuoteState memory st;
        st.colBase = acc.colBase;
        st.debtBase = acc.debtBase;
        st.liqThresholdBps = acc.liqThresholdBps;
        st.priceDebt = IAaveOracle(addressesProvider.getPriceOracle()).getAssetPrice(debtAsset);
        st.unitDebt = 10 ** IERC20Metadata(debtAsset).decimals();
        st.remainingNeededTokens = ((acc.debtBase - targetDebtBase) * st.unitDebt + st.priceDebt - 1) / st.priceDebt;

        r.l1Repay = _quoteL1(user, debtAsset, p, st);
        r.l2Repay = _quoteL2(user, debtAsset, _layer2[user][debtAsset], st);
        (, r.l3Repay) = _quoteL3(user, debtAsset, p, _layer3[user][debtAsset], st);

        if (st.debtBase == 0) {
            r.expectedHf = type(uint256).max;
        } else {
            r.expectedHf = (st.colBase * st.liqThresholdBps * GuardianCore.WAD) / (GuardianCore.BPS * st.debtBase);
        }
    }

    // ─── Protection Execution ────────────────────────────────────────────────

    function protect(address user, address debtAsset) external nonReentrant returns (uint256 totalRepaid) {
        GuardianCore.Policy memory p = _policies[user][debtAsset];
        if (!p.enabled) revert GuardianCore.NoPolicy();

        IPool aave = pool();
        (,,,,, uint256 hfBefore) = aave.getUserAccountData(user);
        uint256 trig = effectiveTrigger(user, debtAsset);
        if (hfBefore >= trig) revert GuardianCore.NotAtRisk(hfBefore, trig);

        // Check if user has debt in this asset if variable debt token is known
        try aave.getReserveData(debtAsset) returns (ReserveData memory reserve) {
            if (reserve.variableDebtTokenAddress != address(0)) {
                if (IERC20(reserve.variableDebtTokenAddress).balanceOf(user) == 0) {
                    revert GuardianCore.NothingToRepay();
                }
            }
        } catch {}

        // Layer 1
        totalRepaid += _executeLayer1(user, debtAsset, p, aave);

        // Check target HF
        (,,,,, uint256 hfAfterL1) = aave.getUserAccountData(user);
        if (hfAfterL1 < p.targetHF) {
            // Layer 2
            Layer2Config storage l2 = _layer2[user][debtAsset];
            if (l2.kind != L2_NONE) {
                totalRepaid += _executeLayer2(user, debtAsset, p, l2, aave);
            }

            // Check target HF
            (,,,,, uint256 hfAfterL2) = aave.getUserAccountData(user);
            if (hfAfterL2 < p.targetHF) {
                // Layer 3
                Layer3Config storage l3 = _layer3[user][debtAsset];
                if (l3.enabled) {
                    totalRepaid += _executeLayer3(user, debtAsset, p, l3, aave);
                }
            }
        }

        if (totalRepaid == 0) revert GuardianCore.NothingToRepay();

        // Success fee handling per ADR 0013
        if (GuardianCore.isFeeEligible(hfBefore, p.triggerHF)) {
            uint256 fee = GuardianCore.calculateFee(totalRepaid);
            (uint256 charged, uint256 waived) =
                GuardianCore.chargeFee(IERC20(debtAsset), user, treasury, fee);
            emit FeeCharged(user, debtAsset, charged, waived);
        }

        // Return leftover debt tokens to user
        uint256 remDebt = IERC20(debtAsset).balanceOf(address(this));
        if (remDebt > 0) {
            IERC20(debtAsset).safeTransfer(user, remDebt);
        }

        // Invariant checks: zero balance on Guardian
        GuardianCore.checkGuardianBalanceZero(IERC20(debtAsset));
        Layer3Config memory finalL3 = _layer3[user][debtAsset];
        if (finalL3.collateralAsset != address(0)) {
            GuardianCore.checkGuardianBalanceZero(IERC20(finalL3.collateralAsset));
        }

        // Invariant check: HF strictly improved
        (,,,,, uint256 hfAfter) = aave.getUserAccountData(user);
        GuardianCore.checkHealthFactorImproved(hfBefore, hfAfter);

        emit Protected(user, debtAsset, msg.sender, totalRepaid, hfBefore, hfAfter);
    }

    // ─── Internal Cascade Logic ──────────────────────────────────────────────

    function _getAccountData(address user) internal view returns (AccountData memory a) {
        (a.colBase, a.debtBase,, a.liqThresholdBps,, a.hf) = pool().getUserAccountData(user);
    }

    function _getMaxDebtTokens(address user, address debtAsset, uint256 debtBase, uint256 unitDebt, uint256 priceDebt)
        internal
        view
        returns (uint256 maxDebtTokens)
    {
        maxDebtTokens = (debtBase * unitDebt) / priceDebt;
        try pool().getReserveData(debtAsset) returns (ReserveData memory reserve) {
            if (reserve.variableDebtTokenAddress != address(0)) {
                uint256 actualDebt = IERC20(reserve.variableDebtTokenAddress).balanceOf(user);
                if (actualDebt < maxDebtTokens) {
                    maxDebtTokens = actualDebt;
                }
            }
        } catch {}
    }

    function _quoteL1(address user, address debtAsset, GuardianCore.Policy memory p, QuoteState memory st)
        internal
        view
        returns (uint256 l1Repay)
    {
        if (st.debtBase == 0 || st.remainingNeededTokens == 0) return 0;
        uint256 l1Bal = IERC20(debtAsset).balanceOf(user);
        uint256 l1Allow = IERC20(debtAsset).allowance(user, address(this));
        uint256 maxDebtTokens = _getMaxDebtTokens(user, debtAsset, st.debtBase, st.unitDebt, st.priceDebt);
        l1Repay = GuardianCore.min(
            GuardianCore.min(GuardianCore.min(st.remainingNeededTokens, p.maxRepayPerAction), l1Bal), l1Allow
        );
        l1Repay = GuardianCore.min(l1Repay, maxDebtTokens);
        if (l1Repay > 0) {
            st.remainingNeededTokens -= l1Repay;
            uint256 l1Base = (l1Repay * st.priceDebt) / st.unitDebt;
            st.debtBase = l1Base >= st.debtBase ? 0 : st.debtBase - l1Base;
        }
    }

    function _quoteL2(address user, address debtAsset, Layer2Config memory l2, QuoteState memory st)
        internal
        view
        returns (uint256 l2Repay)
    {
        if (st.debtBase == 0 || st.remainingNeededTokens == 0 || l2.kind == L2_NONE) return 0;
        uint256 availAssets = 0;
        if (l2.kind == L2_ERC4626) {
            uint256 sharesBal = IERC20(l2.source).balanceOf(user);
            uint256 sharesAllow = IERC20(l2.source).allowance(user, address(this));
            uint256 usableShares = GuardianCore.min(sharesBal, sharesAllow);
            availAssets = IERC4626(l2.source).previewRedeem(usableShares);
        } else if (l2.kind == L2_ATOKEN) {
            uint256 aBal = IERC20(l2.source).balanceOf(user);
            uint256 aAllow = IERC20(l2.source).allowance(user, address(this));
            availAssets = GuardianCore.min(aBal, aAllow);
        }
        l2Repay = GuardianCore.min(
            GuardianCore.min(st.remainingNeededTokens, l2.maxAssetsPerAction), availAssets
        );
        uint256 maxDebtTokens = _getMaxDebtTokens(user, debtAsset, st.debtBase, st.unitDebt, st.priceDebt);
        l2Repay = GuardianCore.min(l2Repay, maxDebtTokens);
        if (l2Repay > 0) {
            st.remainingNeededTokens -= l2Repay;
            uint256 l2Base = (l2Repay * st.priceDebt) / st.unitDebt;
            st.debtBase = l2Base >= st.debtBase ? 0 : st.debtBase - l2Base;
        }
    }

    function _quoteL3(
        address user,
        address debtAsset,
        GuardianCore.Policy memory p,
        Layer3Config memory l3,
        QuoteState memory st
    ) internal view returns (uint256 l3Collateral, uint256 l3Repay) {
        if (st.debtBase == 0 || !l3.enabled) return (0, 0);
        (l3Collateral, l3Repay) =
            _calculateL3Amounts(user, debtAsset, st.colBase, st.debtBase, st.liqThresholdBps, p, l3);
        if (l3Repay > 0) {
            uint256 l3RepayBase = (l3Repay * st.priceDebt) / st.unitDebt;
            st.debtBase = l3RepayBase >= st.debtBase ? 0 : st.debtBase - l3RepayBase;
            uint256 priceCollat = IAaveOracle(addressesProvider.getPriceOracle()).getAssetPrice(l3.collateralAsset);
            uint8 decCollat = IERC20Metadata(l3.collateralAsset).decimals();
            uint256 l3CollatBase = (l3Collateral * priceCollat) / (10 ** decCollat);
            st.colBase = l3CollatBase >= st.colBase ? 0 : st.colBase - l3CollatBase;
        }
    }

    function _computeLayer1Amount(
        address user,
        address debtAsset,
        GuardianCore.Policy memory p,
        uint256 debtBase,
        uint256 targetDebtBase
    ) internal view returns (uint256 amount) {
        uint256 priceDebt = IAaveOracle(addressesProvider.getPriceOracle()).getAssetPrice(debtAsset);
        uint256 unitDebt = 10 ** IERC20Metadata(debtAsset).decimals();
        uint256 debtNeededTokens = ((debtBase - targetDebtBase) * unitDebt + priceDebt - 1) / priceDebt;

        uint256 l1Avail = GuardianCore.min(
            IERC20(debtAsset).balanceOf(user), IERC20(debtAsset).allowance(user, address(this))
        );
        amount = GuardianCore.min(GuardianCore.min(debtNeededTokens, p.maxRepayPerAction), l1Avail);
        uint256 maxDebtTokens = _getMaxDebtTokens(user, debtAsset, debtBase, unitDebt, priceDebt);
        amount = GuardianCore.min(amount, maxDebtTokens);
    }

    function _executeLayer1(
        address user,
        address debtAsset,
        GuardianCore.Policy memory p,
        IPool aave
    ) internal returns (uint256 repaid) {
        AccountData memory acc = _getAccountData(user);
        uint256 targetDebtBase = (acc.colBase * acc.liqThresholdBps * GuardianCore.WAD)
            / (GuardianCore.BPS * (p.targetHF + GuardianCore.TARGET_BUFFER));
        if (acc.debtBase <= targetDebtBase) return 0;

        uint256 amount = _computeLayer1Amount(user, debtAsset, p, acc.debtBase, targetDebtBase);
        if (amount == 0) return 0;

        IERC20 token = IERC20(debtAsset);
        token.safeTransferFrom(user, address(this), amount);
        token.forceApprove(address(aave), amount);
        repaid = aave.repay(debtAsset, amount, VARIABLE_RATE, user);
        token.forceApprove(address(aave), 0);

        emit LayerUsed(user, debtAsset, 1, amount, repaid);
    }

    function _getLayer2Available(address user, Layer2Config storage l2) internal view returns (uint256 avail) {
        if (l2.kind == L2_ERC4626) {
            uint256 sharesBal = IERC20(l2.source).balanceOf(user);
            uint256 sharesAllow = IERC20(l2.source).allowance(user, address(this));
            avail = IERC4626(l2.source).previewRedeem(GuardianCore.min(sharesBal, sharesAllow));
        } else if (l2.kind == L2_ATOKEN) {
            uint256 aBal = IERC20(l2.source).balanceOf(user);
            uint256 aAllow = IERC20(l2.source).allowance(user, address(this));
            avail = GuardianCore.min(aBal, aAllow);
        }
    }

    function _computeLayer2Amount(
        address user,
        address debtAsset,
        Layer2Config storage l2,
        uint256 debtBase,
        uint256 targetDebtBase
    ) internal view returns (uint256 amount) {
        uint256 priceDebt = IAaveOracle(addressesProvider.getPriceOracle()).getAssetPrice(debtAsset);
        uint256 unitDebt = 10 ** IERC20Metadata(debtAsset).decimals();
        uint256 debtNeededTokens = ((debtBase - targetDebtBase) * unitDebt + priceDebt - 1) / priceDebt;

        uint256 availAssets = _getLayer2Available(user, l2);
        amount = GuardianCore.min(GuardianCore.min(debtNeededTokens, l2.maxAssetsPerAction), availAssets);
        uint256 maxDebtTokens = _getMaxDebtTokens(user, debtAsset, debtBase, unitDebt, priceDebt);
        amount = GuardianCore.min(amount, maxDebtTokens);
    }

    function _executeLayer2(
        address user,
        address debtAsset,
        GuardianCore.Policy memory p,
        Layer2Config storage l2,
        IPool aave
    ) internal returns (uint256 repaid) {
        AccountData memory acc = _getAccountData(user);
        uint256 targetDebtBase = (acc.colBase * acc.liqThresholdBps * GuardianCore.WAD)
            / (GuardianCore.BPS * (p.targetHF + GuardianCore.TARGET_BUFFER));
        if (acc.debtBase <= targetDebtBase) return 0;

        uint256 amount = _computeLayer2Amount(user, debtAsset, l2, acc.debtBase, targetDebtBase);
        if (amount == 0) return 0;

        IERC20 debtToken = IERC20(debtAsset);
        if (l2.kind == L2_ERC4626) {
            IERC4626(l2.source).withdraw(amount, address(this), user);
        } else if (l2.kind == L2_ATOKEN) {
            IERC20(l2.source).safeTransferFrom(user, address(this), amount);
            aave.withdraw(debtAsset, amount, address(this));
        }

        debtToken.forceApprove(address(aave), amount);
        repaid = aave.repay(debtAsset, amount, VARIABLE_RATE, user);
        debtToken.forceApprove(address(aave), 0);

        emit LayerUsed(user, debtAsset, 2, amount, repaid);
    }

    function _executeLayer3(
        address user,
        address debtAsset,
        GuardianCore.Policy memory p,
        Layer3Config storage l3,
        IPool aave
    ) internal returns (uint256 repaid) {
        AccountData memory acc = _getAccountData(user);
        (uint256 collatTokens, uint256 flashLoanPrincipal) =
            _calculateL3Amounts(user, debtAsset, acc.colBase, acc.debtBase, acc.liqThresholdBps, p, l3);

        if (collatTokens == 0 || flashLoanPrincipal == 0) return 0;

        bytes memory params = abi.encode(
            FlashParams({
                user: user,
                collateralAsset: l3.collateralAsset,
                collateralAmount: collatTokens,
                maxSlippageBps: l3.maxSlippageBps
            })
        );
        aave.flashLoanSimple(address(this), debtAsset, flashLoanPrincipal, params, 0);

        repaid = _lastL3DebtRepaid;
        _lastL3DebtRepaid = 0;
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        if (msg.sender != address(pool())) revert GuardianCore.Unauthorized();
        if (initiator != address(this)) revert GuardianCore.Unauthorized();

        FlashParams memory fp = abi.decode(params, (FlashParams));
        uint256 repaid = _executeFlashOperation(asset, amount, premium, fp);

        emit LayerUsed(fp.user, asset, 3, fp.collateralAmount, repaid);
        _lastL3DebtRepaid = repaid;
        return true;
    }

    function _executeFlashOperation(address asset, uint256 amount, uint256 premium, FlashParams memory fp)
        internal
        returns (uint256 repaid)
    {
        IPool aave = pool();
        IERC20 debtToken = IERC20(asset);

        debtToken.forceApprove(address(aave), amount);
        repaid = aave.repay(asset, amount, VARIABLE_RATE, fp.user);
        debtToken.forceApprove(address(aave), 0);

        address aCollateral = _getATokenAddress(aave, fp.collateralAsset);
        if (aCollateral == address(0)) {
            aCollateral = aave.getReserveData(fp.collateralAsset).aTokenAddress;
        }
        IERC20(aCollateral).safeTransferFrom(fp.user, address(this), fp.collateralAmount);
        aave.withdraw(fp.collateralAsset, fp.collateralAmount, address(this));

        uint256 amountOut = _swapCollateral(fp.collateralAsset, asset, fp.collateralAmount, fp.maxSlippageBps);

        uint256 totalOwed = amount + premium;
        if (amountOut < totalOwed) {
            revert InsufficientSwapOutput(amountOut, totalOwed);
        }

        uint256 excess = amountOut - totalOwed;
        repaid += _handleSwapExcess(fp.user, asset, excess, aave);

        debtToken.forceApprove(address(aave), totalOwed);

        uint256 remCollat = IERC20(fp.collateralAsset).balanceOf(address(this));
        if (remCollat > 0) {
            IERC20(fp.collateralAsset).safeTransfer(fp.user, remCollat);
        }
    }

    function _swapCollateral(
        address collateralAsset,
        address debtAsset,
        uint256 collateralAmount,
        uint16 maxSlippageBps
    ) internal returns (uint256 amountOut) {
        uint256 minOut = _calcMinOut(collateralAsset, debtAsset, collateralAmount, maxSlippageBps);
        IERC20(collateralAsset).forceApprove(address(swapRouter), collateralAmount);

        ISwapRouter02.ExactInputSingleParams memory params = ISwapRouter02.ExactInputSingleParams({
            tokenIn: collateralAsset,
            tokenOut: debtAsset,
            fee: swapFee,
            recipient: address(this),
            amountIn: collateralAmount,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        });

        amountOut = swapRouter.exactInputSingle(params);
        IERC20(collateralAsset).forceApprove(address(swapRouter), 0);
    }

    function _handleSwapExcess(address user, address asset, uint256 excess, IPool aave)
        internal
        returns (uint256 additionalRepaid)
    {
        if (excess == 0) return 0;
        IERC20 debtToken = IERC20(asset);
        debtToken.forceApprove(address(aave), excess);
        additionalRepaid = aave.repay(asset, excess, VARIABLE_RATE, user);
        debtToken.forceApprove(address(aave), 0);
    }

    function _calculateL3Amounts(
        address user,
        address debtAsset,
        uint256 colBase,
        uint256 debtBase,
        uint256 currentLT,
        GuardianCore.Policy memory p,
        Layer3Config memory l3
    ) internal view returns (uint256 collatTokens, uint256 flashLoanPrincipal) {
        uint256 cBase = _calculateL3CollateralBase(
            colBase, debtBase, currentLT, p.targetHF, l3.maxSlippageBps, l3.collateralAsset
        );
        collatTokens = _capCollateralTokens(user, cBase, colBase, l3);
        flashLoanPrincipal =
            _calculateFlashPrincipal(user, collatTokens, debtBase, debtAsset, l3.collateralAsset, l3.maxSlippageBps);
    }

    function _calculateL3CollateralBase(
        uint256 colBase,
        uint256 debtBase,
        uint256 currentLT,
        uint256 targetHF,
        uint16 maxSlippageBps,
        address collateralAsset
    ) internal view returns (uint256 cBase) {
        IPool aave = pool();
        uint256 ltCollateralBps = _getCollateralReserveLT(aave, collateralAsset, currentLT);
        uint256 premiumBps = _getFlashLoanPremiumBps(aave);

        uint256 hTarget = targetHF + GuardianCore.TARGET_BUFFER;
        uint256 mBaseWad = (colBase * currentLT * GuardianCore.WAD) / GuardianCore.BPS;
        uint256 targetDebtTerm = hTarget * debtBase;

        if (targetDebtTerm <= mBaseWad) return 0;
        uint256 numerator = targetDebtTerm - mBaseWad;

        uint256 hTargetGamma = (hTarget * (GuardianCore.BPS - maxSlippageBps)) / (GuardianCore.BPS + premiumBps);
        uint256 ltCollateralWad = (ltCollateralBps * GuardianCore.WAD) / GuardianCore.BPS;

        if (hTargetGamma <= ltCollateralWad) return 0;
        uint256 denominator = hTargetGamma - ltCollateralWad;

        cBase = (numerator + denominator - 1) / denominator;
    }

    function _capCollateralTokens(address user, uint256 cBase, uint256 colBase, Layer3Config memory l3)
        internal
        view
        returns (uint256 collatTokens)
    {
        if (cBase == 0) return 0;
        uint256 priceCollat = IAaveOracle(addressesProvider.getPriceOracle()).getAssetPrice(l3.collateralAsset);
        uint256 unitCollat = 10 ** IERC20Metadata(l3.collateralAsset).decimals();

        collatTokens = (cBase * unitCollat + priceCollat - 1) / priceCollat;
        collatTokens = GuardianCore.min(collatTokens, l3.maxCollateralPerAction);

        address aCollateral = _getATokenAddress(pool(), l3.collateralAsset);
        if (aCollateral != address(0)) {
            collatTokens = GuardianCore.min(collatTokens, IERC20(aCollateral).balanceOf(user));
            collatTokens = GuardianCore.min(collatTokens, IERC20(aCollateral).allowance(user, address(this)));
        }
        collatTokens = GuardianCore.min(collatTokens, (colBase * unitCollat) / priceCollat);
    }

    function _calculateFlashPrincipal(
        address user,
        uint256 collatTokens,
        uint256 debtBase,
        address debtAsset,
        address collateralAsset,
        uint16 maxSlippageBps
    ) internal view returns (uint256 flashLoanPrincipal) {
        if (collatTokens == 0) return 0;
        uint256 minOut = _calcMinOut(collateralAsset, debtAsset, collatTokens, maxSlippageBps);
        uint256 premiumBps = _getFlashLoanPremiumBps(pool());
        flashLoanPrincipal = (minOut * GuardianCore.BPS) / (GuardianCore.BPS + premiumBps);

        uint256 priceDebt = IAaveOracle(addressesProvider.getPriceOracle()).getAssetPrice(debtAsset);
        uint256 unitDebt = 10 ** IERC20Metadata(debtAsset).decimals();
        uint256 maxDebtTokens = _getMaxDebtTokens(user, debtAsset, debtBase, unitDebt, priceDebt);
        flashLoanPrincipal = GuardianCore.min(flashLoanPrincipal, maxDebtTokens);
    }

    function _calcMinOut(address tokenIn, address tokenOut, uint256 amountIn, uint16 maxSlippageBps)
        internal
        view
        returns (uint256 minOut)
    {
        IAaveOracle oracle = IAaveOracle(addressesProvider.getPriceOracle());
        uint256 priceIn = oracle.getAssetPrice(tokenIn);
        uint256 priceOut = oracle.getAssetPrice(tokenOut);
        uint256 unitIn = 10 ** IERC20Metadata(tokenIn).decimals();
        uint256 unitOut = 10 ** IERC20Metadata(tokenOut).decimals();
        minOut = (amountIn * priceIn * unitOut * (GuardianCore.BPS - maxSlippageBps))
            / (priceOut * unitIn * GuardianCore.BPS);
    }

    function _getCollateralReserveLT(IPool aave, address collateralAsset, uint256 defaultLT)
        internal
        view
        returns (uint256)
    {
        try aave.getReserveData(collateralAsset) returns (ReserveData memory reserve) {
            uint256 lt = (reserve.configuration.data >> 16) & 0xFFFF;
            if (lt > 0) return lt;
        } catch {}
        return defaultLT;
    }

    function _getATokenAddress(IPool aave, address asset) internal view returns (address) {
        try aave.getReserveData(asset) returns (ReserveData memory reserve) {
            if (reserve.aTokenAddress != address(0)) return reserve.aTokenAddress;
        } catch {}
        return address(0);
    }

    function _getFlashLoanPremiumBps(IPool aave) internal view returns (uint256) {
        try aave.FLASHLOAN_PREMIUM_TOTAL() returns (uint128 p) {
            return uint256(p);
        } catch {
            return 5;
        }
    }
}
