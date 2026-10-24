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

uint8 constant L2_NONE = 0;
uint8 constant L2_ERC4626 = 1;
uint8 constant L2_ATOKEN = 2;

/// @title TahansoeGuardianV2
/// @notice Non-custodial liquidation protection for Aave V3 borrowers with 3-layer protection:
///   - Layer 1: Wallet hot reserve (ERC20 debtAsset transferFrom)
///   - Layer 2: Yield reserve (ERC-4626 vault or aToken of debtAsset)
///   - Layer 3: Deleverage via Aave flashLoanSimple (sell collateral to repay debt)
///
/// Invariant: tokens only move from the user (wallet, vault shares, aTokens) into Aave to repay
/// that same user's debt, with any unused remainder returned to the user. The Guardian holds no
/// funds between calls, has no admin or owner, and enforces non-custodial protection.
contract TahansoeGuardianV2 is ReentrancyGuard, IFlashLoanSimpleReceiver {
    using SafeERC20 for IERC20;

    uint256 public constant MIN_TRIGGER_HF = 1.05e18;
    uint256 public constant MAX_TARGET_HF = 3e18;

    uint256 private constant TARGET_BUFFER = 1e14;
    uint256 private constant WAD = 1e18;
    uint256 private constant BPS = 10_000;
    uint256 private constant VARIABLE_RATE = 2;

    struct Policy {
        bool enabled;
        address debtAsset;
        uint256 triggerHF; // WAD
        uint256 targetHF; // WAD
        uint256 maxRepayPerAction;
    }

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

    struct TriggerBand {
        uint256 minTriggerHF;
        uint256 maxTriggerHF;
        address riskAgent;
        uint256 dynamicTriggerHF;
        uint64 validUntil;
    }

    IPoolAddressesProvider public immutable addressesProvider;
    ISwapRouter02 public immutable swapRouter;
    uint24 public immutable swapFee;

    mapping(address user => Policy) public policies;
    mapping(address user => Layer2Config) public layer2;
    mapping(address user => Layer3Config) public layer3;
    mapping(address user => TriggerBand) public triggerBands;

    address[] private _users;
    mapping(address => bool) private _isRegistered;

    uint256 private _lastL3DebtRepaid;

    event PolicySet(
        address indexed user, address indexed debtAsset, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction
    );
    event PolicyDisabled(address indexed user);
    event Layer2Set(address indexed user, uint8 kind, address source, uint256 maxAssetsPerAction);
    event Layer3Set(
        address indexed user,
        bool enabled,
        address collateralAsset,
        uint256 maxCollateralPerAction,
        uint16 maxSlippageBps
    );
    event TriggerBandSet(address indexed user, uint256 minTriggerHF, uint256 maxTriggerHF, address riskAgent);
    event DynamicTriggerSet(address indexed user, address indexed agent, uint256 triggerHF, uint64 validUntil);
    event LayerUsed(address indexed user, uint8 indexed layer, uint256 amountIn, uint256 debtRepaid);
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
    error InvalidLayer2();
    error InvalidLayer3();
    error InvalidBand();
    error InvalidTrigger();
    error InvalidExpiry();
    error Unauthorized();
    error InsufficientSwapOutput(uint256 received, uint256 minRequired);
    error RemainingBalance();
    error InvalidSource();
    error InvalidCollateral();

    constructor(IPoolAddressesProvider provider, address swapRouter_, uint24 swapFee_) {
        addressesProvider = provider;
        swapRouter = ISwapRouter02(swapRouter_);
        swapFee = swapFee_;
    }

    // ─── Policy ──────────────────────────────────────────────────────────────

    function setPolicy(address debtAsset, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction) external {
        if (
            debtAsset == address(0) || triggerHF < MIN_TRIGGER_HF || targetHF <= triggerHF || targetHF > MAX_TARGET_HF
                || maxRepayPerAction == 0
        ) revert InvalidPolicy();

        TriggerBand memory band = triggerBands[msg.sender];
        if (band.riskAgent != address(0) && band.maxTriggerHF >= targetHF) {
            revert InvalidPolicy();
        }

        if (!_isRegistered[msg.sender]) {
            _isRegistered[msg.sender] = true;
            _users.push(msg.sender);
        }

        policies[msg.sender] = Policy({
            enabled: true,
            debtAsset: debtAsset,
            triggerHF: triggerHF,
            targetHF: targetHF,
            maxRepayPerAction: maxRepayPerAction
        });

        emit PolicySet(msg.sender, debtAsset, triggerHF, targetHF, maxRepayPerAction);
    }

    function disablePolicy() external {
        policies[msg.sender].enabled = false;
        emit PolicyDisabled(msg.sender);
    }

    // ─── Layer 2 & 3 Configuration ───────────────────────────────────────────

    function setLayer2(uint8 kind, address source, uint256 maxAssetsPerAction) external {
        if (kind == L2_NONE) {
            layer2[msg.sender] = Layer2Config(L2_NONE, address(0), 0);
            emit Layer2Set(msg.sender, L2_NONE, address(0), 0);
            return;
        }

        Policy memory p = policies[msg.sender];
        if (!p.enabled) revert NoPolicy();
        if (source == address(0) || maxAssetsPerAction == 0) revert InvalidLayer2();

        if (kind == L2_ERC4626) {
            if (IERC4626(source).asset() != p.debtAsset) revert InvalidSource();
        } else if (kind == L2_ATOKEN) {
            if (IAToken(source).UNDERLYING_ASSET_ADDRESS() != p.debtAsset) revert InvalidSource();
        } else {
            revert InvalidLayer2();
        }

        layer2[msg.sender] = Layer2Config(kind, source, maxAssetsPerAction);
        emit Layer2Set(msg.sender, kind, source, maxAssetsPerAction);
    }

    function setLayer3(bool enabled, address collateralAsset, uint256 maxCollateralPerAction, uint16 maxSlippageBps)
        external
    {
        if (!enabled) {
            layer3[msg.sender] = Layer3Config(false, address(0), 0, 0);
            emit Layer3Set(msg.sender, false, address(0), 0, 0);
            return;
        }

        Policy memory p = policies[msg.sender];
        if (!p.enabled) revert NoPolicy();
        if (collateralAsset == address(0) || maxCollateralPerAction == 0 || maxSlippageBps > BPS) {
            revert InvalidLayer3();
        }
        if (collateralAsset == p.debtAsset) revert InvalidCollateral();

        layer3[msg.sender] = Layer3Config(true, collateralAsset, maxCollateralPerAction, maxSlippageBps);
        emit Layer3Set(msg.sender, true, collateralAsset, maxCollateralPerAction, maxSlippageBps);
    }

    // ─── Dynamic Trigger Bands ───────────────────────────────────────────────

    function setTriggerBand(uint256 minTriggerHF, uint256 maxTriggerHF, address riskAgent) external {
        if (riskAgent == address(0)) {
            triggerBands[msg.sender] = TriggerBand(0, 0, address(0), 0, 0);
            emit TriggerBandSet(msg.sender, 0, 0, address(0));
            return;
        }

        if (minTriggerHF < MIN_TRIGGER_HF || minTriggerHF > maxTriggerHF || maxTriggerHF > MAX_TARGET_HF) {
            revert InvalidBand();
        }

        Policy memory p = policies[msg.sender];
        if (p.enabled && maxTriggerHF >= p.targetHF) revert InvalidBand();

        TriggerBand storage band = triggerBands[msg.sender];
        band.minTriggerHF = minTriggerHF;
        band.maxTriggerHF = maxTriggerHF;
        band.riskAgent = riskAgent;
        if (band.dynamicTriggerHF < minTriggerHF || band.dynamicTriggerHF > maxTriggerHF) {
            band.dynamicTriggerHF = 0;
            band.validUntil = 0;
        }

        emit TriggerBandSet(msg.sender, minTriggerHF, maxTriggerHF, riskAgent);
    }

    function setDynamicTrigger(address user, uint256 triggerHF, uint64 validUntil) external {
        TriggerBand storage band = triggerBands[user];
        if (msg.sender != band.riskAgent || band.riskAgent == address(0)) revert Unauthorized();
        if (triggerHF < band.minTriggerHF || triggerHF > band.maxTriggerHF) revert InvalidTrigger();
        if (validUntil <= block.timestamp) revert InvalidExpiry();

        Policy memory p = policies[user];
        if (p.enabled && triggerHF >= p.targetHF) revert InvalidTrigger();

        band.dynamicTriggerHF = triggerHF;
        band.validUntil = validUntil;

        emit DynamicTriggerSet(user, msg.sender, triggerHF, validUntil);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function pool() public view returns (IPool) {
        return IPool(addressesProvider.getPool());
    }

    function healthFactor(address user) public view returns (uint256 hf) {
        (,,,,, hf) = pool().getUserAccountData(user);
    }

    function effectiveTrigger(address user) public view returns (uint256) {
        TriggerBand memory band = triggerBands[user];
        if (
            band.riskAgent != address(0) && block.timestamp <= band.validUntil
                && band.dynamicTriggerHF >= band.minTriggerHF && band.dynamicTriggerHF <= band.maxTriggerHF
        ) {
            return band.dynamicTriggerHF;
        }
        return policies[user].triggerHF;
    }

    function needsProtection(address user) public view returns (bool) {
        Policy memory p = policies[user];
        if (!p.enabled) return false;
        (, uint256 debtBase,,,, uint256 hf) = pool().getUserAccountData(user);
        uint256 trig = effectiveTrigger(user);
        return debtBase > 0 && hf < trig;
    }

    function userCount() external view returns (uint256) {
        return _users.length;
    }

    function usersPage(uint256 offset, uint256 limit) public view returns (address[] memory) {
        uint256 total = _users.length;
        if (offset >= total || limit == 0) {
            return new address[](0);
        }
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint256 len = end - offset;
        address[] memory page = new address[](len);
        for (uint256 i = 0; i < len; ++i) {
            page[i] = _users[offset + i];
        }
        return page;
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
        uint256 l3Collateral;
        uint256 l3Repay;
        uint256 expectedHF;
    }

    struct QuoteState {
        uint256 colBase;
        uint256 debtBase;
        uint256 liqThresholdBps;
        uint256 remainingNeededTokens;
        uint256 priceDebt;
        uint256 unitDebt;
    }

    function _getAccountData(address user) internal view returns (AccountData memory a) {
        (a.colBase, a.debtBase,, a.liqThresholdBps,, a.hf) = pool().getUserAccountData(user);
    }

    /// @notice Simulates cascade L1 -> L2 -> L3 and returns projected repayment and HF.
    function quoteProtect(address user)
        public
        view
        returns (uint256 l1Repay, uint256 l2Repay, uint256 l3Collateral, uint256 l3Repay, uint256 expectedHF)
    {
        QuoteResult memory r = _quoteProtectInternal(user);
        return (r.l1Repay, r.l2Repay, r.l3Collateral, r.l3Repay, r.expectedHF);
    }

    function _quoteProtectInternal(address user) internal view returns (QuoteResult memory r) {
        Policy memory p = policies[user];
        if (!p.enabled) {
            r.expectedHF = healthFactor(user);
            return r;
        }

        AccountData memory acc = _getAccountData(user);
        if (acc.debtBase == 0 || acc.hf >= effectiveTrigger(user)) {
            r.expectedHF = acc.hf;
            return r;
        }

        uint256 hTarget = p.targetHF + TARGET_BUFFER;
        uint256 targetDebtBase = (acc.colBase * acc.liqThresholdBps * WAD) / (BPS * hTarget);
        if (acc.debtBase <= targetDebtBase) {
            r.expectedHF = acc.hf;
            return r;
        }

        QuoteState memory st;
        st.colBase = acc.colBase;
        st.debtBase = acc.debtBase;
        st.liqThresholdBps = acc.liqThresholdBps;
        st.priceDebt = IAaveOracle(addressesProvider.getPriceOracle()).getAssetPrice(p.debtAsset);
        st.unitDebt = 10 ** IERC20Metadata(p.debtAsset).decimals();
        st.remainingNeededTokens = ((acc.debtBase - targetDebtBase) * st.unitDebt + st.priceDebt - 1) / st.priceDebt;

        r.l1Repay = _quoteL1(user, policies[user], st);
        r.l2Repay = _quoteL2(user, layer2[user], st);
        (r.l3Collateral, r.l3Repay) = _quoteL3(user, policies[user], layer3[user], st);

        if (st.debtBase == 0) {
            r.expectedHF = type(uint256).max;
        } else {
            r.expectedHF = (st.colBase * st.liqThresholdBps * WAD) / (BPS * st.debtBase);
        }
    }

    function _quoteL1(address user, Policy storage p, QuoteState memory st) internal view returns (uint256 l1Repay) {
        if (st.debtBase == 0 || st.remainingNeededTokens == 0) return 0;
        uint256 l1Bal = IERC20(p.debtAsset).balanceOf(user);
        uint256 l1Allow = IERC20(p.debtAsset).allowance(user, address(this));
        uint256 maxDebtTokens = (st.debtBase * st.unitDebt) / st.priceDebt;
        l1Repay = _min(_min(_min(st.remainingNeededTokens, p.maxRepayPerAction), l1Bal), l1Allow);
        l1Repay = _min(l1Repay, maxDebtTokens);
        if (l1Repay > 0) {
            st.remainingNeededTokens -= l1Repay;
            uint256 l1Base = (l1Repay * st.priceDebt) / st.unitDebt;
            st.debtBase = l1Base >= st.debtBase ? 0 : st.debtBase - l1Base;
        }
    }

    function _quoteL2(address user, Layer2Config storage l2, QuoteState memory st)
        internal
        view
        returns (uint256 l2Repay)
    {
        if (st.debtBase == 0 || st.remainingNeededTokens == 0 || l2.kind == L2_NONE) return 0;
        uint256 availAssets = 0;
        if (l2.kind == L2_ERC4626) {
            uint256 sharesBal = IERC20(l2.source).balanceOf(user);
            uint256 sharesAllow = IERC20(l2.source).allowance(user, address(this));
            uint256 usableShares = _min(sharesBal, sharesAllow);
            availAssets = IERC4626(l2.source).previewRedeem(usableShares);
        } else if (l2.kind == L2_ATOKEN) {
            uint256 aBal = IERC20(l2.source).balanceOf(user);
            uint256 aAllow = IERC20(l2.source).allowance(user, address(this));
            availAssets = _min(aBal, aAllow);
        }
        l2Repay = _min(_min(st.remainingNeededTokens, l2.maxAssetsPerAction), availAssets);
        uint256 curMaxDebtTokens = (st.debtBase * st.unitDebt) / st.priceDebt;
        l2Repay = _min(l2Repay, curMaxDebtTokens);
        if (l2Repay > 0) {
            st.remainingNeededTokens -= l2Repay;
            uint256 l2Base = (l2Repay * st.priceDebt) / st.unitDebt;
            st.debtBase = l2Base >= st.debtBase ? 0 : st.debtBase - l2Base;
        }
    }

    function _quoteL3(address user, Policy storage p, Layer3Config storage l3, QuoteState memory st)
        internal
        view
        returns (uint256 l3Collateral, uint256 l3Repay)
    {
        if (st.debtBase == 0 || !l3.enabled) return (0, 0);
        (l3Collateral, l3Repay) = _calculateL3Amounts(user, st.colBase, st.debtBase, st.liqThresholdBps, p, l3);
        if (l3Repay > 0) {
            uint256 l3RepayBase = (l3Repay * st.priceDebt) / st.unitDebt;
            st.debtBase = l3RepayBase >= st.debtBase ? 0 : st.debtBase - l3RepayBase;
            uint256 priceCollat = IAaveOracle(addressesProvider.getPriceOracle()).getAssetPrice(l3.collateralAsset);
            uint8 decCollat = IERC20Metadata(l3.collateralAsset).decimals();
            uint256 l3CollatBase = (l3Collateral * priceCollat) / (10 ** decCollat);
            st.colBase = l3CollatBase >= st.colBase ? 0 : st.colBase - l3CollatBase;
        }
    }

    // ─── Sizing Math ─────────────────────────────────────────────────────────

    /// @dev Calculates the amount of collateralAsset to sell in Layer 3 to restore the
    /// user's Health Factor to targetHF (plus TARGET_BUFFER).
    ///
    /// Math Derivation:
    /// Let C_base = total collateral in base currency, D_base = total debt in base currency.
    /// Aave V3 Health Factor is defined as:
    ///   HF = (sum(C_i * LT_i)) / D_base
    /// where M = sum(C_i * LT_i) = C_base * currentLiquidationThreshold.
    ///
    /// When selling an amount of collateral with base value c_base:
    /// 1. Numerator M decreases by: c_base * LT_collateral (collateral asset's own liquidation threshold).
    /// 2. Collateral is swapped to debtAsset with slippage s (maxSlippageBps).
    ///    The received debt tokens are used to repay flash loan principal and premium p (flashLoanPremiumBps).
    ///    The net debt reduction factor gamma = (BPS - s) / (BPS + p).
    ///    Debt reduction: d_base = c_base * gamma.
    ///
    /// Setting target HF:
    ///   H_target = targetHF + TARGET_BUFFER
    ///   (M - c_base * LT_collateral) / (D_base - c_base * gamma) = H_target
    ///   M - c_base * LT_collateral = H_target * D_base - c_base * H_target * gamma
    ///   c_base * (H_target * gamma - LT_collateral) = H_target * D_base - M
    ///
    /// Therefore:
    ///   c_base = (H_target * D_base - M) / (H_target * gamma - LT_collateral)
    ///
    /// Once c_base is determined:
    ///   collateralAmount = (c_base * 10^decimals_c + price_c - 1) / price_c
    /// Capped by maxCollateralPerAction, user's aToken balance, and user's aToken allowance.
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

        uint256 hTarget = targetHF + TARGET_BUFFER;
        uint256 mBaseWad = (colBase * currentLT * WAD) / BPS;
        uint256 targetDebtTerm = hTarget * debtBase;

        if (targetDebtTerm <= mBaseWad) return 0;
        uint256 numerator = targetDebtTerm - mBaseWad; // scale: 10^26

        uint256 hTargetGamma = (hTarget * (BPS - maxSlippageBps)) / (BPS + premiumBps);
        uint256 ltCollateralWad = (ltCollateralBps * WAD) / BPS;

        if (hTargetGamma <= ltCollateralWad) return 0;
        uint256 denominator = hTargetGamma - ltCollateralWad; // scale: WAD (10^18)

        cBase = (numerator + denominator - 1) / denominator; // scale: 8 decimals
    }

    function _capCollateralTokens(address user, uint256 cBase, uint256 colBase, Layer3Config storage l3)
        internal
        view
        returns (uint256 collatTokens)
    {
        if (cBase == 0) return 0;
        uint256 priceCollat = IAaveOracle(addressesProvider.getPriceOracle()).getAssetPrice(l3.collateralAsset);
        uint256 unitCollat = 10 ** IERC20Metadata(l3.collateralAsset).decimals();

        collatTokens = (cBase * unitCollat + priceCollat - 1) / priceCollat;
        collatTokens = _min(collatTokens, l3.maxCollateralPerAction);

        address aCollateral = _getATokenAddress(pool(), l3.collateralAsset);
        if (aCollateral != address(0)) {
            collatTokens = _min(collatTokens, IERC20(aCollateral).balanceOf(user));
            collatTokens = _min(collatTokens, IERC20(aCollateral).allowance(user, address(this)));
        }
        collatTokens = _min(collatTokens, (colBase * unitCollat) / priceCollat);
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
        minOut = (amountIn * priceIn * unitOut * (BPS - maxSlippageBps)) / (priceOut * unitIn * BPS);
    }

    function _calculateFlashPrincipal(
        uint256 collatTokens,
        uint256 debtBase,
        address debtAsset,
        address collateralAsset,
        uint16 maxSlippageBps
    ) internal view returns (uint256 flashLoanPrincipal) {
        if (collatTokens == 0) return 0;
        uint256 minOut = _calcMinOut(collateralAsset, debtAsset, collatTokens, maxSlippageBps);
        uint256 premiumBps = _getFlashLoanPremiumBps(pool());
        flashLoanPrincipal = (minOut * BPS) / (BPS + premiumBps);

        uint256 maxDebtTokens = (debtBase * (10 ** IERC20Metadata(debtAsset).decimals()))
            / IAaveOracle(addressesProvider.getPriceOracle()).getAssetPrice(debtAsset);
        flashLoanPrincipal = _min(flashLoanPrincipal, maxDebtTokens);
    }

    function _calculateL3Amounts(
        address user,
        uint256 colBase,
        uint256 debtBase,
        uint256 currentLT,
        Policy storage p,
        Layer3Config storage l3
    ) internal view returns (uint256 collatTokens, uint256 flashLoanPrincipal) {
        uint256 cBase = _calculateL3CollateralBase(
            colBase, debtBase, currentLT, p.targetHF, l3.maxSlippageBps, l3.collateralAsset
        );
        collatTokens = _capCollateralTokens(user, cBase, colBase, l3);
        flashLoanPrincipal =
            _calculateFlashPrincipal(collatTokens, debtBase, p.debtAsset, l3.collateralAsset, l3.maxSlippageBps);
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

    // ─── Protection Execution ────────────────────────────────────────────────

    function protect(address user) public nonReentrant returns (uint256 totalRepaid) {
        Policy storage p = policies[user];
        if (!p.enabled) revert NoPolicy();

        IPool aave = pool();
        (,,,,, uint256 hfBefore) = aave.getUserAccountData(user);
        uint256 trig = effectiveTrigger(user);
        if (hfBefore >= trig) revert NotAtRisk(hfBefore, trig);

        // 1. Layer 1 execution
        totalRepaid += _executeLayer1(user, p, aave);

        // Check if target HF reached
        (,,,,, uint256 hfAfterL1) = aave.getUserAccountData(user);
        if (hfAfterL1 < p.targetHF) {
            // 2. Layer 2 execution
            Layer2Config storage l2 = layer2[user];
            if (l2.kind != L2_NONE) {
                totalRepaid += _executeLayer2(user, p, l2, aave);
            }

            // Check if target HF reached
            (,,,,, uint256 hfAfterL2) = aave.getUserAccountData(user);
            if (hfAfterL2 < p.targetHF) {
                // 3. Layer 3 execution (flash-loan deleverage)
                Layer3Config storage l3 = layer3[user];
                if (l3.enabled) {
                    totalRepaid += _executeLayer3(user, p, l3, aave);
                }
            }
        }

        _afterLayers(user, p.debtAsset, hfBefore, totalRepaid);

        // Return any remaining debt tokens to user
        uint256 remDebt = IERC20(p.debtAsset).balanceOf(address(this));
        if (remDebt > 0) {
            IERC20(p.debtAsset).safeTransfer(user, remDebt);
        }

        // Verify Guardian holds zero tokens after protect
        if (IERC20(p.debtAsset).balanceOf(address(this)) != 0) revert RemainingBalance();
        Layer3Config memory finalL3 = layer3[user];
        if (finalL3.collateralAsset != address(0) && IERC20(finalL3.collateralAsset).balanceOf(address(this)) != 0) {
            revert RemainingBalance();
        }

        if (totalRepaid == 0) revert NothingToRepay();

        (,,,,, uint256 hfAfter) = aave.getUserAccountData(user);
        if (hfAfter <= hfBefore) revert HealthFactorNotImproved(hfBefore, hfAfter);

        emit Protected(user, p.debtAsset, msg.sender, totalRepaid, hfBefore, hfAfter);
    }

    /// @dev Extension point run after the layers and before the final refund. No-op in V2.
    ///      Args: user, debtAsset, hfBefore, totalRepaid.
    function _afterLayers(address, address, uint256, uint256) internal virtual {}

    /// @dev Returns unused debt tokens to the user after a layer. V2 refunds immediately.
    function _refundLeftover(IERC20 token, address user, uint256 amount) internal virtual {
        token.safeTransfer(user, amount);
    }

    function _computeLayer1Amount(address user, Policy storage p, uint256 debtBase, uint256 targetDebtBase)
        internal
        view
        returns (uint256 amount)
    {
        uint256 priceDebt = IAaveOracle(addressesProvider.getPriceOracle()).getAssetPrice(p.debtAsset);
        uint256 unitDebt = 10 ** IERC20Metadata(p.debtAsset).decimals();
        uint256 debtNeededTokens = ((debtBase - targetDebtBase) * unitDebt + priceDebt - 1) / priceDebt;

        uint256 l1Avail = _min(IERC20(p.debtAsset).balanceOf(user), IERC20(p.debtAsset).allowance(user, address(this)));
        amount = _min(_min(debtNeededTokens, p.maxRepayPerAction), l1Avail);
        amount = _min(amount, (debtBase * unitDebt) / priceDebt);
    }

    function _executeLayer1(address user, Policy storage p, IPool aave) internal returns (uint256 repaid) {
        AccountData memory acc = _getAccountData(user);
        uint256 targetDebtBase = (acc.colBase * acc.liqThresholdBps * WAD) / (BPS * (p.targetHF + TARGET_BUFFER));
        if (acc.debtBase <= targetDebtBase) return 0;

        uint256 amount = _computeLayer1Amount(user, p, acc.debtBase, targetDebtBase);
        if (amount == 0) return 0;

        IERC20 token = IERC20(p.debtAsset);
        token.safeTransferFrom(user, address(this), amount);
        token.forceApprove(address(aave), amount);
        repaid = aave.repay(p.debtAsset, amount, VARIABLE_RATE, user);
        token.forceApprove(address(aave), 0);

        uint256 leftover = token.balanceOf(address(this));
        if (leftover > 0) _refundLeftover(token, user, leftover);

        emit LayerUsed(user, 1, amount, repaid);
    }

    function _getLayer2Available(address user, Layer2Config storage l2) internal view returns (uint256 avail) {
        if (l2.kind == L2_ERC4626) {
            uint256 sharesBal = IERC20(l2.source).balanceOf(user);
            uint256 sharesAllow = IERC20(l2.source).allowance(user, address(this));
            avail = IERC4626(l2.source).previewRedeem(_min(sharesBal, sharesAllow));
        } else if (l2.kind == L2_ATOKEN) {
            uint256 aBal = IERC20(l2.source).balanceOf(user);
            uint256 aAllow = IERC20(l2.source).allowance(user, address(this));
            avail = _min(aBal, aAllow);
        }
    }

    function _computeLayer2Amount(
        address user,
        Policy storage p,
        Layer2Config storage l2,
        uint256 debtBase,
        uint256 targetDebtBase
    ) internal view returns (uint256 amount) {
        uint256 priceDebt = IAaveOracle(addressesProvider.getPriceOracle()).getAssetPrice(p.debtAsset);
        uint256 unitDebt = 10 ** IERC20Metadata(p.debtAsset).decimals();
        uint256 debtNeededTokens = ((debtBase - targetDebtBase) * unitDebt + priceDebt - 1) / priceDebt;

        uint256 availAssets = _getLayer2Available(user, l2);
        amount = _min(_min(debtNeededTokens, l2.maxAssetsPerAction), availAssets);
        amount = _min(amount, (debtBase * unitDebt) / priceDebt);
    }

    function _executeLayer2(address user, Policy storage p, Layer2Config storage l2, IPool aave)
        internal
        returns (uint256 repaid)
    {
        AccountData memory acc = _getAccountData(user);
        uint256 targetDebtBase = (acc.colBase * acc.liqThresholdBps * WAD) / (BPS * (p.targetHF + TARGET_BUFFER));
        if (acc.debtBase <= targetDebtBase) return 0;

        uint256 amount = _computeLayer2Amount(user, p, l2, acc.debtBase, targetDebtBase);
        if (amount == 0) return 0;

        IERC20 debtToken = IERC20(p.debtAsset);
        if (l2.kind == L2_ERC4626) {
            IERC4626(l2.source).withdraw(amount, address(this), user);
        } else if (l2.kind == L2_ATOKEN) {
            IERC20(l2.source).safeTransferFrom(user, address(this), amount);
            aave.withdraw(p.debtAsset, amount, address(this));
        }

        debtToken.forceApprove(address(aave), amount);
        repaid = aave.repay(p.debtAsset, amount, VARIABLE_RATE, user);
        debtToken.forceApprove(address(aave), 0);

        uint256 leftover = debtToken.balanceOf(address(this));
        if (leftover > 0) _refundLeftover(debtToken, user, leftover);

        emit LayerUsed(user, 2, amount, repaid);
    }

    function _executeLayer3(address user, Policy storage p, Layer3Config storage l3, IPool aave)
        internal
        returns (uint256 repaid)
    {
        AccountData memory acc = _getAccountData(user);
        (uint256 collatTokens, uint256 flashLoanPrincipal) =
            _calculateL3Amounts(user, acc.colBase, acc.debtBase, acc.liqThresholdBps, p, l3);

        if (collatTokens == 0 || flashLoanPrincipal == 0) return 0;

        bytes memory params = abi.encode(
            FlashParams({
                user: user,
                collateralAsset: l3.collateralAsset,
                collateralAmount: collatTokens,
                maxSlippageBps: l3.maxSlippageBps
            })
        );
        aave.flashLoanSimple(address(this), p.debtAsset, flashLoanPrincipal, params, 0);

        repaid = _lastL3DebtRepaid;
        _lastL3DebtRepaid = 0;
    }

    struct FlashParams {
        address user;
        address collateralAsset;
        uint256 collateralAmount;
        uint16 maxSlippageBps;
    }

    /// @notice Aave V3 flash loan callback for Layer 3 deleverage.
    /// Ordering is critical:
    ///   1. Repay debt first using flash-loaned asset to raise user's HF.
    ///   2. Transfer user's collateral aToken to Guardian (succeeds because HF is now safe).
    ///   3. Withdraw collateral from Aave pool.
    ///   4. Swap collateral for debtAsset on swapRouter.
    ///   5. Approve Aave pool for total flash loan repayment (amount + premium).
    ///   6. Use remaining swap output to repay more debt or refund user.
    function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params)
        external
        override
        returns (bool)
    {
        if (msg.sender != address(pool())) revert Unauthorized();
        if (initiator != address(this)) revert Unauthorized();

        FlashParams memory fp = abi.decode(params, (FlashParams));
        uint256 repaid = _executeFlashOperation(asset, amount, premium, fp);

        emit LayerUsed(fp.user, 3, fp.collateralAmount, repaid);
        _lastL3DebtRepaid = repaid;
        return true;
    }

    function _executeFlashOperation(address asset, uint256 amount, uint256 premium, FlashParams memory fp)
        internal
        returns (uint256 repaid)
    {
        IPool aave = pool();
        IERC20 debtToken = IERC20(asset);

        // 1. Repay user debt first to raise user HF
        debtToken.forceApprove(address(aave), amount);
        repaid = aave.repay(asset, amount, VARIABLE_RATE, fp.user);
        debtToken.forceApprove(address(aave), 0);

        // 2. Pull collateral aToken from user after debt repayment
        address aCollateral = _getATokenAddress(aave, fp.collateralAsset);
        if (aCollateral == address(0)) {
            aCollateral = aave.getReserveData(fp.collateralAsset).aTokenAddress;
        }
        IERC20(aCollateral).safeTransferFrom(fp.user, address(this), fp.collateralAmount);

        // 3. Withdraw collateral from Aave pool
        aave.withdraw(fp.collateralAsset, fp.collateralAmount, address(this));

        // 4. Swap collateral for debtAsset on swapRouter
        uint256 amountOut = _swapCollateral(fp.collateralAsset, asset, fp.collateralAmount, fp.maxSlippageBps);

        // 5. Verify swap output covers flash loan repayment
        uint256 totalOwed = amount + premium;
        if (amountOut < totalOwed) {
            revert InsufficientSwapOutput(amountOut, totalOwed);
        }

        // 6. Excess proceeds repay remaining debt or refund user
        uint256 excess = amountOut - totalOwed;
        repaid += _handleSwapExcess(fp.user, asset, excess, aave);

        // 7. Approve Aave pool for flash loan repayment (amount + premium)
        debtToken.forceApprove(address(aave), totalOwed);

        // Return leftover debt tokens above totalOwed to user
        uint256 currentBal = debtToken.balanceOf(address(this));
        if (currentBal > totalOwed) {
            _refundLeftover(debtToken, fp.user, currentBal - totalOwed);
        }

        // Return leftover collateral tokens to user
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
        ISwapRouter02.ExactInputSingleParams memory swapParams = ISwapRouter02.ExactInputSingleParams({
            tokenIn: collateralAsset,
            tokenOut: debtAsset,
            fee: swapFee,
            recipient: address(this),
            amountIn: collateralAmount,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        });
        amountOut = swapRouter.exactInputSingle(swapParams);
        IERC20(collateralAsset).forceApprove(address(swapRouter), 0);
    }

    function _handleSwapExcess(address user, address asset, uint256 excess, IPool aave)
        internal
        returns (uint256 extraRepaid)
    {
        if (excess > 0) {
            (, uint256 remainingDebtBase,,,,) = aave.getUserAccountData(user);
            if (remainingDebtBase > 0) {
                IERC20(asset).forceApprove(address(aave), excess);
                extraRepaid = aave.repay(asset, excess, VARIABLE_RATE, user);
                IERC20(asset).forceApprove(address(aave), 0);
            }
        }
    }

    // ─── Chainlink Automation ────────────────────────────────────────────────

    /// @param checkData abi-encoded (offset, limit) of user registry page
    function checkUpkeep(bytes calldata checkData) external view returns (bool upkeepNeeded, bytes memory performData) {
        uint256 offset = 0;
        uint256 limit = _users.length;
        if (checkData.length >= 64) {
            (offset, limit) = abi.decode(checkData, (uint256, uint256));
        }
        address[] memory page = usersPage(offset, limit);
        for (uint256 i = 0; i < page.length; ++i) {
            address u = page[i];
            if (needsProtection(u)) {
                QuoteResult memory q = _quoteProtectInternal(u);
                if (q.l1Repay > 0 || q.l2Repay > 0 || q.l3Repay > 0) {
                    return (true, abi.encode(u));
                }
            }
        }
        return (false, "");
    }

    function performUpkeep(bytes calldata performData) external {
        address user = abi.decode(performData, (address));
        protect(user);
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
