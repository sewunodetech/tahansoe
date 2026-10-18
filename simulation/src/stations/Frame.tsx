import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, X } from "lucide-react";
import { STATIONS } from "../sim/constants";
import { useSim } from "../sim/store";
import { Button, Card } from "../components/ui";

/** Common chrome for every station drawer: number, title, lead, body, nav. */
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
    <Card className="overflow-hidden rounded-none border-0 sm:rounded-xl sm:border">
      <div className="border-b border-line px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.08em]">
            <span className="text-gold">Station {String(i + 1).padStart(2, "0")}</span>
            <span className="text-ink-4">/ {String(STATIONS.length).padStart(2, "0")}</span>
            {kicker && <span className="text-ink-3">· {kicker}</span>}
          </div>
          <button
            onClick={() => dispatch({ type: "CLOSE" })}
            className="-mr-2 -mt-2 grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-bg-hover hover:text-ink"
            aria-label="Back to the board"
          >
            <X size={16} />
          </button>
        </div>
        <h1 className="mt-2 font-display text-[34px] leading-[1.05] tracking-tight sm:text-[42px]">{s.title}</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-2">{lead}</p>
      </div>

      <div className="space-y-5 px-5 py-6 sm:px-7">{children}</div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-bg-subtle px-5 py-4 sm:px-7">
        <Button variant="ghost" onClick={() => dispatch({ type: "OPEN", index: i - 1 })} disabled={i === 0}>
          <ArrowLeft size={15} /> Back
        </Button>
        <div className="flex flex-1 items-center justify-end gap-3">
          {done && doneNote && (
            <span className="hidden items-center gap-1.5 text-sm text-safe sm:inline-flex">
              <CheckCircle2 size={15} /> {doneNote}
            </span>
          )}
          {!isLast && (
            <Button variant={done ? "primary" : "ghost"} onClick={() => dispatch({ type: "NEXT" })} disabled={!done}>
              Next arrow <ArrowRight size={15} />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
