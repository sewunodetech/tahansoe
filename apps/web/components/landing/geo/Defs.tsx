/**
 * Shared gradients for every isometric illustration on the page. Rendered
 * once (hidden) so each scene can reference `url(#geo-…)`.
 */
export type Material = "glass" | "chrome" | "brand" | "danger" | "safe" | "warn" | "pearl" | "usdc";

const FACES: Record<Material, { top: [string, string]; left: [string, string]; right: [string, string] }> = {
  glass:  { top: ["#edf6ff", "#d6ecff"], left: ["#a5d2ff", "#bee8fa"], right: ["#7b94ff", "#a491ff"] },
  chrome: { top: ["#ffffff", "#e9ecf5"], left: ["#dde2ed", "#c4c9d9"], right: ["#b5bbcd", "#9da3b7"] },
  brand:  { top: ["#6ca5ff", "#3b82f6"], left: ["#2563eb", "#1d4ed8"], right: ["#1e40af", "#1e3090"] },
  danger: { top: ["#ffb5bf", "#ff889b"], left: ["#f43f5e", "#e11d48"], right: ["#be123c", "#9f1239"] },
  safe:   { top: ["#bbf7d0", "#86efac"], left: ["#10b981", "#059669"], right: ["#047857", "#065f46"] },
  warn:   { top: ["#fef08a", "#fde047"], left: ["#f59e0b", "#d97706"], right: ["#b45309", "#92400e"] },
  pearl:  { top: ["#ffffff", "#f1f4fb"], left: ["#eaeef8", "#dde2f1"], right: ["#cfd5e7", "#bec5dc"] },
  usdc:   { top: ["#60a5fa", "#2775ca"], left: ["#2563eb", "#1d4ed8"], right: ["#1d4ed8", "#1e40af"] },
};

export const MATERIALS = Object.keys(FACES) as Material[];

