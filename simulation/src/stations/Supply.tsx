import { ShieldCheck } from "lucide-react";
import { LIQ_THRESHOLD, MAX_LTV } from "../sim/constants";
import { fmtBtc, fmtPct, fmtUsd } from "../sim/model";
import { useSim } from "../sim/store";
import { Button, Explainer, Stat } from "../components/ui";
import { Flow } from "./Flow";
import { Frame } from "./Frame";

export function Supply() {
  const { state, dispatch } = useSim();
  const done = state.done.supply;
  const btc = done ? state.collBtc : state.walletBtc;
  const value = btc * state.price;
  return (
    <Frame
      kicker="Collateral"
      lead={<>Deposit your BTC into the BTC pool. It becomes collateral: you can borrow against it, and it stays yours.</>}
      doneNote="BTC is collateral"
    >
      <Flow
        nodes={[
          { title: "Your wallet", sub: fmtBtc(done ? 0 : btc), tone: "neutral" },
          { title: "BTC pool", sub: done ? `${fmtBtc(btc)} locked` : "empty", tone: "brand", active: done },
        ]}
        edges={["supply"]}
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Collateral value" value={fmtUsd(value)} />
        <Stat label="Liq. threshold" value={fmtPct(LIQ_THRESHOLD, 0)} sub="mock, WBTC-like" />
        <Stat label="Max LTV" value={fmtPct(MAX_LTV, 0)} />
        <Stat label="Borrow capacity" value={fmtUsd(value * MAX_LTV)} tone="brand" />
      </div>
      <Explainer title="Non-custodial by design">
        <span className="inline-flex items-start gap-2">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-brand" />
          Tahansoe never takes custody. Its guardian can only repay your debt or rebalance your own position; it can't withdraw your funds anywhere else.
        </span>
      </Explainer>
      <Button variant="brand" size="lg" disabled={done || state.walletBtc <= 0} onClick={() => dispatch({ type: "DEPOSIT" })}>
        {done ? "Supplied" : `Supply ${fmtBtc(state.walletBtc)}`}
      </Button>
    </Frame>
  );
}
