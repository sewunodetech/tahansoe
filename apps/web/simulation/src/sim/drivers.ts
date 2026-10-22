import { useEffect, useRef } from "react";
import { STATIONS } from "./constants";
import { TM_HORIZON, useSim, type Action, type SimState } from "./store";

const TM_STEP_MS = 160;
const GUARD_STEP_MS = 110;

/** Advances the time machine while it is playing. */
export function useTimeMachineDriver() {
  const { state, dispatch } = useSim();
  const { tmPlaying, tmMonth } = state;
  useEffect(() => {
    if (!tmPlaying) return;
    if (tmMonth >= TM_HORIZON) {
      dispatch({ type: "TM_PLAY", playing: false });
      return;
    }
    const t = setTimeout(() => dispatch({ type: "SET_TM_MONTH", month: tmMonth + 1 }), TM_STEP_MS);
    return () => clearTimeout(t);
  }, [tmPlaying, tmMonth, dispatch]);
}

/** Plays a precomputed crash scenario one oracle tick at a time. */
export function useGuardDriver() {
  const { state, dispatch } = useSim();
  const tick = state.guardActive?.tick ?? -1;
  useEffect(() => {
    if (tick < 0) return;
    const t = setTimeout(() => dispatch({ type: "GUARD_TICK" }), GUARD_STEP_MS);
    return () => clearTimeout(t);
  }, [tick, dispatch]);
}

/** ← / → move along the board, Enter opens the node, Esc closes it, R resets. */
export function useKeyboard() {
  const { state, dispatch } = useSim();
  const view = useRef(state.view);
  useEffect(() => {
    view.current = state.view;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight") dispatch({ type: "NEXT" });
      else if (e.key === "ArrowLeft") dispatch({ type: "PREV" });
      else if (e.key === "Escape") dispatch({ type: "CLOSE" });
      else if (e.key === "Enter" && el?.tagName !== "BUTTON") dispatch({ type: "OPEN", index: view.current });
      else if (e.key === "r" || e.key === "R") dispatch({ type: "RESET" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);
}

/** Scripted walk-through for the stage: plays every remaining station with default choices. */
export function useAutoDemo() {
  const { state, dispatch } = useSim();
  const ref = useRef<SimState>(state);
  useEffect(() => {
    ref.current = state;
  });

  useEffect(() => {
    if (!state.autoDemo) return;
    let cancelled = false;
    const sleep = (ms: number) =>
      new Promise<void>((resolve, reject) => setTimeout(() => (cancelled ? reject(new Error("cancelled")) : resolve()), ms));
    const send = async (a: Action, wait = 0) => {
      if (cancelled) throw new Error("cancelled");
      dispatch(a);
      if (wait) await sleep(wait);
    };
    const waitFor = async (pred: (s: SimState) => boolean) => {
      while (!pred(ref.current)) await sleep(120);
    };

    const script: Record<(typeof STATIONS)[number]["id"], () => Promise<void>> = {
      faucet: () => send({ type: "CLAIM" }),
      supply: () => send({ type: "DEPOSIT" }),
      lender: () => send({ type: "LENDER_SUPPLY" }),
      borrow: () => send({ type: "BORROW" }),
      fixed: async () => {
        await send({ type: "SET_TERM", days: 365 }, 700);
        await send({ type: "LOCK_RATE" });
      },
      yield: async () => {
        await send({ type: "SET_VENUE", venue: "lst" }, 700);
        await send({ type: "STAKE" });
      },
      time: async () => {
        for (let m = ref.current.tmMonth + 1; m <= 12; m++) await send({ type: "SET_TM_MONTH", month: m }, 170);
        await sleep(700);
        await send({ type: "COMMIT_TIME" });
      },
      guard: async () => {
        await send({ type: "START_GUARD", scenario: "crash" }, 300);
        await waitFor((s) => s.guardActive === null);
      },
      receipt: async () => {},
    };

    (async () => {
      for (let i = 0; i < STATIONS.length; i++) {
        const id = STATIONS[i].id;
        if (ref.current.done[id] && id !== "receipt") continue;
        // Let the arrow draw toward the node on the board, then open its example.
        await send({ type: "GO", index: i }, 1700);
        await send({ type: "OPEN", index: i }, 1000);
        await script[id]();
        await sleep(1600);
        if (id !== "receipt") await send({ type: "CLOSE" }, 400);
      }
      dispatch({ type: "SET_AUTO", on: false });
    })().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [state.autoDemo, dispatch]);
}
