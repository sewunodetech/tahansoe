"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, LogOut } from "lucide-react";
import { useSimActions, useSimSession, useSimStatus } from "@/lib/sim/hooks";
import { useSimDashboard } from "./sim-context";

/** Always-visible strip on every dashboard page while the burner wallet is connected. */
export function SimBanner() {
  const router = useRouter();
  const { data: session } = useSimSession();
  const { data: status, error } = useSimStatus(Boolean(session));
  const { exit, switchMode } = useSimActions();
  const { reset, setMarketChosen } = useSimDashboard();
  const [leaving, setLeaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const restarting = useRef(false);
  const mode = status?.mode ?? session?.mode ?? "live";

  // simnet reclaims a fork only after a long idle stretch (tab closed, laptop asleep). Instead of
  // ending the simulation, start a fresh fork in the same mode and say so.
  const expired = (error as { status?: number } | null)?.status === 410;
  useEffect(() => {
    if (!expired || !session || restarting.current) return;
    restarting.current = true;
    switchMode(session.address, session.mode, session.mode === "replay" ? session.scenario : undefined)
      .then(() => {
        reset();
        setMarketChosen(false);
        setNotice("Your previous fork was cleaned up after a long idle time. A fresh one is ready; open the position again.");
      })
      .catch(() => router.replace("/connect?sim=ended"))
      .finally(() => {
        restarting.current = false;
      });
  }, [expired, session, switchMode, reset, setMarketChosen, router]);

  const handleExit = async () => {
    setLeaving(true);
    await exit();
    router.replace("/connect");
  };

  return (
    <div
      role="status"
      className="sticky top-0 z-20 px-4 md:px-8 py-2 border-b border-[var(--warning-border)] bg-[var(--warning-bg)] backdrop-blur-sm text-[11px] font-mono"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 font-semibold tracking-wider text-[var(--warning)]">
          <FlaskConical className="size-3.5" strokeWidth={1.75} />
          SIMULATION MODE
        </span>
        <span className="text-[var(--text-secondary)]">
          fake funds · price: <span className="text-[var(--text-primary)]">{mode}</span>
          {status && (
            <>
              {" "}· ETH <span className="text-[var(--text-primary)]">${status.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
            </>
          )}
          {mode === "live" && <> · resets daily</>}
        </span>
        {session?.mock && <span className="text-[var(--text-tertiary)]">mock simnet</span>}
        <button
          type="button"
          onClick={handleExit}
          disabled={leaving}
          className="ml-auto inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer disabled:opacity-50"
        >
          <LogOut className="size-3" /> Exit simulation
        </button>
      </div>
      {notice && (
        <p className="mt-1.5 text-[var(--text-primary)] font-sans flex items-center gap-2">
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer">
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}
