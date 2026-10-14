/**
 * Ketahanan pipeline research (audit 14 Okt 2026): exception analyst tidak hilang
 * diam-diam, deadline run membatalkan run, dan shutdown membatalkan run.
 * Offline: FakeProvider + fixture collector, fetch diblokir.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runResearch, type ProgressEvent } from "../../src/agents/run.ts";
import { Budget } from "../../src/llm/budget.ts";
import type { LlmProvider, LlmRequest, LlmResult } from "../../src/llm/provider.ts";
import { FakeProvider } from "../fake-provider.ts";
import { fakeScript, fixtureCollector } from "../fixtures/research-fixtures.ts";

const originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async () => {
    throw new Error("NETWORK ACCESS FORBIDDEN in unit test");
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = originalFetch;
});

/** Provider yang melempar untuk analyst domain tertentu, sisanya delegasi ke FakeProvider. */
class ThrowingAnalystProvider implements LlmProvider {
  private readonly inner = new FakeProvider(fakeScript());
  constructor(private readonly throwOnCall: number) {}
  private n = 0;
  async structured<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const i = this.n++;
    if (i === this.throwOnCall) throw new Error("boom: payload rusak");
    return this.inner.structured(req);
  }
}

test("exception di satu analyst → tercatat sebagai kegagalan dengan alasan + event progres", async () => {
  const dir = await mkdtemp(join(tmpdir(), "engine-robust-"));
  const events: ProgressEvent[] = [];
  try {
    const result = await runResearch({
      trigger: "SCHEDULED",
      chainId: 42161,
      assets: ["ETH", "USDC"],
      provider: new ThrowingAnalystProvider(1),
      collector: fixtureCollector,
      budget: new Budget(1000),
      dry: true,
      outDir: dir,
      onProgress: (e) => events.push(e),
    });
    const done = events.filter((e) => e.type === "analyst_done");
    assert.equal(done.length, 4, "keempat analyst harus melapor selesai, termasuk yang melempar");
    const failedRole = result.diagnostics?.roles.find((r) => r.role.startsWith("analyst:") && !r.ok);
    assert.ok(failedRole, "analyst yang melempar harus muncul sebagai gagal di diagnostik");
    assert.match(failedRole!.reason ?? "", /exception: boom/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Provider yang menggantung sampai signal request di-abort. */
const hangingProvider: LlmProvider = {
  structured<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    return new Promise((resolve) => {
      const done = () =>
        resolve({
          stopReason: "error",
          data: null,
          usage: { model: "m", inputTokens: 0, outputTokens: 0 },
          error: "aborted",
          aborted: true,
        });
      if (req.signal?.aborted) return done();
      req.signal?.addEventListener("abort", done, { once: true });
      // Penjaga agar event loop tetap hidup selama menunggu (seperti socket nyata).
      const keepAlive = setTimeout(() => {}, 10_000);
      req.signal?.addEventListener("abort", () => clearTimeout(keepAlive), { once: true });
    });
  },
};

test("deadline run → run berhenti tanpa report dengan alasan batas waktu", async () => {
  const started = Date.now();
  const result = await runResearch({
    trigger: "SCHEDULED",
    chainId: 42161,
    assets: ["ETH"],
    provider: hangingProvider,
    collector: fixtureCollector,
    budget: new Budget(1000),
    dry: true,
    timeoutMs: 100,
  });
  assert.equal(result.report, null);
  assert.match(result.reason ?? "", /batas waktu/);
  assert.ok(Date.now() - started < 5000, "run tidak boleh menggantung");
});

test("signal shutdown → run berhenti dengan alasan shutdown", async () => {
  const ac = new AbortController();
  const p = runResearch({
    trigger: "SCHEDULED",
    chainId: 42161,
    assets: ["ETH"],
    provider: hangingProvider,
    collector: fixtureCollector,
    budget: new Budget(1000),
    dry: true,
    signal: ac.signal,
  });
  setTimeout(() => ac.abort(), 50);
  const result = await p;
  assert.equal(result.report, null);
  assert.match(result.reason ?? "", /shutdown/);
});
