// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal Aave V3 surface used by Tahansoe.
interface IPoolAddressesProvider {
    function getPool() external view returns (address);
    function getPriceOracle() external view returns (address);
}

struct ReserveConfigurationMap {
    uint256 data;
}

struct ReserveData {
    ReserveConfigurationMap configuration;
    uint128 liquidityIndex;
    uint128 currentLiquidityRate;
    uint128 variableBorrowIndex;
    uint128 currentVariableBorrowRate;
    uint128 currentStableBorrowRate;
    uint40 lastUpdateTimestamp;
    uint16 id;
    address aTokenAddress;
    address stableDebtTokenAddress;
    address variableDebtTokenAddress;
    address interestRateStrategyAddress;
    uint128 accruedToTreasury;
    uint128 unbacked;
    uint128 isolationModeTotalDebt;
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

    function withdraw(address asset, uint256 amount, address to) external returns (uint256);

    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;

    function getReserveData(address asset) external view returns (ReserveData memory);

    function FLASHLOAN_PREMIUM_TOTAL() external view returns (uint128);
}

interface IAaveOracle {
    /// @return price of one whole token in the base currency (USD, 8 decimals on Aave V3)
    function getAssetPrice(address asset) external view returns (uint256);
}

interface IFlashLoanSimpleReceiver {
    function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params)
        external
        returns (bool);
}

interface IAToken {
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}
