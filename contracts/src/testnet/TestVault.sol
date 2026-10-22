// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title TestVault
/// @notice OpenZeppelin ERC-4626 vault wrapper over an underlying token for testing.
contract TestVault is ERC4626 {
    constructor(IERC20 asset_, string memory name_, string memory symbol_) ERC4626(asset_) ERC20(name_, symbol_) {}
}
