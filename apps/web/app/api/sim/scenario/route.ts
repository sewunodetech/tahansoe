/**
 * POST /api/sim/scenario { kind: "replay", scenario } | { kind: "crash", pct: 10 | 30 | 50 }
 *
 * Drives the price on a private fork (spec m1-simulation-mode §3.3). The shared Live fork follows
 * mainnet and cannot be crashed.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { simnetFetch } from "@/lib/sim/simnet.server";
import { mockScenario } from "@/lib/sim/mock";
import { clientIp, rateLimit } from "@/lib/sim/rate-limit";
import { scenarioSchema } from "@/lib/sim/types";

export async function POST(req: NextRequest) {
  if (!rateLimit(`sim-scenario:${clientIp(req.headers)}`, 20)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await getSession();
  const sim = session.sim;
  if (!sim) return NextResponse.json({ error: "No simulation session" }, { status: 401 });

  const parsed = scenarioSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  if (sim.mode === "live") {
    return NextResponse.json({ error: "Live mode follows the mainnet price. Switch to Replay or Stress." }, { status: 400 });
  }
  if (parsed.data.kind === "crash" && sim.mode !== "stress") {
    return NextResponse.json({ error: "Crash buttons are only available in Stress mode" }, { status: 400 });
  }

  if (sim.mock) {
    mockScenario(sim.sessionId, sim.mode, parsed.data);
    return NextResponse.json({ ok: true });
  }

  const { status, body } = await simnetFetch<{ ok?: boolean; error?: string }>(
    `/v1/sessions/${encodeURIComponent(sim.sessionId)}/scenario`,
    { method: "POST", body: parsed.data }
  );
  if (status < 200 || status >= 300) {
    return NextResponse.json({ error: body?.error ?? "Scenario failed" }, { status: status === 503 ? 503 : 502 });
  }
  return NextResponse.json({ ok: true });
}
