/**
 * Shared gradients for every isometric illustration on the page. Rendered
 * once (hidden) so each scene can reference `url(#geo-…)`.
 */
export type Material = "glass" | "chrome" | "brand" | "danger" | "safe" | "warn" | "pearl";

const FACES: Record<Material, { top: [string, string]; left: [string, string]; right: [string, string] }> = {
  glass:  { top: ["#e4f1ff", "#c3e2ff"], left: ["#8fc0ff", "#a8e6f5"], right: ["#6f86ff", "#9b85ff"] },
  chrome: { top: ["#ffffff", "#e6e9f2"], left: ["#dde1eb", "#c3c8d7"], right: ["#b6bccd", "#9aa1b6"] },
  brand:  { top: ["#7fb4ff", "#4d93ff"], left: ["#2f7bff", "#1f6bff"], right: ["#1a55d6", "#3a3fd0"] },
  danger: { top: ["#ffc2cb", "#ff9aa9"], left: ["#ff7b8a", "#f2647a"], right: ["#db3655", "#c22a4a"] },
  safe:   { top: ["#c9f2ec", "#9ee4d9"], left: ["#5fcabb", "#3dada3"], right: ["#2b8f86", "#21766f"] },
  warn:   { top: ["#ffe2bf", "#ffd09a"], left: ["#ffb162", "#f49a45"], right: ["#e07833", "#c9641f"] },
  pearl:  { top: ["#ffffff", "#f1f3fa"], left: ["#eef1f8", "#e1e5f0"], right: ["#d8dcea", "#cdd2e3"] },
};

export const MATERIALS = Object.keys(FACES) as Material[];

export function GeoDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      <defs>
        {MATERIALS.map((m) =>
          (["top", "left", "right"] as const).map((f) => (
            <linearGradient key={`${m}-${f}`} id={`geo-${m}-${f}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={FACES[m][f][0]} />
              <stop offset="100%" stopColor={FACES[m][f][1]} />
            </linearGradient>
          ))
        )}
        <linearGradient id="geo-iridescent" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#1f7bff" />
          <stop offset="35%" stopColor="#36c6f0" />
          <stop offset="70%" stopColor="#8f7cff" />
          <stop offset="100%" stopColor="#ff9ad5" />
        </linearGradient>
        <radialGradient id="geo-sphere-pearl" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#eef1f9" />
          <stop offset="100%" stopColor="#c9cfe2" />
        </radialGradient>
        <radialGradient id="geo-sphere-glass" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="40%" stopColor="#a8d4ff" />
          <stop offset="100%" stopColor="#7d6bff" />
        </radialGradient>
        <radialGradient id="geo-floor" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#5b6bd6" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#5b6bd6" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}
