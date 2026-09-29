// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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

/// @dev Tracks collateral/debt in base currency (8 decimals) and computes HF like Aave.
contract MockPool {
    struct Account {
        uint256 collateralBase;
        uint256 debtBase;
        uint256 liqThresholdBps;
    }

    MockOracle public immutable oracle;
    mapping(address => Account) public accounts;

    constructor(MockOracle o) {
        oracle = o;
    }

    function setAccount(address user, uint256 collateralBase, uint256 debtBase, uint256 ltBps) external {
        accounts[user] = Account(collateralBase, debtBase, ltBps);
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
        IERC20(asset).transferFrom(msg.sender, address(this), paid);
        uint256 paidBase = (paid * price) / unit;
        a.debtBase = paidBase >= a.debtBase ? 0 : a.debtBase - paidBase;
    }
}

contract MockProvider {
    address public getPool;
    address public getPriceOracle;

    constructor(address pool_, address oracle_) {
        getPool = pool_;
        getPriceOracle = oracle_;
    }
}
