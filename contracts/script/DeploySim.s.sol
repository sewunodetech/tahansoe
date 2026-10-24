// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TahansoeGuardianV3} from "../src/TahansoeGuardianV3.sol";
import {SimPriceFeed} from "../src/testnet/SimPriceFeed.sol";
import {TestVault} from "../src/testnet/TestVault.sol";
import {IPoolAddressesProvider, IAaveOracle} from "../src/interfaces/IAave.sol";

interface IAaveOracleAdmin {
    function getSourceOfAsset(address asset) external view returns (address);
    function setAssetSources(address[] calldata assets, address[] calldata sources) external;
}

interface IACLManager {
    function isPoolAdmin(address admin) external view returns (bool);
    function isAssetListingAdmin(address admin) external view returns (bool);
}

interface IPoolAddressesProviderACL {
    function getACLManager() external view returns (address);
}

/// @notice Deploys the simulation stack on an anvil fork of Arbitrum One (ADR 0014, spec m1-simulation-mode
/// §3.2-3.3). SIMULATION FORKS ONLY: it refuses to run unless block.chainid == SIM_CHAIN_ID (default
/// 4216199), and the oracle switch only works on a fork where the Aave admin is impersonated.
///
/// Deploys, from the deployer (nonce 0 -> deterministic addresses):
///   nonce 0  SimPriceFeed  (initial answer = current AaveOracle WETH price, updater = SIM_PRICE_UPDATER)
///   nonce 1  TahansoeGuardianV3 (real PoolAddressesProvider, Uniswap SwapRouter02, fee tier 500, SIM_TREASURY)
///   nonce 2  TestVault over native USDC (unless SIM_DEPLOY_TEST_VAULT=false)
/// Then, from SIM_ORACLE_ADMIN (POOL_ADMIN or ASSET_LISTING_ADMIN on Aave's ACLManager), calls
/// AaveOracle.setAssetSources([WETH], [SimPriceFeed]). Aave and the Guardian keep reading the AaveOracle (I5).
///
/// Exact sequence (anvil default account 0 as deployer, Aave governance executor as oracle admin):
///   anvil --fork-url $ARB_ONE_RPC_URL --chain-id 4216199
///   DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
///   ADMIN=0xFF1137243698CaA18EE364Cc966CF0e02A4e6327
///   cast rpc anvil_setNonce $DEPLOYER 0x0                      # same addresses on every fork
///   cast rpc anvil_impersonateAccount $ADMIN
///   cast rpc anvil_setBalance $ADMIN 0x56BC75E2D63100000        # 100 ETH for gas
///   forge script script/DeploySim.s.sol --rpc-url http://127.0.0.1:8545 \
///     --unlocked --sender $DEPLOYER --broadcast
///   cast rpc anvil_stopImpersonatingAccount $ADMIN
///
/// Output: one line `SIM_DEPLOYMENT {json}` for apps/simnet to parse.
contract DeploySim is Script {
    address constant AAVE_V3_PROVIDER_ARB_ONE = 0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb;
    address constant SWAP_ROUTER02_ARB_ONE = 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45;
    address constant WETH_ARB_ONE = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;
    address constant USDC_ARB_ONE = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    /// Aave governance executor on Arbitrum One; holds POOL_ADMIN (checked on-chain 2026-10-24).
    address constant AAVE_EXECUTOR_ARB_ONE = 0xFF1137243698CaA18EE364Cc966CF0e02A4e6327;
    uint24 constant SWAP_FEE = 500; // 0.05%
    uint256 constant DEFAULT_SIM_CHAIN_ID = 4216199;
    uint256 constant ARBITRUM_ONE_CHAIN_ID = 42161;

    struct Config {
        address deployer;
        address oracleAdmin;
        address treasury;
        address priceUpdater;
        bool deployTestVault;
    }

    struct Deployment {
        address guardianV3;
        address simPriceFeed;
        address testVault;
        address treasury;
        address priceUpdater;
        address aaveOracle;
        address previousWethSource;
        uint256 initialPrice;
    }

    function run() external returns (Deployment memory d) {
        uint256 simChainId = vm.envOr("SIM_CHAIN_ID", DEFAULT_SIM_CHAIN_ID);
        require(simChainId != ARBITRUM_ONE_CHAIN_ID, "DeploySim: SIM_CHAIN_ID must not be Arbitrum One");
        require(block.chainid == simChainId, "DeploySim: block.chainid != SIM_CHAIN_ID");

        address deployer = msg.sender;
        Config memory cfg = Config({
            deployer: deployer,
            oracleAdmin: vm.envOr("SIM_ORACLE_ADMIN", AAVE_EXECUTOR_ARB_ONE),
            treasury: vm.envOr("SIM_TREASURY", deployer),
            priceUpdater: vm.envOr("SIM_PRICE_UPDATER", deployer),
            deployTestVault: vm.envOr("SIM_DEPLOY_TEST_VAULT", true)
        });

        d = deploy(cfg);
        console.log(string.concat("SIM_DEPLOYMENT ", toJson(d)));
    }

    function deploy(Config memory cfg) public returns (Deployment memory d) {
        IPoolAddressesProvider provider = IPoolAddressesProvider(AAVE_V3_PROVIDER_ARB_ONE);
        d.aaveOracle = provider.getPriceOracle();
        d.previousWethSource = IAaveOracleAdmin(d.aaveOracle).getSourceOfAsset(WETH_ARB_ONE);
        d.initialPrice = IAaveOracle(d.aaveOracle).getAssetPrice(WETH_ARB_ONE);
        d.treasury = cfg.treasury;
        d.priceUpdater = cfg.priceUpdater;

        IACLManager acl = IACLManager(IPoolAddressesProviderACL(AAVE_V3_PROVIDER_ARB_ONE).getACLManager());
        require(
            acl.isPoolAdmin(cfg.oracleAdmin) || acl.isAssetListingAdmin(cfg.oracleAdmin),
            "DeploySim: SIM_ORACLE_ADMIN lacks POOL_ADMIN/ASSET_LISTING_ADMIN"
        );

        vm.startBroadcast(cfg.deployer);
        d.simPriceFeed = address(new SimPriceFeed(cfg.priceUpdater, int256(d.initialPrice), "WETH / USD (sim)"));
        d.guardianV3 = address(new TahansoeGuardianV3(provider, SWAP_ROUTER02_ARB_ONE, SWAP_FEE, cfg.treasury));
        if (cfg.deployTestVault) {
            d.testVault = address(new TestVault(IERC20(USDC_ARB_ONE), "Tahansoe Sim USDC Vault", "vUSDC"));
        }
        vm.stopBroadcast();

        address[] memory assets = new address[](1);
        address[] memory sources = new address[](1);
        assets[0] = WETH_ARB_ONE;
        sources[0] = d.simPriceFeed;
        vm.startBroadcast(cfg.oracleAdmin);
        IAaveOracleAdmin(d.aaveOracle).setAssetSources(assets, sources);
        vm.stopBroadcast();

        require(
            IAaveOracle(d.aaveOracle).getAssetPrice(WETH_ARB_ONE) == d.initialPrice, "DeploySim: oracle switch failed"
        );
    }

    function toJson(Deployment memory d) public returns (string memory) {
        string memory k = "sim";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "poolAddressesProvider", AAVE_V3_PROVIDER_ARB_ONE);
        vm.serializeAddress(k, "swapRouter", SWAP_ROUTER02_ARB_ONE);
        vm.serializeUint(k, "swapFee", SWAP_FEE);
        vm.serializeAddress(k, "weth", WETH_ARB_ONE);
        vm.serializeAddress(k, "usdc", USDC_ARB_ONE);
        vm.serializeAddress(k, "guardianV3", d.guardianV3);
        vm.serializeAddress(k, "simPriceFeed", d.simPriceFeed);
        vm.serializeAddress(k, "testVault", d.testVault);
        vm.serializeAddress(k, "treasury", d.treasury);
        vm.serializeAddress(k, "priceUpdater", d.priceUpdater);
        vm.serializeAddress(k, "aaveOracle", d.aaveOracle);
        vm.serializeAddress(k, "previousWethSource", d.previousWethSource);
        return vm.serializeUint(k, "initialPrice", d.initialPrice);
    }
}
