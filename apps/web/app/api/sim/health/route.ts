/**
 * GET /api/sim/health
 *
 * Tells /connect whether Simulation Mode can be offered. Any failure reads as "down" so the page
 * falls back to Demo mode (spec m1-simulation-mode §4, I6).
 */

import { NextResponse } from "next/server";
import { isSimnetConfigured, isSimnetMock, simnetFetch } from "@/lib/sim/simnet.server";
import { mockHealth } from "@/lib/sim/mock";
import type { SimHealth } from "@/lib/sim/types";

export async function GET() {
  if (isSimnetMock()) return NextResponse.json(mockHealth());
  if (!isSimnetConfigured()) return NextResponse.json({ ok: false } satisfies SimHealth);

  const { status, body } = await simnetFetch<SimHealth>("/v1/health", { timeoutMs: 4_000 });
  if (status !== 200 || !body?.ok) return NextResponse.json({ ok: false } satisfies SimHealth);
  return NextResponse.json({ ok: true, forks: body.forks } satisfies SimHealth);
}
