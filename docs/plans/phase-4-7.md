# Tahansoe Remake: Phases 4–7 (contract, on-chain wiring, agents), revised for core-dev

Replaces the "Next phases" section of [morpho-remake.md](morpho-remake.md). That section was written against `master` and missed what `core-dev` already has: the monorepo (ADR 0007), the research engine in `apps/engine`, the Telegram gateway, the M1 spec, and ADRs 0002/0003/0006/0009.

**Done before this plan:** the Morpho remake UI is ported into `apps/web` on branch `feat/morpho-remake-mono` (based on `core-dev`). `npm run typecheck`, `npm run lint` and `npm run build` pass; the build no longer needs `DATABASE_URL` because `@tahansoe/db` connects lazily. One engine test fails (`pairing: membatasi maksimal 5 percobaan gagal per chat per jam`); it already fails on `core-dev` CI (run 38675943604).

## What already exists vs what is missing

| Area | Already on core-dev | Missing |
|---|---|---|
| Contract | `TahansoeGuardian` v1: Layer 1 (allowance-based `protect()`, `quoteRepay`, `checkUpkeep`/`performUpkeep`), Arbitrum Sepolia `0x1A5D…D97E`. CI runs `forge test --no-match-contract Fork` | Layer 2, Layer 3, dynamic trigger band (ADR 0002 §3), user registry for `checkUpkeep`, passing fork test, audit |
| Web ↔ chain | Spec `docs/specs/m1-web-onchain-integration.md` (draft), `arbitrumSepolia` in wagmi | All of it: the dashboard still runs on `lib/simulation-*` |
| Agent 1 (market) | Research pipeline (4 analysts → Hawk/Dove debate → assessor → `Signal`), deterministic modules (oracle, sequencer, depeg, carry/T11, macro calendar), Risk Fusion with guardrails, scheduler, daily budget, eval set, Telegram `/status /fuse /carry /report /history` | Broadcast to opted-in users, web Agents page reading real data |
| Agent 2 (HF Sentinel) | Price and rate samplers, regime per asset | Per-user HF watcher, zone transitions, server-side alerts, keeper that calls `protect()` |

## Decisions already made by the team (do not re-litigate)

- **ADR 0002:** AI advises, rules decide, contract enforces. The only on-chain effect of AI is shifting the trigger HF inside a band the user approved (Guardian v2). Until then the engine runs dry-run.
- **ADR 0003:** v1 is EOA + bounded ERC20 approve, no Safe module.
- **ADR 0006:** information is free for everyone (alerts, regime, research), automation is paid (Pro). No on-chain fee; the contract never has a path that sends funds to Tahansoe.
- **ADR 0009:** one OpenAI-compatible LLM gateway (`LLM_API_URL`, `LLM_API_KEY`). The old plan's "Anthropic SDK" line is dropped.
- **ADR 0011:** engine uses Postgres (Neon) only; chat only through the gateway.

## Step 1 – Web on-chain wiring (spec M1) — next

Follow the M1 spec; this section only maps it onto the new UI.

1. `lib/contracts/` with the Guardian ABI from `contracts/out` and addresses per chain. Aave V3 Pool and `UiPoolDataProvider` addresses for Arbitrum Sepolia.
2. `hooks/useProtection.ts` keeps its return shape (`docs/plans/use-protection.md`) but gets a live source next to the simulation source:
   - reads: `getUserAccountData`, `policies(user)`, `healthFactor(user)`, `needsProtection(user)`, debt token `allowance` and `balanceOf`;
   - writes: `approve(guardian, bounded)`, `setPolicy(...)`, `disablePolicy()`, `approve(guardian, 0)`.
3. "Live Testnet / Demo" toggle in the dashboard topbar; the simulation moves to `features/demo/` (ADR 0007 phase 3).
4. Amount presets on the cap inputs (wizard + Protection page): **Recommended** = repay needed to move HF from trigger to target, **25% / 50% / 100% of debt**, **Max** = wallet balance. Allowance stays within 1–3× `maxRepayPerAction`; unlimited is refused.
5. Capacity warning when `min(allowance, balance) / maxRepayPerAction < 1`.
6. Layer 2 and Layer 3 cards show "Coming with Guardian v2" on live mode (M1 spec §2.7: no v1 copy that promises flash-loan deleverage).
7. Remove the browser-triggered alert path (`app/api/alerts/notify` + the `useEffect` caller) once Step 3 sends alerts from the engine.
8. DB: `users` unique per wallet (drop `chainId` from the constraint) with a Drizzle migration in `packages/db`.

