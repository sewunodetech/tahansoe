import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Lock, MousePointerClick } from "lucide-react";
import {
  BORROWER_FIXED_RATE,
  FAUCET_BTC,
  LENDER_APY,
  LENDER_SUPPLY,
  LIQ_THRESHOLD,
  PROTOCOL_SPREAD,
  STATIONS,
  SWEEP_TO_RESERVE,
  TRIGGER_HF,
  type StationId,
} from "../sim/constants";
import { fmtBtc, fmtHf, fmtPct, fmtUsd, healthFactor, payoffMonth, triggerPrice } from "../sim/model";
import { canView, projectionFor, stationIndex, useSim, venueOf, type SimState } from "../sim/store";
import { cx } from "./ui";

/* ── Geometry ──────────────────────────────────────────────────────────────
   A fixed 1000-wide canvas, scaled to fit. The spine runs down the middle
   (the borrower's journey); side nodes are the counterparties and money
   sources around it, like the whiteboard sketch.                           */

const W = 1000;
const H = 1230;
const SPINE_X = 500;
const LEFT_X = 160;
const RIGHT_X = 840;

type NodeId =
  | "faucet" | "borrower" | "pool" | "lender" | "loan" | "fixed" | "buffer" | "yield" | "venue"
  | "repay" | "reserve" | "guard" | "flash" | "liquidator" | "receipt";

interface BoardNode {
  id: NodeId;
  station: StationId;
  x: number;
  y: number;
  title: string;
  side?: boolean;
  /** Spine nodes are the destination of their station's arrow. */
  target?: boolean;
}

const NODES: BoardNode[] = [
  { id: "faucet", station: "faucet", x: LEFT_X, y: 90, title: "Mock BTC faucet", side: true },
  { id: "borrower", station: "faucet", x: SPINE_X, y: 90, title: "You, the borrower", target: true },
  { id: "pool", station: "supply", x: SPINE_X, y: 245, title: "BTC pool", target: true },
  { id: "lender", station: "lender", x: RIGHT_X, y: 245, title: "Lender · USDT", side: true, target: true },
  { id: "loan", station: "borrow", x: SPINE_X, y: 400, title: "USDT loan", target: true },
  { id: "fixed", station: "fixed", x: SPINE_X, y: 555, title: "Fixed-rate match", target: true },
  { id: "buffer", station: "fixed", x: RIGHT_X, y: 610, title: "Rate buffer", side: true },
  { id: "yield", station: "yield", x: SPINE_X, y: 710, title: "Collateral yield", target: true },
  { id: "venue", station: "yield", x: LEFT_X - 15, y: 710, title: "Yield venue", side: true },
  { id: "repay", station: "time", x: SPINE_X, y: 865, title: "Auto-repay", target: true },
  { id: "reserve", station: "time", x: RIGHT_X, y: 865, title: "Guard reserve", side: true },
  { id: "guard", station: "guard", x: SPINE_X, y: 1020, title: "Tahansoe guard", target: true },
  { id: "flash", station: "guard", x: RIGHT_X, y: 1120, title: "Flash loan", side: true },
  { id: "liquidator", station: "guard", x: LEFT_X, y: 1020, title: "Liquidator", side: true },
  { id: "receipt", station: "receipt", x: SPINE_X, y: 1160, title: "Journey receipt", target: true },
];

const nodeSize = (n: BoardNode) => (n.side ? { w: 210, h: 74 } : { w: 250, h: 80 });

type Side = "top" | "bottom" | "left" | "right";
type EdgeKind = "spine" | "flow" | "back" | "danger";

interface BoardEdge {
  from: NodeId;
  to: NodeId;
  out: Side;
  in: Side;
  label: string;
  station: StationId;
  kind: EdgeKind;
  outOffset?: number;
  inOffset?: number;
  bend?: number;
}

