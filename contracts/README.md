# Tahansoe contracts

`TahansoeGuardian` protects an Aave V3 borrower from liquidation. The user sets a
policy (trigger HF, target HF, debt asset, per-action cap) and approves the
Guardian to spend that asset from their wallet. When Health Factor drops below
the trigger, anyone — a keeper, Chainlink Automation, or the user — can call
`protect(user)`, which repays exactly enough debt to bring HF back to the target.

**Security invariant:** tokens only move from the user's wallet into Aave to
repay that same user's debt; any unused amount is returned. The Guardian has no
owner, no admin functions and holds no funds between calls.

## Guardian V2 (3-Layer Cascade & Dynamic Trigger Bands)

`TahansoeGuardianV2` expands protection into a multi-layer cascade:

1. **Layer 1 (Wallet Hot Reserve):** Pulls debt tokens directly from the user's wallet up to `maxRepayPerAction`.
2. **Layer 2 (Yield-Bearing Reserve):** If still below target HF, pulls either:
   - ERC-4626 vault shares (`L2_ERC4626`), redeeming underlying debt asset, or
   - Aave aTokens of the debt asset (`L2_ATOKEN`), withdrawing from Aave pool.
3. **Layer 3 (Flash Loan Deleverage):** If still below target HF, takes an Aave V3 flash loan of the debt asset:
   - Repays user debt first to unlock collateral health factor.
   - Withdraws user collateral aTokens and sells them via Uniswap V3 `SwapRouter02` (or `MockSwapRouter` on testnet) within `maxSlippageBps`.
   - Repays flash loan (`amount + premium`) and directs any excess to further debt repayment or refunds.
4. **Dynamic Trigger Bands:** Users can authorize a `riskAgent` with a trigger band `[minTriggerHF, maxTriggerHF]`. The agent can adaptively adjust `effectiveTrigger` within bounds before expiration.

## Guardian V3 (success fee, ADR 0013)

`TahansoeGuardianV3` inherits `TahansoeGuardianV2` unchanged and adds a fixed **0.15% success fee**
(spec `docs/specs/m4-guardian-success-fee.md`). No proxy, owner, admin or upgrade path.

- `SUCCESS_FEE_BPS = 15`, `FEE_HF_CEILING = 1.50e18` (constants) and an `immutable`, non-zero `treasury`
  set in the constructor: `new TahansoeGuardianV3(provider, swapRouter, swapFee, treasury)`.
