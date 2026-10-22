import * as React from "react";
import { ellipse, iso, pathThrough, poly, type P3 } from "./iso";
import type { Material } from "./Defs";

const EDGE = "var(--geo-edge, rgba(255,255,255,0.75))";
const EDGE_TOP = "var(--geo-edge-highlight, var(--geo-edge, rgba(255,255,255,0.75)))";

type BoxProps = {
  at: P3;
  size: [number, number, number]; // w (x), d (y), h (z)
  m?: Material;
  opacity?: number;
  className?: string;
};

/** Rectangular prism: only the three faces facing the viewer are drawn. */
export function IsoBox({ at: [x, y, z], size: [w, d, h], m = "glass", opacity = 1, className }: BoxProps) {
  const top: P3[] = [[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]];
  const left: P3[] = [[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]];
  const right: P3[] = [[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]];
  return (
    <g opacity={opacity} className={className} strokeLinejoin="round" strokeLinecap="round">
      <polygon points={poly(left)} fill={`url(#geo-${m}-left)`} stroke={EDGE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <polygon points={poly(right)} fill={`url(#geo-${m}-right)`} stroke={EDGE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <polygon points={poly(top)} fill={`url(#geo-${m}-top)`} stroke={EDGE_TOP} strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </g>
  );
}

/** Vertical cylinder (coins, pillars). */
export function IsoCylinder({
  at: [x, y, z],
  r,
  h,
  m = "brand",
  className,
}: { at: P3; r: number; h: number; m?: Material; className?: string }) {
  const { rx, ry } = ellipse(r);
  const [cx, cyTop] = iso(x, y, z + h);
  const [, cyBot] = iso(x, y, z);
  const side = `M${cx - rx},${cyTop} L${cx - rx},${cyBot} A${rx},${ry} 0 0 0 ${cx + rx},${cyBot} L${cx + rx},${cyTop} Z`;
  return (
    <g className={className} strokeLinejoin="round" strokeLinecap="round">
      <path d={side} fill={`url(#geo-${m}-right)`} stroke={EDGE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <ellipse cx={cx} cy={cyTop} rx={rx} ry={ry} fill={`url(#geo-${m}-top)`} stroke={EDGE_TOP} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {m === "usdc" && (
        <ellipse
          cx={cx}
          cy={cyTop}
          rx={rx * 0.62}
          ry={ry * 0.62}
          fill="none"
          stroke="var(--geo-edge-highlight)"
          strokeWidth={0.8}
          strokeOpacity={0.75}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
}

/** A stack of coins, e.g. USDC in a wallet. */
export function IsoCoinStack({ at, count, r = 14, m = "brand", className }: {
  at: P3; count: number; r?: number; m?: Material; className?: string;
}) {
  return (
    <g className={className}>
      {Array.from({ length: count }, (_, i) => (
        <IsoCylinder key={i} at={[at[0], at[1], at[2] + i * 6]} r={r} h={5} m={m} />
      ))}
    </g>
  );
}

export function IsoSphere({ at, r, glass = false, className }: { at: P3; r: number; glass?: boolean; className?: string }) {
  const [cx, cy] = iso(...at);
  return (
    <g className={className}>
      <ellipse cx={cx} cy={cy + r + 4} rx={r * 0.9} ry={r * 0.28} fill="url(#geo-floor)" />
      <circle cx={cx} cy={cy} r={r} fill={`url(#geo-sphere-${glass ? "glass" : "pearl"})`} stroke={EDGE_TOP} strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </g>
  );
}

/** Flat horizontal ring on the floor (flash-loan loop, radar sweep). */
export function IsoRing({ at, r, width = 1.5, dashed = false, className }: {
  at: P3; r: number; width?: number; dashed?: boolean; className?: string;
}) {
  const { rx, ry } = ellipse(r);
  const [cx, cy] = iso(...at);
  return (
    <ellipse
      cx={cx}
      cy={cy}
      rx={rx}
      ry={ry}
      fill="none"
      stroke="url(#geo-iridescent)"
      strokeWidth={width}
      strokeDasharray={dashed ? "5 6" : undefined}
      vectorEffect="non-scaling-stroke"
      className={className}
    />
  );
}

/** Soft floor shadow / tile under a composition. */
export function IsoFloor({ at, r }: { at: P3; r: number }) {
  const { rx, ry } = ellipse(r);
  const [cx, cy] = iso(...at);
  return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#geo-floor)" />;
}

/** Curved path with dots flowing from a to b. */
export function FlowPath({ from, to, lift = 40, danger = false }: { from: P3; to: P3; lift?: number; danger?: boolean }) {
  const d = pathThrough(from, to, lift);
  return (
    <g fill="none">
      <path
        d={d}
        stroke={danger ? "var(--danger)" : "url(#geo-iridescent)"}
        strokeOpacity={0.35}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={d}
        stroke={danger ? "var(--danger)" : "url(#geo-iridescent)"}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray="2 12"
        vectorEffect="non-scaling-stroke"
        className="geo-flow"
      />
    </g>
  );
}

/** Dashed line on the floor, e.g. the liquidation line. */
export function IsoLine({ from, to, color = "var(--danger)", dashed = true }: { from: P3; to: P3; color?: string; dashed?: boolean }) {
  return (
    <path
      d={pathThrough(from, to)}
      stroke={color}
      strokeWidth={1.5}
      strokeDasharray={dashed ? "5 5" : undefined}
      vectorEffect="non-scaling-stroke"
      fill="none"
    />
  );
}

/** Small mono label anchored at a world point. */
export function IsoLabel({ at, children, dy = 0, anchor = "middle", tone = "muted", badge = true }: {
  at: P3; children: React.ReactNode; dy?: number; anchor?: "start" | "middle" | "end"; tone?: "muted" | "strong" | "danger" | "brand" | "safe" | "warn"; badge?: boolean;
}) {
  const [x, y] = iso(...at);
  const textY = y + dy;
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

  const textStr = typeof children === "string" ? children : "";
  const charCount = textStr.length || 8;
  const badgeWidth = Math.max(36, Math.round(charCount * 7.8 + 18));
  const badgeHeight = 22;
  const badgeX = anchor === "middle" ? x - badgeWidth / 2 : anchor === "end" ? x - badgeWidth : x;
  const badgeY = textY - badgeHeight / 2;

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
        y={textY}
        textAnchor={anchor}
        dominantBaseline="central"
        fill={fill}
        style={{ font: "600 12px var(--font-geist-mono), ui-monospace, monospace", letterSpacing: "0.06em" }}
      >
        {children}
      </text>
    </g>
  );
}

/** Phone-shaped thin slab with message lines (Telegram). */
export function IsoPhone({ at: [x, y, z], className }: { at: P3; className?: string }) {
  const lines: P3[][] = [0, 1, 2].map((i) => [
    [x + 4 + i * 0, y + 6, z + 44 - i * 9],
    [x + 4, y + 22 - i * 4, z + 44 - i * 9],
  ]);
  return (
    <g className={className}>
      <IsoBox at={[x, y, z]} size={[3, 28, 54]} m="pearl" />
      {lines.map(([a, b], i) => (
        <path
          key={i}
          d={pathThrough([a[0] - 1, a[1], a[2]], [b[0] - 1, b[1], b[2]])}
          stroke="url(#geo-iridescent)"
          strokeWidth={2}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

/** Wraps a composition in a responsive SVG with a shared viewBox. */
export function Scene({ children, label, className, viewBox = "-180 -150 360 300" }: {
  children: React.ReactNode; label: string; className?: string; viewBox?: string;
}) {
  return (
    <svg
      viewBox={viewBox}
      role="img"
      aria-label={label}
      shapeRendering="geometricPrecision"
      className={className ?? "w-full h-auto"}
    >
      <title>{label}</title>
      {children}
    </svg>
  );
}
