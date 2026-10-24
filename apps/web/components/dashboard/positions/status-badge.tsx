import React from "react";
import { Eye, ShieldCheck, ShieldOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PositionStatus } from "@/lib/positions/status";

/** Protected / Not protected / Monitor only (spec §3.4). */
export function StatusBadge({ status }: { status: PositionStatus }) {
  if (status.kind === "protected") {
    return (
      <Badge variant="safe" size="md" className="font-mono">
        <ShieldCheck className="size-3.5" /> Protected · {status.triggerHf.toFixed(2)} → {status.targetHf.toFixed(2)}
      </Badge>
    );
  }
  if (status.kind === "not-protected") {
    return (
      <Badge variant="warning" size="md" className="font-mono">
        <ShieldOff className="size-3.5" /> Not protected
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" size="md" className="font-mono">
      <Eye className="size-3.5" /> Monitor only
    </Badge>
  );
}

export const PROTOCOL_LABEL: Record<string, string> = {
  "aave-v3": "Aave V3",
  "morpho-blue": "Morpho Blue",
};
