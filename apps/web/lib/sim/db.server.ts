/**
 * Funnel writes to `sim_sessions` (spec m1-simulation-mode §3.9). Best effort: when the DB is not
 * configured or the table does not exist yet, the write is skipped and the simulation still runs.
 * No raw IP is stored; the user agent is hashed.
 *
 * TODO: switch to the typed `simSessions` table from @tahansoe/db once the schema lands there.
 */

import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db, isDbConfigured } from "@tahansoe/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DB row id for a simnet session: its own id when it is a UUID, otherwise a fresh one. */
export function simDbId(sessionId: string): string {
  return UUID_RE.test(sessionId) ? sessionId : crypto.randomUUID();
}

async function run(query: ReturnType<typeof sql>): Promise<void> {
  if (!isDbConfigured()) return;
  try {
    await db.execute(query);
  } catch (err) {
    // 42P01 = undefined_table: the migration has not run yet.
    const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code !== "42P01") console.warn("[sim_sessions] write skipped:", err instanceof Error ? err.message : err);
  }
}

export function recordSimSessionStart(row: {
  id: string;
  address: string;
  mode: string;
  scenario: string | null;
  forkId: string;
  userAgent: string | null;
}) {
  const uaHash = row.userAgent ? crypto.createHash("sha256").update(row.userAgent).digest("hex").slice(0, 32) : null;
  return run(sql`
    insert into sim_sessions (id, address, mode, scenario, fork_id, created_at, user_agent_hash)
    values (${row.id}, ${row.address.toLowerCase()}, ${row.mode}, ${row.scenario}, ${row.forkId}, now(), ${uaHash})
    on conflict (id) do nothing
  `);
}

export function recordPositionOpened(id: string) {
  return run(sql`update sim_sessions set position_opened_at = coalesce(position_opened_at, now()) where id = ${id}`);
}

export function recordProtection(id: string, layers: number[]) {
  const list = `{${[...new Set(layers)].sort().join(",")}}`;
  return run(sql`
    update sim_sessions
    set first_protect_at = coalesce(first_protect_at, now()), layers_used = ${list}::integer[]
    where id = ${id}
  `);
}

export function recordConverted(id: string) {
  return run(sql`update sim_sessions set converted_at = coalesce(converted_at, now()) where id = ${id}`);
}