**Done when:** a wallet with a real Aave V3 position on Arbitrum Sepolia sees its real HF, approves a bounded cap, sets a policy, sees it on Arbiscan, and revokes it, all from the dashboard.

## Step 2 – Guardian v2 (`contracts/`) — can run in parallel with Step 1

1. Fix `test_fork_protectsRealAavePosition` first.
2. Policy gains `l2Sources[]` (ERC-4626 vault or aToken + cap), `l3Enabled`, `collateralAsset`, `maxSlippageBps`, `l3Cap`, and a trigger band `[minTriggerHf, maxTriggerHf]` plus an optional `riskAgent` address (ADR 0002 §3).
3. `protect(user)` cascades in one transaction: L1 → L2 (`redeem`/`withdraw` → repay) → L3.
4. L3: Aave `flashLoanSimple` → `executeOperation` (`msg.sender == pool && initiator == address(this)`) → repay → pull aWETH (`transferFrom`) → `withdraw` → swap with `minOut` from the Aave oracle minus `maxSlippageBps` → close the flash loan. Mock router on Sepolia; real Uniswap V3 only in Arbitrum One fork tests.
5. `setTrigger(user, hf)` callable only by the user's `riskAgent`, only inside the band, with `validUntil`; expired → static trigger.
6. Invariants as fuzz/invariant tests: HF strictly improves, no balance left in the contract, per-layer caps, no transfer to any address other than the Aave pool / the user (I1, I4).
7. User registry with pagination for `checkUpkeep` instead of a static list in `checkData`.
8. Deploy v2 to Sepolia as a new address; v1 stays live until users migrate.

**Done when:** `forge test` (unit + invariant) is green in CI and fork tests for L2/L3 pass on an Arbitrum One fork.

## Step 3 – Agent 2, HF Sentinel (`apps/engine`)

1. Event sync: listen to `PolicySet` / `PolicyDisabled` and mirror into `policies` (the engine is the single writer, per M1 spec §3.3).
2. Worker (every ~60 s, advisory lock like the research scheduler): multicall HF for every active policy → `positions`, zone transitions → `notification_logs`.
3. Alerts from the server through the existing gateway (`apps/engine/src/gateway/views.ts` style): Warning, Critical, `RESERVE_LOW` (allowance or balance below one action), executed.
4. Keeper: when HF < trigger, a keeper EOA calls `protect(user)`; Chainlink Automation stays as the backup executor.
5. On entering Warning: one cached LLM explanation that uses the current fusion regime and signals (no new prompt pipeline).
6. Dry-run trigger recommendations from fusion (ADR 0002 §5) shown in the web app; written on-chain only after Step 2 ships the band.

## Step 4 – Agent 1, Market Pulse (`apps/engine` + `apps/web`)

1. No new LLM pipeline: the brief is built from the latest `research_reports` + `risk_assessments` + deterministic signals.
2. Opt-in per Telegram account; fan-out through a queue capped at ~25 msg/s globally and 1 msg/s per chat, honouring `retry_after` on 429 (the gateway already has the per-chat cap and 429 handling).
3. Bot commands `/pulse`, `/pulse_on`, `/pulse_off` next to the existing ones.
4. `/dashboard/agents` reads real reports, regime history and the scorecard instead of mock data.
5. Every brief keeps the "informational · not investment advice" footer.

## Open decisions (need the team)

1. Host for the engine worker and Sentinel: Railway, Fly or a VPS (Vercel serverless is not suitable for a 60 s loop).
2. Who funds the keeper EOA (ETH) and Chainlink Automation (LINK) under ADR 0006.
3. Whether `feat/morpho-remake-mono` merges into `core-dev` first, and when `core-dev` merges into `master`.
4. Vercel project `custos`: the Root Directory must point at `apps/web` (or the root build script) once this branch is deployed, and Preview needs its own env vars.

## Verification per step

- Every step: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` from the repo root (same as `.github/workflows/ci.yml`).
- Step 1: manual run on Arbitrum Sepolia with a real Aave position; screenshots of live and demo mode.
- Step 2: `forge test`, invariant tests, Arbitrum One fork tests.
- Step 3–4: engine unit tests with fake RPC and fake gateway; one live run against Sepolia with a test Telegram chat.
