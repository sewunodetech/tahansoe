/**
 * GET /api/sim/status
 *
 * Price, scenario progress and the sim keeper's protection events for the session's fork
 * (spec m1-simulation-mode §3.6). Also records the first protection in sim_sessions.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { simnetFetch } from "@/lib/sim/simnet.server";
import { mockStatus } from "@/lib/sim/mock";
import { recordProtection } from "@/lib/sim/db.server";
import { clientIp, rateLimit } from "@/lib/sim/rate-limit";
import type { SimEvent, SimStatus } from "@/lib/sim/types";

/** USDC is the only debt asset on the fork; every event amount is in its 6-decimal units. */
const DEBT_DECIMALS = 6;

/** Raw on-chain value (base-unit string) → number with `decimals`; numbers pass through. */
function fromUnits(v: unknown, decimals: number): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v !== "string" || !/^\d+$/.test(v)) return undefined;
  return Number(BigInt(v)) / 10 ** decimals;
}

/**
 * simnet reports event values as raw on-chain integers (token units, HF in WAD, `waived` as an
 * amount). The UI reads dollars, plain HF numbers and a waived flag.
 */
function normalizeEvent(e: SimEvent): SimEvent {
  const raw = e as unknown as Record<string, unknown>;
  const waived = typeof raw.waived === "boolean" ? raw.waived : (fromUnits(raw.waived, DEBT_DECIMALS) ?? 0) > 0;
  return {
    ...e,
    amount: fromUnits(raw.amount, DEBT_DECIMALS) ?? e.amount,
    hfBefore: fromUnits(raw.hfBefore, 18),
    hfAfter: fromUnits(raw.hfAfter, 18),
    waived,
  };
}

export async function GET(req: NextRequest) {
  // The dashboard polls every few seconds; allow that with headroom.
  if (!rateLimit(`sim-status:${clientIp(req.headers)}`, 120)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await getSession();
  const sim = session.sim;
  if (!sim) return NextResponse.json({ error: "No simulation session" }, { status: 401 });

  let status: SimStatus;
  if (sim.mock) {
    status = mockStatus(sim.sessionId, sim.mode);
  } else {
    const res = await simnetFetch<SimStatus & { error?: string }>(`/v1/sessions/${encodeURIComponent(sim.sessionId)}/status`);
    if (res.status === 404 || res.status === 410) {
      return NextResponse.json({ error: "Simulation session expired", expired: true }, { status: 410 });
    }
    if (res.status !== 200) return NextResponse.json({ error: "Simulation is not available right now" }, { status: 503 });
    status = { ...res.body, events: res.body.events.map(normalizeEvent) };
  }

  const layers = status.events
    .filter((e) => e.type === "layer" && typeof e.layer === "number")
    .map((e) => e.layer as number);
  const hasProtect = status.events.some((e) => e.type === "protected");
  const known = sim.layersRecorded ?? [];
  if (hasProtect && (known.length === 0 || layers.some((l) => !known.includes(l)))) {
    const all = [...new Set([...known, ...layers])];
    await recordProtection(sim.dbId, all);
    session.sim = { ...sim, layersRecorded: all.length ? all : [0] };
    await session.save();
  }

  return NextResponse.json(status);
}
