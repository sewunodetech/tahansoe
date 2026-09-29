# Tahansoe contracts

`TahansoeGuardian` protects an Aave V3 borrower from liquidation. The user sets a
policy (trigger HF, target HF, debt asset, per-action cap) and approves the
Guardian to spend that asset from their wallet. When Health Factor drops below
the trigger, anyone — a keeper, Chainlink Automation, or the user — can call
`protect(user)`, which repays exactly enough debt to bring HF back to the target.

**Security invariant:** tokens only move from the user's wallet into Aave to
repay that same user's debt; any unused amount is returned. The Guardian has no
owner, no admin functions and holds no funds between calls.

Scope today: the *hot reserve* strategy on Aave V3. Flash-loan and deleverage
strategies and Morpho Blue are not implemented yet.

## Setup

```bash
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
forge build
```

## Test

```bash
forge test                                   # unit + fuzz tests against mocks
ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc \
  forge test --match-contract Fork -vv       # end-to-end on real Aave V3 (Arbitrum Sepolia fork)
```

The fork test opens a real position (1 WETH supplied, USDC borrowed), drops the
ETH price 25% via the Aave oracle, and checks `protect()` restores HF to 1.60.

## Deploy to Arbitrum Sepolia

1. Get Arbitrum Sepolia ETH from a faucet for your deployer wallet.
2. Import the deployer key into Foundry's encrypted keystore (never paste it into a file):
   ```bash
   cast wallet import tahansoe-deployer --interactive
   ```
3. Deploy and verify:
   ```bash
   cp .env.example .env   # add ARBISCAN_API_KEY
   source .env
   forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia \
     --account tahansoe-deployer --broadcast --verify
   ```

The deployed address is printed and saved under `broadcast/`.

## Addresses

| Contract | Arbitrum Sepolia |
|---|---|
| Aave V3 PoolAddressesProvider | `0xB25a5D144626a0D488e52AE717A051a2E9997076` |
| Aave V3 Pool | `0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff` |
| TahansoeGuardian | [`0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E`](https://sepolia.arbiscan.io/address/0x1a5d249a8e711e2288add7c01e31eb7ffb05d97e) |

Deployment tx: [`0x6720…1896`](https://sepolia.arbiscan.io/tx/0x672004425aa93871d104335a26a26d46f9f3fee18c7939b379a77ea2d6a51896), block 313944170.