export function GeoDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      <defs>
        <style>{`
          :root {
            --geo-edge: rgba(54, 56, 110, 0.16);
            --geo-edge-strong: rgba(54, 56, 110, 0.30);
            --geo-edge-highlight: rgba(255, 255, 255, 0.95);
            --geo-floor-color: #36386e;
            --geo-floor-opacity: 0.07;
            --geo-label-bg: rgba(255, 255, 255, 0.92);
            --geo-label-border: rgba(54, 56, 110, 0.15);
            --geo-label-shadow: rgba(54, 56, 110, 0.08);

            --geo-glass-top-0: #edf6ff;
            --geo-glass-top-1: #d6ecff;
            --geo-glass-left-0: #a5d2ff;
            --geo-glass-left-1: #bee8fa;
            --geo-glass-right-0: #7b94ff;
            --geo-glass-right-1: #a491ff;

            --geo-chrome-top-0: #ffffff;
            --geo-chrome-top-1: #e9ecf5;
            --geo-chrome-left-0: #dde2ed;
            --geo-chrome-left-1: #c4c9d9;
            --geo-chrome-right-0: #b5bbcd;
            --geo-chrome-right-1: #9da3b7;

            --geo-brand-top-0: #6ca5ff;
            --geo-brand-top-1: #3b82f6;
            --geo-brand-left-0: #2563eb;
            --geo-brand-left-1: #1d4ed8;
            --geo-brand-right-0: #1e40af;
            --geo-brand-right-1: #1e3090;

            --geo-danger-top-0: #ffb5bf;
            --geo-danger-top-1: #ff889b;
            --geo-danger-left-0: #f43f5e;
            --geo-danger-left-1: #e11d48;
            --geo-danger-right-0: #be123c;
            --geo-danger-right-1: #9f1239;

            --geo-safe-top-0: #bbf7d0;
            --geo-safe-top-1: #86efac;
            --geo-safe-left-0: #10b981;
            --geo-safe-left-1: #059669;
            --geo-safe-right-0: #047857;
            --geo-safe-right-1: #065f46;

            --geo-warn-top-0: #fef08a;
            --geo-warn-top-1: #fde047;
            --geo-warn-left-0: #f59e0b;
            --geo-warn-left-1: #d97706;
            --geo-warn-right-0: #b45309;
            --geo-warn-right-1: #92400e;

            --geo-pearl-top-0: #ffffff;
            --geo-pearl-top-1: #f1f4fb;
            --geo-pearl-left-0: #eaeef8;
            --geo-pearl-left-1: #dde2f1;
            --geo-pearl-right-0: #cfd5e7;
            --geo-pearl-right-1: #bec5dc;

            --geo-usdc-top-0: #60a5fa;
            --geo-usdc-top-1: #2775ca;
            --geo-usdc-left-0: #2563eb;
            --geo-usdc-left-1: #1d4ed8;
            --geo-usdc-right-0: #1d4ed8;
            --geo-usdc-right-1: #1e40af;

            --geo-sphere-pearl-0: #ffffff;
            --geo-sphere-pearl-55: #eef2fb;
            --geo-sphere-pearl-100: #c9d0e5;

            --geo-sphere-glass-0: #ffffff;
            --geo-sphere-glass-40: #a8d5ff;
            --geo-sphere-glass-100: #7d6cff;

            --geo-irid-0: #1f7bff;
            --geo-irid-35: #36c6f0;
            --geo-irid-70: #8f7cff;
            --geo-irid-100: #ff9ad5;
          }

          [data-theme="dark"] {
            --geo-edge: rgba(255, 255, 255, 0.16);
            --geo-edge-strong: rgba(255, 255, 255, 0.32);
            --geo-edge-highlight: rgba(255, 255, 255, 0.42);
            --geo-floor-color: #3b82f6;
            --geo-floor-opacity: 0.14;
            --geo-label-bg: rgba(21, 24, 26, 0.90);
            --geo-label-border: rgba(255, 255, 255, 0.14);
            --geo-label-shadow: rgba(0, 0, 0, 0.5);

            --geo-glass-top-0: #2b4c80;
            --geo-glass-top-1: #1e3966;
            --geo-glass-left-0: #1d4ed8;
            --geo-glass-left-1: #0284c7;
            --geo-glass-right-0: #1e1b4b;
            --geo-glass-right-1: #312e81;

            --geo-chrome-top-0: #3a4454;
            --geo-chrome-top-1: #2a3340;
            --geo-chrome-left-0: #212833;
            --geo-chrome-left-1: #1a202a;
            --geo-chrome-right-0: #141820;
            --geo-chrome-right-1: #0e1117;

            --geo-brand-top-0: #60a5fa;
            --geo-brand-top-1: #3b82f6;
            --geo-brand-left-0: #2563eb;
            --geo-brand-left-1: #1d4ed8;
            --geo-brand-right-0: #1e3a8a;
            --geo-brand-right-1: #172554;

            --geo-danger-top-0: #fb7185;
            --geo-danger-top-1: #e11d48;
            --geo-danger-left-0: #be123c;
            --geo-danger-left-1: #9f1239;
            --geo-danger-right-0: #881337;
            --geo-danger-right-1: #4c0519;

            --geo-safe-top-0: #34d399;
            --geo-safe-top-1: #10b981;
            --geo-safe-left-0: #059669;
            --geo-safe-left-1: #047857;
            --geo-safe-right-0: #064e3b;
            --geo-safe-right-1: #022c22;

            --geo-warn-top-0: #fbbf24;
            --geo-warn-top-1: #f59e0b;
            --geo-warn-left-0: #d97706;
            --geo-warn-left-1: #b45309;
            --geo-warn-right-0: #78350f;
            --geo-warn-right-1: #451a03;

            --geo-pearl-top-0: #363e4e;
            --geo-pearl-top-1: #282f3d;
            --geo-pearl-left-0: #202632;
            --geo-pearl-left-1: #1a1e27;
            --geo-pearl-right-0: #141720;
            --geo-pearl-right-1: #0e1017;

            --geo-usdc-top-0: #93c5fd;
            --geo-usdc-top-1: #3b82f6;
            --geo-usdc-left-0: #2563eb;
            --geo-usdc-left-1: #1d4ed8;
            --geo-usdc-right-0: #1d4ed8;
            --geo-usdc-right-1: #1e3a8a;

            --geo-sphere-pearl-0: #546078;
            --geo-sphere-pearl-55: #323a49;
            --geo-sphere-pearl-100: #1a1f28;

            --geo-sphere-glass-0: #60a5fa;
            --geo-sphere-glass-40: #2563eb;
            --geo-sphere-glass-100: #1e1b4b;

            --geo-irid-0: #3b82f6;
            --geo-irid-35: #38bdf8;
            --geo-irid-70: #a78bfa;
            --geo-irid-100: #f472b6;
          }

          .geo-float {
            will-change: transform;
          }
          .geo-pulse {
            will-change: opacity;
          }
          @media (prefers-reduced-motion: reduce) {
            .geo-flow,
            .geo-flow-slow,
            .geo-float,
            .geo-pulse {
              animation: none !important;
              transform: none !important;
            }
          }
        `}</style>
        {MATERIALS.map((m) =>
          (["top", "left", "right"] as const).map((f) => (
            <linearGradient key={`${m}-${f}`} id={`geo-${m}-${f}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={`var(--geo-${m}-${f}-0, ${FACES[m][f][0]})`} />
              <stop offset="100%" stopColor={`var(--geo-${m}-${f}-1, ${FACES[m][f][1]})`} />
            </linearGradient>
          ))
        )}
        <linearGradient id="geo-iridescent" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--geo-irid-0, #1f7bff)" />
          <stop offset="35%" stopColor="var(--geo-irid-35, #36c6f0)" />
          <stop offset="70%" stopColor="var(--geo-irid-70, #8f7cff)" />
          <stop offset="100%" stopColor="var(--geo-irid-100, #ff9ad5)" />
        </linearGradient>
        <radialGradient id="geo-sphere-pearl" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="var(--geo-sphere-pearl-0, #ffffff)" />
          <stop offset="55%" stopColor="var(--geo-sphere-pearl-55, #eef1f9)" />
          <stop offset="100%" stopColor="var(--geo-sphere-pearl-100, #c9cfe2)" />
        </radialGradient>
        <radialGradient id="geo-sphere-glass" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="var(--geo-sphere-glass-0, #ffffff)" />
          <stop offset="40%" stopColor="var(--geo-sphere-glass-40, #a8d4ff)" />
          <stop offset="100%" stopColor="var(--geo-sphere-glass-100, #7d6bff)" />
        </radialGradient>
        <radialGradient id="geo-floor" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--geo-floor-color, #5b6bd6)" stopOpacity="var(--geo-floor-opacity, 0.18)" />
          <stop offset="100%" stopColor="var(--geo-floor-color, #5b6bd6)" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}
