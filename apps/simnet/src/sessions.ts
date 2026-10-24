/**
 * Simulation sessions (spec §3.5): in-memory, keyed by a random id. A session owns a
 * burner address (the key never leaves the browser), a fork, and a faucet ledger.
 */

import { randomUUID } from "node:crypto";
import { getAddress, type Address } from "viem";
import { FORK_SOURCE, LIMITS } from "./config.ts";
import { FaucetLedger, FaucetLimitError, type FaucetAsset } from "./faucet.ts";
import { CapacityError, ExtendError, forkContracts, type ForkManager, type ForkRecord } from "./forks.ts";
import type { CrashPct, Scenario } from "./scenario.ts";

export type SimMode = "live" | "replay" | "stress";

export interface Session {
  id: string;
  address: Address;
  mode: SimMode;
  forkId: string;
  createdAt: number;
  ledger: FaucetLedger;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.error ?? status));
  }
}

export type ScenarioCommand = { kind: "replay"; scenario: string } | { kind: "crash"; pct: CrashPct };

export class SessionService {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly forks: ForkManager,
    private readonly scenarios: ReadonlyMap<string, Scenario>,
    private readonly simChainId: number,
  ) {}

  get size() {
    return this.sessions.size;
  }

  /** Drops sessions whose fork disappeared (TTL, live reset). Wired to ForkManager.onForkGone. */
  forkGone(forkId: string): void {
    for (const [id, s] of this.sessions) if (s.forkId === forkId) this.sessions.delete(id);
  }

  async create(input: { address: string; mode: SimMode; scenario?: string }) {
    const address = getAddress(input.address);
    if (input.scenario !== undefined && input.mode !== "replay") {
      throw new HttpError(400, { error: "scenario is only valid with mode=replay" });
    }
    const scenario = input.scenario !== undefined ? this.requireScenario(input.scenario) : undefined;

    let fork: ForkRecord;
    try {
      fork = input.mode === "live" ? await this.forks.live() : await this.forks.acquirePrivate();
    } catch (e) {
      if (e instanceof CapacityError) throw new HttpError(409, { error: "capacity", retryAfterSec: e.retryAfterSec });
      throw e;
    }

    const session: Session = {
      id: randomUUID(),
      address,
      mode: input.mode,
      forkId: fork.id,
      createdAt: Date.now(),
      ledger: new FaucetLedger(),
    };
    try {
      await this.drip(session, fork, "ETH", LIMITS.initialEth);
      await this.drip(session, fork, "USDC", LIMITS.initialUsdc);
      if (scenario) fork.runtime.price.startReplay(scenario);
    } catch (e) {
      if (fork.kind === "private") await this.forks.release(fork.id);
      throw e;
    }
    this.sessions.set(session.id, session);

    return {
      sessionId: session.id,
      forkId: fork.id,
      rpcPath: `/rpc/${fork.id}`,
      chainId: this.simChainId,
      contracts: forkContracts(fork, FORK_SOURCE),
      expiresAt: toIso(fork.expiresAt),
    };
  }

  async faucet(id: string, asset: FaucetAsset, amount: number) {
    const { session, fork } = this.resolve(id);
    await this.drip(session, fork, asset, amount);
    return { balances: await fork.runtime.faucet.balances(session.address) };
  }

  scenario(id: string, cmd: ScenarioCommand) {
    const { fork } = this.resolve(id);
    if (fork.kind !== "private") {
      throw new HttpError(409, { error: "the shared live fork cannot run scenarios; start a replay or stress session" });
    }
    try {
      if (cmd.kind === "replay") fork.runtime.price.startReplay(this.requireScenario(cmd.scenario));
      else fork.runtime.price.startCrash(cmd.pct);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(409, { error: e instanceof Error ? e.message : "scenario failed" });
    }
    return { ok: true as const };
  }

  status(id: string) {
    const { session, fork } = this.resolve(id);
    const snap = fork.runtime.price.snapshot();
    const events = fork.runtime.events
      .filter((e) => e.user === session.address)
      .map(({ user: _user, ...rest }) => rest);
    return {
      mode: session.mode,
      price: snap.price,
      priceSource: snap.priceSource,
      ...(snap.scenarioProgress !== undefined ? { scenarioProgress: snap.scenarioProgress } : {}),
      expiresAt: toIso(fork.expiresAt),
      events,
    };
  }

  extend(id: string) {
    const { fork } = this.resolve(id);
    try {
      return { expiresAt: toIso(this.forks.extend(fork.id)) };
    } catch (e) {
      if (e instanceof ExtendError) throw new HttpError(409, { error: e.message });
      throw e;
    }
  }

  async delete(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new HttpError(404, { error: "session not found" });
    this.sessions.delete(id);
    const fork = this.forks.get(session.forkId);
    if (fork?.kind === "private") await this.forks.release(fork.id);
    return { ok: true as const };
  }

  private resolve(id: string) {
    const session = this.sessions.get(id);
    const fork = session && this.forks.get(session.forkId);
    if (!session || !fork) {
      if (session) this.sessions.delete(id);
      throw new HttpError(404, { error: "session not found" });
    }
    return { session, fork };
  }

  private requireScenario(id: string): Scenario {
    const s = this.scenarios.get(id);
    if (!s) throw new HttpError(400, { error: `unknown scenario ${id}`, available: [...this.scenarios.keys()] });
    return s;
  }

  private async drip(session: Session, fork: ForkRecord, asset: FaucetAsset, amount: number) {
    try {
      session.ledger.reserve(asset, amount);
    } catch (e) {
      if (e instanceof FaucetLimitError) {
        throw new HttpError(429, { error: "faucet_limit", asset, remaining: e.remaining });
      }
      throw new HttpError(400, { error: e instanceof Error ? e.message : "invalid amount" });
    }
    try {
      await fork.runtime.faucet.fund(session.address, asset, amount);
    } catch (e) {
      session.ledger.release(asset, amount);
      throw e;
    }
  }
}

function toIso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}
