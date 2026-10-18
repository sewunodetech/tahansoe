import { Fragment, type ReactNode } from "react";
import { motion } from "motion/react";
import { cx } from "../components/ui";

export interface FlowNode {
  title: string;
  sub?: ReactNode;
  tone?: "brand" | "gold" | "safe" | "neutral";
  active?: boolean;
}

/** A small left-to-right flow that echoes the whiteboard sketch. */
export function Flow({ nodes, edges }: { nodes: FlowNode[]; edges: string[] }) {
  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      {nodes.map((n, i) => (
        <Fragment key={n.title}>
          <div
            className={cx(
              "flex-1 rounded-xl border px-4 py-3 transition-colors",
              n.active === false ? "border-line bg-bg text-ink-4" : "bg-bg-subtle",
              n.active !== false && (n.tone === "brand" ? "border-brand-dim/60" : n.tone === "gold" ? "border-gold/40" : n.tone === "safe" ? "border-safe-line" : "border-line-strong"),
            )}
          >
            <div className={cx("text-sm font-medium", n.active === false ? "text-ink-4" : "text-ink")}>{n.title}</div>
            {n.sub && <div className="mt-0.5 text-xs text-ink-3 tabular">{n.sub}</div>}
          </div>
          {i < edges.length && (
            <div className="flex shrink-0 items-center justify-center gap-1.5 px-1 font-mono text-[10.5px] uppercase tracking-wider text-ink-3 sm:flex-col sm:gap-0.5">
              <span className="text-center">{edges[i]}</span>
              <motion.span
                className="text-brand"
                animate={{ x: [0, 4, 0] }}
                transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
              >
                <span className="hidden sm:inline">→</span>
                <span className="sm:hidden">↓</span>
              </motion.span>
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}
