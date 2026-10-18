import { Activity, Landmark, ShieldCheck, Wallet } from "lucide-react";
import { BORROWER_FIXED_RATE, LENDER_APY } from "../sim/constants";
import { fmtBtc, fmtHf, fmtPct, fmtUsd, healthFactor, liquidationPrice, triggerPrice } from "../sim/model";
import { timeLabel, useSim, venueOf } from "../sim/store";
import { HFGauge } from "./HFGauge";
import { Card, Label, Pill } from "./ui";

export function PositionPanel() {
  const { state } = useSim();
  const g = state.guardActive;
  const live = g ? g.run.ticks[g.tick] : null;
  const price = live?.price ?? state.price;
  const hf = live ? live.hfWith : healthFactor(state.collBtc, state.price, state.debt);
  const coll = live?.collWith ?? state.collBtc;
  const debt = live?.debtWith ?? state.debt;
  const reserve = live?.reserve ?? state.reserve;
  const venue = venueOf(state.venue);
  const hasDebt = debt > 0;

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Wallet size={15} className="text-brand" /> Borrower position
          </div>
          {live ? <Pill tone="danger">Live crash</Pill> : <Pill>{timeLabel(state)}</Pill>}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <Row label="BTC price" value={fmtUsd(price)} hint={live ? `day ${live.day.toFixed(1)}` : "mock oracle"} />
          <Row label="Wallet" value={fmtBtc(state.walletBtc)} />
          <Row label="Collateral" value={fmtBtc(coll)} hint={coll ? fmtUsd(coll * price) : undefined} />
          <Row label="Debt" value={fmtUsd(debt)} hint={state.borrowed ? `borrowed ${fmtUsd(state.borrowed)}` : undefined} />
        </div>

        <div className="mt-4 border-t border-line pt-4">
          {hasDebt || live ? (
            <>
              <HFGauge hf={hf} />
              {live && (
                <div className="mt-3 flex items-center justify-between rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-xs">
                  <span className="text-ink-2">Same position, no Tahansoe</span>
                  <span className="font-semibold tabular text-danger">HF {fmtHf(live.hfWithout)}</span>
                </div>
              )}
              {!live && (
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
                  <Row label="Liquidation at" value={fmtUsd(liquidationPrice(coll, debt))} tone="danger" />
                  <Row label="Tahansoe acts at" value={fmtUsd(triggerPrice(coll, debt))} tone="warning" />
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-ink-3">
              <Activity size={14} /> {state.collBtc ? "No debt yet. Health factor is ∞." : "Nothing supplied yet."}
            </div>
          )}
        </div>

        {(state.fixedRate || venue) && (
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4">
            <Row label="Borrow rate" value={state.fixedRate ? `${fmtPct(state.fixedRate, 0)} fixed` : "—"} hint={state.termDays ? `${state.termDays}-day term` : undefined} />
            <Row label="Collateral yield" value={venue ? `~${fmtPct(venue.apy, 0)} APY` : "—"} hint={venue?.name} />
            {state.committedMonth !== null && (
              <>
                <Row label="Yield → debt" value={fmtUsd(state.sweptToDebt)} tone="brand" />
                <Row label="Guard reserve" value={fmtUsd(reserve)} tone="gold" hint="yield-funded" />
              </>
            )}
          </div>
        )}
      </Card>

      {state.lenderSupplied > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Landmark size={15} className="text-gold" /> Lender
            </div>
            <Pill tone="brand">{fmtPct(LENDER_APY, 0)} fixed</Pill>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <Row label="Supplied" value={fmtUsd(state.lenderSupplied)} />
            <Row label="Utilization" value={fmtPct(state.borrowed / state.lenderSupplied, 0)} hint={`${fmtUsd(state.borrowed)} lent`} />
            {state.committedMonth !== null && (
              <>
                <Row label="Earned" value={fmtUsd(state.lenderEarned)} tone="safe" />
                <Row label="Rate buffer" value={fmtUsd(state.spreadEarned)} hint={`${fmtPct(BORROWER_FIXED_RATE - LENDER_APY, 0)} spread`} />
              </>
            )}
          </div>
        </Card>
      )}

      {state.done.time && (
        <div className="flex items-start gap-2 rounded-lg border border-line bg-bg-subtle px-3 py-2.5 text-xs leading-relaxed text-ink-2">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-brand" />
          Tahansoe watches HF on every oracle update. Below 1.30 it repays from the reserve first, then flash-loans the rest. Target: 1.60.
        </div>
      )}
    </div>
  );
}

function Row({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" | "warning" | "brand" | "gold" | "safe" }) {
  const color = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "brand" ? "text-brand" : tone === "gold" ? "text-gold" : tone === "safe" ? "text-safe" : "text-ink";
  return (
    <div className="min-w-0">
      <Label className="text-[10px]">{label}</Label>
      <div className={`mt-0.5 truncate text-sm font-semibold tabular ${color}`}>{value}</div>
      {hint && <div className="truncate text-[11px] text-ink-3">{hint}</div>}
    </div>
  );
}
