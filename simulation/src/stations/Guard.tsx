import { ShieldCheck, Skull, Zap } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SCENARIOS, TARGET_HF, TRIGGER_HF } from "../sim/constants";
import { fmtBtc, fmtHf, fmtUsd, healthFactor, liquidationPrice, triggerPrice, type GuardSummary } from "../sim/model";
import { useSim } from "../sim/store";
import { Card, Label, Stat, cx } from "../components/ui";
import { axis, grid, tooltip } from "./chart";
import { Frame } from "./Frame";

const HF_CAP = 4;

export function Guard() {
  const { state, dispatch } = useSim();
  const active = state.guardActive;
  const run = active?.run ?? state.lastGuard;
  const shown = run ? run.ticks.slice(0, active ? active.tick + 1 : run.ticks.length) : [];
  const data = shown.map((t) => ({ ...t, hfWith: Math.min(HF_CAP, t.hfWith), hfWithout: Math.min(HF_CAP, t.hfWithout) }));
  const finished = run && !active ? run.summary : null;
  const hf = healthFactor(state.collBtc, state.price, state.debt);

  return (
    <Frame
      kicker="Tahansoe"
      lead={<>Markets don't sleep; you do. Pick a scenario and replay it twice on your exact position: once with Tahansoe guarding, once without.</>}
      doneNote="Stress-tested"
    >
      <div className="grid grid-cols-2 gap-4 @lg:grid-cols-4">
        <Stat label="Health factor now" value={fmtHf(hf)} tone="safe" />
        <Stat label="Tahansoe acts at" value={fmtUsd(triggerPrice(state.collBtc, state.debt))} tone="warning" sub={`HF < ${TRIGGER_HF.toFixed(2)}`} />
        <Stat label="Liquidation at" value={fmtUsd(liquidationPrice(state.collBtc, state.debt))} tone="danger" />
        <Stat label="Guard reserve" value={fmtUsd(state.reserve)} tone="gold" sub="from collateral yield" />
      </div>

      <div className="grid gap-3 @lg:grid-cols-3">
        {SCENARIOS.map((s) => {
          const ran = state.guardRuns.some((r) => r.scenario === s.id);
          const running = active?.run.summary.scenario === s.id;
          return (
            <button
              key={s.id}
              disabled={!!active}
              onClick={() => dispatch({ type: "START_GUARD", scenario: s.id })}
              className={cx(
                "rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed",
                running ? "border-danger bg-danger-bg" : s.id === "crash" ? "border-danger-line bg-bg-subtle hover:border-danger" : "border-line bg-bg-subtle hover:border-line-strong",
                active && !running && "opacity-40",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{s.name}</span>
                {ran && !running && <span className="font-mono text-[10px] uppercase tracking-wider text-safe">ran</span>}
                {running && <span className="font-mono text-[10px] uppercase tracking-wider text-danger">running…</span>}
              </div>
              <div className="mt-1 text-[13px] leading-relaxed text-ink-3">{s.blurb}</div>
            </button>
          );
        })}
      </div>

      {run ? (
        <div className="grid gap-4">
          <ChartCard title="BTC price" sub={`${fmtUsd(run.ticks[0].price)} → ${fmtUsd(run.summary.finalPrice)}`}>
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
              <CartesianGrid {...grid} />
              <XAxis dataKey="day" type="number" domain={[0, run.ticks[run.ticks.length - 1].day]} {...axis} tickFormatter={(d) => `d${Number(d).toFixed(0)}`} />
              <YAxis {...axis} domain={[(min: number) => Math.floor((min * 0.95) / 1000) * 1000, "auto"]} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} width={52} />
              <Tooltip {...tooltip} labelFormatter={(d) => `Day ${Number(d).toFixed(1)}`} formatter={(v) => [fmtUsd(Number(v)), "BTC"]} />
              <ReferenceLine y={triggerPrice(state.collBtc, state.debt)} stroke="var(--warning)" strokeDasharray="4 3" />
              <ReferenceLine y={liquidationPrice(state.collBtc, state.debt)} stroke="var(--danger)" strokeDasharray="4 3" />
              <Line type="monotone" dataKey="price" stroke="var(--text-primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ChartCard>
          <ChartCard title="Health factor" sub="with vs. without Tahansoe">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid {...grid} />
              <XAxis dataKey="day" type="number" domain={[0, run.ticks[run.ticks.length - 1].day]} {...axis} tickFormatter={(d) => `d${Number(d).toFixed(0)}`} />
              <YAxis {...axis} domain={[0, HF_CAP]} ticks={[0, 1, TRIGGER_HF, TARGET_HF, 2, 3, 4]} tickFormatter={(v) => Number(v).toFixed(1)} width={44} />
              <Tooltip {...tooltip} labelFormatter={(d) => `Day ${Number(d).toFixed(1)}`} formatter={(v, name) => [fmtHf(Number(v)), name === "hfWith" ? "With Tahansoe" : "Without"]} />
              <ReferenceLine y={1} stroke="var(--danger)" strokeDasharray="4 3" />
              <ReferenceLine y={TRIGGER_HF} stroke="var(--warning)" strokeDasharray="4 3" />
              <ReferenceLine y={TARGET_HF} stroke="var(--safe)" strokeDasharray="2 4" />
              <Line type="monotone" dataKey="hfWithout" stroke="var(--danger)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="hfWith" stroke="var(--brand)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ChartCard>
        </div>
      ) : (
        <div className="grid h-40 place-items-center rounded-xl border border-dashed border-line-strong text-sm text-ink-3">
          Pick a scenario. Try “Crash through liquidation” to see Tahansoe act.
        </div>
      )}

      {finished && <Outcome s={finished} />}
    </Frame>
  );
}

function ChartCard({ title, sub, children }: { title: string; sub: string; children: React.ReactElement }) {
  return (
    <div className="rounded-xl border border-line bg-bg-subtle p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Label>{title}</Label>
        <span className="truncate font-mono text-[10.5px] text-ink-3">{sub}</span>
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Outcome({ s }: { s: GuardSummary }) {
  const idle = s.actions === 0;
  return (
    <div className="grid gap-3 @xl:grid-cols-2">
      <Card className="border-brand-dim/60 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-brand">
          <ShieldCheck size={16} /> With Tahansoe
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Stat label="Lowest HF" value={fmtHf(s.minHfWith)} tone={s.minHfWith >= 1 ? "safe" : "danger"} />
          <Stat label="Actions" value={String(s.actions)} sub={idle ? "no false positives" : undefined} />
          {!idle && <Stat label="From reserve" value={fmtUsd(s.repaidFromReserve)} tone="gold" />}
          {!idle && <Stat label="Via flash loan" value={fmtUsd(s.repaidViaFlash)} sub={`${fmtBtc(s.btcSoldWith)} sold`} />}
          {!idle && <Stat label="Cost" value={fmtUsd(s.costWith)} sub="flash fee + slippage" />}
          <Stat label="Liquidations" value="0" tone="safe" />
        </div>
      </Card>
      <Card className={cx("p-4", s.liquidations ? "border-danger-line" : "")}>
        <div className={cx("flex items-center gap-2 text-sm font-medium", s.liquidations ? "text-danger" : "text-ink-2")}>
          {s.liquidations ? <Skull size={16} /> : <Zap size={16} />} Without Tahansoe
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Stat label="Lowest HF" value={fmtHf(s.minHfWithout)} tone={s.minHfWithout >= 1 ? "safe" : "danger"} />
          <Stat label="Liquidations" value={String(s.liquidations)} tone={s.liquidations ? "danger" : undefined} />
          {s.liquidations > 0 && <Stat label="Penalty paid" value={fmtUsd(s.penaltyWithout)} tone="danger" />}
          {s.liquidations > 0 && <Stat label="BTC seized" value={fmtBtc(s.btcSeizedWithout)} tone="danger" />}
        </div>
        {s.liquidations > 0 && (
          <div className="mt-3 text-xs text-ink-3">
            Tahansoe saved {fmtUsd(s.penaltyWithout - s.costWith)} versus being liquidated.
          </div>
        )}
      </Card>
    </div>
  );
}
