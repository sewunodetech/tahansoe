# Tahansoe Remake: Morpho Design System, 3 Protection Layers, 2 AI Agents

## Context

Tahansoe's landing page and dashboard currently use the "Mostar" style (cream + moss, Instrument Serif). The product story there is still a 4-layer *architecture* stack (Data/Policy/Trigger/Execution), which doesn't match the product the user wants to sell. The goal:

1. **Rebuild the look** of the landing page and dashboard using Morpho's design language (morpho.org + app.morpho.org): dark-first, neutral blue-grey, brand blue `#2B76FF`, light-weight grotesk display headings, mono eyebrow pills, grid-line hero, dense data tables. Plus a light-mode toggle.
2. **Recenter the product on 3 protection layers** that users approve themselves, and make them clear on both the landing page and the dashboard:
   - **Layer 1 – Wallet Reserve**: approve the debt token (e.g. USDC) in the hot wallet for the repay function.
   - **Layer 2 – Position Reserve**: approve shares from *another* DeFi position (ERC-4626 vault such as a Morpho Vault, or an Aave aToken) to be redeemed for repay.
   - **Layer 3 – Flash Deleverage**: approve the use of a flash loan when HF is low and Layers 1 and 2 are empty or insufficient (flash borrow debt → repay → withdraw some collateral → swap → close the flash loan).
3. **2 AI agents**:
   - **Agent 1 – Market Pulse**: one research fetch per cycle → one LLM call → broadcast to every user who enables it on Telegram.
   - **Agent 2 – HF Sentinel**: monitors HF. **Execution is triggered by deterministic rules** (HF < trigger), and the AI acts only as an *advisor* (explains why HF dropped, early warnings). AI never signs a transaction.

**User decisions (already confirmed):** free fonts (Morpho look-alikes) · dark + light toggle · Layer 3 = flash-loan deleverage · Agent 2 = rule-based keeper + AI advisor · chain **Arbitrum** (Sepolia → One) · protocol **Aave V3 first** (Morpho Blue in a later phase; Morpho Vaults can already be a Layer 2 source) · `/simulation` and demo mode **kept, restyled** · build order **UI first**.

**Assumptions:** site copy stays in English (as it is now). The logo uses the existing `BrandMark` as a placeholder until the user sends the new logo.

## Current state (exploration results)

- Next **16.3.1** (Middleware → `proxy.ts`; read `node_modules/next/dist/docs/` before coding), React 19.2, Tailwind v4 (no config, tokens in `app/globals.css`), shadcn CLI + `@base-ui/react`, `motion`, `recharts`, `next-themes` (`attribute="data-theme"`, `enableSystem=false`), wagmi v3 + viem, SIWE + iron-session, Neon + Drizzle.
- **Contract** `contracts/src/TahansoeGuardian.sol`: Aave-only, **Layer 1 is done** (allowance-based `protect()`, `quoteRepay`, `checkUpkeep`/`performUpkeep`), deployed on Arbitrum Sepolia `0x1A5D…D97E`. No Layer 2 or 3 yet. The fork test `test_fork_protectsRealAavePosition` is listed in `contracts/cache/test-failures`.
- **Schema** `lib/schema.ts` already has enums `HOT_RESERVE / WARM_RESERVE / FLASH_LOAN` (= L1/L2/L3) and the tables `policies`, `positions`, `intents`, `notification_logs`, all still unused.
- **Dashboard** is 100% simulated (`lib/simulation-engine.tsx`, `lib/simulation-context.tsx`, `lib/mock-data.ts`). `app/dashboard/layout.tsx` **ignores `children`** and renders pages from a client-side `PAGES` registry, so `/dashboard/positions` can't be opened directly.
- **Telegram**: raw Bot API (`app/api/telegram/*`). Notifications are triggered by the *browser* simulation (`app/api/alerts/notify/route.ts`). The bot username is hardcoded as `cuustos_bot`.
- **Design debt:** hex colors hardcoded everywhere, `--color-white` overridden to cream, shadcn tokens (`--primary`, `--ring`, …) undefined, `BrandMark` duplicated in `Navbar.tsx`/`Footer.tsx`/`simulation/`, ~10 unused landing components, hero depends on external video/image URLs.

