# Guardian v2, live L2/L3 and HF Sentinel: execution plan

Executes Steps 2 and 3 of [phase-4-7.md](phase-4-7.md) and finishes the leftovers of Step 1. Work is split into three parallel workstreams that meet at one interface: the Guardian v2 ABI below.

## Constraints (binding)

- **Immutable, versioned.** v2 is a new contract at a new address. No owner, no admin, no proxy, no withdraw path (security.md I1, I2, I4). Updating later means v3 plus the migration banner the web app already has.
- **Funds only repay the user's own debt.** Tokens move from the user (wallet, vault shares, aTokens) to the Guardian and on to the Aave Pool for `onBehalfOf = user`, or back to the user. Nothing goes to Tahansoe (ADR 0006).
- **Bounded approvals.** Every layer has a per-action cap; the web app never asks for an unlimited approval.
- **AI advises, rules decide** (ADR 0002). The `riskAgent` can only move the trigger inside the band the user set, and only until `validUntil`.
- v1 (`0x1A5D…D97E`) stays live. The web app reads every version from `@tahansoe/domain` `chains.ts` `guardians`.

## Interface: `TahansoeGuardianV2`

Constructor: `(IPoolAddressesProvider provider, address swapRouter, uint24 swapFee)`, all immutable. `swapRouter` speaks Uniswap V3 `SwapRouter02.exactInputSingle` (no deadline field). On Arbitrum Sepolia it is `MockSwapRouter`, priced from the Aave oracle, because the test-token Uniswap pools hold almost no liquidity (about 158 USDC).

```solidity
uint8 constant L2_NONE = 0; uint8 constant L2_ERC4626 = 1; uint8 constant L2_ATOKEN = 2;

// Layer 1 + core policy. Same signature and event as v1.
function setPolicy(address debtAsset, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction) external;
function disablePolicy() external;
// Layer 2: ERC-4626 vault whose asset() == debtAsset, or the aToken of debtAsset. kind 0 turns it off.
function setLayer2(uint8 kind, address source, uint256 maxAssetsPerAction) external;
// Layer 3: sell up to maxCollateralPerAction of collateralAsset (underlying, e.g. WETH). enabled=false turns it off.
function setLayer3(bool enabled, address collateralAsset, uint256 maxCollateralPerAction, uint16 maxSlippageBps) external;
// Optional dynamic trigger band for an agent. riskAgent = address(0) turns it off.
function setTriggerBand(uint256 minTriggerHF, uint256 maxTriggerHF, address riskAgent) external;
function setDynamicTrigger(address user, uint256 triggerHF, uint64 validUntil) external; // only that user's riskAgent

function policies(address) external view returns (bool enabled, address debtAsset, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction);
function layer2(address) external view returns (uint8 kind, address source, uint256 maxAssetsPerAction);
function layer3(address) external view returns (bool enabled, address collateralAsset, uint256 maxCollateralPerAction, uint16 maxSlippageBps);
function triggerBands(address) external view returns (uint256 minTriggerHF, uint256 maxTriggerHF, address riskAgent, uint256 dynamicTriggerHF, uint64 validUntil);
function effectiveTrigger(address user) external view returns (uint256);
function healthFactor(address user) external view returns (uint256);
function needsProtection(address user) external view returns (bool);
function quoteProtect(address user) external view returns (uint256 l1Repay, uint256 l2Repay, uint256 l3Collateral, uint256 l3Repay, uint256 expectedHF);
function protect(address user) external returns (uint256 totalRepaid);
function userCount() external view returns (uint256);
function usersPage(uint256 offset, uint256 limit) external view returns (address[] memory);
function checkUpkeep(bytes calldata checkData) external view returns (bool, bytes memory); // checkData = abi.encode(offset, limit)
function performUpkeep(bytes calldata performData) external;
function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params) external returns (bool);

event PolicySet(address indexed user, address indexed debtAsset, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction);
event PolicyDisabled(address indexed user);
event Layer2Set(address indexed user, uint8 kind, address source, uint256 maxAssetsPerAction);
event Layer3Set(address indexed user, bool enabled, address collateralAsset, uint256 maxCollateralPerAction, uint16 maxSlippageBps);
event TriggerBandSet(address indexed user, uint256 minTriggerHF, uint256 maxTriggerHF, address riskAgent);
event DynamicTriggerSet(address indexed user, address indexed agent, uint256 triggerHF, uint64 validUntil);
event LayerUsed(address indexed user, uint8 indexed layer, uint256 amountIn, uint256 debtRepaid);
event Protected(address indexed user, address indexed debtAsset, address indexed caller, uint256 repaid, uint256 healthFactorBefore, uint256 healthFactorAfter);
```

