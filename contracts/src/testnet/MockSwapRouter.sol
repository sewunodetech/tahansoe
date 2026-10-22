// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter02} from "../interfaces/ISwapRouter02.sol";
import {IAaveOracle} from "../interfaces/IAave.sol";

/// @title MockSwapRouter
/// @notice SwapRouter02-compatible mock that prices swaps using the Aave oracle
/// with a fixed spread configured at construction. Pays out from its own balance.
contract MockSwapRouter is ISwapRouter02 {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    IAaveOracle public immutable oracle;
    uint16 public immutable spreadBps;

    error TooLittleReceived(uint256 received, uint256 minExpected);
    error InvalidOracle();
    error InvalidSpread();

    constructor(address oracle_, uint16 spreadBps_) {
        if (oracle_ == address(0)) revert InvalidOracle();
        if (spreadBps_ > BPS) revert InvalidSpread();
        oracle = IAaveOracle(oracle_);
        spreadBps = spreadBps_;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        uint256 priceIn = oracle.getAssetPrice(params.tokenIn);
        uint256 priceOut = oracle.getAssetPrice(params.tokenOut);
        uint8 decIn = IERC20Metadata(params.tokenIn).decimals();
        uint8 decOut = IERC20Metadata(params.tokenOut).decimals();

        // Calculate amountOut from oracle prices:
        // amountOutRaw = (amountIn * priceIn * 10^decOut) / (priceOut * 10^decIn)
        uint256 amountOutRaw = (params.amountIn * priceIn * (10 ** decOut)) / (priceOut * (10 ** decIn));
        amountOut = (amountOutRaw * (BPS - spreadBps)) / BPS;

        if (amountOut < params.amountOutMinimum) {
            revert TooLittleReceived(amountOut, params.amountOutMinimum);
        }

        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);
    }
}
