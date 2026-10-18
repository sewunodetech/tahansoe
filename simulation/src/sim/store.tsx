import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import {
  BORROWER_FIXED_RATE,
  BTC_PRICE_0,
  DEFAULT_LTV,
  DEFAULT_MONTHLY_PAYMENT,
  FAUCET_BTC,
  LENDER_APY,
  LENDER_SUPPLY,
  LIQ_THRESHOLD,
  POLICY_MAX_LTV,
  SCENARIOS,
  STATIONS,
  TERMS,
  YIELD_VENUES,
  type ScenarioId,
  type StationId,
  type VenueId,
} from "./constants";
import {
  fmtBtc,
  fmtHf,
  fmtPct,
  fmtUsd,
  healthFactor,
  projectMonths,
  runGuard,
  type GuardRun,
  type GuardSummary,
  type Intent,
} from "./model";

export const TM_HORIZON = 60; // months shown in the time machine

export type LogKind = "action" | "info" | "intent" | "warn" | "danger" | "success";

export interface LogEntry {
  id: number;
  at: string;
  kind: LogKind;
  title: string;
  detail?: string;
  intent?: Intent;
}

export interface SimState {
  view: number;
  done: Record<StationId, boolean>;

  walletBtc: number;
  collBtc: number;
  price: number;
  lenderSupplied: number;

  ltvDraft: number;
  borrowed: number;
  debt: number;

  termDraft: number;
  termDays: number | null;
  fixedRate: number | null;

  venueDraft: VenueId;
  venue: VenueId | null;

  monthlyPayment: number;
  tmMonth: number;
  tmPlaying: boolean;
  committedMonth: number | null;
  interestPaid: number;
  yieldEarned: number;
  sweptToDebt: number;
  userPaid: number;
  reserve: number;
  lenderEarned: number;
  spreadEarned: number;

  guardActive: { run: GuardRun; tick: number; logged: number } | null;
  lastGuard: GuardRun | null;
  guardRuns: GuardSummary[];

  /** Station detail drawer (the "example" for the focused node) is open. */
  drawerOpen: boolean;
  autoDemo: boolean;
  log: LogEntry[];
  nextLogId: number;
}

const NOT_DONE = Object.fromEntries(STATIONS.map((s) => [s.id, false])) as Record<StationId, boolean>;

export const initialState: SimState = {
  view: 0,
  done: NOT_DONE,
  walletBtc: 0,
  collBtc: 0,
  price: BTC_PRICE_0,
  lenderSupplied: 0,
  ltvDraft: DEFAULT_LTV,
  borrowed: 0,
  debt: 0,
  termDraft: 365,
  termDays: null,
  fixedRate: null,
  venueDraft: "lst",
  venue: null,
  monthlyPayment: DEFAULT_MONTHLY_PAYMENT,
  tmMonth: 0,
  tmPlaying: false,
  committedMonth: null,
  interestPaid: 0,
  yieldEarned: 0,
  sweptToDebt: 0,
  userPaid: 0,
  reserve: 0,
  lenderEarned: 0,
  spreadEarned: 0,
  guardActive: null,
  lastGuard: null,
  guardRuns: [],
  drawerOpen: false,
  autoDemo: false,
  log: [],
  nextLogId: 1,
};

export type Action =
  | { type: "GO"; index: number }
  | { type: "OPEN"; index: number }
  | { type: "CLOSE" }
  | { type: "NEXT" }
  | { type: "PREV" }
  | { type: "CLAIM" }
  | { type: "DEPOSIT" }
  | { type: "LENDER_SUPPLY" }
  | { type: "SET_LTV"; ltv: number }
  | { type: "BORROW" }
  | { type: "SET_TERM"; days: number }
  | { type: "LOCK_RATE" }
  | { type: "SET_VENUE"; venue: VenueId }
  | { type: "STAKE" }
  | { type: "SET_PAYMENT"; amount: number }
  | { type: "SET_TM_MONTH"; month: number }
  | { type: "TM_PLAY"; playing: boolean }
  | { type: "COMMIT_TIME" }
  | { type: "START_GUARD"; scenario: ScenarioId }
  | { type: "GUARD_TICK" }
  | { type: "SET_AUTO"; on: boolean }
  | { type: "RESET" };

/** A station is reachable once every station before it is done. */
export function canView(state: SimState, index: number): boolean {
  return STATIONS.slice(0, index).every((s) => state.done[s.id]);
}

export function stationIndex(id: StationId): number {
  return STATIONS.findIndex((s) => s.id === id);
}

export function venueOf(id: VenueId | null) {
  return YIELD_VENUES.find((v) => v.id === id) ?? null;
}

