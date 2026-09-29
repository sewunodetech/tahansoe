// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal Aave V3 surface used by Tahansoe.
interface IPoolAddressesProvider {
    function getPool() external view returns (address);
    function getPriceOracle() external view returns (address);
}

interface IPool {
    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );

    function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf)
        external
        returns (uint256);
}

interface IAaveOracle {
    /// @return price of one whole token in the base currency (USD, 8 decimals on Aave V3)
    function getAssetPrice(address asset) external view returns (uint256);
}
