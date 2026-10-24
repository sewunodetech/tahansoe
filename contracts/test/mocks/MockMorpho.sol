// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    IMorpho,
    IMorphoOracle,
    IMorphoIrm,
    MarketParams,
    Position,
    Market
} from "../../src/interfaces/IMorpho.sol";

contract MockMorphoOracle is IMorphoOracle {
    uint256 public priceValue;

    constructor(uint256 initialPrice) {
        priceValue = initialPrice;
    }

    function setPrice(uint256 newPrice) external {
        priceValue = newPrice;
    }

    function price() external view override returns (uint256) {
        return priceValue;
    }
}

contract MockMorphoIrm is IMorphoIrm {
    uint256 public borrowRate;

    function setBorrowRate(uint256 rate) external {
        borrowRate = rate;
    }

    function borrowRateView(MarketParams memory, Market memory) external view override returns (uint256) {
        return borrowRate;
    }
}

contract MockMorpho is IMorpho {
    using SafeERC20 for IERC20;

    mapping(bytes32 => MarketParams) public marketParamsMap;
    mapping(bytes32 => Market) public marketMap;
    mapping(bytes32 => mapping(address => Position)) public positionMap;

    bool public accrueInterestCalled;
    bool public repayCalled;

    // Track forbidden selector calls
    bool public forbiddenCallAttempted;

    error ForbiddenCall(bytes4 selector);

    function setMarketParams(bytes32 id, MarketParams memory mp) external {
        marketParamsMap[id] = mp;
    }

    function setMarket(bytes32 id, Market memory m) external {
        marketMap[id] = m;
    }

    function setPosition(bytes32 id, address user, Position memory p) external {
        positionMap[id][user] = p;
    }

    function idToMarketParams(bytes32 id) external view override returns (MarketParams memory) {
        return marketParamsMap[id];
    }

    function position(bytes32 id, address user) external view override returns (Position memory) {
        return positionMap[id][user];
    }

    function market(bytes32 id) external view override returns (Market memory) {
        return marketMap[id];
    }

    function accrueInterest(MarketParams memory mp) external override {
        bytes32 id = keccak256(abi.encode(mp));
        accrueInterestCalled = true;
        marketMap[id].lastUpdate = uint128(block.timestamp);
    }

    function repay(
        MarketParams memory mp,
        uint256 assets,
        uint256 /* shares */,
        address onBehalf,
        bytes memory
    ) external override returns (uint256 assetsRepaid, uint256 sharesRepaid) {
        bytes32 id = keccak256(abi.encode(mp));
        repayCalled = true;

        Position storage pos = positionMap[id][onBehalf];
        Market storage m = marketMap[id];

        // Pull loan tokens from caller
        IERC20(mp.loanToken).safeTransferFrom(msg.sender, address(this), assets);

        // Compute shares repaid: mulDivDown(assets, totalBorrowShares + 1e6, totalBorrowAssets + 1)
        uint256 totalAssets = uint256(m.totalBorrowAssets);
        uint256 totalShares = uint256(m.totalBorrowShares);
        sharesRepaid = (assets * (totalShares + 1e6)) / (totalAssets + 1);
        if (sharesRepaid > pos.borrowShares) {
            sharesRepaid = pos.borrowShares;
        }

        pos.borrowShares -= uint128(sharesRepaid);
        m.totalBorrowShares -= uint128(sharesRepaid);
        if (assets > m.totalBorrowAssets) {
            m.totalBorrowAssets = 0;
        } else {
            m.totalBorrowAssets -= uint128(assets);
        }

        assetsRepaid = assets;
    }

    // ─── Forbidden Selectors (must NEVER be called by Guardian) ─────────────

    function borrow(MarketParams memory, uint256, uint256, address, address) external returns (uint256, uint256) {
        forbiddenCallAttempted = true;
        revert ForbiddenCall(msg.sig);
    }

    function withdraw(MarketParams memory, uint256, uint256, address, address) external returns (uint256, uint256) {
        forbiddenCallAttempted = true;
        revert ForbiddenCall(msg.sig);
    }

    function withdrawCollateral(MarketParams memory, uint256, address, address) external {
        forbiddenCallAttempted = true;
        revert ForbiddenCall(msg.sig);
    }

    function setAuthorization(address, bool) external {
        forbiddenCallAttempted = true;
        revert ForbiddenCall(msg.sig);
    }
}