## Morpho design tokens (extracted from morpho.org)

| Group | Value |
|---|---|
| Neutral | 050 `#f4f7ff` · 100 `#edf3fe` · 150 `#dee8fc` · 200 `#d0ddf7` · 300 `#b1c0dd` · 400 `#95a1b8` · 500 `#727f99` · 600 `#5b677e` · 700 `#464f60` · 800 `#353a46` · 850 `#2c313a` · 900 `#1e2227` · 950 `#15181a` (dark bg) · 990 `#121212` |
| Brand | 100 `#86b1ff` · 200 `#79a8ff` · 300 `#5792ff` · 400 `#3c80ff` · 500 `#2b76ff` (app button `#2973ff`) · accent `#b5e6e2` · midnight `#003185` · gradient radial 300→200→100 |
| Status | success 100–500 `#d9efed…#04675b` · warning `#ffe9cf…#774205` · error `#ffdadf…#ab103f` |
| Radius | xs 4 · s 8 · m 12 · l 16 · xl 24 · full |
| Type | Display: FK Grotesk **300** (h1 ~55px/1.28), 400 (h2 27px, h3 19px). Body: Untitled Sans 400, letter-spacing −0.02em. Mono eyebrow: FK Grotesk Mono. App: Inter, 13px buttons, 40px height, 8px radius, 36px table rows, borders `rgba(255,255,255,.07)` |
| Light mode | fg `neutral-950`, surfaces `neutral-050/100/200` |

**Free font substitutes:** `Geist` 300/400 (display) + `Inter` (body and dashboard, same as app.morpho.org) + `Geist Mono` (eyebrows/numbers), all via `next/font/google`. Instrument Serif and JetBrains Mono are removed.

---

## Phase 1: Design system foundation (blocks everything else, do this first)

1. **`app/globals.css`**: replace the Mostar palette.
   - Primitive Morpho tokens (`--color-neutral-*`, `--color-brand-*`, `--color-success/warning/error-*`).
   - **Semantic** tokens under `[data-theme="dark"]` and `[data-theme="light"]`. Keep the old names already in use (`--bg`, `--bg-subtle`, `--bg-elevated`, `--border`, `--text-primary/secondary/tertiary`, `--brand`, `--safe/--warning/--danger` + `-bg/-border`) so existing `var(--…)` references don't break, but repoint their values to Morpho.
   - Map to Tailwind via `@theme inline`: `bg-surface-1/2/3`, `text-fg-1/2/3`, `border-line`, `bg-brand`, `text-safe`, etc. Remove the `--color-white` override.
   - Define the shadcn tokens (`--primary`, `--ring`, `--radius-*`, `--destructive`) so `components/ui/button.tsx` works.
   - Utilities: `.grid-lines` (Morpho hero grid), `.eyebrow` (mono uppercase pill). Remove `.liquid-glass` and the moss classes once they're no longer used.
2. **`app/layout.tsx`**: switch to Geist + Inter + Geist Mono, update the metadata (the "3-layer liquidation protection" story).
3. **`components/providers/ThemeProvider.tsx`**: keep `data-theme`, add a `components/ui/theme-toggle.tsx` component (used in the navbar and dashboard topbar).
4. **Shared primitives in `components/ui/`** (Morpho style, all token-based, no hardcoded hex): `button` (primary/secondary/ghost/danger, sm/md), `card`, `eyebrow`, `badge`/`status-pill` (Safe/Watch/Warning/Critical), `stat`, `data-table`, `input` + `number-input`, `switch`, `tabs`, `tooltip`, `dialog`, `stepper`, `hf-gauge`, `zone-bar`, `layer-badge` (L1/L2/L3 with fixed colors), and `approval-explainer` (the "What this allows / What it can't do / How to revoke" box, reused on the landing page and in the wizard). Merge the local `StatCard`/`Toggle`/`FieldRow`/`NumberInput` copies from each dashboard page into these primitives.
5. **`components/ui/brand-mark.tsx`**: the single source of truth. Remove the duplicate logos in `Navbar.tsx` and `Footer.tsx`. Asset slot `public/brand/` for the new logo.

