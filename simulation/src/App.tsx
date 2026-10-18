import { motion } from "motion/react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Board } from "./components/Board";
import { BrandMark } from "./components/BrandMark";
import { EventLog } from "./components/EventLog";
import { PositionPanel } from "./components/PositionPanel";
import { Button, Pill } from "./components/ui";
import { STATIONS } from "./sim/constants";
import { useAutoDemo, useGuardDriver, useKeyboard, useTimeMachineDriver } from "./sim/drivers";
import { SimProvider, useSim } from "./sim/store";
import { STATION_VIEWS } from "./stations";

export function App() {
  return (
    <SimProvider>
      <Shell />
    </SimProvider>
  );
}

function Shell() {
  const { state, dispatch } = useSim();
  useTimeMachineDriver();
  useGuardDriver();
  useKeyboard();
  useAutoDemo();

  const station = STATIONS[state.view];
  const View = STATION_VIEWS[station.id];
  const doneCount = STATIONS.filter((s) => state.done[s.id]).length;

  return (
    <div className="grain min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-3 px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark size={24} />
            <span className="truncate text-[15px] font-semibold tracking-tight">Tahansoe</span>
            <span className="hidden text-ink-4 sm:inline">/</span>
            <span className="hidden truncate text-sm text-ink-2 sm:inline">Journey board</span>
            <span className="hidden md:inline">
              <Pill>Simulated · no wallet needed</Pill>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="mr-1 hidden items-center gap-2 font-mono text-[11px] text-ink-3 lg:flex">
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-line-strong">
                <span className="block h-full rounded-full bg-brand transition-all" style={{ width: `${(doneCount / (STATIONS.length - 1)) * 100}%` }} />
              </span>
              {Math.min(doneCount, STATIONS.length - 1)}/{STATIONS.length - 1}
            </span>
            <Button variant={state.autoDemo ? "ghost" : "brand"} size="sm" onClick={() => dispatch({ type: "SET_AUTO", on: !state.autoDemo })}>
              {state.autoDemo ? <Pause size={15} /> : <Play size={15} />}
              <span className="hidden sm:inline">{state.autoDemo ? "Stop demo" : "Auto demo"}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "RESET" })} aria-label="Reset simulation">
              <RotateCcw size={15} />
              <span className="hidden sm:inline">Reset</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] grid-cols-[minmax(0,1fr)] gap-5 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-6">
        <main className="min-w-0">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h1 className="font-display text-3xl leading-none tracking-tight sm:text-4xl">From 1 BTC to a guarded loan</h1>
              <p className="mt-2 text-sm text-ink-3">Follow the arrows. Click the glowing node to try each step.</p>
            </div>
            <span className="hidden font-mono text-[11px] text-ink-3 xl:inline">← → move · Enter open · Esc close · R reset</span>
          </div>
          <Board />
        </main>

        <aside className="space-y-3 lg:sticky lg:top-[76px] lg:self-start">
          <PositionPanel />
          <EventLog />
        </aside>
      </div>

      {/* No exit animation: the drawer closes instantly so the next arrow draws in plain view. */}
      {state.drawerOpen && (
          <>
            <motion.div
              key="backdrop"
              className="fixed inset-0 top-14 z-40 bg-bg/60 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={() => dispatch({ type: "CLOSE" })}
            />
            <motion.aside
              key="drawer"
              role="dialog"
              aria-label={station.title}
              className="fixed bottom-0 right-0 top-14 z-50 w-full overflow-y-auto border-l border-line bg-bg sm:w-[640px] sm:p-4"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
            >
              <motion.div key={station.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                <View />
              </motion.div>
            </motion.aside>
          </>
      )}
    </div>
  );
}