export function timeLabel(state: SimState): string {
  if (state.committedMonth !== null) return `Month ${state.committedMonth}`;
  return "Day 0";
}

function addLog(state: SimState, entries: Omit<LogEntry, "id" | "at">[], at = timeLabel(state)): SimState {
  let id = state.nextLogId;
  const fresh = entries.map((e) => ({ ...e, at, id: id++ }));
  return { ...state, log: [...fresh.reverse(), ...state.log].slice(0, 120), nextLogId: id };
}

function complete(state: SimState, id: StationId): SimState {
  return { ...state, done: { ...state.done, [id]: true } };
}

export function projectionFor(state: SimState, months = TM_HORIZON) {
  return projectMonths({
    debt: state.borrowed,
    collBtc: state.collBtc,
    price: state.price,
    rate: state.fixedRate ?? BORROWER_FIXED_RATE,
    apy: venueOf(state.venue ?? state.venueDraft)?.apy ?? 0,
    monthlyPayment: state.monthlyPayment,
    months,
  });
}

function reducer(state: SimState, action: Action): SimState {
  switch (action.type) {
    case "GO":
      if (action.index < 0 || action.index >= STATIONS.length || !canView(state, action.index)) return state;
      return { ...state, view: action.index };
    case "OPEN": {
      const s = reducer(state, { type: "GO", index: action.index });
      return s.view === action.index ? { ...s, drawerOpen: true } : state;
    }
    case "CLOSE":
      return { ...state, drawerOpen: false };
    // Moving along the board closes the drawer so the next arrow can be seen drawing.
    case "NEXT":
    case "PREV": {
      const s = reducer(state, { type: "GO", index: state.view + (action.type === "NEXT" ? 1 : -1) });
      return s === state ? state : { ...s, drawerOpen: false };
    }

    case "CLAIM": {
      if (state.done.faucet) return state;
      const s = complete({ ...state, walletBtc: FAUCET_BTC }, "faucet");
      return addLog(s, [{ kind: "action", title: `Claimed ${fmtBtc(FAUCET_BTC)} from the faucet`, detail: `Mock oracle: 1 BTC = ${fmtUsd(BTC_PRICE_0)}` }]);
    }

    case "DEPOSIT": {
      if (state.done.supply || state.walletBtc <= 0) return state;
      const s = complete({ ...state, collBtc: state.walletBtc, walletBtc: 0 }, "supply");
      return addLog(s, [
        {
          kind: "action",
          title: `Supplied ${fmtBtc(state.walletBtc)} to the BTC pool`,
          detail: `Collateral ${fmtUsd(state.walletBtc * state.price)} · liquidation threshold ${fmtPct(LIQ_THRESHOLD, 0)}`,
        },
      ]);
    }

    case "LENDER_SUPPLY": {
      if (state.done.lender) return state;
      const s = complete({ ...state, lenderSupplied: LENDER_SUPPLY }, "lender");
      return addLog(s, [{ kind: "info", title: `Lender supplied ${fmtUsd(LENDER_SUPPLY)} USDT`, detail: `Asks a fixed ${fmtPct(LENDER_APY, 0)} APY` }]);
    }

    case "SET_LTV":
      if (state.done.borrow) return state;
      return { ...state, ltvDraft: Math.min(POLICY_MAX_LTV, Math.max(0.05, action.ltv)) };

    case "BORROW": {
      if (state.done.borrow || !state.done.lender) return state;
      const amount = Math.min(state.lenderSupplied, Math.round(state.collBtc * state.price * state.ltvDraft));
      const s = complete({ ...state, borrowed: amount, debt: amount }, "borrow");
      return addLog(s, [
        {
          kind: "action",
          title: `Borrowed ${fmtUsd(amount)} USDT (${fmtPct(state.ltvDraft, 0)} LTV)`,
          detail: `Health factor ${fmtHf(healthFactor(s.collBtc, s.price, amount))}`,
        },
      ]);
    }

    case "SET_TERM":
      if (state.done.fixed) return state;
      return { ...state, termDraft: action.days };

    case "LOCK_RATE": {
      if (state.done.fixed || !state.done.borrow) return state;
      const term = TERMS.find((t) => t.days === state.termDraft) ?? TERMS[2];
      const s = complete({ ...state, termDays: term.days, fixedRate: BORROWER_FIXED_RATE }, "fixed");
      return addLog(s, [
        {
          kind: "success",
          title: `Fixed rate locked: ${fmtPct(BORROWER_FIXED_RATE, 0)} for ${term.label}`,
          detail: `Lender receives ${fmtPct(LENDER_APY, 0)} fixed; ${fmtPct(BORROWER_FIXED_RATE - LENDER_APY, 0)} spread funds the rate buffer`,
        },
      ]);
    }

    case "SET_VENUE":
      if (state.done.yield) return state;
      return { ...state, venueDraft: action.venue };

    case "STAKE": {
      if (state.done.yield || !state.done.fixed) return state;
      const v = venueOf(state.venueDraft)!;
      const s = complete({ ...state, venue: v.id }, "yield");
      return addLog(s, [
        {
          kind: "action",
          title: `Locked BTC routed to ${v.name} (~${fmtPct(v.apy, 0)} APY)`,
          detail: `Yield sweep: 80% → repay USDT debt, 20% → Tahansoe guard reserve`,
        },
      ]);
    }

    case "SET_PAYMENT":
      if (state.done.time) return state;
      return { ...state, monthlyPayment: action.amount };

    case "SET_TM_MONTH":
      if (state.done.time) return state;
      return { ...state, tmMonth: Math.max(0, Math.min(TM_HORIZON, action.month)) };

    case "TM_PLAY":
      if (state.done.time) return state;
      return { ...state, tmPlaying: action.playing, tmMonth: action.playing && state.tmMonth >= TM_HORIZON ? 0 : state.tmMonth };

    case "COMMIT_TIME": {
      if (state.done.time || !state.done.yield || state.tmMonth < 1) return state;
      const pt = projectionFor(state)[state.tmMonth];
      const s = complete(
        {
          ...state,
          tmPlaying: false,
          committedMonth: pt.month,
          debt: pt.debtWith,
          interestPaid: pt.interestCum,
          yieldEarned: pt.yieldCum,
          sweptToDebt: pt.sweptCum,
          userPaid: pt.userPaidCum,
          reserve: pt.reserve,
          lenderEarned: pt.lenderCum,
          spreadEarned: pt.spreadCum,
        },
        "time",
      );
      return addLog(s, [
        {
          kind: "success",
          title: `Fast-forwarded ${pt.month} months`,
          detail: `Debt ${fmtUsd(state.borrowed)} → ${fmtUsd(pt.debtWith)} · yield repaid ${fmtUsd(pt.sweptCum)} · reserve ${fmtUsd(pt.reserve)}`,
        },
      ]);
    }

    case "START_GUARD": {
      if (!state.done.time || state.guardActive) return state;
      const run = runGuard({ scenario: action.scenario, collBtc: state.collBtc, price0: state.price, debt: state.debt, reserve: state.reserve });
      const name = SCENARIOS.find((x) => x.id === action.scenario)!.name;
      return addLog({ ...state, guardActive: { run, tick: 0, logged: 0 }, lastGuard: run }, [
        { kind: "warn", title: `Scenario started: ${name}`, detail: `BTC ${fmtUsd(state.price)} → ${fmtUsd(run.summary.finalPrice)}` },
      ]);
    }

    case "GUARD_TICK": {
      const g = state.guardActive;
      if (!g) return state;
      const tick = g.tick + 1;
      const last = g.run.ticks.length - 1;
      const due = g.run.events.filter((e) => e.tick <= tick).slice(g.logged);
      let s: SimState = { ...state, guardActive: { ...g, tick: Math.min(tick, last), logged: g.logged + due.length } };
      if (due.length) {
        const at = `Crash · day ${g.run.ticks[Math.min(tick, last)].day.toFixed(1)}`;
        s = addLog(
          s,
          due.map((e) => ({
            kind: e.kind === "intent" ? "intent" : e.kind === "liquidation" ? "danger" : "warn",
            title: e.lane === "with" ? `Tahansoe · ${e.text}` : `No guard · ${e.text}`,
            intent: e.intent,
          })),
          at,
        );
      }
      if (tick >= last) {
        const sum = g.run.summary;
        s = complete({ ...s, guardActive: null, guardRuns: [...s.guardRuns, sum] }, "guard");
        s = addLog(s, [
          sum.actions > 0
            ? { kind: "success", title: `Survived. Min HF ${fmtHf(sum.minHfWith)}, ${sum.actions} Tahansoe action${sum.actions > 1 ? "s" : ""}`, detail: `Without Tahansoe: ${sum.liquidations} liquidation${sum.liquidations === 1 ? "" : "s"}, ${fmtUsd(sum.penaltyWithout)} penalty` }
            : { kind: "info", title: `Scenario over. Min HF ${fmtHf(sum.minHfWith)} — no action needed`, detail: "Tahansoe stayed idle: no false positives" },
        ]);
      }
      return s;
    }

    case "SET_AUTO":
      return { ...state, autoDemo: action.on };

    case "RESET":
      return { ...initialState };
  }
}

const Ctx = createContext<{ state: SimState; dispatch: Dispatch<Action> } | null>(null);

export function SimProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}

export function useSim() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSim must be used inside <SimProvider>");
  return v;
}
