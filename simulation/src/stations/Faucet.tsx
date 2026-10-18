import { Bitcoin, Droplets } from "lucide-react";
import { BTC_PRICE_0, FAUCET_BTC } from "../sim/constants";
import { fmtBtc, fmtUsd } from "../sim/model";
import { useSim } from "../sim/store";
import { Button, Stat } from "../components/ui";
import { Frame } from "./Frame";

export function Faucet() {
  const { state, dispatch } = useSim();
  const done = state.done.faucet;
  return (
    <Frame
      kicker="Start"
      lead={<>Every journey starts with an asset. Claim one mock BTC to play with. There's no wallet and no gas here: it's all simulated in your browser.</>}
      doneNote="BTC in your wallet"
    >
      <div className="flex flex-col items-center gap-5 rounded-xl border border-line bg-bg-subtle px-6 py-10 text-center">
        <div className={`grid h-20 w-20 place-items-center rounded-full border-2 ${done ? "border-gold bg-gold-bg text-gold" : "border-line-strong text-ink-3"}`}>
          <Bitcoin size={38} />
        </div>
        <div>
          <div className="font-display text-4xl tabular">{fmtBtc(done ? state.walletBtc : FAUCET_BTC)}</div>
          <div className="mt-1 text-sm text-ink-3">Mock oracle: 1 BTC = {fmtUsd(BTC_PRICE_0)}</div>
        </div>
        <Button variant="brand" onClick={() => dispatch({ type: "CLAIM" })} disabled={done} size="lg">
          <Droplets size={16} /> {done ? "Claimed" : `Claim ${FAUCET_BTC} mock BTC`}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-4 @sm:grid-cols-3">
        <Stat label="Wallet" value={fmtBtc(state.walletBtc)} />
        <Stat label="Value" value={fmtUsd(state.walletBtc * state.price)} />
        <Stat label="Network" value="Arbitrum" sub="simulated" className="hidden @sm:block" />
      </div>
    </Frame>
  );
}
