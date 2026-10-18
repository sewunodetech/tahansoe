import { AlertTriangle } from "lucide-react";
import { MAX_LTV, POLICY_MAX_LTV, TARGET_HF } from "../sim/constants";
import { fmtHf, fmtPct, fmtUsd, healthFactor, liquidationPrice, triggerPrice } from "../sim/model";
import { useSim } from "../sim/store";
import { HFGauge } from "../components/HFGauge";
import { Button, Explainer, Label, Slider, Stat, cx } from "../components/ui";
import { Frame } from "./Frame";

const PRESETS = [
  { ltv: 0.2, label: "20% · conservative" },
  { ltv: 0.4, label: "40% · moderate" },
  { ltv: 0.55, label: "55% · aggressive" },
];

export function Borrow() {
  const { state, dispatch } = useSim();
  const done = state.done.borrow;
  const ltv = done ? state.borrowed / (state.collBtc * state.price) : state.ltvDraft;
  const amount = done ? state.borrowed : Math.min(state.lenderSupplied, Math.round(state.collBtc * state.price * ltv));
  const hf = healthFactor(state.collBtc, state.price, amount);
  const liq = liquidationPrice(state.collBtc, amount);
  const trig = triggerPrice(state.collBtc, amount);

  return (
    <Frame
      kicker="Borrow"
      lead={<>You want 20% of your BTC's value as USDT, without selling the BTC. Pick how much to borrow and watch the health factor respond.</>}
      doneNote={`Borrowed ${fmtUsd(state.borrowed)}`}
    >
      <div className="rounded-xl border border-line bg-bg-subtle p-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <Label>Borrow amount</Label>
            <div className="mt-1 font-display text-5xl tabular">{fmtUsd(amount)}</div>
            <div className="mt-1 text-sm text-ink-3">USDT at {fmtPct(ltv, 0)} loan-to-value</div>
          </div>
          <div className="text-right text-xs text-ink-3">
            <div>Protocol max {fmtPct(MAX_LTV, 0)}</div>
            <div>Guarded max {fmtPct(POLICY_MAX_LTV, 0)}</div>
          </div>
        </div>
        <div className="mt-5">
          <Slider label="Loan to value" value={ltv} min={0.05} max={POLICY_MAX_LTV} step={0.01} disabled={done} onChange={(v) => dispatch({ type: "SET_LTV", ltv: v })} />
          <div className="mt-3 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.ltv}
                disabled={done}
                onClick={() => dispatch({ type: "SET_LTV", ltv: p.ltv })}
                className={cx(
                  "rounded-full border px-3 py-1 font-mono text-[11px] transition-colors disabled:cursor-not-allowed",
                  Math.abs(ltv - p.ltv) < 0.005 ? "border-brand bg-brand-bg text-brand" : "border-line-strong text-ink-3 hover:text-ink",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <HFGauge hf={hf} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Health factor" value={fmtHf(hf)} sub="collateral × 78% ÷ debt" />
        <Stat label="Tahansoe acts at" value={fmtUsd(trig)} tone="warning" sub={`BTC −${fmtPct(1 - trig / state.price, 0)}`} />
        <Stat label="Liquidated at" value={fmtUsd(liq)} tone="danger" sub={`BTC −${fmtPct(1 - liq / state.price, 0)}`} />
      </div>

      {hf < TARGET_HF && (
        <div className="flex items-start gap-2 rounded-lg border border-warning-line bg-warning-bg px-4 py-3 text-sm text-warning">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          This position already starts below Tahansoe's {TARGET_HF.toFixed(2)} target. It works, but it'll be busy.
        </div>
      )}

      <Explainer title="Health factor in one line">
        HF = (collateral value × liquidation threshold) ÷ debt. Above 1 you're safe; below 1 anyone can liquidate you and take a ~7.5% penalty out of your collateral.
      </Explainer>

      <Button variant="brand" size="lg" disabled={done} onClick={() => dispatch({ type: "BORROW" })}>
        {done ? "Borrowed" : `Borrow ${fmtUsd(amount)} USDT`}
      </Button>
    </Frame>
  );
}
