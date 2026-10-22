import * as React from "react";
import {
  FlowPath,
  IsoBox,
  IsoCoinStack,
  IsoFloor,
  IsoLine,
  IsoPhone,
  IsoRing,
  IsoSphere,
  Scene,
} from "../geo/primitives";
import type { Material } from "../geo/Defs";
import { boxAt, fromScreen, iso, type P3 } from "../geo/iso";

/*
 * Every scene is laid out in screen space (viewBox centred on 0,0) so objects
 * never overlap: `at(sx, sy, z)` is the floor point under screen (sx, sy).
 */
const at = (sx: number, sy: number, z = 0): P3 => {
  const [x, y] = fromScreen(sx, sy);
  return [x, y, z];
};

function Box({ sx, sy, size, m, z = 0, opacity, className }: {
  sx: number; sy: number; size: [number, number, number]; m: Material; z?: number; opacity?: number; className?: string;
}) {
  return <IsoBox at={boxAt(sx, sy, size[0], size[1], z)} size={size} m={m} opacity={opacity} className={className} />;
}

function Label({ x, y, children, tone = "strong" }: {
  x: number; y: number; children: React.ReactNode; tone?: "muted" | "strong" | "danger";
}) {
  const fill = tone === "danger" ? "#db3655" : tone === "strong" ? "var(--text-primary)" : "var(--text-tertiary)";
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fill={fill}
      style={{ font: "500 9px var(--font-geist-mono), ui-monospace, monospace", letterSpacing: "0.08em" }}
    >
      {children}
    </text>
  );
}

/** A borrow position: collateral, debt, and the liquidation line it must not cross. */
export function PositionScene() {
  return (
    <Scene label="Collateral block, debt stack, and the liquidation line">
      <IsoFloor at={at(0, 40)} r={150} />
      <IsoLine from={at(-40, 150)} to={at(150, 40)} />
      <Label x={-20} y={142} tone="danger">LIQUIDATION LINE</Label>

      <g className="geo-float">
        <Box sx={-85} sy={20} size={[64, 64, 84]} m="glass" />
      </g>
      <Label x={-85} y={78}>COLLATERAL · ETH</Label>

      <IsoCoinStack at={at(40, 55)} count={7} r={17} m="chrome" />
      <Label x={40} y={92}>DEBT · USDC</Label>

      <Box sx={130} sy={-15} size={[12, 12, 96]} m="pearl" />
      <Box sx={130} sy={-15} size={[12, 12, 26]} m="danger" className="geo-pulse" />
      <Label x={130} y={-122}>HF ↓</Label>
    </Scene>
  );
}

/** Layer 1: USDC in the wallet repays the Aave debt. */
export function L1WalletScene() {
  return (
    <Scene label="Coins move from the wallet to repay the debt">
      <IsoFloor at={at(0, 50)} r={150} />
      <Box sx={-100} sy={45} size={[80, 80, 16]} m="glass" />
      <IsoCoinStack at={at(-100, 45, 16)} count={5} r={16} className="geo-float" />
      <Label x={-100} y={110}>YOUR WALLET · USDC</Label>

      <FlowPath from={at(-100, 45, 54)} to={at(100, 45, 84)} lift={60} />

      <Box sx={100} sy={45} size={[64, 64, 52]} m="chrome" />
      <Box sx={100} sy={45} z={52} size={[64, 64, 22]} m="danger" opacity={0.4} className="geo-pulse" />
      <Label x={100} y={-82} tone="danger">− REPAID</Label>
      <Label x={100} y={110}>AAVE DEBT</Label>
    </Scene>
  );
}

/** Layer 2: vault shares from another position are redeemed, then repay. */
export function L2VaultScene() {
  return (
    <Scene label="Vault shares are redeemed into coins that repay the debt">
      <IsoFloor at={at(0, 50)} r={155} />
      <g className="geo-float">
        <Box sx={-115} sy={30} size={[56, 56, 96]} m="glass" />
        <IsoRing at={at(-115, 30, 96)} r={14} width={2.5} />
      </g>
      <Label x={-115} y={88}>VAULT SHARES</Label>

      <FlowPath from={at(-115, 30, 70)} to={at(0, 75, 34)} lift={30} />
      <IsoCoinStack at={at(0, 75)} count={4} r={15} />
      <Label x={0} y={110}>REDEEM → USDC</Label>

      <FlowPath from={at(0, 75, 30)} to={at(115, 30, 70)} lift={36} />
      <Box sx={115} sy={30} size={[60, 60, 46]} m="chrome" />
      <Box sx={115} sy={30} z={46} size={[60, 60, 20]} m="danger" opacity={0.4} className="geo-pulse" />
      <Label x={115} y={88}>AAVE DEBT</Label>
    </Scene>
  );
}

