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
```

The fork test suite covers v1 and v2:
- `TahansoeGuardianForkTest`: opens a real position (1 WETH supplied, USDC borrowed) and verifies v1 L1 repayment.
- `TahansoeGuardianV2ForkTest`: verifies v2 Layer 1 (wallet), Layer 2 (ERC-4626 vault), and Layer 3 (flash-loan deleverage) on Arbitrum Sepolia.

## Invariant Tests

Invariant tests in `TahansoeGuardianV2.invariant.t.sol` run 100,000+ state transitions across multi-user random perturbations and enforce:
- `guardianHoldsZeroTokens`: Guardian balance of debt asset, collateral asset, aTokens, and vault shares is strictly 0 at the end of every transaction.
- Successful `protect()` strictly increases the borrower's Health Factor.
- Per-action caps on every layer are strictly respected.

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

