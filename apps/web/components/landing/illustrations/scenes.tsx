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
import { HitPath, Hot, Inspectable } from "./inspect";

/*
 * Every scene is laid out in screen space (viewBox centred on 0,0) so objects
 * never overlap: `at(sx, sy, z)` is the floor point under screen (sx, sy).
 */
export const at = (sx: number, sy: number, z = 0): P3 => {
  const [x, y] = fromScreen(sx, sy);
  return [x, y, z];
};

export function Box({ sx, sy, size, m, z = 0, opacity, className }: {
  sx: number; sy: number; size: [number, number, number]; m: Material; z?: number; opacity?: number; className?: string;
}) {
  return <IsoBox at={boxAt(sx, sy, size[0], size[1], z)} size={size} m={m} opacity={opacity} className={className} />;
}

export function Label({
  x,
  y,
  children,
  tone = "strong",
  size = 12,
  badge = true,
}: {
  x: number;
  y: number;
  children: string;
  tone?: "muted" | "strong" | "danger" | "brand" | "safe" | "warn";
  size?: number;
  badge?: boolean;
}) {
  const fill =
    tone === "danger"
      ? "var(--danger)"
      : tone === "brand"
      ? "var(--brand)"
      : tone === "safe"
      ? "var(--safe)"
      : tone === "warn"
      ? "var(--warning)"
      : tone === "strong"
      ? "var(--text-primary)"
      : "var(--text-secondary)";

  const charCount = children.length;
  const charAdvance = size * 0.65;
  const badgeWidth = Math.max(30, Math.round(charCount * charAdvance + 16));
  const badgeHeight = Math.round(size * 1.8);
  const badgeX = x - badgeWidth / 2;
  const badgeY = y - badgeHeight / 2;

  return (
    <g className="geo-label select-none pointer-events-none">
      {badge && (
        <rect
          x={badgeX}
          y={badgeY}
          width={badgeWidth}
          height={badgeHeight}
          rx={5}
          fill="var(--geo-label-bg)"
          stroke="var(--geo-label-border)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          style={{ filter: "drop-shadow(0 1px 2px var(--geo-label-shadow))" }}
        />
      )}
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fill={fill}
        style={{
          font: `600 ${size}px var(--font-geist-mono), ui-monospace, monospace`,
          letterSpacing: "0.06em",
        }}
      >
        {children}
      </text>
    </g>
  );
}

/** A borrow position: collateral, debt, and the liquidation line it must not cross. */
export function PositionScene() {
  return (
    <Inspectable
      items={[
        { id: "collateral", title: "Collateral", body: "The ETH you locked on Aave. Its value moves with the market, so when ETH falls, the cushion under your loan shrinks." },
        { id: "debt", title: "Debt", body: "The USDC you borrowed. It stays the same no matter what ETH does, which is why a falling price makes the loan riskier." },
        { id: "hf", title: "Health Factor", body: "Collateral × liquidation threshold ÷ debt. The red part grows as HF falls. Above 1.00 you are safe; below 1.00 you can be liquidated." },
        { id: "line", title: "Liquidation line", body: "Cross it and a bot repays up to half your debt and takes your collateral plus a 5–10% bonus. It often happens at night, while nobody is watching." },
      ]}
    >
      <Scene label="Collateral block, debt stack, and the liquidation line" viewBox="-190 -145 380 300">
        <IsoFloor at={at(0, 40)} r={155} />
        <Hot id="line" label="the liquidation line">
          <HitPath from={at(42, 138)} to={at(168, 75)} lift={0} />
          <IsoLine from={at(42, 138)} to={at(168, 75)} />
          <Label x={-40} y={138} tone="danger">LIQUIDATION LINE</Label>
        </Hot>

        <Hot id="collateral" label="collateral">
          <g className="geo-float">
            <Box sx={-88} sy={20} size={[64, 64, 84]} m="glass" />
          </g>
          <Label x={-88} y={80}>COLLATERAL · ETH</Label>
        </Hot>

        <Hot id="debt" label="debt">
          <IsoCoinStack at={at(50, 48)} count={7} r={16} m="usdc" />
          <Label x={52} y={64}>DEBT · USDC</Label>
        </Hot>

        <Hot id="hf" label="the Health Factor">
          <Box sx={130} sy={-15} size={[14, 14, 26]} m="danger" className="geo-pulse" />
          <Box sx={130} sy={-15} z={26} size={[14, 14, 70]} m="pearl" />
          <Label x={130} y={-124} tone="danger">HF ↓</Label>
        </Hot>
      </Scene>
    </Inspectable>
  );
}