## Phase 2: Landing page (`app/page.tsx`, `components/landing/*`)

Follows the Morpho landing rhythm (grid hero + live stats → alternating text/visual sections with eyebrow pills → 3 cards → code section → footer). New order:

1. **Navbar**: logo, anchors (Layers · Agents · How it works · FAQ), theme toggle, blue "Launch app" button.
2. **Hero**: CSS/SVG perspective grid lines (no external video), light display heading, one-line value prop, CTA. Stats on the right: *Protected debt*, *Positions guarded*, *Liquidations avoided*, labelled "Testnet" / "Demo" so we don't show fake numbers as real ones.
3. **Health Factor explainer**: keep the calculator from `HealthFactorExplainer.tsx`, restyle it.
4. **`ProtectionLayers.tsx` (new, the core section)**: an L1 → L2 → L3 cascade. Each layer card covers: *what you approve* (exact token), *when it runs*, *what it does* (one sentence), *cost*, and *revoke anytime*. An interactive "price drop" slider highlights which layer kicks in. Copy example L1: "Allow Tahansoe to use up to 500 USDC from your wallet — only to repay your own Aave debt, never to anywhere else."
5. **`Agents.tsx` (new)**: two panels.
   - Market Pulse: a mock preview of the Telegram brief message, plus "1 research run → sent to every subscriber".
   - HF Sentinel: a zone timeline Safe → Watch → Warning → Critical → Repay, plus the "AI explains, rules execute — AI never signs" badge.