- **Eligible only on a real rescue:** `hfBefore < policies[user].triggerHF` (the user's *static* trigger)
  **and** `hfBefore < 1.50`. Actions caused only by the risk agent's dynamic trigger are free.
- `fee = floor(totalRepaid * 15 / 10_000)`. Repayment is sized exactly as in V2; the fee never reduces it.
- Sources, in order: **A** leftover debt tokens in the Guardian during this call (V3 keeps per-layer
  leftovers until the end of `protect()` instead of refunding them immediately), then **B** the user's
  wallet within the remaining debt-asset allowance, via `transferFrom(user, treasury)`. The remainder is
  waived. The fee never pulls extra from L2/L3 and never reverts `protect()` (failed transfers are waived).
- `FeeCharged(user, debtAsset, amount, waived)` is emitted on every eligible action that repaid something.
- `quoteFee(user) returns (bool eligible, uint256 fee)` estimates the fee for the UI (pre-waiver).
- Suggested L1 allowance = repay cap x 1.0015, so source B can cover the fee.

V2 gained two internal no-op hooks (`_afterLayers`, `_refundLeftover`); its behavior and ABI are unchanged.

## Guardian V4 (Per-Position Policies & Morpho Blue, ADR 0015)

Guardian V4 extends risk protection to independent positions and protocols (spec `docs/specs/m4-guardian-v4-per-position.md`, ADR 0015):

### 1. `TahansoeGuardianAaveV4` (Per-Debt-Asset Policies for Aave V3)
- Multi-debt positions on Aave V3 can configure independent policies per `(user, debtAsset)`.
- Configurable debt asset priority list (`setDebtPriority(address[] calldata debtAssets)`) determines rescue order when multiple debt assets are at risk.
- Each debt asset has its own Layer 1 cap, Layer 2 reserve (ERC-4626 or aToken), Layer 3 deleverage settings (collateral token & max slippage), and dynamic trigger band.
- Calling `protect(user, debtAsset)` rescues the specified debt asset while strictly leaving all other borrowed positions untouched.
- Enumerable user positions through `positionsPage(uint256 offset, uint256 limit)` and `positionCount()`.

### 2. `TahansoeGuardianMorpho` (Morpho Blue Protection)
- Dedicated guardian for isolated Morpho Blue markets identified by `marketId = keccak256(abi.encode(MarketParams))`.
- Policies are configured per `(user, marketId)`.
- Independent Health Factor calculation:
  $$\text{HF} = \frac{\text{collateral} \times \text{oraclePrice} \times \text{lltv}}{10^{36} \times 10^{18} \times \text{borrowedAssets}}$$
- Supports Layer 1 (direct loan token pull from user wallet) and Layer 2 (ERC-4626 vault shares where `asset() == loanToken`).
- Computes exact repayment needed to reach `targetHF` without overspending or relying on flash loans.
- **Strict Morpho Invariant:** Forbidden selectors (`borrow`, `withdraw`, `withdrawCollateral`, `setAuthorization`) are never called by the Guardian under any circumstances.

### 3. Shared `GuardianCore` Library & Fee Model
- Reuses uniform layer ordering, dynamic trigger clamping, and fee accounting across protocol guardians.
- Implements ADR 0013 success fee (15 bps on repaid debt, eligible only if $HF_{\text{before}} < \text{staticTrigger}$ and $HF_{\text{before}} < 1.50\text{e}18$).
- Fee is collected via Source A (leftovers) and Source B (wallet allowance) and waived if insufficient without reverting the rescue.
- Zero-token balance invariant: Guardian never retains debt, collateral, or vault tokens between calls.

## Setup

```bash
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
forge build
```

## Test

```bash
forge test                                   # unit, fuzz, and invariant tests against mocks
ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc \
  forge test --match-contract Fork -vv       # end-to-end on real Aave V3 (Arbitrum Sepolia fork)
ARB_ONE_RPC_URL=https://arb1.arbitrum.io/rpc \
  forge test --match-contract TahansoeGuardianV3ForkTest -vv  # V3 + DeploySim on an Arbitrum One fork
ARB_ONE_RPC_URL=https://arb1.arbitrum.io/rpc \
  forge test --match-contract TahansoeGuardianV4ForkTest -vv  # V4 (Aave multi-debt + Morpho Blue) on Arbitrum One fork
```

The fork test suites cover v1, v2, v3, and v4:
- `TahansoeGuardianForkTest`: opens a real position (1 WETH supplied, USDC borrowed) and verifies v1 L1 repayment.
- `TahansoeGuardianV2ForkTest`: verifies v2 Layer 1 (wallet), Layer 2 (ERC-4626 vault), and Layer 3 (flash-loan deleverage) on Arbitrum Sepolia.
- `TahansoeGuardianV3ForkTest`: deploys through `DeploySim` on Arbitrum One, drives the price via `SimPriceFeed`, and checks the V3 fee and V2 parity for L1 and L3 (real Uniswap `SwapRouter02`).
- `TahansoeGuardianV4ForkTest`: verifies Aave V3 multi-debt isolation (USDC and USDT) and live Morpho Blue position protection on Arbitrum One fork.

Fee acceptance criteria (spec §5) map to named tests in `TahansoeGuardianV3.t.sol` (see the header comment there).

## Invariant Tests

Invariant tests in `TahansoeGuardianV2.invariant.t.sol` run 100,000+ state transitions across multi-user random perturbations and enforce:
- `guardianHoldsZeroTokens`: Guardian balance of debt asset, collateral asset, aTokens, and vault shares is strictly 0 at the end of every transaction.
- Successful `protect()` strictly increases the borrower's Health Factor.
- Per-action caps on every layer are strictly respected.

`TahansoeGuardianV3.invariant.t.sol` adds, with random dynamic triggers and allowances:
- the Guardian still holds zero tokens after every call;
- the treasury never exceeds the sum of `floor(repaid * 15 / 10_000)` over eligible actions;
- non-eligible actions (dynamic-trigger-only, HF >= 1.50) never move tokens to the treasury.

`TahansoeGuardianAaveV4.invariant.t.sol` and `TahansoeGuardianMorpho.invariant.t.sol` verify:
- Guardian balance of debt/loan/collateral tokens and vault shares is strictly zero after every call;
- Morpho Blue never receives calls to forbidden selectors (`borrow`, `withdraw`, `withdrawCollateral`, `setAuthorization`);
- Protocol treasury balance is strictly bounded by cumulative 15 bps success fees on eligible rescues.

## Deploy to Arbitrum Sepolia

1. Get Arbitrum Sepolia ETH from a faucet for your deployer wallet.
2. Import the deployer key into Foundry's encrypted keystore (never paste it into a file):
   ```bash
   cast wallet import tahansoe-deployer --interactive
   ```
3. Deploy V1:
   ```bash
   forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia \
     --account tahansoe-deployer --broadcast --verify
   ```
4. Deploy V2 (Guardian v2, MockSwapRouter, and TestVault):
   ```bash
   forge script script/DeployV2.s.sol --rpc-url arbitrum_sepolia \
     --account tahansoe-deployer --broadcast --verify
   ```

## Simulation fork (anvil, Arbitrum One)

`script/DeploySim.s.sol` deploys the simulation stack on an **anvil fork of Arbitrum One** (ADR 0014,
spec `docs/specs/m1-simulation-mode.md` §3.2-3.3). It reverts unless `block.chainid == SIM_CHAIN_ID`
(default `4216199`), and refuses `SIM_CHAIN_ID=42161`. Never run it against a real network.

It deploys, from the deployer: `SimPriceFeed` (nonce 0, initial answer = current AaveOracle WETH price),
`TahansoeGuardianV3` (nonce 1; real PoolAddressesProvider `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb`,
Uniswap `SwapRouter02` `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45`, fee tier 500) and optionally
`TestVault` over native USDC (nonce 2). Then, from an account holding `POOL_ADMIN` or
`ASSET_LISTING_ADMIN` on Aave's ACLManager, it calls `AaveOracle.setAssetSources([WETH], [SimPriceFeed])`.
Aave and the Guardian still read the AaveOracle (I5); only its WETH source changes.

| Env | Default | Meaning |
|---|---|---|
| `SIM_CHAIN_ID` | `4216199` | Required `block.chainid` |
| `SIM_TREASURY` | deployer | Guardian V3 treasury |
| `SIM_PRICE_UPDATER` | deployer | Only address allowed to call `SimPriceFeed.setAnswer` |
| `SIM_ORACLE_ADMIN` | `0xFF1137243698CaA18EE364Cc966CF0e02A4e6327` (Aave executor, POOL_ADMIN) | Account that switches the oracle source |
| `SIM_DEPLOY_TEST_VAULT` | `true` | Deploy `TestVault` (USDC) for L2 |

Exact sequence (anvil account 0 as deployer):

```bash
anvil --fork-url $ARB_ONE_RPC_URL --chain-id 4216199
export ETH_RPC_URL=http://127.0.0.1:8545
DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
ADMIN=0xFF1137243698CaA18EE364Cc966CF0e02A4e6327
cast rpc anvil_setNonce $DEPLOYER 0x0                  # account 0 has mainnet history; reset -> same addresses on every fork
cast rpc anvil_impersonateAccount $ADMIN               # the oracle switch is sent from the Aave admin
cast rpc anvil_setBalance $ADMIN 0x56BC75E2D63100000   # 100 ETH for gas (the executor holds none)
forge script script/DeploySim.s.sol --rpc-url $ETH_RPC_URL --unlocked --sender $DEPLOYER --broadcast
cast rpc anvil_stopImpersonatingAccount $ADMIN
```

The script logs one line `SIM_DEPLOYMENT {json}` (indented under forge's `== Logs ==`; match
`SIM_DEPLOYMENT (\{.*\})`) with `chainId`, `guardianV3`, `simPriceFeed`, `testVault`, `treasury`,
`priceUpdater`, `aaveOracle`, `previousWethSource`, `initialPrice`, `poolAddressesProvider`, `swapRouter`,
`swapFee`, `weth`, `usdc`. With the sequence above the addresses are deterministic: `SimPriceFeed`
`0x5FbDB2315678afecb367f032d93F642f64180aa3`, `TahansoeGuardianV3` `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`,
`TestVault` `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`. Move the price with
`cast send $SIM_PRICE_FEED "setAnswer(int256)" <price 8 decimals> --from $UPDATER --unlocked`.
Receipts under `broadcast/DeploySim.s.sol/` are gitignored.

## Demo Scenario (Arbitrum Sepolia)

To open a position, configure all 3 protection layers, and trigger protection on Arbitrum Sepolia:
```bash
GUARDIAN_V2=<deployed_v2_address> TEST_VAULT=<deployed_vault_address> \
  forge script script/DemoScenario.s.sol --rpc-url arbitrum_sepolia \
  --account tahansoe-deployer --broadcast
```

## Addresses

| Contract | Arbitrum Sepolia |
|---|---|
| Aave V3 PoolAddressesProvider | `0xB25a5D144626a0D488e52AE717A051a2E9997076` |
| Aave V3 Pool | `0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff` |
| TahansoeGuardian (V1) | [`0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E`](https://sepolia.arbiscan.io/address/0x1a5d249a8e711e2288add7c01e31eb7ffb05d97e) |
| TahansoeGuardianV2 | *(Deployed per release)* |
| TahansoeGuardianV3 | *(Not deployed; simulation fork only until audit)* |
| TahansoeGuardianAaveV4 | *(Not deployed; simulation fork only until audit)* |
| TahansoeGuardianMorpho | *(Not deployed; simulation fork only until audit)* |

