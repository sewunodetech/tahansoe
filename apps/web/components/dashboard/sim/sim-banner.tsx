"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, LogOut } from "lucide-react";
import { useSimActions, useSimSession, useSimStatus } from "@/lib/sim/hooks";

function useCountdown(expiresAt: string | null | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const left = Math.max(0, new Date(expiresAt).getTime() - now);
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1_000);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Always-visible strip on every dashboard page while the burner wallet is connected. */
export function SimBanner() {
  const router = useRouter();
  const { data: session } = useSimSession();
  const { data: status, error } = useSimStatus(Boolean(session));
  const { exit } = useSimActions();
  const [leaving, setLeaving] = useState(false);
  const mode = status?.mode ?? session?.mode ?? "live";
  const countdown = useCountdown(status?.expiresAt ?? session?.expiresAt);

  const expired = (error as { status?: number } | null)?.status === 410;
  useEffect(() => {
    if (expired) router.replace("/connect?sim=ended");
  }, [expired, router]);

  const handleExit = async () => {
    setLeaving(true);
    await exit();
    router.replace("/connect");
  };

  return (
    <div
      role="status"
      className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 md:px-8 py-2 border-b border-[var(--warning-border)] bg-[var(--warning-bg)] backdrop-blur-sm text-[11px] font-mono"
    >
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
        {countdown && <> · fork ends in {countdown}</>}
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
  );
}
