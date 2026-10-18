import { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronUp, Info, ScrollText, Skull, Zap } from "lucide-react";
import type { Intent } from "../sim/model";
import { useSim, type LogEntry, type LogKind } from "../sim/store";
import { cx } from "./ui";

const ICON: Record<LogKind, { Icon: typeof Info; cls: string }> = {
  action: { Icon: ArrowRight, cls: "text-brand" },
  info: { Icon: Info, cls: "text-ink-3" },
  intent: { Icon: Zap, cls: "text-gold" },
  warn: { Icon: AlertTriangle, cls: "text-warning" },
  danger: { Icon: Skull, cls: "text-danger" },
  success: { Icon: CheckCircle2, cls: "text-safe" },
};

/** Floating log at the bottom of the screen: the latest event, expandable to the full history. */
export function LogDock() {
  const { state } = useSim();
  const [open, setOpen] = useState(false);
  const latest = state.log[0];
  // The step popover becomes a bottom sheet on phones, so the dock steps aside there.
  const hiddenOnMobile = state.drawerOpen;

  return (
    <div
      data-keep-popover
      className={cx(
        "fixed bottom-4 left-1/2 z-[60] w-[min(760px,calc(100vw-32px))] -translate-x-1/2",
        hiddenOnMobile && "max-md:hidden",
      )}
    >
      <div className="overflow-hidden rounded-2xl border border-line-strong bg-bg-elevated/95 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur">
        {open && (
          <div className="max-h-[45vh] overflow-y-auto border-b border-line px-2 py-2" aria-live="polite">
            {state.log.length === 0 && <div className="px-2 py-6 text-center text-sm text-ink-3">Your actions will appear here.</div>}
            {state.log.map((e) => (
              <Entry key={e.id} e={e} />
            ))}
          </div>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-bg-hover/60"
        >
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
            <ScrollText size={13} /> Log
          </span>
          {latest ? (
            <span key={latest.id} className="log-in flex min-w-0 flex-1 items-center gap-2">
              {(() => {
                const { Icon, cls } = ICON[latest.kind];
                return <Icon size={14} className={cx("shrink-0", cls)} />;
              })()}
              <span className="truncate text-[13px] text-ink">{latest.title}</span>
              <span className="hidden shrink-0 font-mono text-[10px] text-ink-3 sm:inline">{latest.at}</span>
            </span>
          ) : (
            <span className="flex-1 truncate text-[13px] text-ink-3">Your actions will appear here.</span>
          )}
          <span className="shrink-0 rounded-full border border-line-strong px-2 py-0.5 font-mono text-[10px] text-ink-3">{state.log.length}</span>
          <ChevronUp size={15} className={cx("shrink-0 text-ink-3 transition-transform", !open && "rotate-180")} />
        </button>
      </div>
    </div>
  );
}

function Entry({ e }: { e: LogEntry }) {
  const { Icon, cls } = ICON[e.kind];
  return (
    <div className="flex gap-2.5 rounded-md px-2 py-2">
      <Icon size={14} className={cx("mt-0.5 shrink-0", cls)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] leading-snug text-ink">{e.title}</span>
          <span className="shrink-0 font-mono text-[10px] text-ink-3">{e.at}</span>
        </div>
        {e.detail && <div className="mt-0.5 text-xs leading-snug text-ink-3">{e.detail}</div>}
        {e.intent && <IntentCard intent={e.intent} />}
      </div>
    </div>
  );
}

export function IntentCard({ intent }: { intent: Intent }) {
  const rows: [string, string][] = [
    ["action", `"${intent.action}"`],
    ["amount", intent.amount.toLocaleString("en-US")],
    ["asset", `"${intent.asset}"`],
    ["source", `"${intent.source}"`],
    ["targetHealthFactor", intent.targetHealthFactor.toFixed(2)],
    ["estimatedGas", intent.estimatedGas.toLocaleString("en-US")],
    ["estimatedSlippageBps", String(intent.estimatedSlippageBps)],
    ["reason", `"${intent.reason}"`],
  ];
  return (
    <pre className="mt-2 overflow-x-auto rounded-md border border-line bg-bg px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-2">
      <span className="text-ink-3">Intent {"{"}</span>
      {rows.map(([k, v]) => (
        <span key={k} className="block pl-3">
          <span className="text-brand">{k}</span>: <span className={k === "action" ? "text-gold" : "text-ink"}>{v}</span>
        </span>
      ))}
      <span className="text-ink-3">{"}"}</span>
    </pre>
  );
}
