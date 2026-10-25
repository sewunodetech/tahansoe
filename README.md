# Tahansoe

**A non-custodial AI risk agent that protects on-chain borrow positions from liquidation.**
Aave V3 and Morpho Blue · Arbitrum first, chain-agnostic by design.

[Live app](https://www.tahansoe.xyz) · [Docs](docs/README.md) · [Contracts](contracts/README.md) · [Security model](docs/security.md)

> Tahansoe reduces the chance of liquidation. It is **not** a guarantee against liquidation, not price prediction, and not a trading signal. See [Risk disclosure](#risk-disclosure).

---

## TL;DR

- **Problem:** borrowers on Aave and Morpho lose 5–10% of their collateral to liquidation penalties when markets move faster than they can react. The trigger is often news, macro, a depeg, or an L2 outage, not just "price went down".
- **Solution:** Tahansoe watches each position's Health Factor 24/7. When HF falls below the user's trigger, a guardian contract repays debt through a 3-layer cascade, using only funds the user has approved. A Core Risk Engine reads oracles, on-chain data, macro calendars, and news to judge the market regime and recommend a thicker buffer **before** the shock. Today that recommendation arrives as an explained alert; writing it on-chain inside the user's band is the next step.
- **Why it's different:**
  - **Context-aware risk assessment** (news, macro, depegs, oracles, sequencer) on top of the HF threshold, moving toward context-aware protection.
  - **No wallet migration:** works from a normal EOA with capped approvals.
  - **Per-position policies** across Aave and Morpho.
  - **A bounded Protection Agent**, being proven in shadow mode: it records the action it would take for each position but sends no transactions yet. Once proven, it may act only inside a mandate the user signs and can revoke.
  - **An ERC-8004 on-chain identity** so anyone can audit the agent.
- **Status:** live on Arbitrum Sepolia; a zero-risk Simulation Mode runs on an Arbitrum One fork. Mainnet follows an external audit.

---

## The problem

If you borrow stablecoins against volatile collateral (ETH, WBTC, LSTs), your position is liquidated when its Health Factor drops below 1.0:

```
HF = (collateral value × liquidation threshold) / total debt
```

Liquidation is expensive: Aave V3 charges a 5–10% penalty on the liquidated amount. Borrowers keep getting caught for the same reasons:

| # | What happens | Real example | Why people miss it |
|---|--------------|--------------|--------------------|
| 1 | Collateral crashes on news (war, tariffs, central banks) | ETH drops double digits within hours | Manual reaction is always late; liquidation bots are faster |
| 2 | A stablecoin loses its peg | USDC fell to ~$0.88 when SVB failed (Mar 2023) | HF moves even though ETH is flat |
| 3 | A protocol or network incident | Exploits, the Arbitrum sequencer halting | You cannot repay while it lasts, and prices jump when it resumes |
| 4 | Borrow interest quietly erodes the position | Utilization spikes push borrow APR up | HF falls without any price move |
| 5 | Too much to watch | News, macro calendars, on-chain data in many places | Nobody monitors 24/7 |

Existing automation reacts to a **static** HF threshold, and usually only after the user moves funds into a smart wallet or proxy.

---

## The solution

Tahansoe runs in three parts that never trust each other blindly. **AI advises, rules decide, the contract enforces.**

### 1. Core Risk Engine (off-chain)

- **Deterministic signal modules:**
  - oracle staleness and deviation;
  - Arbitrum sequencer uptime;
  - stablecoin depegs;
  - Aave reserve utilization and borrow-rate (carry) monitoring;
  - a macro calendar (FOMC, CPI, NFP).
- **Multi-agent research layer:**
  - analyst agents read credible news, FRED, DefiLlama, and on-chain data;
  - a hawk/dove debate and an assessor propose a market regime: `CALM → ELEVATED → STRESSED → CRISIS`;
  - research output is schema-validated, capped in confidence, and cannot raise the regime to `STRESSED`/`CRISIS` on its own.
- **Risk Fusion** turns the signals into a `RiskAssessment` per asset, with a recommended trigger and a plain-language explanation.
- **Reflection loop:** every prediction is settled against the AaveOracle price and tracked on a scorecard, so alert quality is measured rather than claimed.

### 2. Guardian contracts (on-chain, no admin)

When a position's HF falls below its trigger, anyone can call `protect()`. The Guardian repays the user's own debt toward the target HF through a three-layer cascade:

| Layer | Funding source | When |
|-------|----------------|------|
| **L1: Wallet reserve** | Debt token in the user's wallet, within an approved cap | First |
| **L2: Position reserve** | Redeem from an ERC-4626 vault or Aave aToken the user chose | If L1 is not enough |
| **L3: Flash deleverage** | Flash-loan repay, then sell capped collateral with a slippage limit | Last resort |

Funds only ever move from the user's own sources to the user's own debt. The Guardian holds no balance between calls. HF must strictly improve, or the transaction reverts.

### 3. Protection Strategy Agent (bounded autonomy)

> **Today the agent runs in shadow mode (Phase A).** It decides and records what it *would* do for each position, but it sends no transactions. Positions are protected today by the Guardian cascade above when HF falls below the user's own trigger. The engine's regime and recommended trigger reach users as alerts; writing that trigger on-chain (`setDynamicTrigger` inside the user's band) is not wired yet. The agent will be allowed to act only after it beats the static policy in backtests and builds a shadow track record, and only through Guardian v5 mandates after an audit (see [Roadmap](#roadmap-to-mainnet)).

The agent combines **off-chain research** (regime, signals) with the **on-chain state of each position** (HF, debt composition, available reserves) and chooses a protection action: hold, raise the trigger, repay from wallet, repay from vault, or deleverage. Once it is allowed to act:

- **It acts only inside a mandate the user signs per position:**
  - which actions are allowed (deleverage is off by default);
  - a per-action cap and a 24-hour cap;
  - a maximum HF above which it may not act;
  - an expiry.
- **Revocable:** the user can revoke the mandate in one transaction.
- **Checked twice:** a deterministic rule engine validates every plan before it becomes an intent, and the contract re-enforces every bound.
- **It learns protection strategies, not trades.** Playbooks come from how positions survived past crashes and from our own settlement results. It never copies positions, direction, or leverage from anyone.
- **New strategy versions ship only after** they pass the backtest gate and human review.

---

## What makes Tahansoe different

| | Tahansoe | Static automation (e.g. DeFi Saver, Summer.fi/Instadapp automation) | Alert bots and risk dashboards |
|---|---|---|---|
| Reacts to | Market context (news, macro, depeg, oracle, sequencer) **plus** HF | An HF threshold | An HF threshold |
| Acts before the threshold | Designed for it: the regime recommends a higher buffer early (explained alerts today; the on-chain shift inside user bounds is in progress) | No | No |
| Executes the fix | Yes, 3-layer cascade | Yes | No, the user must act |
| Wallet migration | **None**: works from an EOA with capped approvals | Smart wallet / proxy | n/a |
| Per-position policies (multi-debt Aave, Morpho markets) | Yes | Varies | n/a |
| Explains why | Yes, a plain-language reason per change, also on Telegram | Not a focus | Partly |
| Agent identity and track record | **ERC-8004** identity plus public reputation | Closed bot | Closed bot |
| Cost model | Pay only when a position is actually saved (planned 0.15% success fee) | Varies by product | Varies by product |

*Competitor features change quickly; we re-check this table before each public release.*

---

## Building trust

Trust has to be earned with evidence, not promised. This is what exists today and what is still in progress.

**Enforced by design ([security invariants](docs/security.md)):**
- **Non-custodial:** no code path can move user funds anywhere except the user's own position.
- **No admin keys:** Guardians are immutable, and upgrading means deploying a new version that users opt into.
- **Same oracle as the protocol:** execution uses the lending protocol's own oracle; other prices serve only as early warning.
- **Graceful degradation:** if the AI engine is down or its data is stale, protection falls back to the user's static policy.
- **External content is data, never instructions:** LLM output is structured and schema-validated.

**Measured, in progress:**
- **Backtest harness:** replays historical Binance ETHUSDT prices over 7 crash windows (Black Thursday, LUNA, stETH/Celsius, FTX, the SVB/USDC depeg, the yen carry unwind, the Oct 2025 tariff crash) plus a calm period. It compares static, dynamic-trigger, and agent policies against a release gate.
  - *Honest status:* with the current synthetic positions, the static policy already avoids every liquidation. The agent matches it, 23 of 23, at 8.6% higher cost.
  - The agent's advantage is **not demonstrated yet**. Next: more fragile positions, and regimes replayed from the engine instead of hand-labelled ones.
- **Survivor miner:** reads Aave V3 Arbitrum One events for historical crash windows from an archive RPC and compares positions that survived with positions that were liquidated.
  - Liquidation counts match on-chain data; for example, 189 wallets were liquidated during the USDC depeg window.
  - Historical HF reconstruction is still being built, so no playbook from it is used yet.
- **Shadow mode:** the agent records every plan it *would* make in `protection_plans` without sending transactions, so its decisions can be audited before it is allowed to act.
- **ERC-8004 identity:** the agent registers in the [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) Identity Registry, and settlement outcomes feed its public Reputation Registry. Reputation only counts feedback from addresses that actually had a policy with us (a Sybil filter).

---

## Architecture

```
                 ┌──────────────────────────────────────────────┐
 News, macro ───▶│ CORE RISK ENGINE (apps/engine)               │
 FRED, DefiLlama▶│  signals → research agents → Risk Fusion     │──▶ RiskAssessment
 Oracles, RPC ──▶│  Protection Agent → rule engine → Intent     │──▶ protection_plans (shadow)
                 │  sentinel + keeper · reflection & scorecard  │
                 └───────┬───────────────────┬──────────────────┘
                         │ protect()         │ setDynamicTrigger() inside the user's band (planned)
                         ▼                   ▼
                 ┌──────────────────────────────────────────────┐      ┌──────────────────────────┐
                 │ Guardian contracts (no admin, per chain)     │      │ Postgres (Neon)          │
                 │  AaveV4 · Morpho · v1–v3                     │      │ one DB for web + engine  │
                 └───────┬──────────────────────────────────────┘      └────────────┬─────────────┘
                         ▼                                                          │
                 Aave V3 / Morpho Blue                        ┌─────────────────────┴──────────┐
                                                              │ Web app (apps/web) + Telegram  │
                 ERC-8004 Identity & Reputation ◀── agent ────│ dashboard, simulation, alerts  │
                                                              └────────────────────────────────┘
```

| Component | Location | What it does |
|-----------|----------|--------------|
| Web app | `apps/web` | Landing page; dashboard (Positions, Holdings, Reserves, Protection, Activity, Agents); per-position protection setup; Simulation Mode; SIWE login; Telegram linking |
| Core Risk Engine | `apps/engine` | Signals, research agents, Risk Fusion, sentinel and keeper, Protection Agent, backtest, survivor miner, ERC-8004 module, `tahansoe` CLI, Telegram alerts and digests |
| Simulation network | `apps/simnet` | Anvil fork of Arbitrum One with Tahansoe contracts and replayable crash scenarios |
| Shared domain | `packages/domain` | Canonical types, chain registry, HF math, position readers, protection plan schema |
| Database | `packages/db` | One Drizzle schema with idempotent migrations |
| Contracts | `contracts` | Foundry: Guardians v1–v4, `GuardianCore`, unit, fuzz, invariant, and fork tests |

Key decisions are recorded as ADRs in [`docs/decisions/`](docs/decisions/), for example [0002 AI advises, rules decide](docs/decisions/0002-ai-advises-rules-decide.md), [0015 per-position Guardian v4](docs/decisions/0015-guardian-v4-per-position-policies.md), [0016 bounded Protection Agent](docs/decisions/0016-bounded-protection-agent.md), and [0017 ERC-8004 identity](docs/decisions/0017-erc8004-agent-identity.md).

---

## Contract addresses

### Tahansoe on Arbitrum Sepolia (testnet, unaudited)

| Contract | Address |
|----------|---------|
| TahansoeGuardianAaveV4 (per-position policies, 3 layers, success fee) | [`0xa7Bbab6366a723e17cd2f220D708757e449571b4`](https://sepolia.arbiscan.io/address/0xa7bbab6366a723e17cd2f220d708757e449571b4) ✅ verified |
| MockSwapRouter (testnet L3 swaps via the Aave oracle) | [`0x3A4440473141DAB3822bAb065a4d16fc18255F6C`](https://sepolia.arbiscan.io/address/0x3a4440473141dab3822bab065a4d16fc18255f6c) ✅ verified |
| TahansoeGuardian v1 (L1 wallet repay) | [`0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E`](https://sepolia.arbiscan.io/address/0x1a5d249a8e711e2288add7c01e31eb7ffb05d97e) |

`TahansoeGuardianV3` and `TahansoeGuardianMorpho` run in Simulation Mode on the Arbitrum One fork until the audit, because Morpho Blue is not deployed on Arbitrum Sepolia.

### External contracts we integrate with

| Contract | Arbitrum Sepolia | Arbitrum One |
|----------|------------------|--------------|
| Aave V3 PoolAddressesProvider | `0xB25a5D144626a0D488e52AE717A051a2E9997076` | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` |
| Aave V3 Pool | `0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff` | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Morpho Blue | n/a | `0x6c247b1F6182318877311737BaC0844bAa518F5e` |
| ERC-8004 Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ERC-8004 Reputation Registry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |

All addresses live in the chain registry ([`packages/domain/src/chains.ts`](packages/domain/src/chains.ts)); nothing is hardcoded in app code.

---

## Try it without risking money

**Simulation Mode** in the [dashboard](https://www.tahansoe.xyz/dashboard) gives you a burner wallet on a private fork of Arbitrum One with real Aave and Morpho state:

1. Open a position.
2. Set up protection.
3. Replay a historical crash (Black Thursday, the yen carry unwind, the Oct 2025 tariff crash) and watch the Guardian protect the position, side by side with what would have happened without it.

No wallet funds, faucet, or gas are needed.

On **Arbitrum Sepolia** you can use a real wallet with testnet tokens:
- connect your wallet;
- approve a capped reserve;
- set a per-position policy;
- receive Telegram alerts.

---

## Status

| Area | Status |
|------|--------|
| Guardian v4 per-position (Aave multi-debt and Morpho Blue), 3-layer cascade, success fee | ✅ 88 Foundry tests (unit, fuzz, invariant at 128k calls per handler); AaveV4 deployed and verified on Sepolia |
| Web dashboard: positions, holdings, reserves, per-position protection, activity, Simulation Mode | ✅ Live at [tahansoe.xyz](https://www.tahansoe.xyz) |
| Core Risk Engine: signals, research agents, Risk Fusion, settlement and scorecard, Telegram alerts | ✅ Running |
| Sentinel and keeper: multi-guardian discovery (v1–v4, Morpho), per-position debt priority | ✅ |
| Dynamic trigger: engine writes the recommended trigger on-chain (`setDynamicTrigger` inside the user's band) | 🚧 Contracts support it; the engine writer is not built yet |
| Protection Agent Phase A: decider, rule engine, shadow mode, backtest, ERC-8004 module | ✅ Built, in shadow; agent value not yet proven (see [Building trust](#building-trust)) |
| Survivor miner with historical HF reconstruction | 🚧 In progress |
| Guardian v5: on-chain mandates plus `agentProtect` (Protection Agent Phase B) | 🗓 Planned |
| External audit, then Arbitrum One mainnet | 🗓 Planned |

Detailed, always-current status: [`docs/status.md`](docs/status.md).

---

## Roadmap to mainnet

1. **Prove the agent:** fragile-position backtests and engine-replayed regimes, real survivor playbooks from historical HF, and a shadow-mode track record on Sepolia.
2. **Register the agent on ERC-8004** and publish settlement-based reputation.
3. **Guardian v5:** user-signed mandates and `agentProtect` with per-action, 24-hour, and HF caps, tested with unit, fuzz, invariant, and fork suites.
4. **External audit** of Guardians v4 and v5 and `GuardianCore`.
5. **Arbitrum One closed beta** with a TVL cap and Chainlink Automation as a second keeper.
6. **Expansion:** more chains (Base, Optimism), Morpho L3 deleverage, and cross-chain views.

---

## Business model

- **Success fee (planned, [ADR 0013](docs/decisions/0013-success-fee-on-protection.md)):** 0.15% of the debt repaid, charged only when the HF was actually below the user's static trigger, meaning only when a position is saved.
  - Preemptive agent actions above the trigger are free, so the agent has no incentive to over-act.
  - Uncollectable fees are waived and never block the rescue.
- **Later:** B2B risk scores and white-label protection for wallets and lending protocols.

---

## Tech stack

| Part | Technology |
|------|------------|
| Contracts | Solidity 0.8.26, Foundry, OpenZeppelin v5 |
| Web | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, wagmi + viem, SIWE, iron-session |
| Engine | Node.js + TypeScript (tsx), viem, one OpenAI-compatible LLM gateway, zod-validated outputs |
| Data | Neon Postgres + Drizzle ORM |
| Simulation | Anvil fork of Arbitrum One (`apps/simnet`) |
| Notifications | Telegram Bot API |
| Agent identity | ERC-8004 Identity and Reputation registries |

---

## Run locally

**Prerequisites:** Node.js 20+, a Postgres database ([Neon](https://neon.tech) recommended), and [Foundry](https://book.getfoundry.sh/) for contracts.

```bash
npm install
```

Create `apps/web/.env`; the web app and the database scripts both use it:

```bash
DATABASE_URL=postgresql://user:password@host/dbname
SESSION_SECRET=            # random string, at least 32 characters (openssl rand -base64 32)
NEXT_PUBLIC_APP_DOMAIN=localhost:3000

# Optional
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
NEXT_PUBLIC_WC_PROJECT_ID=
```

```bash
npm run db:migrate     # idempotent schema setup
npm run dev            # http://localhost:3000
```

The engine (`apps/engine`) needs its own `apps/engine/.env` (`DATABASE_URL`, LLM gateway, RPC URLs); see [`apps/engine/README.md`](apps/engine/README.md). Useful commands:

```bash
npm run tahansoe -w @tahansoe/engine -- start --detach            # run the agent in the background
npm run tahansoe -w @tahansoe/engine -- backtest protection --candidate agent --active static
npm run tahansoe -w @tahansoe/engine -- agent plans               # Protection Agent shadow log
npm run tahansoe -w @tahansoe/engine -- agent identity show       # ERC-8004 identity and reputation
```

Contracts:

```bash
cd contracts
forge build
forge test
```

| Command (from repo root) | Purpose |
|--------------------------|---------|
| `npm run dev` / `build` / `start` | Web app |
| `npm run lint` | ESLint (web) |
| `npm run typecheck` | TypeScript, all workspaces |
| `npm test` | Tests, all workspaces |
| `npm run db:migrate` / `db:check` / `db:reset` | Database scripts |

---

## Repository layout

```
apps/
  web/        Next.js app: landing, dashboard, API routes, Simulation Mode
  engine/     Core Risk Engine: signals, research agents, fusion, sentinel/keeper,
              Protection Agent (strategy/), backtest/, erc8004/, tahansoe CLI
  simnet/     Anvil fork service for Simulation Mode
packages/
  domain/     Types, chain registry, HF math, position readers, protection plan schema
  db/         Drizzle schema and idempotent migrations
contracts/    Foundry: Guardians v1–v4, GuardianCore, tests, deploy scripts
docs/         PRD, BRD, architecture, security, status, ADRs, specs, knowledge
AGENTS.md     Workflow for contributors and coding agents
DESIGN.md     Design system
```

Full documentation index: [`docs/README.md`](docs/README.md) (written in Indonesian).

---

## Risk disclosure

Tahansoe lowers the probability of liquidation by acting earlier. It cannot remove it. Conditions outside our control include:

- price gaps faster than one block;
- network congestion or gas spikes that delay the rescue transaction;
- oracle update lag (deviation thresholds and heartbeats);
- insufficient liquidity in the rescue funding sources;
- an L2 sequencer outage.

The contracts are **unaudited** and deployed on testnet only. Use them with full understanding of the risks.

---

## License

Private; license to be decided.