/** Layer 1: USDC in the wallet repays the Aave debt. */
export function L1WalletScene() {
  return (
    <Inspectable
      items={[
        { id: "wallet", title: "Your wallet", body: "USDC you keep in your own wallet. You approve a capped amount; it stays yours and untouched until HF hits your trigger." },
        { id: "flow", title: "Exact repay", body: "Tahansoe pulls only what is needed to reach your target HF, never more than your cap, and sends it straight to Aave." },
        { id: "debt", title: "Aave debt", body: "The red slice is the part that gets repaid. Your HF is back at target in the same transaction, and you get a Telegram receipt." },
      ]}
    >
      <Scene label="Coins move from the wallet to repay the debt" viewBox="-185 -145 370 295">
        <IsoFloor at={at(0, 50)} r={150} />
        <Hot id="wallet" label="your wallet">
          <Box sx={-100} sy={45} size={[80, 80, 16]} m="glass" />
          <IsoCoinStack at={at(-100, 45, 16)} count={5} r={16} m="usdc" className="geo-float" />
          <Label x={-100} y={112}>YOUR WALLET · USDC</Label>
        </Hot>

        <Hot id="flow" label="the repayment">
          <HitPath from={at(-100, 45, 54)} to={at(100, 45, 84)} lift={60} />
          <FlowPath from={at(-100, 45, 54)} to={at(100, 45, 84)} lift={60} />
        </Hot>

        <Hot id="debt" label="the Aave debt">
          <Box sx={100} sy={45} size={[64, 64, 52]} m="chrome" />
          <Box sx={100} sy={45} z={52} size={[64, 64, 22]} m="danger" className="geo-pulse" />
          <Label x={100} y={-84} tone="danger">− REPAID</Label>
          <Label x={100} y={112}>AAVE DEBT</Label>
        </Hot>
      </Scene>
    </Inspectable>
  );
}

/** Layer 2: vault shares from another position are redeemed, then repay. */
export function L2VaultScene() {
  return (
    <Inspectable
      items={[
        { id: "vault", title: "Vault shares", body: "Another DeFi position you already hold, like a Morpho vault or an Aave aToken. It keeps earning yield until it is needed." },
        { id: "redeem", title: "Redeem to USDC", body: "Only the shares needed are withdrawn into USDC. If Layer 1 covered everything, this layer never moves." },
        { id: "debt", title: "Aave debt", body: "The proceeds repay your loan in the same transaction. Shares you didn't need stay in the vault." },
      ]}
    >
      <Scene label="Vault shares are redeemed into coins that repay the debt" viewBox="-185 -145 370 295">
        <IsoFloor at={at(0, 50)} r={155} />
        <Hot id="vault" label="vault shares">
          <g className="geo-float">
            <Box sx={-122} sy={30} size={[56, 56, 96]} m="glass" />
            <IsoRing at={at(-122, 30, 96)} r={14} width={2} />
          </g>
          <Label x={-122} y={82}>VAULT SHARES</Label>
        </Hot>

        <Hot id="redeem" label="the redemption">
          <HitPath from={at(-122, 30, 70)} to={at(0, 75, 34)} lift={30} />
          <FlowPath from={at(-122, 30, 70)} to={at(0, 75, 34)} lift={30} />
          <IsoCoinStack at={at(0, 75)} count={4} r={15} m="usdc" />
          <Label x={0} y={118}>REDEEM → USDC</Label>
        </Hot>

        <Hot id="debt" label="the Aave debt">
          <HitPath from={at(0, 75, 30)} to={at(122, 30, 70)} lift={36} />
          <FlowPath from={at(0, 75, 30)} to={at(122, 30, 70)} lift={36} />
          <Box sx={122} sy={30} size={[60, 60, 46]} m="chrome" />
          <Box sx={122} sy={30} z={46} size={[60, 60, 20]} m="danger" className="geo-pulse" />
          <Label x={122} y={82}>AAVE DEBT</Label>
        </Hot>
      </Scene>
    </Inspectable>
  );
}

