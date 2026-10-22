// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    IPoolAddressesProvider,
    IPool,
    ReserveData,
    ReserveConfigurationMap,
    IFlashLoanSimpleReceiver,
    IAToken
} from "../../src/interfaces/IAave.sol";

contract MockToken is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory name, uint8 dec) ERC20(name, name) {
        _dec = dec;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockOracle {
    mapping(address => uint256) public getAssetPrice;

    function setPrice(address asset, uint256 price) external {
        getAssetPrice[asset] = price;
    }
}

contract MockAToken is ERC20, IAToken {
    using SafeERC20 for IERC20;

    address public immutable underlying;
    MockPool public pool;

    constructor(string memory name, address underlying_) ERC20(name, name) {
        underlying = underlying_;
    }

    function setPool(MockPool pool_) external {
        pool = pool_;
    }

    function UNDERLYING_ASSET_ADDRESS() external view override returns (address) {
        return underlying;
    }

    function decimals() public view override returns (uint8) {
        return MockToken(underlying).decimals();
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (address(pool) != address(0) && from != address(pool)) {
            (,,,,, uint256 hf) = pool.getUserAccountData(from);
            // In Aave V3, if health factor drops below 1, transfer reverts
            require(hf >= 1e18, "Aave: transfer not allowed below HF 1.0");
        }
        return super.transferFrom(from, to, amount);
    }
}

/// @dev Tracks collateral/debt in base currency (8 decimals) and computes HF like Aave.
contract MockPool {
    using SafeERC20 for IERC20;

    struct Account {
        uint256 collateralBase;
        uint256 debtBase;
        uint256 liqThresholdBps;
    }

    MockOracle public immutable oracle;
    mapping(address => Account) public accounts;
    mapping(address => address) public aTokens;
    mapping(address => uint256) public assetLT;

    constructor(MockOracle o) {
        oracle = o;
    }

    function setAccount(address user, uint256 collateralBase, uint256 debtBase, uint256 ltBps) external {
        accounts[user] = Account(collateralBase, debtBase, ltBps);
    }

    function setReserve(address asset, address aTokenAddress, uint256 ltBps) external {
        aTokens[asset] = aTokenAddress;
        assetLT[asset] = ltBps;
    }

    function getReserveData(address asset) external view returns (ReserveData memory r) {
        r.aTokenAddress = aTokens[asset];
        r.configuration.data = (assetLT[asset] << 16);
    }

    function FLASHLOAN_PREMIUM_TOTAL() external pure returns (uint128) {
        return 5; // 5 bps (0.05%)
    }

    function getUserAccountData(address user)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, uint256 hf)
    {
        Account memory a = accounts[user];
        hf = a.debtBase == 0 ? type(uint256).max : (a.collateralBase * a.liqThresholdBps * 1e18) / (1e4 * a.debtBase);
        return (a.collateralBase, a.debtBase, 0, a.liqThresholdBps, 0, hf);
    }

    function repay(address asset, uint256 amount, uint256, address onBehalfOf) external returns (uint256 paid) {
        Account storage a = accounts[onBehalfOf];
        uint256 unit = 10 ** ERC20(asset).decimals();
        uint256 price = oracle.getAssetPrice(asset);
        uint256 debtInAsset = (a.debtBase * unit) / price;
        paid = amount > debtInAsset ? debtInAsset : amount;
        IERC20(asset).safeTransferFrom(msg.sender, address(this), paid);
        uint256 paidBase = (paid * price) / unit;
        a.debtBase = paidBase >= a.debtBase ? 0 : a.debtBase - paidBase;
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        address aToken = aTokens[asset];
        if (aToken != address(0)) {
            MockAToken(aToken).burn(msg.sender, amount);
        }
        IERC20(asset).safeTransfer(to, amount);
        return amount;
    }

    function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes calldata params, uint16)
        external
    {
        uint256 premium = (amount * 5) / 10_000;
        MockToken(asset).mint(receiverAddress, amount);

        bool success =
            IFlashLoanSimpleReceiver(receiverAddress).executeOperation(asset, amount, premium, msg.sender, params);
        require(success, "flashloan failed");

        IERC20(asset).safeTransferFrom(receiverAddress, address(this), amount + premium);
    }
}

contract MockProvider is IPoolAddressesProvider {
    address private immutable _pool;
    address private immutable _oracle;

    constructor(address pool_, address oracle_) {
        _pool = pool_;
        _oracle = oracle_;
    }

    function getPool() external view override returns (address) {
        return _pool;
    }

    function getPriceOracle() external view override returns (address) {
        return _oracle;
    }
}
