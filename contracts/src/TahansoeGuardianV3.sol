// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TahansoeGuardianV2} from "./TahansoeGuardianV2.sol";
import {IPoolAddressesProvider} from "./interfaces/IAave.sol";

/// @title TahansoeGuardianV3
/// @notice TahansoeGuardianV2 plus a fixed 0.15% success fee (ADR 0013, spec m4-guardian-success-fee).
///
/// The fee is charged only on a real rescue: hfBefore below the user's STATIC policy trigger and below
/// FEE_HF_CEILING. Actions that run only because the risk agent raised the dynamic trigger are free.
/// Repayment is sized exactly as in V2; the fee is computed afterwards from `totalRepaid` and taken from:
///   A. debt tokens left over in the Guardian during this call (which V2 would refund to the user), then
///   B. the user's wallet, within the remaining debt-asset allowance, sent straight to `treasury`.
/// Anything still missing is waived. The fee never pulls extra from L2/L3 and never reverts protect().
///
/// Invariant: besides the V2 flows, the only new transfer is debt asset -> immutable `treasury`, bounded
/// by SUCCESS_FEE_BPS of the amount repaid in the same call. No owner, admin, or upgrade path.
contract TahansoeGuardianV3 is TahansoeGuardianV2 {
    uint256 public constant SUCCESS_FEE_BPS = 15; // 0.15%
    uint256 public constant FEE_HF_CEILING = 1.5e18; // WAD

    uint256 private constant FEE_BPS_DENOMINATOR = 10_000;

    address public immutable treasury;

    event FeeCharged(address indexed user, address indexed debtAsset, uint256 amount, uint256 waived);

    error InvalidTreasury();

    constructor(IPoolAddressesProvider provider, address swapRouter_, uint24 swapFee_, address treasury_)
        TahansoeGuardianV2(provider, swapRouter_, swapFee_)
    {
        if (treasury_ == address(0)) revert InvalidTreasury();
        treasury = treasury_;
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice Estimated success fee if protect(user) ran now. The final amount is in FeeCharged.
    /// @return eligible true when protect would run and HF is below the static trigger and the ceiling
    /// @return fee floor(projected repay * SUCCESS_FEE_BPS / 10_000), before any waiver
    function quoteFee(address user) external view returns (bool eligible, uint256 fee) {
        if (!needsProtection(user)) return (false, 0);
        eligible = _isFeeEligible(user, healthFactor(user));
        if (!eligible) return (false, 0);
        QuoteResult memory q = _quoteProtectInternal(user);
        fee = _feeFor(q.l1Repay + q.l2Repay + q.l3Repay);
    }

    // ─── Fee ─────────────────────────────────────────────────────────────────

    function _isFeeEligible(address user, uint256 hfBefore) internal view returns (bool) {
        return hfBefore < policies[user].triggerHF && hfBefore < FEE_HF_CEILING;
    }

    function _feeFor(uint256 repaid) internal pure returns (uint256) {
        return (repaid * SUCCESS_FEE_BPS) / FEE_BPS_DENOMINATOR;
    }

    /// @dev Leftover debt tokens stay in the Guardian until _afterLayers so they can fund the fee
    /// (source A). The V2 sweep at the end of protect() refunds the rest to the user in the same call.
    function _refundLeftover(IERC20, address, uint256) internal override {}

    function _afterLayers(address user, address debtAsset, uint256 hfBefore, uint256 totalRepaid) internal override {
        if (totalRepaid == 0 || !_isFeeEligible(user, hfBefore)) return;

        IERC20 token = IERC20(debtAsset);
        uint256 fee = _feeFor(totalRepaid);

        // Source A: tokens already in the Guardian for this call.
        uint256 fromGuardian = _lesser(fee, token.balanceOf(address(this)));
        if (fromGuardian > 0 && !_tryCall(token, abi.encodeCall(IERC20.transfer, (treasury, fromGuardian)))) {
            fromGuardian = 0;
        }

        // Source B: the user's wallet, within the remaining allowance, straight to the treasury.
        uint256 fromWallet =
            _lesser(fee - fromGuardian, _lesser(token.balanceOf(user), token.allowance(user, address(this))));
        if (fromWallet > 0 && !_tryCall(token, abi.encodeCall(IERC20.transferFrom, (user, treasury, fromWallet)))) {
            fromWallet = 0;
        }

        uint256 charged = fromGuardian + fromWallet;
        emit FeeCharged(user, debtAsset, charged, fee - charged);
    }

    /// @dev SafeERC20-style call that reports failure instead of reverting, so the fee can never make
    /// protect() revert (e.g. a paused token or a blocklisted treasury).
    function _tryCall(IERC20 token, bytes memory data) private returns (bool) {
        (bool ok, bytes memory ret) = address(token).call(data);
        if (!ok) return false;
        if (ret.length == 0) return address(token).code.length > 0;
        // forge-lint: disable-next-line(unsafe-typecast)
        return ret.length == 32 && uint256(bytes32(ret)) == 1; // length checked: no truncation
    }

    function _lesser(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
