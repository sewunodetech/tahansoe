# Tahansoe Journey Board

Interactive, fully simulated walkthrough of the Tahansoe flow for live demos
(Arbitrum Foundation, Singapore). No wallet, no chain, no backend: every number
comes from `src/sim/model.ts` in the browser.

The board follows the whiteboard sketch: 1 mock BTC → BTC pool → USDT loan,
a lender who wants 10%, a fixed-rate match, locked BTC that earns yield and
repays the loan faster, and Tahansoe guarding the health factor through a crash.
Arrows draw one by one as each step completes; click a glowing node to open its
interactive example.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

## Presenter controls

| Key | Action |
|-----|--------|
| `Auto demo` button | Plays the whole journey with default choices |
| `→` / `←` | Move to the next / previous node on the board |
| `Enter` | Open the current node |
| `Esc` | Back to the board |
| `R` | Reset |

## Where things live

| Path | What |
|------|------|
| `src/sim/constants.ts` | All mock parameters (BTC price, LT, trigger/target HF, rates, venues, scenarios) |
| `src/sim/model.ts` | Pure math: health factor, fixed vs variable rate, yield projection, crash replay + Intents |
| `src/sim/store.tsx` | Reducer state machine for the journey |
| `src/components/Board.tsx` | The node/arrow board and live examples on each node |
| `src/stations/*` | The interactive example opened from each node |

This folder is a standalone package. The root Next.js app ignores it
(`tsconfig.json` exclude, `eslint.config.mjs` ignore).