/** Layer 3: flash loan repays, collateral is swapped, the loop closes in one transaction. */
export function L3FlashScene() {
  return (
    <Scene label="Flash loan loop: borrow, repay, swap collateral, close" viewBox="-190 -160 380 320">
      <IsoRing at={at(0, 30)} r={118} width={2} dashed className="geo-flow-slow" />

      <IsoCoinStack at={at(-110, -25)} count={4} r={15} m="brand" />
      <Label x={-110} y={12}>① FLASH LOAN</Label>

      <Box sx={115} sy={-60} size={[46, 46, 44]} m="chrome" />
      <Label x={115} y={-118}>② REPAY DEBT</Label>
      <FlowPath from={at(-110, -25, 30)} to={at(115, -60, 56)} lift={50} />

      <g className="geo-float">
        <Box sx={75} sy={95} size={[50, 50, 60]} m="glass" />
      </g>
      <Label x={75} y={142}>③ COLLATERAL</Label>

      <Box sx={-15} sy={115} size={[26, 26, 26]} m="glass" opacity={0.85} />
      <FlowPath from={at(75, 95, 44)} to={at(-15, 115, 28)} lift={18} />

      <IsoCoinStack at={at(-120, 85)} count={3} r={13} />
      <Label x={-120} y={120}>④ SWAP → CLOSE</Label>
      <FlowPath from={at(-15, 115, 20)} to={at(-120, 85, 20)} lift={18} />
      <FlowPath from={at(-120, 85, 22)} to={at(-110, -25, 26)} lift={10} />
    </Scene>
  );
}

/** The three layers as walls between a position and the liquidation line. */
export function CascadeScene() {
  const walls: { sx: number; sy: number; m: Material; label: string }[] = [
    { sx: -70, sy: 10, m: "brand", label: "L1 · WALLET" },
    { sx: -5, sy: 48, m: "glass", label: "L2 · POSITION" },
    { sx: 60, sy: 86, m: "chrome", label: "L3 · FLASH" },
  ];
  return (
    <Scene label="Position, three protection walls, then the liquidation line" viewBox="-250 -170 500 330">
      <IsoFloor at={at(0, 40)} r={210} />
      <g className="geo-float">
        <Box sx={-175} sy={-20} size={[56, 56, 72]} m="glass" />
      </g>
      <Label x={-175} y={-126}>YOUR POSITION</Label>

      {walls.map(({ sx, sy, m, label }) => (
        <g key={label}>
          <Box sx={sx} sy={sy} size={[8, 170, 72]} m={m} opacity={0.9} />
          <Label x={sx + 74} y={sy - 126}>{label}</Label>
        </g>
      ))}

      <IsoLine from={at(225, 55)} to={at(80, 140)} />
      <Label x={190} y={118} tone="danger">LIQUIDATION</Label>
    </Scene>
  );
}

/** Agent 1: one research run broadcast to every subscriber. */
export function PulseScene() {
  const phones: [number, number][] = [[-125, 45], [120, -20], [105, 105]];
  const top = at(0, 40, 112);
  const [sx, sy] = iso(...top);
  return (
    <Scene label="One research tower broadcasting to many phones">
      <IsoFloor at={at(0, 50)} r={150} />
      <Box sx={0} sy={40} size={[28, 28, 92]} m="chrome" />
      <IsoRing at={top} r={40} width={1.5} className="geo-pulse" />
      <IsoRing at={top} r={72} width={1} dashed className="geo-pulse geo-delay" />
      {phones.map(([px, py], i) => (
        <FlowPath key={i} from={top} to={at(px, py, 60)} lift={20} />
      ))}
      <circle cx={sx} cy={sy} r={14} fill="url(#geo-sphere-glass)" stroke="rgba(255,255,255,.8)" />
      {phones.map(([px, py], i) => (
        <IsoPhone key={i} at={boxAt(px, py, 3, 28)} className={i % 2 ? "geo-float geo-delay" : "geo-float"} />
      ))}
      <Label x={0} y={88}>1 RESEARCH RUN → ALL SUBSCRIBERS</Label>
    </Scene>
  );
}

/** Agent 2: radar watching HF zones; execution is locked to rules. */
export function SentinelScene() {
  const cols: { h: number; m: Material; label: string }[] = [
    { h: 92, m: "safe", label: "SAFE" },
    { h: 68, m: "glass", label: "WATCH" },
    { h: 44, m: "warn", label: "WARN" },
    { h: 22, m: "danger", label: "ACT" },
  ];
  const [lx, ly] = [125, -30];
  const [ax, ay] = iso(...at(lx - 9, ly, 26));
  const [bx, by] = iso(...at(lx + 9, ly, 26));
  return (
    <Scene label="Radar sphere watching four Health Factor zones, with a lock for rule-based execution">
      <IsoFloor at={at(0, 40)} r={150} />
      <IsoRing at={at(-105, -10)} r={52} width={1.5} dashed className="geo-flow-slow" />
      <IsoSphere at={at(-105, -10, 36)} r={24} glass />
      <Label x={-105} y={58}>HF SENTINEL</Label>

      {cols.map(({ h, m, label }, i) => (
        <g key={label}>
          <Box sx={-25 + i * 42} sy={75} size={[22, 22, h]} m={m} />
          <Label x={-25 + i * 42} y={106} tone="muted">{label}</Label>
        </g>
      ))}

      <Box sx={lx} sy={ly} size={[26, 20, 26]} m="chrome" />
      <path d={`M${ax},${ay} C${ax},${ay - 26} ${bx},${by - 26} ${bx},${by}`} fill="none" stroke="#9aa1b6" strokeWidth={4} strokeLinecap="round" />
      <Label x={lx} y={ly + 34}>RULES EXECUTE</Label>
    </Scene>
  );
}
