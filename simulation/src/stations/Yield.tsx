import { Sprout } from "lucide-react";
import { BORROWER_FIXED_RATE, SWEEP_TO_DEBT, SWEEP_TO_RESERVE, YIELD_VENUES } from "../sim/constants";
import { fmtBtc, fmtPct, fmtUsd } from "../sim/model";
import { useSim, venueOf } from "../sim/store";
import { Button, Explainer, Pill, Stat, cx } from "../components/ui";
import { Flow } from "./Flow";
import { Frame } from "./Frame";

export function Yield() {
  const { state, dispatch } = useSim();
  const done = state.done.yield;
  const v = venueOf(done ? state.venue : state.venueDraft)!;
  const yearly = state.collBtc * state.price * v.apy;
  const interest = state.borrowed * BORROWER_FIXED_RATE;

  return (
    <Frame
      kicker="Collateral that works"
      lead={<>Your 1 BTC sits locked for the whole loan. What if it earned while it waited, and that yield paid down the loan for you? Pick where it goes.</>}
      doneNote={`Earning ~${fmtPct(v.apy, 0)}`}
    >
      <div className="grid gap-3 @xl:grid-cols-3">
        {YIELD_VENUES.map((venue) => {
          const selected = venue.id === v.id;
          return (
            <button
              key={venue.id}
              disabled={done}
              onClick={() => dispatch({ type: "SET_VENUE", venue: venue.id })}
              aria-pressed={selected}
              className={cx(
                "rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed",
                selected ? "border-brand bg-brand-bg/60" : "border-line bg-bg-subtle hover:border-line-strong",
                done && !selected && "opacity-40",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{venue.name}</span>
                <Pill tone={venue.risk === "Low" ? "safe" : venue.risk === "Medium" ? "warning" : "danger"}>{venue.risk} risk</Pill>
              </div>
              <div className="mt-3 font-display text-3xl tabular text-ink">~{fmtPct(venue.apy, 0)}</div>
              <div className="text-xs text-ink-3">APY, paid in BTC</div>
              <div className="mt-3 text-[13px] leading-relaxed text-ink-3">{venue.how}</div>
            </button>
          );
        })}
      </div>

      <Flow
        nodes={[
          { title: "Locked BTC", sub: `${fmtBtc(state.collBtc)} earning ~${fmtPct(v.apy, 0)}`, tone: "brand" },
          { title: "Yield sweep", sub: `${fmtUsd(yearly / 12)} / month`, tone: "neutral" },
          { title: `${fmtPct(SWEEP_TO_DEBT, 0)} → repay debt`, sub: `${fmtUsd((yearly * SWEEP_TO_DEBT) / 12)} / month`, tone: "safe" },
          { title: `${fmtPct(SWEEP_TO_RESERVE, 0)} → guard reserve`, sub: "Tahansoe's first line", tone: "gold" },
        ]}
        edges={["earns", "splits", "+"]}
      />

      <div className="grid grid-cols-2 gap-4 @sm:grid-cols-3">
        <Stat label="Yield per year" value={fmtUsd(yearly)} tone="brand" />
        <Stat label="Interest per year" value={fmtUsd(interest)} sub={`${fmtPct(BORROWER_FIXED_RATE, 0)} on ${fmtUsd(state.borrowed)}`} />
        <Stat
          label="Yield covers"
          value={fmtPct((yearly * SWEEP_TO_DEBT) / Math.max(1, interest), 0)}
          sub="of your interest"
          tone={yearly * SWEEP_TO_DEBT >= interest ? "safe" : "warning"}
        />
      </div>

      <Explainer title="“But how?” — the BTC still secures your loan">
        The pool accepts the yield-bearing form of BTC as collateral, the same way lending markets accept staked ETH. So the BTC keeps backing your loan while it earns. The venue's risk becomes part of your position, and Tahansoe watches it alongside your health factor.
      </Explainer>

      <Button variant="brand" size="lg" disabled={done} onClick={() => dispatch({ type: "STAKE" })}>
        <Sprout size={16} /> {done ? "BTC is earning" : `Route BTC to ${v.name}`}
      </Button>
    </Frame>
  );
}