const EDGES: BoardEdge[] = [
  { from: "faucet", to: "borrower", out: "right", in: "left", label: "claim 1 mBTC", station: "faucet", kind: "spine" },
  { from: "borrower", to: "pool", out: "bottom", in: "top", label: "supply as collateral", station: "supply", kind: "spine" },
  { from: "lender", to: "pool", out: "left", in: "right", label: "lends USDT · wants 10%", station: "lender", kind: "flow" },
  { from: "pool", to: "loan", out: "bottom", in: "top", label: "borrow 20% as USDT", station: "borrow", kind: "spine" },
  { from: "loan", to: "fixed", out: "bottom", in: "top", label: "how to get a fixed rate?", station: "fixed", kind: "spine" },
  { from: "lender", to: "fixed", out: "bottom", in: "right", label: "commits a term", station: "fixed", kind: "flow", inOffset: -14 },
  { from: "fixed", to: "buffer", out: "right", in: "left", label: "1% spread", station: "fixed", kind: "flow", outOffset: 14 },
  { from: "fixed", to: "yield", out: "bottom", in: "top", label: "put locked BTC to work", station: "yield", kind: "spine" },
  { from: "venue", to: "yield", out: "right", in: "left", label: "earns yield", station: "yield", kind: "flow" },
  { from: "yield", to: "repay", out: "bottom", in: "top", label: "yield sweep", station: "time", kind: "spine" },
  { from: "repay", to: "loan", out: "left", in: "left", label: "repay the loan faster", station: "time", kind: "back", bend: 125 },
  { from: "repay", to: "reserve", out: "right", in: "left", label: "20% kept", station: "time", kind: "flow" },
  { from: "repay", to: "guard", out: "bottom", in: "top", label: "market crashes", station: "guard", kind: "spine" },
  { from: "reserve", to: "guard", out: "bottom", in: "right", label: "repays first", station: "guard", kind: "flow", inOffset: -16 },
  { from: "flash", to: "guard", out: "left", in: "right", label: "fallback", station: "guard", kind: "flow", inOffset: 16 },
  { from: "guard", to: "liquidator", out: "left", in: "right", label: "keeps HF above 1", station: "guard", kind: "danger" },
  { from: "guard", to: "receipt", out: "bottom", in: "top", label: "journey complete", station: "receipt", kind: "spine" },
];

const byId = Object.fromEntries(NODES.map((n) => [n.id, n])) as Record<NodeId, BoardNode>;

function anchor(n: BoardNode, side: Side, offset = 0): { x: number; y: number; dx: number; dy: number } {
  const { w, h } = nodeSize(n);
  switch (side) {
    case "top": return { x: n.x + offset, y: n.y - h / 2, dx: 0, dy: -1 };
    case "bottom": return { x: n.x + offset, y: n.y + h / 2, dx: 0, dy: 1 };
    case "left": return { x: n.x - w / 2, y: n.y + offset, dx: -1, dy: 0 };
    case "right": return { x: n.x + w / 2, y: n.y + offset, dx: 1, dy: 0 };
  }
}

const ARROW_GAP = 7; // room for the arrowhead before the node border

