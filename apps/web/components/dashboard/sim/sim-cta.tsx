"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSimActions } from "@/lib/sim/hooks";

/** End of the journey: leave the simulation and connect a real wallet (marks the funnel converted). */
export function SimCta() {
  const router = useRouter();
  const { exit } = useSimActions();
  const [leaving, setLeaving] = useState(false);

  const handle = async () => {
    setLeaving(true);
    await exit({ converted: true });
    router.replace("/connect");
  };

  return (
    <Card className="p-5 md:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 border-[var(--brand)]/30 bg-[var(--brand-bg)]">
      <div className="flex items-start gap-3">
        <ShieldCheck className="size-5 text-[var(--brand)] shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-[var(--text-primary)]">Seen enough? Protect your real position.</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-[520px]">
            Same Guardian, same rules, your own wallet. Tahansoe never takes custody: it can only repay your own Aave debt within the caps you approve.
            It lowers the odds of liquidation; it does not guarantee against it.
          </p>
        </div>
      </div>
      <Button onClick={handle} disabled={leaving} className="shrink-0 self-start md:self-center">
        Protect your real position <ArrowRight />
      </Button>
    </Card>
  );
}