/** Layer 3: flash loan repays, collateral is swapped, the loop closes in one transaction. */
export function L3FlashScene() {
  return (
    <Inspectable
      items={[
        { id: "loan", title: "① Flash loan", body: "USDC is borrowed for the length of a single transaction. No reserve of your own is needed." },
        { id: "repay", title: "② Repay debt", body: "The borrowed USDC repays part of your Aave loan, which frees up some of your collateral." },
        { id: "collateral", title: "③ Collateral", body: "A slice of your collateral is swapped to USDC, with slippage capped against the oracle price you allowed." },
        { id: "close", title: "④ Close", body: "The swap pays back the flash loan. If any step fails, the whole transaction reverts and nothing moves." },
      ]}
    >
      <Scene label="Flash loan loop: borrow, repay, swap collateral, close" viewBox="-195 -165 390 330">
        <IsoRing at={at(0, 30)} r={118} width={2} dashed className="geo-flow-slow" />

        <Hot id="loan" label="the flash loan">
          <IsoCoinStack at={at(-110, -25)} count={4} r={15} m="usdc" />
          <Label x={-110} y={8} tone="brand">① FLASH LOAN</Label>
        </Hot>

        <Hot id="repay" label="repaying the debt">
          <HitPath from={at(-110, -25, 30)} to={at(115, -60, 56)} lift={50} />
          <Box sx={115} sy={-60} size={[46, 46, 44]} m="chrome" />
          <Label x={115} y={-136}>② REPAY DEBT</Label>
          <FlowPath from={at(-110, -25, 30)} to={at(115, -60, 56)} lift={50} />
        </Hot>

        <Hot id="collateral" label="the collateral swap">
          <g className="geo-float">
            <Box sx={75} sy={95} size={[50, 50, 60]} m="glass" />
          </g>
          <Label x={75} y={144}>③ COLLATERAL</Label>
          <Box sx={-15} sy={115} size={[26, 26, 26]} m="glass" opacity={0.9} />
          <FlowPath from={at(75, 95, 44)} to={at(-15, 115, 28)} lift={18} />
        </Hot>

        <Hot id="close" label="closing the loop">
          <IsoCoinStack at={at(-120, 85)} count={3} r={13} m="usdc" />
          <Label x={-120} y={126}>④ SWAP → CLOSE</Label>
          <FlowPath from={at(-15, 115, 20)} to={at(-120, 85, 20)} lift={18} />
          <FlowPath from={at(-120, 85, 22)} to={at(-110, -25, 26)} lift={10} />
        </Hot>
      </Scene>
    </Inspectable>
  );
}

/** The three layers as walls between a position and the liquidation line. */
export function CascadeScene() {
  const walls: { id: string; sx: number; sy: number; m: Material; label: string; tone: "brand" | "strong" | "muted" }[] = [
    { id: "l1", sx: -70, sy: 10, m: "brand", label: "L1 · WALLET", tone: "brand" },
    { id: "l2", sx: -5, sy: 48, m: "glass", label: "L2 · POSITION", tone: "strong" },
    { id: "l3", sx: 60, sy: 86, m: "chrome", label: "L3 · FLASH", tone: "muted" },
  ];
  return (
    <Inspectable
      items={[
        { id: "position", title: "Your position", body: "Your Aave loan. When its Health Factor falls below your trigger, Tahansoe tries the walls in order, cheapest first." },
        { id: "l1", title: "L1 · Wallet", body: "Repays with USDC already in your wallet. Gas only, so it always goes first." },
        { id: "l2", title: "L2 · Position", body: "If the wallet runs dry, redeems shares from another position you hold, like a Morpho vault." },
        { id: "l3", title: "L3 · Flash", body: "Last resort: a flash loan plus a small collateral swap, all in one transaction. Opt-in only." },
        { id: "liquidation", title: "Liquidation", body: "What the walls stand in front of. Each wall you turn on lowers the odds of reaching it; none can promise it never happens." },
      ]}
    >
      <Scene label="Position, three protection walls, then the liquidation line" viewBox="-250 -170 500 355">
        <IsoFloor at={at(0, 40)} r={210} />
        <Hot id="position" label="your position">
          <g className="geo-float">
            <Box sx={-175} sy={-20} size={[56, 56, 72]} m="glass" />
          </g>
          <Label x={-175} y={-126} size={15}>YOUR POSITION</Label>
        </Hot>

        {walls.map(({ id, sx, sy, m, label, tone }) => (
          <Hot key={id} id={id} label={label}>
            <Box sx={sx} sy={sy} size={[8, 170, 72]} m={m} opacity={0.92} />
            <Label x={sx + 74} y={sy - 124} tone={tone} size={15}>{label}</Label>
          </Hot>
        ))}

        <Hot id="liquidation" label="the liquidation line">
          <HitPath from={at(220, 50)} to={at(105, 116)} lift={0} />
          <IsoLine from={at(220, 50)} to={at(105, 116)} />
          <Label x={175} y={138} tone="danger" size={15}>LIQUIDATION</Label>
        </Hot>
      </Scene>
    </Inspectable>
  );
}

