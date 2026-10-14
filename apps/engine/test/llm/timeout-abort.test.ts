/**
 * Timeout, pembatalan, dan ketahanan respons gateway (ADR 0011, audit 14 Okt 2026).
 * Offline: fetch di-mock; tidak ada jaringan.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  OpenAICompatibleProvider,
  parseRetryAfter,
  type FetchLike,
} from "../../src/llm/openai-compatible.ts";
import { RoleRouter } from "../../src/llm/registry.ts";
import { Budget, type BudgetStore } from "../../src/llm/budget.ts";
import type { LlmProvider, LlmRequest, LlmResult } from "../../src/llm/provider.ts";
import { withSignal } from "../../src/llm/provider.ts";

const Schema = z.object({ answer: z.number() });

function req(signal?: AbortSignal): LlmRequest<z.infer<typeof Schema>> {
  return {
    model: "",
    effort: "low",
    system: "system",
    messages: [{ role: "user", content: "data" }],
    output: Schema,
    outputName: "Answer",
    signal,
  };
}

/** Fetch yang tidak pernah menjawab, kecuali signal di-abort (meniru gateway hang). */
const hangingFetch: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  });

function provider(fetchImpl: FetchLike, timeoutMs = 50) {
  return new OpenAICompatibleProvider(
    { name: "gateway", baseURL: "https://example/v1", apiKey: "k", model: "m", timeoutMs },
    new Budget(100),
    fetchImpl,
  );
}

test("gateway hang → error timeout (tidak menggantung)", async () => {
  const started = Date.now();
  const res = await provider(hangingFetch, 50).structured(req());
  assert.equal(res.stopReason, "error");
  assert.match(res.error ?? "", /timeout/);
  assert.notEqual(res.aborted, true, "timeout bukan pembatalan pemanggil");
  assert.ok(Date.now() - started < 2000);
});

test("pembatalan pemanggil → aborted:true", async () => {
  const ac = new AbortController();
  const p = provider(hangingFetch, 10_000).structured(req(ac.signal));
  ac.abort();
  const res = await p;
  assert.equal(res.stopReason, "error");
  assert.equal(res.aborted, true);
});

test("status 200 dengan body bukan JSON → error, tidak melempar", async () => {
  const fetchImpl: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
    text: async () => "<html>proxy error</html>",
  });
  const res = await provider(fetchImpl).structured(req());
  assert.equal(res.stopReason, "error");
  assert.match(res.error ?? "", /bukan JSON/);
});

test("HTTP 429 membawa retryAfterMs dari header", async () => {
  const fetchImpl: FetchLike = async () => ({
    ok: false,
    status: 429,
    json: async () => ({}),
    text: async () => "rate limited",
    headers: { get: (n: string) => (n === "retry-after" ? "3" : null) },
  });
  const res = await provider(fetchImpl).structured(req());
  assert.equal(res.status, 429);
  assert.equal(res.retryAfterMs, 3000);
});

test("parseRetryAfter: detik, HTTP-date, dan nilai tidak valid", () => {
  const now = Date.parse("2026-10-14T10:00:00Z");
  assert.equal(parseRetryAfter("2", now), 2000);
  assert.equal(parseRetryAfter("Wed, 14 Oct 2026 10:00:05 GMT", now), 5000);
  assert.equal(parseRetryAfter("abc", now), undefined);
  assert.equal(parseRetryAfter(null, now), undefined);
});

/** Provider palsu yang menghitung panggilan dan mengembalikan hasil tetap. */
class CountingProvider implements LlmProvider {
  calls = 0;
  constructor(private readonly result: Partial<LlmResult<unknown>>) {}
  async structured<T>(): Promise<LlmResult<T>> {
    this.calls++;
    return {
      stopReason: "error",
      data: null,
      usage: { model: "m", inputTokens: 0, outputTokens: 0 },
      ...this.result,
    } as LlmResult<T>;
  }
}

test("router: hasil aborted → berhenti tanpa retry/fallback", async () => {
  const p1 = new CountingProvider({ aborted: true, error: "aborted" });
  const p2 = new CountingProvider({});
  const router = new RoleRouter([{ model: "a" }, { model: "b" }], new Budget(100), undefined, [p1, p2], 0);
  const res = await router.structured(req());
  assert.equal(res.aborted, true);
  assert.equal(p1.calls, 1);
  assert.equal(p2.calls, 0);
});

test("router: signal sudah abort → tidak memanggil provider", async () => {
  const p1 = new CountingProvider({});
  const router = new RoleRouter([{ model: "a" }], new Budget(100), undefined, [p1], 0);
  const ac = new AbortController();
  ac.abort();
  const res = await router.structured(req(ac.signal));
  assert.equal(res.aborted, true);
  assert.equal(p1.calls, 0);
});

test("router: budget habis → tidak memanggil provider", async () => {
  const p1 = new CountingProvider({});
  const budget = new Budget(0); // limit 0 → langsung exceeded
  const router = new RoleRouter([{ model: "a" }], budget, undefined, [p1], 0);
  const res = await router.structured(req());
  assert.match(res.error ?? "", /budget harian habis/);
  assert.equal(p1.calls, 0);
});

test("withSignal: menyisipkan signal ke setiap request", async () => {
  let seen: AbortSignal | undefined;
  const inner: LlmProvider = {
    async structured<T>(r: LlmRequest<T>): Promise<LlmResult<T>> {
      seen = r.signal;
      return { stopReason: "ok", data: null, usage: { model: "m", inputTokens: 0, outputTokens: 0 } };
    },
  };
  const ac = new AbortController();
  await withSignal(inner, ac.signal).structured(req());
  assert.ok(seen);
  ac.abort();
  assert.equal(seen!.aborted, true);
});

test("Budget + store bersama: sync mengambil total DB, record menambah ke store", async () => {
  const totals = new Map<string, number>();
  const store: BudgetStore = {
    async add(day, usd) {
      const v = (totals.get(day) ?? 0) + usd;
      totals.set(day, v);
      return v;
    },
    async get(day) {
      return totals.get(day) ?? 0;
    },
  };
  const now = new Date("2026-10-14T12:00:00Z");
  totals.set("2026-10-14", 4.5); // dipakai proses lain hari ini
  const b = new Budget(5, store);
  await b.sync(now);
  assert.equal(b.spentToday(now), 4.5);
  assert.equal(b.exceeded(now), false);

  b.record({ model: "claude-opus-5-5", inputTokens: 1_000_000, outputTokens: 0 }, now); // $4
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(totals.get("2026-10-14"), 8.5);
  assert.equal(b.exceeded(now), true);
});

test("Budget: store gagal → tetap jalan dengan hitungan lokal", async () => {
  const store: BudgetStore = {
    add: async () => {
      throw new Error("db down");
    },
    get: async () => {
      throw new Error("db down");
    },
  };
  const now = new Date("2026-10-14T12:00:00Z");
  const b = new Budget(5, store);
  const warn = console.warn;
  console.warn = () => {};
  try {
    await b.sync(now);
    b.record({ model: "claude-opus-5-5", inputTokens: 500_000, outputTokens: 0 }, now); // $2
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    console.warn = warn;
  }
  assert.equal(b.spentToday(now), 2);
});