`protect(user)` runs in one transaction while HF < `effectiveTrigger(user)`:

1. **L1:** `transferFrom(user, debtAsset)` up to `min(needed, maxRepayPerAction, balance, allowance)`, repay.
2. **L2:** if still short of the target, redeem vault shares (`withdraw(assets, guardian, user)`) or pull the aToken and `Pool.withdraw`, up to `maxAssetsPerAction`, repay.
3. **L3:** if still short, `flashLoanSimple(debtAsset)`. In `executeOperation` (`msg.sender == pool`, `initiator == this`): repay, pull the collateral aToken, `Pool.withdraw`, swap with `minOut` = oracle value minus `maxSlippageBps`, approve the pool for amount + premium. Swap output above that goes to repaying more debt or back to the user.
4. Revert unless HF after > HF before. The Guardian holds no tokens at the end.

`effectiveTrigger` = `dynamicTriggerHF` if a band is set, `block.timestamp <= validUntil`, and the value lies in `[minTriggerHF, maxTriggerHF]`; otherwise the static `triggerHF`.

## Workstream A: contracts (`contracts/`)

- `src/TahansoeGuardianV2.sol`, `src/testnet/MockSwapRouter.sol`, `src/testnet/TestVault.sol` (OpenZeppelin ERC4626 over a test token).
- Unit and fuzz tests for each layer and the cascade, invariant tests (HF improves, Guardian balance is zero after `protect`, per-layer caps, funds only to the pool or the user), fix `test_fork_protectsRealAavePosition`.
- Arbitrum Sepolia fork test that runs L1, L2 and L3 against the real Aave testnet Pool.
- `script/DeployV2.s.sol` (Guardian v2, mock router, test vault) and `script/DemoScenario.s.sol` (opens a position, sets all layers, calls `protect`).
- README: v2 section, deploy and demo commands.

## Workstream B: web (`apps/web`, `packages/domain`)

- `packages/domain`: cascade math shared by the Demo simulator and the Live page (`simulateCascade`), with tests. The Demo simulator uses it, so Demo matches the contract (layer order, partial layers, balance and allowance limits, real target, slippage in L3).
- Live mode: Guardian v2 support behind the version registry. L2 and L3 forms (approve vault shares or aToken, `setLayer2`, `setLayer3`), trigger band form, `quoteProtect` preview, and a **Run protect now** button when HF is under the trigger. v1-only users keep the v1 form and see the migration banner once v2 is listed.
- Activity reads the v2 events (`LayerUsed`, `Layer2Set`, `Layer3Set`).

## Workstream C: engine (`apps/engine`, `packages/db`)

- HF Sentinel: event sync of `PolicySet` / `PolicyDisabled` for every Guardian version into `policies`, a 60 s loop that reads HF with multicall into `positions`, zone transitions into `notification_logs`, Telegram alerts through the existing gateway (Warning, Critical, reserve low, executed).
- Keeper: calls `protect(user)` when HF is under the trigger. Runs dry-run unless `KEEPER_PRIVATE_KEY` is set.
- Unit tests with a fake RPC client and a fake gateway.

## Workstream D: docs and delivery (coordinator)

- `docs/product/faq.md`: questions people will ask and how to answer them.
- `docs/product/protocol-impact.md`: who gains and who loses, and the L3 sell-pressure mitigations.
- Vercel: project `custos`, Root Directory `apps/web`, production branch, env vars.

## Order

A, B and C start together against the interface above. B uses a placeholder until A's address exists. After A merges, the coordinator deploys v2 to Arbitrum Sepolia (needs the `tahansoe-deployer` keystore password and Sepolia ETH), adds the `guardians` entry, regenerates the ABI, and runs the demo scenario.

## Done when

- `forge test` (unit, fuzz, invariant) green; fork test green against Arbitrum Sepolia.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` green from the repo root, except the known pre-existing engine pairing test.
- v2 deployed on Arbitrum Sepolia, demo scenario transactions visible on Arbiscan, Live page shows them.
