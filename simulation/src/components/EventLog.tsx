import { motion } from "motion/react";
import { AlertTriangle, ArrowRight, CheckCircle2, Info, Skull, Zap } from "lucide-react";
import type { Intent } from "../sim/model";
import { useSim, type LogKind } from "../sim/store";
import { Card, cx } from "./ui";

const ICON: Record<LogKind, { Icon: typeof Info; cls: string }> = {
  action: { Icon: ArrowRight, cls: "text-brand" },
  info: { Icon: Info, cls: "text-ink-3" },
  intent: { Icon: Zap, cls: "text-gold" },
  warn: { Icon: AlertTriangle, cls: "text-warning" },
  danger: { Icon: Skull, cls: "text-danger" },
  success: { Icon: CheckCircle2, cls: "text-safe" },
};

export function EventLog() {
  const { state } = useSim();
  return (
    <Card className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="text-sm font-medium">Event log</span>
        <span className="font-mono text-[10.5px] text-ink-3">{state.log.length} events</span>
      </div>
      <div className="max-h-[420px] min-h-[120px] overflow-y-auto px-2 py-2" aria-live="polite">
        {state.log.length === 0 && <div className="px-2 py-6 text-center text-sm text-ink-3">Your actions will appear here.</div>}
          {state.log.map((e) => {
            const { Icon, cls } = ICON[e.kind];
            return (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-2.5 rounded-md px-2 py-2"
              >
                <Icon size={14} className={cx("mt-0.5 shrink-0", cls)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] leading-snug text-ink">{e.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-3">{e.at}</span>
                  </div>
                  {e.detail && <div className="mt-0.5 text-xs leading-snug text-ink-3">{e.detail}</div>}
                  {e.intent && <IntentCard intent={e.intent} />}
                </div>
              </motion.div>
            );
          })}
      </div>
    </Card>
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