function edgeGeometry(e: BoardEdge) {
  const a = anchor(byId[e.from], e.out, e.outOffset);
  const bRaw = anchor(byId[e.to], e.in, e.inOffset);
  const b = { ...bRaw, x: bRaw.x + bRaw.dx * ARROW_GAP, y: bRaw.y + bRaw.dy * ARROW_GAP };
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const k = e.bend ?? Math.max(30, dist * 0.42);
  const c1 = { x: a.x + a.dx * k, y: a.y + a.dy * k };
  const c2 = { x: b.x + b.dx * k, y: b.y + b.dy * k };
  const d = `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
  const t = 0.5;
  const mt = 1 - t;
  const mid = {
    x: mt ** 3 * a.x + 3 * mt ** 2 * t * c1.x + 3 * mt * t ** 2 * c2.x + t ** 3 * b.x,
    y: mt ** 3 * a.y + 3 * mt ** 2 * t * c1.y + 3 * mt * t ** 2 * c2.y + t ** 3 * b.y,
  };
  // Arrowhead points along the final tangent (c2 → b), into the node.
  const angle = (Math.atan2(b.y - c2.y, b.x - c2.x) * 180) / Math.PI;
  return { d, mid, end: b, angle };
}

/* ── Live "example" line on every node ─────────────────────────────────── */

function example(id: NodeId, s: SimState): { text: string; live: boolean } {
  const venue = venueOf(s.venue ?? s.venueDraft);
  const hf = healthFactor(s.collBtc, s.price, s.debt);
  switch (id) {
    case "faucet":
      return { text: s.done.faucet ? `sent ${fmtBtc(FAUCET_BTC)}` : `e.g. ${fmtBtc(FAUCET_BTC)} = ${fmtUsd(s.price)}`, live: s.done.faucet };
    case "borrower":
      return s.done.faucet
        ? { text: `wallet ${fmtBtc(s.walletBtc)}${s.borrowed ? ` · +${fmtUsd(s.borrowed)} USDT` : ""}`, live: true }
        : { text: "e.g. holds BTC, needs dollars", live: false };
    case "pool":
      return s.done.supply
        ? { text: `${fmtBtc(s.collBtc)} locked · ${s.debt ? `HF ${fmtHf(hf)}` : `LT ${fmtPct(LIQ_THRESHOLD, 0)}`}`, live: true }
        : { text: `e.g. 1 BTC → ${fmtUsd(s.price * 0.73)} borrow capacity`, live: false };
    case "lender":
      return s.done.lender
        ? { text: `${fmtUsd(s.lenderSupplied)} · earned ${fmtUsd(s.lenderEarned)}`, live: true }
        : { text: `e.g. ${fmtUsd(LENDER_SUPPLY)} USDT at ${fmtPct(LENDER_APY, 0)}`, live: false };
    case "loan":
      return s.done.borrow
        ? { text: `debt ${fmtUsd(s.debt)} of ${fmtUsd(s.borrowed)}`, live: true }
        : { text: `e.g. 20% LTV → ${fmtUsd(s.price * s.collBtc * 0.2 || 20_000)}`, live: false };
    case "fixed":
      return s.done.fixed
        ? { text: `${fmtPct(BORROWER_FIXED_RATE, 0)} fixed · ${s.termDays}-day term`, live: true }
        : { text: `e.g. lender ${fmtPct(LENDER_APY, 0)} + ${fmtPct(PROTOCOL_SPREAD, 0)} spread`, live: false };
    case "buffer":
      return s.done.time
        ? { text: `${fmtUsd(s.spreadEarned)} collected`, live: true }
        : { text: `e.g. ${fmtPct(PROTOCOL_SPREAD, 0)} of every payment`, live: false };
    case "yield":
      return s.done.yield
        ? { text: `${fmtUsd((s.collBtc * s.price * (venue?.apy ?? 0)) / 12)} / month`, live: true }
        : { text: "e.g. 1 BTC at 4% ≈ $333 / month", live: false };
    case "venue":
      return s.done.yield
        ? { text: `${venue?.name} · ~${fmtPct(venue?.apy ?? 0, 0)}`, live: true }
        : { text: "e.g. lending · staking · basis", live: false };
    case "repay": {
      if (!s.done.yield) return { text: "e.g. paid off years sooner", live: false };
      const long = projectionFor(s, 360);
      const w = payoffMonth(long, "debtWith");
      const wo = payoffMonth(long, "debtWithout");
      const txt = w !== null && wo !== null ? `paid off ${wo - w} months sooner` : w !== null ? `paid off in ${w} months` : "yield pays the interest";
      return { text: s.done.time ? `month ${s.committedMonth} · repaid ${fmtUsd(s.sweptToDebt)}` : txt, live: true };
    }
    case "reserve":
      return s.done.time
        ? { text: `${fmtUsd(s.reserve)} ready`, live: true }
        : { text: `e.g. ${fmtPct(SWEEP_TO_RESERVE, 0)} of yield, set aside`, live: false };
    case "guard": {
      const run = s.guardActive?.run ?? s.lastGuard;
      if (s.guardActive) return { text: `live · HF ${fmtHf(s.guardActive.run.ticks[s.guardActive.tick].hfWith)}`, live: true };
      if (run) return { text: `${run.summary.actions} action${run.summary.actions === 1 ? "" : "s"} · min HF ${fmtHf(run.summary.minHfWith)}`, live: true };
      return s.done.borrow
        ? { text: `acts at BTC ${fmtUsd(triggerPrice(s.collBtc, s.debt))}`, live: true }
        : { text: `e.g. acts when HF < ${TRIGGER_HF.toFixed(2)}`, live: false };
    }
    case "flash": {
      const run = s.lastGuard;
      return run && run.summary.repaidViaFlash > 0 ? { text: `covered ${fmtUsd(run.summary.repaidViaFlash)}`, live: true } : { text: "e.g. 0.05% fee, atomic", live: false };
    }
    case "liquidator": {
      const run = s.lastGuard;
      return run && run.summary.liquidations > 0
        ? { text: `would take ${fmtUsd(run.summary.penaltyWithout)}`, live: true }
        : { text: "e.g. 7.5% penalty if HF < 1", live: false };
    }
    case "receipt":
      return s.done.guard ? { text: "see what you saved", live: true } : { text: "e.g. the full trip, in numbers", live: false };
  }
}

/* ── Board ─────────────────────────────────────────────────────────────── */

export function Board() {
  const { state, dispatch } = useSim();
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(Math.min(1, Math.max(0.62, entry.contentRect.width / W))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Bring the current destination into view whenever the journey moves on.
  const current = STATIONS[state.view].id;
  useEffect(() => {
    if (state.drawerOpen) return;
    const el = document.querySelector<HTMLElement>(`[data-target-station="${current}"]`);
    el?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [current, state.drawerOpen]);

  const reachable = (st: StationId) => canView(state, stationIndex(st));
  // New arrows wait until the drawer closes, so the audience sees them draw.
  const revealed = (st: StationId) => reachable(st) && (state.done[st] || !state.drawerOpen || current === st);

  return (
    <div ref={wrap} className="board-dots relative overflow-x-auto rounded-2xl border border-line bg-bg-subtle">
      <div style={{ width: W * scale, height: H * scale }}>
        <div className="relative origin-top-left" style={{ width: W, height: H, transform: `scale(${scale})` }}>
          <svg className="absolute inset-0" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
            {EDGES.map((e, i) => (
              <Edge key={i} edge={e} visible={revealed(e.station)} done={state.done[e.station]} current={current === e.station} />
            ))}
          </svg>

          {EDGES.map((e, i) => {
            if (!revealed(e.station)) return null;
            const { mid } = edgeGeometry(e);
            const done = state.done[e.station];
            return (
              <div
                key={i}
                className={cx(
                  "fade-late pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[11px]",
                  e.kind === "danger" ? "border-danger-line bg-danger-bg text-danger" : done ? "border-line-strong bg-bg text-ink-2" : "border-gold/50 bg-gold-bg text-gold",
                )}
                style={{ left: mid.x, top: mid.y }}
              >
                {e.label}
              </div>
            );
          })}

          {NODES.map((n) => (
            <Node
              key={n.id}
              node={n}
              state={state}
              reachable={reachable(n.station)}
              onOpen={() => dispatch({ type: "OPEN", index: stationIndex(n.station) })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const STROKE: Record<EdgeKind, string> = {
  spine: "var(--brand)",
  flow: "var(--gold)",
  back: "var(--safe)",
  danger: "var(--danger)",
};

function Edge({ edge, visible, done, current }: { edge: BoardEdge; visible: boolean; done: boolean; current: boolean }) {
  if (!visible) return null;
  const { d, end, angle } = edgeGeometry(edge);
  const color = done || edge.kind === "danger" ? STROKE[edge.kind] : "var(--gold)";
  const dashed = edge.kind === "danger" || edge.kind === "back";
  const flowing = !done || edge.kind !== "spine";
  return (
    <g>
      {/* soft glow under the active arrow */}
      {current && !done && <path d={d} fill="none" stroke="var(--gold)" strokeOpacity={0.18} strokeWidth={10} strokeLinecap="round" />}
      <path
        d={d}
        pathLength={1}
        fill="none"
        stroke={color}
        strokeWidth={done ? 2.25 : 2.5}
        strokeLinecap="round"
        className={dashed ? "edge-fade" : "edge-draw"}
        strokeDasharray={dashed ? "0.012 0.012" : undefined}
      />
      <path
        d="M -9 -5.5 L 0 0 L -9 5.5"
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={`translate(${end.x} ${end.y}) rotate(${angle})`}
        className="fade-late"
        style={{ animationDelay: "0.8s" }}
      />
      {/* travelling dots show which way value moves */}
      {flowing &&
        [0, 1].map((k) => (
          <circle key={k} r={done ? 3 : 4} fill={color} opacity={0}>
            <animateMotion dur={done ? "3.2s" : "1.8s"} begin={`${0.9 + k * (done ? 1.6 : 0.9)}s`} repeatCount="indefinite" path={d} />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur={done ? "3.2s" : "1.8s"} begin={`${0.9 + k * (done ? 1.6 : 0.9)}s`} repeatCount="indefinite" />
          </circle>
        ))}
    </g>
  );
}

function Node({ node, state, reachable, onOpen }: { node: BoardNode; state: SimState; reachable: boolean; onOpen: () => void }) {
  const { w, h } = nodeSize(node);
  const done = state.done[node.station];
  const isCurrent = reachable && !done && STATIONS[state.view].id === node.station;
  const isTarget = isCurrent && node.target;
  const ex = example(node.id, state);
  const idx = stationIndex(node.station);
  const tone = node.id === "liquidator" ? "danger" : node.side ? "side" : "spine";

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!reachable}
      data-target-station={node.target ? node.station : undefined}
      aria-label={`${node.title}: ${ex.text}`}
      className={cx(
        "group absolute flex flex-col justify-center rounded-xl border px-3.5 text-left transition-[opacity,border-color,background-color] duration-300",
        reachable ? "cursor-pointer" : "cursor-not-allowed",
        !reachable && "border-dashed border-line bg-bg/40 opacity-50",
        reachable && done && tone !== "danger" && (node.side ? "border-gold/40 bg-bg-elevated hover:border-gold" : "border-brand-dim bg-bg-elevated hover:border-brand"),
        reachable && done && tone === "danger" && "border-danger-line bg-danger-bg/60",
        reachable && !done && (isTarget ? "border-gold bg-gold-bg" : "border-gold/40 bg-bg-elevated hover:border-gold"),
      )}
      style={{ left: node.x - w / 2, top: node.y - h / 2, width: w, height: h }}
    >
      {isTarget && (
        <>
          <span className="node-pulse pointer-events-none absolute inset-0 rounded-xl" />
          <span className="pointer-events-none absolute -top-3 right-3 inline-flex items-center gap-1 rounded-full bg-gold px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-accent-ink">
            <MousePointerClick size={11} /> Try it
          </span>
        </>
      )}
      <span className="flex items-center gap-2">
        <span
          className={cx(
            "grid h-5 min-w-5 place-items-center rounded-full px-1 font-mono text-[10px] font-semibold",
            !reachable ? "bg-bg-hover text-ink-4" : done ? (node.side ? "bg-gold/20 text-gold" : "bg-brand text-accent-ink") : "bg-gold text-accent-ink",
          )}
        >
          {!reachable ? <Lock size={10} /> : done && !node.side ? <Check size={11} strokeWidth={3} /> : String(idx + 1).padStart(2, "0")}
        </span>
        <span className={cx("truncate text-[14px] font-semibold", reachable ? "text-ink" : "text-ink-4")}>{node.title}</span>
      </span>
      <span className={cx("mt-1.5 truncate font-mono text-[11.5px] tabular", !reachable ? "text-ink-4" : ex.live ? (node.id === "liquidator" ? "text-danger" : "text-brand") : "text-ink-3")}>
        {ex.text}
      </span>
    </button>
  );
}
