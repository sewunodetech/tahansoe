/**
 * Isometric projection helpers. World units are pixels:
 * x runs down-right, y runs down-left, z runs straight up.
 */
const C = Math.cos(Math.PI / 6); // 0.866
const S = 0.5;

export type P3 = [number, number, number];

export function iso(x: number, y: number, z = 0): [number, number] {
  return [(x - y) * C, (x + y) * S - z];
}

export function poly(points: P3[]): string {
  return points.map((p) => iso(...p).map((n) => n.toFixed(1)).join(",")).join(" ");
}

/** Projected ellipse of a horizontal circle of radius r. */
export function ellipse(r: number) {
  return { rx: r * Math.SQRT2 * C, ry: r * Math.SQRT2 * S };
}

/** SVG path through world points (straight segments, or a quadratic curve with `lift`). */
export function pathThrough(a: P3, b: P3, lift = 0): string {
  const [ax, ay] = iso(...a);
  const [bx, by] = iso(...b);
  if (!lift) return `M${ax},${ay} L${bx},${by}`;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2 - lift;
  return `M${ax},${ay} Q${mx},${my} ${bx},${by}`;
}

/** Inverse projection on a given height: screen point → world [x, y, z]. */
export function fromScreen(sx: number, sy: number, z = 0): P3 {
  const a = sx / C; // x - y
  const b = (sy + z) / S; // x + y
  return [(a + b) / 2, (b - a) / 2, z];
}

/** Back corner for a box whose footprint is centred on screen point (sx, sy). */
export function boxAt(sx: number, sy: number, w: number, d: number, z = 0): P3 {
  const [x, y] = fromScreen(sx, sy);
  return [x - w / 2, y - d / 2, z];
}
