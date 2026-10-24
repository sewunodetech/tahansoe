/**
 * POST /api/sim/faucet { asset: "ETH" | "WETH" | "USDC", amount }
 *
 * Tops up the burner wallet on the session's fork, within the per-session limits
 * (spec m1-simulation-mode §3.5). Fake funds only.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { simnetFetch } from "@/lib/sim/simnet.server";
import { mockFaucet } from "@/lib/sim/mock";
import { clientIp, rateLimit } from "@/lib/sim/rate-limit";
import { FAUCET_LIMITS, faucetSchema } from "@/lib/sim/types";

export async function POST(req: NextRequest) {
  if (!rateLimit(`sim-faucet:${clientIp(req.headers)}`, 20)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await getSession();
  const sim = session.sim;
  if (!sim) return NextResponse.json({ error: "No simulation session" }, { status: 401 });

  const parsed = faucetSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { asset, amount } = parsed.data;

  const used = sim.faucet?.[asset] ?? 0;
  if (used + amount > FAUCET_LIMITS[asset]) {
    return NextResponse.json(
      { error: `Top-up limit reached: at most ${FAUCET_LIMITS[asset].toLocaleString("en-US")} ${asset} per session` },
      { status: 400 }
    );
  }

  let balances: Record<string, string>;
  if (sim.mock) {
    balances = mockFaucet(asset, amount).balances;
  } else {
    const { status, body } = await simnetFetch<{ balances?: Record<string, string>; error?: string }>(
      `/v1/sessions/${encodeURIComponent(sim.sessionId)}/faucet`,
      { method: "POST", body: { asset, amount } }
    );
    if (status < 200 || status >= 300) {
      return NextResponse.json({ error: body?.error ?? "Top-up failed" }, { status: status === 503 ? 503 : 502 });
    }
    balances = body.balances ?? {};
  }

  session.sim = { ...sim, faucet: { ...sim.faucet, [asset]: used + amount } };
  await session.save();
  return NextResponse.json({ balances, used: session.sim.faucet, limits: FAUCET_LIMITS });
}
