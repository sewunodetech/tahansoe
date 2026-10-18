import { useMemo } from "react";
import { Lock } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BORROWER_FIXED_RATE, LENDER_APY, PROTOCOL_SPREAD, TERMS } from "../sim/constants";
import { fmtPct, fmtUsd, rateComparison } from "../sim/model";
import { useSim } from "../sim/store";
import { Button, Label, Stat, cx } from "../components/ui";
import { axis, grid, tooltip } from "./chart";
import { Frame } from "./Frame";

const STEPS = [
  { n: "1", title: "Lender commits for a term", body: `USDT is committed for the term at ${fmtPct(LENDER_APY, 0)} fixed. No early withdrawal, no floating rate.` },
  { n: "2", title: "You borrow the same term", body: `Your loan is matched term-to-term at ${fmtPct(BORROWER_FIXED_RATE, 0)}: the lender's rate plus a ${fmtPct(PROTOCOL_SPREAD, 0)} spread.` },
  { n: "3", title: "The spread is the buffer", body: "The spread fills a rate buffer that keeps paying the lender if you repay early or the term has to roll." },
];

export function FixedRate() {
  const { state, dispatch } = useSim();
  const done = state.done.fixed;
  const term = done ? state.termDays! : state.termDraft;
  const data = useMemo(() => rateComparison(state.borrowed, term, BORROWER_FIXED_RATE), [state.borrowed, term]);
  const last = data[data.length - 1];
  const peak = Math.max(...data.map((d) => d.variable));
  const saved = last.cumVariable - last.cumFixed;

  return (
    <Frame
      kicker="How to get a fixed rate?"
      lead={<>Most DeFi borrow rates float. One busy week can double what you pay. Tahansoe matches a fixed-term lender with a fixed-term borrower, so both sides know the number upfront.</>}
      doneNote={`${fmtPct(BORROWER_FIXED_RATE, 0)} locked`}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-xl border border-line bg-bg-subtle p-4">
            <div className="grid h-6 w-6 place-items-center rounded-full bg-brand-bg font-mono text-[11px] font-semibold text-brand">{s.n}</div>
            <div className="mt-3 text-sm font-medium">{s.title}</div>
            <div className="mt-1 text-[13px] leading-relaxed text-ink-3">{s.body}</div>
          </div>
        ))}
      </div>

      <div>
        <Label>Term</Label>
        <div className="mt-2 inline-flex rounded-lg border border-line-strong p-1">
          {TERMS.map((t) => (
            <button
              key={t.days}
              disabled={done}
              onClick={() => dispatch({ type: "SET_TERM", days: t.days })}
              className={cx(
                "rounded-md px-4 py-1.5 text-sm transition-colors disabled:cursor-not-allowed",
                term === t.days ? "bg-accent text-accent-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-bg-subtle p-4">
        <div className="mb-2 flex items-center justify-between">
          <Label>Borrow APR over the term</Label>
          <span className="font-mono text-[10.5px] text-ink-3">variable path is simulated</span>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid {...grid} />
              <XAxis dataKey="day" {...axis} tickFormatter={(d) => `d${d}`} />
              <YAxis {...axis} tickFormatter={(v) => `${Math.round(v * 100)}%`} domain={[0, "auto"]} width={48} />
              <Tooltip {...tooltip} labelFormatter={(d) => `Day ${d}`} formatter={(v, name) => [fmtPct(Number(v)), name === "variable" ? "Variable" : "Fixed"]} />
              <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} formatter={(v) => (v === "variable" ? "Variable rate" : "Your fixed rate")} />
              <Line type="monotone" dataKey="variable" stroke="var(--text-tertiary)" strokeWidth={1.75} dot={false} strokeDasharray="4 3" isAnimationActive={false} />
              <Line type="stepAfter" dataKey="fixed" stroke="var(--brand)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Fixed interest" value={fmtUsd(last.cumFixed)} tone="brand" sub={`on ${fmtUsd(state.borrowed)}`} />
        <Stat label="Variable would cost" value={fmtUsd(last.cumVariable)} sub={`peaked at ${fmtPct(peak, 0)}`} />
        <Stat label={saved >= 0 ? "Certainty saved" : "Certainty cost"} value={fmtUsd(Math.abs(saved))} tone={saved >= 0 ? "safe" : "warning"} />
        <Stat label="Lender gets" value={`${fmtPct(LENDER_APY, 0)} fixed`} tone="gold" />
      </div>

      <Button variant="brand" size="lg" disabled={done} onClick={() => dispatch({ type: "LOCK_RATE" })}>
        <Lock size={15} /> {done ? "Rate locked" : `Lock ${fmtPct(BORROWER_FIXED_RATE, 0)} for ${TERMS.find((t) => t.days === term)?.label}`}
      </Button>
    </Frame>
  );
}
