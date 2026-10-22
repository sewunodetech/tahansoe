import { Play, RotateCcw } from "lucide-react";
import { BORROWER_FIXED_RATE, LENDER_APY, SCENARIOS } from "../sim/constants";
import { fmtBtc, fmtHf, fmtPct, fmtUsd } from "../sim/model";
import { useSim, venueOf } from "../sim/store";
import { Button, Label } from "../components/ui";
import { Frame } from "./Frame";

export function Receipt() {
  const { state, dispatch } = useSim();
  const venue = venueOf(state.venue);
  const runs = state.guardRuns;
  const saved = runs.reduce((a, r) => a + Math.max(0, r.penaltyWithout - r.costWith), 0);

  const lines: [string, string, string?][] = [
    ["Collateral supplied", fmtBtc(state.collBtc), `${fmtUsd(state.collBtc * state.price)}`],
    ["Borrowed", fmtUsd(state.borrowed), "USDT"],
    ["Fixed rate", `${fmtPct(BORROWER_FIXED_RATE, 0)} APR`, state.termDays ? `${state.termDays}-day term` : undefined],
    ["Collateral yield", venue ? `~${fmtPct(venue.apy, 0)} APY` : "—", venue?.name],
    ["Time elapsed", `${state.committedMonth ?? 0} months`],
    ["Interest charged", fmtUsd(state.interestPaid)],
    ["You paid", fmtUsd(state.userPaid)],
    ["Yield paid for you", fmtUsd(state.sweptToDebt)],
    ["Debt remaining", fmtUsd(state.debt), `from ${fmtUsd(state.borrowed)}`],
    ["Guard reserve built", fmtUsd(state.reserve)],
  ];

  return (
    <Frame
      kicker="Receipt"
      lead={<>One BTC became a USDT loan at a fixed rate, the BTC earned while it was locked, the yield paid down the loan, and Tahansoe stood guard. Here's the trip.</>}
    >
      <div className="grid gap-5">
        <div className="rounded-xl border border-line bg-bg-subtle p-5 font-mono text-[13px]">
          <div className="flex items-center justify-between border-b border-dashed border-line-strong pb-3">
            <span className="text-ink-3">BORROWER</span>
            <span className="text-ink-3">TAHANSOE · SIM</span>
          </div>
          <dl className="divide-y divide-dashed divide-line">
            {lines.map(([k, v, sub]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-ink-3">{k}</dt>
                <dd className="text-right">
                  <span className="text-ink tabular">{v}</span>
                  {sub && <span className="block text-[11px] text-ink-4">{sub}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-gold/40 bg-gold-bg p-5">
            <Label className="text-gold">Lender</Label>
            <div className="mt-2 font-display text-4xl font-light tabular">{fmtUsd(state.lenderEarned)}</div>
            <div className="mt-1 text-sm text-ink-2">earned at a fixed {fmtPct(LENDER_APY, 0)}, plus {fmtUsd(state.spreadEarned)} in the rate buffer</div>
          </div>

          <div className="rounded-xl border border-brand-dim/60 bg-brand-bg/50 p-5">
            <Label className="text-brand">Tahansoe guard</Label>
            <ul className="mt-3 space-y-2 text-sm">
              {runs.map((r, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3">
                  <span className="text-ink-2">{SCENARIOS.find((s) => s.id === r.scenario)?.name}</span>
                  <span className="shrink-0 text-right tabular">
                    {r.actions ? `${r.actions} action${r.actions > 1 ? "s" : ""} · min HF ${fmtHf(r.minHfWith)}` : "idle"}
                    {r.liquidations > 0 && <span className="block text-xs text-danger">avoided {r.liquidations} liquidation{r.liquidations > 1 ? "s" : ""}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {saved > 0 && <div className="mt-4 border-t border-brand-dim/40 pt-3 text-sm text-ink">Saved {fmtUsd(saved)} in liquidation penalties, net of costs.</div>}
          </div>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-ink-3">
        Simulation with mock prices and rates. Tahansoe is risk automation, not a guarantee against liquidation: intra-block crashes, oracle lag and congestion can still beat any agent.
      </p>

      <div className="flex flex-wrap gap-3">
        <Button variant="brand" size="lg" onClick={() => dispatch({ type: "RESET" })}>
          <RotateCcw size={16} /> Start a new journey
        </Button>
        <Button
          variant="ghost"
          size="lg"
          onClick={() => {
            dispatch({ type: "RESET" });
            dispatch({ type: "SET_AUTO", on: true });
          }}
        >
          <Play size={16} /> Replay as auto demo
        </Button>
      </div>
    </Frame>
  );
}