6. **How it works**: 4 steps (Connect → Choose layers → Approve → Sentinel watches).
7. **Supported**: Aave V3 · Arbitrum (live) · Morpho Blue (soon) in a card style like Morpho's "protocols powering".
8. **Open by default**: a code block with a snippet of `protect()` and the contract address linked to Arbiscan (mirrors Morpho's code section).
9. **FAQ + RiskDisclosure**: restyled, content updated for the 3 layers and 2 agents.
10. **CTA**: "Launch app" + "Join on Telegram". The waitlist form currently goes nowhere, so remove it or store it in the DB.
11. **Footer**.

**Delete** dead code and assets tied to the old style: `Hero.tsx`, `HeroCopy.tsx`, `HFCard.tsx`, `ParticleMesh.tsx`, `ProtocolStrip.tsx`, `HeroChrome.tsx`, `HeroGlows.tsx`, `SpotlightHero.tsx`, `Scenery.tsx`, `Architecture.tsx`, `Features.tsx` (its content moves into Layers/Agents), `ui/cycling-word.tsx`, `ui/hero-ascii-one.tsx`, `ui/text-3d-flip.tsx`, `public/scenery/`.

## Phase 3: Dashboard (`app/dashboard/*`)

1. **Real routing**: `app/dashboard/layout.tsx` renders `children`. Remove the `PAGES` registry, and `components/ui/dashboard-sidebar.tsx` uses `Link` + `usePathname`.
   - New nav: **Overview · Protection · Activity · Agents · Telegram · Settings**.
   - `chat/` → `agents/`, `history/` → `activity/`, `positions/` → merged into Overview/Protection.
2. **Data abstraction**: a `hooks/useProtection.ts` hook returns `{position, hf, zone, layers: {l1,l2,l3}: {enabled, approved, capacity, covers%}, policy, activity}`. In this phase the source is the simulation engine (demo mode). In Phase 5 it switches to on-chain without changing the UI.
3. **`lib/simulation-engine.tsx`**: the strategy order becomes L1 (hot) → L2 (warm) → L3 (flash deleverage), matching the 3 layers. Fix the bugs: `targetHf` is filled with `hf`, and the copy always says "via flash loan".
4. **Overview** (the first thing users see, it has to answer "what's going on and what happens next?"):
   - A large status card: HF, zone pill, and a zone bar with trigger/target markers.
   - A **"What happens next"** panel in plain language, per layer, with a readiness status. Example: "If ETH falls to $2,950 → **Layer 1** repays up to 500 USDC from your wallet ✓ Ready", or "**Layer 2** — Not set up · Set up".
   - Three readiness cards (L1/L2/L3), a Sentinel status (last check, next check), the latest Market Pulse brief, and recent activity.
5. **Protection setup wizard** (`/dashboard/protection/setup`, auto-opens when there's no policy). Steps:
   1. Position detected.
   2. Trigger and target HF, with a translation such as "we act when ETH < $X".
   3. Layer 1: amount cap + approve.
   4. Layer 2: choose a source position + cap + approve (optional).
   5. Layer 3: opt-in, max slippage, collateral cap, cost estimate (optional).
   6. Review → Activate (`setPolicy`).
   7. Connect Telegram + opt into Market Pulse.

   Every approve step uses `approval-explainer` and shows a transaction preview *before* the wallet popup opens. In demo mode, approvals are simulated.
6. **Protection** (`/dashboard/protection`): manage per layer (on/off, change caps, **Revoke** = approve 0, plus "Revoke all").
7. **Activity**: execution table (layer used, HF before→after, amount, fee, tx link) + the HF recovery chart (recharts, colors from tokens).
8. **Agents**: Market Pulse (latest brief, archive, opt-in toggle) + Sentinel (zone thresholds, alert log, AI explanation per event).
9. **Telegram**: restyle; the bot username comes from env `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`.
10. **Settings**: thresholds, notifications, theme, demo mode.
11. **Topbar**: breadcrumb, a "Demo mode" toggle/pill, theme toggle, wallet. Retarget `onboarding-tour.tsx` to the new layout, or remove it (the wizard replaces it).
12. **`/simulation` restyle**: update the tokens in `simulation/src/styles.css` and fonts (`@fontsource/geist`, `inter`) to match Morpho, and import the shared `BrandMark`. Step logic is unchanged.

---

## Next phases (separate sessions after the UI is done)

**Phase 4 – Contract V2 (`contracts/`)**
- Policy gains `l2Sources[]` (ERC-4626 vault/aToken + cap), `l3Enabled`, `collateralAsset`, `maxSlippageBps`, `l3Cap`.
- `protect(user)` **cascades within one transaction**: L1 → L2 (`redeem`/`withdraw` → repay) → L3.
- L3 runs Aave `flashLoanSimple` + `executeOperation` (check `msg.sender == pool && initiator == this`), then repay → `transferFrom` aWETH → `withdraw` → swap via Uniswap V3 on Arbitrum with `minOut` from Aave oracle − `maxSlippageBps` → close the flash loan.
- Invariants: HF must improve, no funds left in the contract, caps per layer.
- Fix the failing fork test. Arbitrum One fork tests for L2/L3.

**Phase 5 – On-chain wiring**
- `lib/wagmi-config.ts` adds `arbitrumSepolia` + `arbitrum`.
- ABIs from `contracts/out` → `lib/contracts/`.
- `useProtection` reads `getUserAccountData`, allowances, balances, and the policy, and writes approve/setPolicy/revoke.
- Store policies, positions and intents in the existing tables.

**Phase 6 – Agent 2 HF Sentinel**
- Server worker (every ~60s): multicall the HF of every active policy, track zone transitions → `notification_logs` + Telegram.
- When HF < trigger → keeper EOA calls `protect(user)`, with Chainlink Automation as the backup executor.
- On entering Warning → one LLM call to explain the cause (cached).
- Notifications move from the browser to the server.

**Phase 7 – Agent 1 Market Pulse**
- Daily cron (time configurable) fetches data (DefiLlama/CoinGecko/Aave rates on-chain).
- **One** LLM call with structured output (numbers come from the data, not the LLM) → `market_reports` table.
- Fan-out to `telegram_accounts` with opt-in, throttled ≤25 msg/s with retry on 429 `retry_after`.
- Bot commands `/pulse`, `/pulse_on`, `/pulse_off`, `/status`.
- LLM via the Anthropic SDK.

## Challenges & things that may have been missed

1. **Approvals = attack surface.** L1 (USDC), L2 (vault shares) and L3 (aWETH collateral!) all grant the contract the right to pull funds. One contract bug = every approved fund is at risk. **Need:** capped approvals (not unlimited), no admin/upgrade, a professional audit before mainnet, and a clear revoke button.
2. **Layer 3 is the riskiest.** Swapping collateral during a crash means high slippage plus a sandwich/MEV target. Uniswap liquidity on **Arbitrum Sepolia is thin**, so L3 is hard to demo realistically on testnet. Use a mock router on testnet and test on an Arbitrum One fork.
3. **Layer 2 has a hidden effect.** If the source is an aToken that's also *collateral*, pulling it lowers collateral at the same time. HF still improves but less than you'd expect. ERC-4626 vaults (Morpho Vaults, Aave stataToken) are cleaner sources.
4. **Layer 1 depends on the wallet balance.** Users can spend their USDC after approving. The dashboard must keep showing live readiness, and Sentinel should send a "Layer 1 no longer sufficient" alert.
5. **Race against liquidators.** In a flash crash HF can jump from 1.3 to <1 within a few blocks. You need enough buffer (trigger ≥1.3), a fast keeper, and gas spike handling. The landing page must honestly say "not a 100% guarantee".
6. **Who pays gas and the keeper?** Chainlink Automation needs LINK, and a keeper EOA needs ETH. This ties into the business model (per-action fee? subscription?), which hasn't been decided.
7. **Sentinel infra:** Vercel serverless has duration and cron-frequency limits. A per-minute HF watcher is better on a persistent worker (Railway/Fly/VPS) or Chainlink Automation, and needs uptime alerting.
8. **Agent 1 hallucination and legal:** the LLM must not make up numbers. Use structured data → narrative, and add a "Not financial advice" disclaimer to every brief. Telegram rate limits (≈30 msg/s global, 1 msg/s per chat) need a queue.
9. **Impersonation risk:** a DeFi site that looks *too* similar to Morpho could be flagged as phishing by wallet scanners (MetaMask/Blockaid) and confuse users. Adopt the design *language* (tokens, layout, typography), but **not** Morpho's illustrations, logos or copy. Your own logo and illustrations are required.
10. **Arbitrum Sepolia is missing from wagmi,** while the contract lives there and the PRD still says Base. PRD/README need updating so they're consistent with Arbitrum.
11. **SIWE security:** domain validation trusts the request's own headers, and the nonce isn't bound to the session. Fix this before mainnet.
12. **No tests or CI** for the web app or the simulator. Add at least a build + lint CI, and unit tests for the HF math/cascade.
13. **Honest numbers:** hero stats must not show simulated numbers as if they were real. Label them Demo/Testnet until data comes from contract events.
14. **Terms & risk acceptance:** Morpho uses a ToS gate before the app. Tahansoe needs one too (non-custodial, smart contract risk, not financial advice), especially because users approve fund access.
15. **Morpho Blue later:** HF there is per *market* (not per account) and authorization is all-or-nothing (`setAuthorization`), so it needs a separate adapter design. Morpho Blue flash loans are 0% fee, so they can be the L3 source on Arbitrum One.

## Parallelization (once execution starts)

Phase 1 must finish first (every other file depends on its tokens and primitives). After that, **Phase 2 (landing)**, **Phase 3 (dashboard)**, and **the `/simulation` restyle (Phase 3 step 12, its own package)** touch separate files and can run in parallel sessions.

## Verification

- `npm run lint` and `npm run build` (includes `prebuild` → simulation build).
- Dev server on port 3100:
  - Landing in dark + light, at 375px and desktop.
  - The Layers slider and the Agents section.
  - Console free of errors.
- Dashboard:
  - Open `/dashboard`, `/dashboard/protection`, `/dashboard/activity`, `/dashboard/agents` **directly by URL** (proves real routing).
  - Run the setup wizard end-to-end in demo mode.
  - Overview shows "What happens next" per layer, and readiness updates when a layer is enabled or disabled.
  - Simulate a price drop: the cascade L1→L2→L3 shows up in Activity with the right layer and HF before→after values.
- Simulation dev server (port 5180): the journey board runs (Auto demo) with the new style.
- Theme toggle persists on reload with no flash of the wrong theme.
