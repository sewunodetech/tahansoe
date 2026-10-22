import { Landmark } from "lucide-react";
import { LENDER_APY, LENDER_SUPPLY } from "../sim/constants";
import { fmtPct, fmtUsd } from "../sim/model";
import { useSim } from "../sim/store";
import { Button, Explainer, Stat } from "../components/ui";
import { Flow } from "./Flow";
import { Frame } from "./Frame";

export function Lender() {
  const { state, dispatch } = useSim();
  const done = state.done.lender;
  return (
    <Frame
      kicker="The other side"
      lead={<>A loan needs a lender. Someone holding USDT supplies it to the pool. They want a predictable {fmtPct(LENDER_APY, 0)} on it.</>}
      doneNote="Liquidity is in"
    >
      <Flow
        nodes={[
          { title: "Lender", sub: `${fmtUsd(LENDER_SUPPLY)} USDT`, tone: "gold" },
          { title: "USDT liquidity", sub: done ? `${fmtUsd(state.lenderSupplied)} available` : "empty", tone: "brand", active: done },
          { title: "Your BTC pool", sub: "collateral ready", tone: "neutral" },
        ]}
        edges={["lends", "backs loans"]}
      />
      <div className="grid grid-cols-2 gap-4 @sm:grid-cols-3">
        <Stat label="Lender supplies" value={fmtUsd(LENDER_SUPPLY)} />
        <Stat label="Lender wants" value={`${fmtPct(LENDER_APY, 0)} APY`} tone="gold" sub="fixed, not floating" />
        <Stat label="Available to borrow" value={fmtUsd(state.lenderSupplied)} tone="brand" />
      </div>
      <Explainer title="Why fixed matters to the lender">
        On a normal pool the lender's rate floats with utilization: 3% one week, 15% the next. Our lender wants to know their return upfront. Hold that thought until station 5.
      </Explainer>
      <Button variant="brand" size="lg" disabled={done} onClick={() => dispatch({ type: "LENDER_SUPPLY" })}>
        <Landmark size={16} /> {done ? "Lender supplied" : `Lender supplies ${fmtUsd(LENDER_SUPPLY)}`}
      </Button>
    </Frame>
  );
}
