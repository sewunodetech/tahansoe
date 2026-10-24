/**
 * Fork manager (spec §3.4): one shared live fork, reset daily at 04:00 WIB, plus up
 * to SIM_MAX_PRIVATE_FORKS private forks with a TTL that can be extended once.
 *
 * The manager only does bookkeeping; `ForkFactory` (runtime.ts) starts anvil, deploys,
 * and wires price/keeper. Tests inject a fake factory and clock.
 */

import { randomBytes } from "node:crypto";
import type { Address } from "viem";
import type { SimDeployment } from "./deploy.ts";
import type { Faucet } from "./faucet.ts";
import type { SimEvent } from "./keeper.ts";
import type { PriceController } from "./price-controller.ts";

export interface ForkRuntime {
  url: string;
  deployment: SimDeployment;
  faucet: Faucet;
  price: PriceController;
  /** Guardian events seen by the sim keeper on this fork. */
  events: SimEvent[];
  stop(): Promise<void>;
}

export type ForkFactory = (forkId: string) => Promise<ForkRuntime>;

export interface ForkRecord {
  id: string;
  kind: "live" | "private";
  runtime: ForkRuntime;
  createdAt: number;
  expiresAt: number | null;
  extended: boolean;
}

export class CapacityError extends Error {
  constructor(readonly retryAfterSec: number) {
    super("private fork capacity reached");
  }
}

export class ExtendError extends Error {}

export interface ForkManagerOptions {
  maxPrivate: number;
  ttlMs: number;
  clock?: () => number;
  /** Called after a fork is gone (TTL, release, live reset). */
  onForkGone?: (forkId: string) => void;
  onError?: (e: unknown) => void;
}

/** ms until the next `hourUtc`:00 UTC strictly after `now`. 04:00 WIB = 21:00 UTC. */
export function msUntilNextDailyReset(now: number, hourUtc: number): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUtc, 0, 0, 0);
  return next > now ? next - now : next + 24 * 60 * 60 * 1000 - now;
}

export class ForkManager {
  private liveFork: ForkRecord | undefined;
  private livePending: Promise<ForkRecord> | undefined;
  private liveGeneration = 0;
  private readonly privates = new Map<string, ForkRecord>();
  /** Private slots reserved while a fork is still starting. */
  private starting = 0;
  private readonly clock: () => number;

  constructor(
    private readonly factory: ForkFactory,
    private readonly opts: ForkManagerOptions,
  ) {
    this.clock = opts.clock ?? Date.now;
  }

  get(forkId: string): ForkRecord | undefined {
    if (this.liveFork?.id === forkId) return this.liveFork;
    return this.privates.get(forkId);
  }

  currentLive(): ForkRecord | undefined {
    return this.liveFork;
  }

  privateRecords(): ForkRecord[] {
    return [...this.privates.values()];
  }

  counts() {
    return { live: this.liveFork !== undefined, private: this.privates.size + this.starting, max: this.opts.maxPrivate };
  }

  /** Returns the live fork, starting it if needed (concurrent callers share one start). */
  async live(): Promise<ForkRecord> {
    if (this.liveFork) return this.liveFork;
    this.livePending ??= (async () => {
      const id = `live-${++this.liveGeneration}`;
      try {
        const runtime = await this.factory(id);
        const rec: ForkRecord = { id, kind: "live", runtime, createdAt: this.clock(), expiresAt: null, extended: false };
        this.liveFork = rec;
        return rec;
      } finally {
        this.livePending = undefined;
      }
    })();
    return this.livePending;
  }

  /** Drops the live fork and starts a fresh one at the latest mainnet block. */
  async resetLive(): Promise<ForkRecord> {
    const old = this.liveFork;
    this.liveFork = undefined;
    if (old) await this.dispose(old);
    return this.live();
  }

  async acquirePrivate(): Promise<ForkRecord> {
    if (this.privates.size + this.starting >= this.opts.maxPrivate) {
      throw new CapacityError(this.retryAfterSec());
    }
    this.starting++;
    const id = `p-${randomBytes(6).toString("hex")}`;
    try {
      const runtime = await this.factory(id);
      const now = this.clock();
      const rec: ForkRecord = { id, kind: "private", runtime, createdAt: now, expiresAt: now + this.opts.ttlMs, extended: false };
      this.privates.set(id, rec);
      return rec;
    } finally {
      this.starting--;
    }
  }

  /** Extends a private fork's TTL by one more period, once. Returns the new expiry. */
  extend(forkId: string): number {
    const rec = this.privates.get(forkId);
    if (!rec || rec.expiresAt === null) throw new ExtendError("only private forks can be extended");
    if (rec.extended) throw new ExtendError("fork already extended once");
    rec.extended = true;
    rec.expiresAt += this.opts.ttlMs;
    return rec.expiresAt;
  }

  async release(forkId: string): Promise<void> {
    const rec = this.privates.get(forkId);
    if (!rec) return;
    this.privates.delete(forkId);
    await this.dispose(rec);
  }

  /** Kills private forks past their TTL. Run on an interval. */
  async sweep(): Promise<string[]> {
    const now = this.clock();
    const expired = [...this.privates.values()].filter((r) => r.expiresAt !== null && r.expiresAt <= now);
    for (const rec of expired) {
      this.privates.delete(rec.id);
      await this.dispose(rec);
    }
    return expired.map((r) => r.id);
  }

  async stopAll(): Promise<void> {
    const all = [...this.privates.values()];
    this.privates.clear();
    if (this.liveFork) all.push(this.liveFork);
    this.liveFork = undefined;
    await Promise.all(all.map((r) => this.dispose(r)));
  }

  private retryAfterSec(): number {
    const now = this.clock();
    const soonest = Math.min(...[...this.privates.values()].map((r) => r.expiresAt ?? Infinity));
    if (!Number.isFinite(soonest)) return 30;
    return Math.max(1, Math.ceil((soonest - now) / 1000));
  }

  private async dispose(rec: ForkRecord): Promise<void> {
    try {
      await rec.runtime.stop();
    } catch (e) {
      this.opts.onError?.(e);
    }
    this.opts.onForkGone?.(rec.id);
  }
}

/** Contract addresses returned to the web for a fork. */
export function forkContracts(rec: ForkRecord, registry: { pool: Address; weth: Address; usdc: Address }) {
  const d = rec.runtime.deployment;
  return {
    guardian: d.guardian,
    simPriceFeed: d.simPriceFeed,
    ...(d.testVault ? { testVault: d.testVault } : {}),
    pool: registry.pool,
    weth: registry.weth,
    usdc: registry.usdc,
  };
}
