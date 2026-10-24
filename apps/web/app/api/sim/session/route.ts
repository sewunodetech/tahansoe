/**
 * /api/sim/session — Simulation Mode session (spec m1-simulation-mode §3.5).
 *
 * GET    current sim session from the cookie (404 when none)
 * POST   { address, mode, scenario? } start a session, or switch mode (replaces the old one)
 * PATCH  { event: "position_opened" | "converted" } funnel events
 * DELETE exit simulation: ends the simnet session and clears the sim cookie fields
 *
 * The sim session never sets `userId`, so it cannot reach routes that serve real user data.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession, type SimCookieData } from "@/lib/session";
import { isSimnetConfigured, isSimnetMock, simnetFetch } from "@/lib/sim/simnet.server";
import { mockCreateSession, mockDeleteSession } from "@/lib/sim/mock";
import { recordPositionOpened, recordSimSessionStart, simDbId } from "@/lib/sim/db.server";
import { clientIp, rateLimit } from "@/lib/sim/rate-limit";
import { SIM_CHAIN_ID } from "@/lib/sim/chain";
import { createSessionSchema, sessionEventSchema, simnetSessionSchema, type SimSessionInfo, type SimnetSession } from "@/lib/sim/types";

/** Creating a fork outlasts the default simnet timeout; the platform limit must cover it too. */
export const maxDuration = 60;
const SESSION_CREATE_TIMEOUT_MS = 55_000;

function publicInfo(sim: SimCookieData): SimSessionInfo {
  return {
    sessionId: sim.sessionId,
    address: sim.address,
    forkId: sim.forkId,
    mode: sim.mode,
    scenario: sim.scenario,
    expiresAt: sim.expiresAt,
    rpcPath: sim.rpcPath,
    contracts: sim.contracts,
    mock: sim.mock,
  };
}

async function endSimnetSession(sim: SimCookieData) {
  if (sim.mock) mockDeleteSession(sim.sessionId);
  else await simnetFetch(`/v1/sessions/${encodeURIComponent(sim.sessionId)}`, { method: "DELETE" });
}

export async function GET() {
  const session = await getSession();
  if (!session.sim) return NextResponse.json({ error: "No simulation session" }, { status: 404 });
  if (session.sim.expiresAt && new Date(session.sim.expiresAt) < new Date()) {
    return NextResponse.json({ error: "Simulation session expired", expired: true, mode: session.sim.mode }, { status: 410 });
  }
  return NextResponse.json(publicInfo(session.sim));
}

export async function POST(req: NextRequest) {
  if (!rateLimit(`sim-session:${clientIp(req.headers)}`, 10)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isSimnetConfigured()) {
    return NextResponse.json({ error: "Simulation is not available right now" }, { status: 503 });
  }

  const parsed = createSessionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { address, mode, scenario } = parsed.data;

  const session = await getSession();
  const mock = isSimnetMock();

  let created: SimnetSession;
  if (mock) {
    created = mockCreateSession({ mode, scenario });
  } else {
    const { status, body } = await simnetFetch<SimnetSession & { error?: string; retryAfterSec?: number }>("/v1/sessions", {
      method: "POST",
      body: { address, mode, ...(scenario ? { scenario } : {}) },
      // A private fork boots anvil and deploys the contracts: about 15–20 s, slower on a cold RPC.
      timeoutMs: SESSION_CREATE_TIMEOUT_MS,
    });
    if (status === 409) {
      return NextResponse.json(
        { error: "capacity", retryAfterSec: body.retryAfterSec ?? 60 },
        { status: 409 }
      );
    }
    const reply = simnetSessionSchema.safeParse(body);
    if (status < 200 || status >= 300 || !reply.success || reply.data.chainId !== SIM_CHAIN_ID) {
      return NextResponse.json({ error: "Simulation is not available right now" }, { status: 503 });
    }
    created = reply.data;
  }

  // Switching mode replaces the previous fork session. Faucet usage carries over for the same
  // burner so re-creating sessions does not reset the per-session top-up limit.
  const previous = session.sim;
  if (previous && previous.sessionId !== created.sessionId) await endSimnetSession(previous);
  const faucet = previous && previous.address === address ? previous.faucet ?? {} : {};

  const dbId = simDbId(created.sessionId);
  session.sim = {
    sessionId: created.sessionId,
    dbId,
    address,
    forkId: created.forkId,
    mode,
    scenario,
    expiresAt: created.expiresAt,
    rpcPath: created.rpcPath,
    contracts: created.contracts,
    mock: mock || undefined,
    faucet,
  };
  await session.save();

  await recordSimSessionStart({
    id: dbId,
    address,
    mode,
    scenario: scenario ?? null,
    forkId: created.forkId,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json(publicInfo(session.sim));
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session.sim) return NextResponse.json({ error: "No simulation session" }, { status: 404 });

  const parsed = sessionEventSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  if (parsed.data.event === "position_opened") {
    await recordPositionOpened(session.sim.dbId);
    return NextResponse.json({ ok: true });
  }

  // "converted": the user chose to protect a real position. convertedAt is written once they
  // finish SIWE sign-in (/api/auth/verify); the simulation ends now.
  session.simConvertedFrom = session.sim.dbId;
  await endSimnetSession(session.sim);
  delete session.sim;
  await session.save();
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const session = await getSession();
  if (session.sim) {
    await endSimnetSession(session.sim);
    delete session.sim;
    await session.save();
  }
  return NextResponse.json({ ok: true });
}
