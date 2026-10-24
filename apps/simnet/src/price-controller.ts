/**
 * Per-fork price state: follows mainnet until a replay or crash takes over, then
 * stays on that source (a crashed fork never snaps back to live price).
 */

import { LIMITS } from "./config.ts";
import { crashPriceAt, replayPriceAt, type CrashPct, type Scenario } from "./scenario.ts";

export type PriceSource = "mainnet" | "replay" | "stress";

type Active =
  | { kind: "replay"; scenario: Scenario; startedAt: number; startPrice: number; compression: number }
  | { kind: "crash"; pct: CrashPct; startedAt: number; startPrice: number; rampMs: number };

export interface PriceSnapshot {
  price: number | null;
  priceSource: PriceSource;
  scenarioProgress?: number;
  scenarioId?: string;
}

export class PriceController {
  private source: PriceSource = "mainnet";
  private price: number | null = null;
  private progress: number | undefined;
  private active: Active | undefined;
  private writing: Promise<void> | null = null;
  private pending: number | null = null;

  constructor(
    private readonly write: (price: number) => Promise<void>,
    private readonly clock: () => number = Date.now,
    private readonly onError: (e: unknown) => void = () => {},
  ) {}

  snapshot(): PriceSnapshot {
    const s: PriceSnapshot = { price: this.price, priceSource: this.source };
    if (this.progress !== undefined) s.scenarioProgress = this.progress;
    if (this.active?.kind === "replay") s.scenarioId = this.active.scenario.id;
    return s;
  }

  get followsMainnet(): boolean {
    return this.source === "mainnet";
  }

  /** Called by the relay. Ignored once a replay/crash has taken over. */
  onMainnetPrice(price: number): Promise<void> {
    if (!this.followsMainnet) return Promise.resolve();
    return this.set(price);
  }

  startReplay(scenario: Scenario, compression: number = LIMITS.replayCompression): void {
    const startPrice = this.requirePrice();
    this.active = { kind: "replay", scenario, startedAt: this.clock(), startPrice, compression };
    this.source = "replay";
    this.progress = 0;
  }

  startCrash(pct: CrashPct, rampMs: number = LIMITS.crashRampMs): void {
    const startPrice = this.requirePrice();
    this.active = { kind: "crash", pct, startedAt: this.clock(), startPrice, rampMs };
    this.source = "stress";
    this.progress = 0;
  }

  /** Advances the active replay/crash; call every scenario tick. */
  tick(): Promise<void> {
    const a = this.active;
    if (!a) return Promise.resolve();
    const elapsed = this.clock() - a.startedAt;
    const sample =
      a.kind === "replay"
        ? replayPriceAt(a.scenario, elapsed, { compression: a.compression, startPrice: a.startPrice })
        : crashPriceAt(a.startPrice, a.pct, elapsed, a.rampMs);
    this.progress = sample.progress;
    if (sample.done) this.active = undefined;
    return this.set(sample.price);
  }

  private requirePrice(): number {
    if (this.price === null) throw new Error("fork has no price yet");
    return this.price;
  }

  /** Latest-wins: at most one setAnswer in flight, the newest pending price follows. */
  private set(price: number): Promise<void> {
    this.price = price;
    this.pending = price;
    if (!this.writing) {
      this.writing = (async () => {
        while (this.pending !== null) {
          const p = this.pending;
          this.pending = null;
          try {
            await this.write(p);
          } catch (e) {
            this.onError(e);
          }
        }
        this.writing = null;
      })();
    }
    return this.writing;
  }
}
