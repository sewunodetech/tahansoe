import { FastForward, Pause, Play } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtUsd, payoffMonth } from "../sim/model";
import { TM_HORIZON, projectionFor, useSim, venueOf } from "../sim/store";
import { Button, Label, Slider, Stat } from "../components/ui";
import { axis, grid, tooltip } from "./chart";
import { Frame } from "./Frame";

const PAYOFF_HORIZON = 360;

function months(n: number | null) {
  if (n === null) return "never";
  const y = Math.floor(n / 12);
  const m = n % 12;
  return y ? `${y}y ${m}m` : `${m} mo`;
}

export function TimeMachine() {
  const { state, dispatch } = useSim();
  const done = state.done.time;
  const series = projectionFor(state);
  const month = done ? state.committedMonth! : state.tmMonth;
  const pt = series[month];
  const long = projectionFor(state, PAYOFF_HORIZON);
  const payWith = payoffMonth(long, "debtWith");
  const payWithout = payoffMonth(long, "debtWithout");
  const sooner = payWith !== null && payWithout !== null ? payWithout - payWith : payWith !== null ? null : 0;
  const venue = venueOf(state.venue);

  return (
    <Frame
      kicker="More fast to repay the loan"
      lead={<>Fast-forward the loan. You pay a fixed amount each month; your collateral's yield pays on top. Compare against the same loan with idle collateral.</>}
      doneNote={`Now at month ${state.committedMonth}`}
    >
      <div className="grid gap-5 @lg:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between">
            <Label>Your monthly payment</Label>
            <span className="text-sm font-semibold tabular">{fmtUsd(state.monthlyPayment)}</span>
          </div>
          <div className="mt-3">
            <Slider label="Monthly payment" value={state.monthlyPayment} min={0} max={2000} step={50} disabled={done} onChange={(v) => dispatch({ type: "SET_PAYMENT", amount: v })} />
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <Label>Time</Label>
            <span className="text-sm font-semibold tabular">Month {month}</span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              disabled={done}
              aria-label={state.tmPlaying ? "Pause" : "Play"}
              onClick={() => dispatch({ type: "TM_PLAY", playing: !state.tmPlaying })}
            >
              {state.tmPlaying ? <Pause size={14} /> : <Play size={14} />}
            </Button>
            <Slider label="Month" value={month} min={0} max={TM_HORIZON} step={1} disabled={done} onChange={(v) => dispatch({ type: "SET_TM_MONTH", month: v })} />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-bg-subtle p-4">
        <div className="mb-2 flex items-center justify-between">
          <Label>Outstanding debt</Label>
          <span className="font-mono text-[10.5px] text-ink-3">BTC flat at {fmtUsd(state.price)} · {venue?.name}</span>
        </div>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
              <defs>
                <linearGradient id="debtWith" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...grid} />
              <XAxis dataKey="month" {...axis} tickFormatter={(m) => `m${m}`} interval={11} />
              <YAxis {...axis} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} width={52} />
              <Tooltip {...tooltip} labelFormatter={(m) => `Month ${m}`} formatter={(v, name) => [fmtUsd(Number(v)), name === "debtWith" ? "With yield" : "Idle collateral"]} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === "debtWith" ? "With yield sweep" : "Idle collateral")} />
              <Area type="monotone" dataKey="debtWithout" stroke="var(--text-tertiary)" strokeDasharray="4 3" strokeWidth={1.75} fill="transparent" isAnimationActive={false} />
              <Area type="monotone" dataKey="debtWith" stroke="var(--brand)" strokeWidth={2.5} fill="url(#debtWith)" isAnimationActive={false} />
              <ReferenceLine x={month} stroke="var(--gold)" strokeWidth={1.5} label={{ value: `m${month}`, position: "top", fill: "var(--gold)", fontSize: 11 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 @lg:grid-cols-4">
        <Stat label="Paid off (idle)" value={months(payWithout)} sub={payWithout === null ? "payment ≤ interest" : undefined} />
        <Stat label="Paid off (yield)" value={months(payWith)} tone="brand" sub={sooner ? `${sooner} months sooner` : payWith !== null && payWithout === null ? "yield makes it possible" : undefined} />
        <Stat label={`Debt at m${month}`} value={fmtUsd(pt.debtWith)} sub={`idle: ${fmtUsd(pt.debtWithout)}`} />
        <Stat label="Guard reserve" value={fmtUsd(pt.reserve)} tone="gold" sub={`yield earned ${fmtUsd(pt.yieldCum)}`} />
      </div>

      <Button variant="brand" size="lg" disabled={done || month < 1} onClick={() => dispatch({ type: "COMMIT_TIME" })}>
        <FastForward size={16} /> {done ? `Continued at month ${state.committedMonth}` : month < 1 ? "Press play or drag the timeline" : `Continue at month ${month}`}
      </Button>
    </Frame>
  );
}
