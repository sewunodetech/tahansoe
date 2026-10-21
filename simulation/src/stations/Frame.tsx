import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, X } from "lucide-react";
import { STATIONS } from "../sim/constants";
import { useSim } from "../sim/store";
import { Button } from "../components/ui";

/** Common chrome for every step popover: number, title, lead, scrollable body, nav. */
export function Frame({
  kicker,
  lead,
  children,
  doneNote,
}: {
  kicker?: string;
  lead: ReactNode;
  children: ReactNode;
  doneNote?: ReactNode;
}) {
  const { state, dispatch } = useSim();
  const i = state.view;
  const s = STATIONS[i];
  const done = state.done[s.id];
  const isLast = i === STATIONS.length - 1;

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line px-5 pb-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.08em]">
            <span className="text-gold">Step {String(i + 1).padStart(2, "0")}</span>
            <span className="text-ink-4">/ {String(STATIONS.length).padStart(2, "0")}</span>
            {kicker && <span className="text-ink-3">· {kicker}</span>}
          </div>
          <button
            onClick={() => dispatch({ type: "CLOSE" })}
            className="-mr-2 -mt-1.5 grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-bg-hover hover:text-ink"
            aria-label="Back to the board"
          >
            <X size={16} />
          </button>
        </div>
        <h2 className="mt-1.5 font-display text-[28px] font-normal leading-[1.05] tracking-tight">{s.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{lead}</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>

      <div className="flex shrink-0 items-center justify-between gap-3 rounded-b-2xl border-t border-line bg-bg-subtle px-5 py-3">
        <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "OPEN", index: i - 1 })} disabled={i === 0}>
          <ArrowLeft size={15} /> Back
        </Button>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
          {done && doneNote && (
            <span className="hidden min-w-0 items-center gap-1.5 truncate text-sm text-safe @sm:inline-flex">
              <CheckCircle2 size={15} className="shrink-0" /> {doneNote}
            </span>
          )}
          {!isLast && (
            <Button variant={done ? "primary" : "ghost"} size="sm" onClick={() => dispatch({ type: "NEXT" })} disabled={!done}>
              Next arrow <ArrowRight size={15} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