/** Agent 1: one research run broadcast to every subscriber. */
export function PulseScene() {
  const phones: [number, number][] = [[-125, 45], [120, -20], [118, 80]];
  const top = at(0, 40, 112);
  const [sx, sy] = iso(...top);
  return (
    <Inspectable
      items={[
        { id: "tower", title: "Research run", body: "Every 1–2 hours the agent reads prices, lending rates, liquidity, macro data and news, then writes one short risk brief." },
        { id: "phones", title: "Your Telegram", body: "The brief arrives twice a day, plus an instant alert when the risk regime rises. Send /stop to the bot any time." },
        { id: "label", title: "Same for everyone", body: "One run serves every subscriber. Figures come from data feeds, not from the AI, and it never touches your position." },
      ]}
    >
      <Scene label="One research tower broadcasting to many phones" viewBox="-185 -150 370 315">
        <IsoFloor at={at(0, 50)} r={150} />
        <Hot id="tower" label="the research run">
          <Box sx={0} sy={40} size={[28, 28, 92]} m="chrome" />
          <IsoRing at={top} r={40} width={1.5} className="geo-pulse" />
          <IsoRing at={top} r={72} width={1} dashed className="geo-pulse geo-delay" />
          <circle cx={sx} cy={sy} r={14} fill="url(#geo-sphere-glass)" stroke="var(--geo-edge-highlight)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </Hot>
        <Hot id="phones" label="subscriber phones">
          {phones.map(([px, py], i) => (
            <FlowPath key={i} from={top} to={at(px, py, 60)} lift={20} />
          ))}
          {phones.map(([px, py], i) => (
            <IsoPhone key={i} at={boxAt(px, py, 3, 28)} className={i % 2 ? "geo-float geo-delay" : "geo-float"} />
          ))}
        </Hot>
        <Hot id="label" label="one run for everyone">
          <rect x={-130} y={120} width={260} height={24} fill="transparent" />
          <Label x={0} y={132} tone="brand">1 RESEARCH RUN → ALL SUBSCRIBERS</Label>
        </Hot>
      </Scene>
    </Inspectable>
  );
}

/** Agent 2: radar watching HF zones; execution is locked to rules. */
export function SentinelScene() {
  const cols: { sx: number; h: number; m: Material; label: string; tone: "safe" | "strong" | "warn" | "danger"; title: string; body: string }[] = [
    { sx: -36, h: 92, m: "safe", label: "SAFE", tone: "safe", title: "Safe", body: "HF comfortably above your trigger. Nothing to do, no messages." },
    { sx: 24, h: 68, m: "glass", label: "WATCH", tone: "strong", title: "Watch", body: "HF is drifting down. The Sentinel keeps a closer eye on it." },
    { sx: 84, h: 44, m: "warn", label: "WARN", tone: "warn", title: "Warn", body: "HF is close to your trigger. You get a Telegram heads-up, with the likely reason." },
    { sx: 138, h: 22, m: "danger", label: "ACT", tone: "danger", title: "Act", body: "HF is below your trigger. The rules run Layer 1 → 2 → 3 until HF is back at target." },
  ];
  const [lx, ly] = [125, -30];
  const [ax, ay] = iso(...at(lx - 9, ly, 26));
  const [bx, by] = iso(...at(lx + 9, ly, 26));
  return (
    <Inspectable
      items={[
        { id: "sentinel", title: "HF Sentinel", body: "Watches the Health Factor of every protected position around the clock, so you don't have to." },
        ...cols.map((c) => ({ id: c.label, title: c.title, body: c.body })),
        { id: "lock", title: "Rules execute", body: "A fixed rule decides when to act. The AI explains why HF dropped, but it never signs a transaction or changes your settings." },
      ]}
    >
      <Scene label="Radar sphere watching four Health Factor zones, with a lock for rule-based execution" viewBox="-185 -150 370 300">
        <IsoFloor at={at(0, 40)} r={150} />
        <Hot id="sentinel" label="the HF Sentinel">
          <IsoRing at={at(-105, -10)} r={52} width={1.5} dashed className="geo-flow-slow" />
          <IsoSphere at={at(-105, -10, 36)} r={24} glass />
          <Label x={-105} y={66} tone="brand">HF SENTINEL</Label>
        </Hot>

        {cols.map(({ sx, h, m, label, tone }) => (
          <Hot key={label} id={label} label={`the ${label.toLowerCase()} zone`}>
            <Box sx={sx} sy={75} size={[20, 20, h]} m={m} />
            <Label x={sx} y={108} tone={tone}>{label}</Label>
          </Hot>
        ))}

        <Hot id="lock" label="rule-based execution">
          <Box sx={lx} sy={ly} size={[26, 20, 26]} m="chrome" />
          <path
            d={`M${ax},${ay} C${ax},${ay - 26} ${bx},${by - 26} ${bx},${by}`}
            fill="none"
            stroke="var(--text-secondary)"
            strokeWidth={3.5}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <Label x={lx} y={ly + 34}>RULES EXECUTE</Label>
        </Hot>
      </Scene>
    </Inspectable>
  );
}
