// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title GuardianCore
/// @notice Shared constants, data structures, fee math, trigger validation, and invariant checks
/// for Tahansoe Guardian v4 contracts (TahansoeGuardianAaveV4 and TahansoeGuardianMorpho).
library GuardianCore {
    uint256 internal constant SUCCESS_FEE_BPS = 15; // 0.15% (ADR 0013)
    uint256 internal constant FEE_HF_CEILING = 1.5e18; // 1.50 in WAD
    uint256 internal constant FEE_BPS_DENOMINATOR = 10_000;

    uint256 internal constant MIN_TRIGGER_HF = 1.05e18;
    uint256 internal constant MAX_TARGET_HF = 3e18;
    uint256 internal constant TARGET_BUFFER = 1e14; // 0.0001 WAD buffer above targetHF

    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    struct Policy {
        bool enabled;
        uint256 triggerHF; // WAD
        uint256 targetHF; // WAD
        uint256 maxRepayPerAction;
    }

    struct TriggerBand {
        uint256 minTriggerHF;
        uint256 maxTriggerHF;
        address riskAgent;
        uint256 dynamicTriggerHF;
        uint64 validUntil;
    }

    error InvalidTreasury();
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
    error RemainingBalance();
    error InvalidSource();
    error InvalidCollateral();
    error InvalidDebtPriority();
    error InvalidMarket();

    /// @notice Validates policy parameters when creating or updating a position policy.
    function validatePolicy(
        uint256 triggerHF,
        uint256 targetHF,
        uint256 maxRepayPerAction,
        TriggerBand storage band
    ) internal view {
        if (triggerHF < MIN_TRIGGER_HF || targetHF <= triggerHF || targetHF > MAX_TARGET_HF || maxRepayPerAction == 0) {
            revert InvalidPolicy();
        }
        if (band.riskAgent != address(0) && band.maxTriggerHF >= targetHF) {
            revert InvalidPolicy();
        }
    }

    /// @notice Validates and updates a user's trigger band for a position.
    function setTriggerBand(
        TriggerBand storage band,
        uint256 minTriggerHF,
        uint256 maxTriggerHF,
        address riskAgent,
        uint256 targetHF,
        bool policyEnabled
    ) internal {
        if (riskAgent == address(0)) {
            band.minTriggerHF = 0;
            band.maxTriggerHF = 0;
            band.riskAgent = address(0);
            band.dynamicTriggerHF = 0;
            band.validUntil = 0;
            return;
        }

        if (minTriggerHF < MIN_TRIGGER_HF || minTriggerHF > maxTriggerHF || maxTriggerHF > MAX_TARGET_HF) {
            revert InvalidBand();
        }

        if (policyEnabled && maxTriggerHF >= targetHF) {
            revert InvalidBand();
        }

        band.minTriggerHF = minTriggerHF;
        band.maxTriggerHF = maxTriggerHF;
        band.riskAgent = riskAgent;
        if (band.dynamicTriggerHF < minTriggerHF || band.dynamicTriggerHF > maxTriggerHF) {
            band.dynamicTriggerHF = 0;
            band.validUntil = 0;
        }
    }

    /// @notice Validates and applies dynamic trigger set by authorized risk agent.
    function setDynamicTrigger(
        TriggerBand storage band,
        uint256 triggerHF,
        uint64 validUntil,
        uint256 targetHF,
        bool policyEnabled
    ) internal {
        if (msg.sender != band.riskAgent || band.riskAgent == address(0)) revert Unauthorized();
        if (triggerHF < band.minTriggerHF || triggerHF > band.maxTriggerHF) revert InvalidTrigger();
        if (validUntil <= block.timestamp) revert InvalidExpiry();
        if (policyEnabled && triggerHF >= targetHF) revert InvalidTrigger();

        band.dynamicTriggerHF = triggerHF;
        band.validUntil = validUntil;
    }

    /// @notice Returns dynamic trigger if valid and active, else static policy trigger.
    function effectiveTrigger(TriggerBand storage band, uint256 staticTriggerHF)
        internal
        view
        returns (uint256)
    {
        if (
            band.riskAgent != address(0) && block.timestamp <= band.validUntil
                && band.dynamicTriggerHF >= band.minTriggerHF && band.dynamicTriggerHF <= band.maxTriggerHF
        ) {
            return band.dynamicTriggerHF;
        }
        return staticTriggerHF;
    }

    /// @notice Checks if rescue is eligible for success fee per ADR 0013.
    /// @dev Eligible only if HF before rescue is strictly below user's static trigger AND below FEE_HF_CEILING (1.50).
    function isFeeEligible(uint256 hfBefore, uint256 staticTriggerHF) internal pure returns (bool) {
        return hfBefore < staticTriggerHF && hfBefore < FEE_HF_CEILING;
    }

    /// @notice Calculates success fee from repaid debt: floor(repaid * 15 / 10_000).
    function calculateFee(uint256 repaid) internal pure returns (uint256) {
        return (repaid * SUCCESS_FEE_BPS) / FEE_BPS_DENOMINATOR;
    }

    /// @notice Charges fee from Guardian leftover (Source A), then user wallet (Source B).
    /// @dev Never reverts on transfer failure; uncollected portion is waived.
    function chargeFee(IERC20 token, address user, address treasury, uint256 fee)
        internal
        returns (uint256 charged, uint256 waived)
    {
        if (fee == 0) return (0, 0);

        // Source A: tokens already in Guardian for this call
        uint256 fromGuardian = min(fee, token.balanceOf(address(this)));
        if (fromGuardian > 0 && !tryCall(token, abi.encodeCall(IERC20.transfer, (treasury, fromGuardian)))) {
            fromGuardian = 0;
        }

        // Source B: user wallet within remaining debt-token allowance, straight to treasury
        uint256 remFee = fee - fromGuardian;
        uint256 userBal = token.balanceOf(user);
        uint256 userAllow = token.allowance(user, address(this));
        uint256 fromWallet = min(remFee, min(userBal, userAllow));
        if (fromWallet > 0 && !tryCall(token, abi.encodeCall(IERC20.transferFrom, (user, treasury, fromWallet)))) {
            fromWallet = 0;
        }

        charged = fromGuardian + fromWallet;
        waived = fee - charged;
    }

    /// @notice Safe call helper reporting success/failure without reverting.
    function tryCall(IERC20 token, bytes memory data) internal returns (bool) {
        (bool ok, bytes memory ret) = address(token).call(data);
        if (!ok) return false;
        if (ret.length == 0) return address(token).code.length > 0;
        // forge-lint: disable-next-line(unsafe-typecast)
        return ret.length == 32 && uint256(bytes32(ret)) == 1;
    }

    /// @notice Asserts health factor strictly improved after protection.
    function checkHealthFactorImproved(uint256 hfBefore, uint256 hfAfter) internal pure {
        if (hfAfter <= hfBefore) revert HealthFactorNotImproved(hfBefore, hfAfter);
    }

    /// @notice Asserts Guardian holds zero balance of the specified token.
    function checkGuardianBalanceZero(IERC20 token) internal view {
        if (token.balanceOf(address(this)) != 0) revert RemainingBalance();
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
