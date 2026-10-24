import * as React from "react";
import { FlowPath, IsoCoinStack, IsoFloor, IsoRing, Scene } from "../geo/primitives";
import { Box, Label, at } from "../illustrations/scenes";
import { LAB, healthFactor, hfStatus, type LabState, type LayerIndex } from "./model";
import type { Part } from "./Inspector";

/** USD per world unit of height: collateral and debt share one scale so HF reads as a height ratio. */
const SCALE = 44;

// Screen-space anchors (sx, sy) for each object; drawn back to front by sy.
const POS = {
  wallet: [168, -48],
  collateral: [-120, 45],
  vault: [196, 62],
  debt: [42, 118],
  flash: [168, 168],
} as const;

export type FlashLayer = LayerIndex | "liquidation";
export type Flash = { layers: FlashLayer[]; amount: number; penalty: number; key: number } | null;

export function LabScene({
  state,
  layersOn,
  flash,
  selected,
  onSelect,
}: {
  state: LabState;
  layersOn: readonly boolean[];
  flash: Flash;
  selected: Part;
  onSelect: (p: Part) => void;
}) {
  const hf = healthFactor(state);
  const status = hfStatus(hf);
  const hC = Math.max(4, (state.collateral * state.price * LAB.lt) / SCALE);
  const hD = Math.max(2, state.debt / SCALE);
  const hV = 6 + (state.vault / LAB.vault) * 58;
  const coins = Math.ceil((state.wallet / LAB.wallet) * 6);

  const debtTop = at(POS.debt[0], POS.debt[1], hD);
  const dim = (i: LayerIndex) => (layersOn[i] ? 1 : 0.28);
  const firing = (l: FlashLayer) => flash?.layers.includes(l) ?? false;
  const tone = (i: LayerIndex) => (firing(i) ? "safe" : layersOn[i] ? "strong" : "muted");
  // Every object is a hotspot: hover, focus, or tap opens it in the inspector.
  const hot = (p: Part, label: string) => ({
    role: "button",
    tabIndex: 0,
    "aria-label": `Inspect ${label}`,
    "aria-pressed": selected === p,
    onClick: () => onSelect(p),
    onMouseEnter: () => onSelect(p),
    onFocus: () => onSelect(p),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(p);
      }
    },
    style: { cursor: "pointer", outline: "none" } as React.CSSProperties,
    className: "transition-opacity duration-300 lab-hot",
  });
  // Pulsing ring on the floor under whatever is being inspected.
  const RING: Record<Exclude<Part, "hf">, [readonly [number, number], number]> = {
    collateral: [POS.collateral, 62],
    debt: [POS.debt, 52],
    l1: [POS.wallet, 52],
    l2: [POS.vault, 44],
    l3: [POS.flash, 36],
  };
  const hfColor = { safe: "var(--safe)", warning: "var(--warning)", critical: "var(--danger)", liquidatable: "var(--danger)" }[status];

  return (
    <Scene
      label={`Borrow position: health factor ${Number.isFinite(hf) ? hf.toFixed(2) : "∞"}`}
      viewBox="-250 -220 500 450"
      className="w-full h-auto select-none"
    >
      <IsoFloor at={at(0, 70)} r={240} />

      {/* Footprint under the collateral: turns solid red once the position is liquidatable */}
      <g opacity={status === "liquidatable" ? 1 : 0.5} className="transition-opacity duration-300">
        <IsoRing at={at(...POS.collateral)} r={58} width={1.5} dashed className="geo-flow-slow" />
      </g>

      {selected !== "hf" && (
        <g key={selected} className="geo-pulse">
          <IsoRing at={at(...RING[selected][0])} r={RING[selected][1]} width={2.5} />
        </g>
      )}

      {/* L1 · wallet */}
      <g opacity={dim(0)} {...hot("l1", "Layer 1, wallet reserve")}>
        <Box sx={POS.wallet[0]} sy={POS.wallet[1]} size={[60, 60, 12]} m="glass" />
        {coins > 0 && <IsoCoinStack at={at(POS.wallet[0], POS.wallet[1], 12)} count={coins} r={15} m="usdc" />}
      </g>

      {/* Collateral, counted at its liquidation threshold */}
      <g {...hot("collateral", "collateral")}>
      <Box
        sx={POS.collateral[0]}
        sy={POS.collateral[1]}
        size={[72, 72, hC]}
        m={status === "liquidatable" ? "danger" : status === "critical" ? "warn" : "glass"}
      />
      </g>

      {/* L2 · vault shares */}
      <g opacity={dim(1)} {...hot("l2", "Layer 2, position reserve")}>
        <Box sx={POS.vault[0]} sy={POS.vault[1]} size={[50, 50, hV]} m="glass" />
        <IsoRing at={at(POS.vault[0], POS.vault[1], hV)} r={12} width={2} />
      </g>

      {/* Debt */}
      <g {...hot("debt", "debt")}>
        <Box sx={POS.debt[0]} sy={POS.debt[1]} size={[60, 60, hD]} m="usdc" />
      </g>

      {/* L3 · flash loan loop */}
      <g opacity={dim(2)} {...hot("l3", "Layer 3, flash deleverage")}>
        <IsoRing at={at(...POS.flash)} r={26} width={2} dashed className="geo-flow" />
        <IsoCoinStack at={at(...POS.flash)} count={firing(2) ? 4 : 1} r={12} m="usdc" />
      </g>

      {/* Money moving: a reserve repays the debt, or a liquidator takes collateral */}
      {flash && (
        <g key={flash.key} className="animate-in fade-in duration-300">
          {firing(0) && <FlowPath from={at(POS.wallet[0], POS.wallet[1], 40)} to={debtTop} lift={50} />}
          {firing(1) && <FlowPath from={at(POS.vault[0], POS.vault[1], hV)} to={debtTop} lift={40} />}
          {firing(2) && (
            <>
              <FlowPath from={at(POS.collateral[0], POS.collateral[1], hC * 0.6)} to={at(POS.flash[0], POS.flash[1], 8)} lift={20} />
              <FlowPath from={at(POS.flash[0], POS.flash[1], 10)} to={debtTop} lift={30} />
            </>
          )}
          {firing("liquidation") && (
            <FlowPath danger from={at(POS.collateral[0], POS.collateral[1], hC)} to={at(-230, -150, 60)} lift={30} />
          )}
        </g>
      )}

      {/* Health Factor badge: collateral height ÷ debt height */}
      <g {...hot("hf", "health factor")}>
        <rect x={-78} y={-212} width={156} height={34} rx={9} fill="var(--geo-label-bg)" stroke={selected === "hf" ? "var(--brand)" : hfColor} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <text x={0} y={-195} textAnchor="middle" dominantBaseline="central" fill={hfColor} style={{ font: "600 15px var(--font-geist-mono), ui-monospace, monospace", letterSpacing: "0.06em" }}>
          {`HF ${Number.isFinite(hf) ? hf.toFixed(2) : "∞"}`}
        </text>
      </g>

      {/* Labels sit on top of every object so nothing hides them */}
      <g>
        <Label x={POS.collateral[0]} y={POS.collateral[1] - hC - 52} tone="muted" size={10}>
          {`× LT ${LAB.lt} = $${Math.round(state.collateral * state.price * LAB.lt).toLocaleString("en-US")}`}
        </Label>
        <Label x={POS.collateral[0]} y={POS.collateral[1] + 52} size={11}>
          {`COLLATERAL · ${state.collateral.toFixed(2)} ETH`}
        </Label>
        <Label x={POS.debt[0]} y={POS.debt[1] + 46} size={11}>
          {`DEBT · $${Math.round(state.debt).toLocaleString("en-US")}`}
        </Label>
        <Label x={POS.wallet[0]} y={POS.wallet[1] + 42} tone={tone(0)} size={11}>
          {`L1 WALLET · $${Math.round(state.wallet)}`}
        </Label>
        <Label x={POS.vault[0] - 6} y={POS.vault[1] + 40} tone={tone(1)} size={11}>
          {`L2 VAULT · $${Math.round(state.vault)}`}
        </Label>
        <Label x={POS.flash[0]} y={POS.flash[1] + 38} tone={tone(2)} size={11}>
          {state.swappedEth > 0 ? `L3 FLASH · −${state.swappedEth.toFixed(2)} ETH` : "L3 FLASH"}
        </Label>
        {flash &&
          (firing("liquidation") ? (
            <Label key={`l${flash.key}`} x={-130} y={-190} tone="danger" size={12}>
              {`LIQUIDATED · −$${Math.round(flash.penalty)} PENALTY`}
            </Label>
          ) : (
            <Label key={`r${flash.key}`} x={POS.debt[0]} y={POS.debt[1] - hD - 34} tone="safe" size={12}>
              {`REPAID −$${Math.round(flash.amount)}`}
            </Label>
          ))}
      </g>
    </Scene>
  );
}
