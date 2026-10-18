/** Shared Recharts styling bound to the CSS tokens. */
export const axis = {
  stroke: "var(--border-strong)",
  tick: { fill: "var(--text-tertiary)", fontSize: 11, fontFamily: "JetBrains Mono Variable, monospace" },
  tickLine: false,
} as const;

export const grid = { stroke: "var(--border)", strokeDasharray: "3 4", vertical: false } as const;

export const tooltip = {
  contentStyle: {
    background: "var(--bg-overlay)",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--text-primary)",
  },
  labelStyle: { color: "var(--text-tertiary)", fontFamily: "JetBrains Mono Variable, monospace", fontSize: 11 },
  itemStyle: { padding: 0 },
  cursor: { stroke: "var(--border-strong)" },
} as const;
