/**
 * Unit test models CLI (offline, fetch mock):
 *  - fetchModelList parse {data:[{id}]} dari {base}/models
 *  - buildRows: gabung harga + endpoint, urut termurah, model tanpa harga di akhir
 *  - formatRows: tampilkan baris + IDR bila native
 *  - runModelsCli --filter
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchModelList, buildRows, formatRows, runModelsCli } from "../../src/cli/models.ts";
import type { ModelPrice, FetchLike } from "../../src/llm/pricing.ts";
import { DEFAULT_TOKEN_PROFILE } from "../../src/llm/estimate.ts";

const USD_TO_IDR = 17891.619611;

function priceMap(): Map<string, ModelPrice> {
  return new Map<string, ModelPrice>([
    ["cheap-flash", { inputPerM: 0.1, outputPerM: 0.2, source: "bynara", reasoning: false }],
    ["mid-flash", { inputPerM: 0.5, outputPerM: 1.5, source: "bynara", reasoning: true, maxContextTokens: 512000, native: { currency: "IDR", inputPerM: 0.5 * USD_TO_IDR, outputPerM: 1.5 * USD_TO_IDR, usdToNative: USD_TO_IDR } }],
    ["expensive", { inputPerM: 3, outputPerM: 15, source: "openrouter" }],
  ]);
}

test("fetchModelList: parse data[].id", async () => {
  const fetchImpl: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ id: "a" }, { id: "b" }, { notid: 1 }] }),
    text: async () => "",
  });
  const ids = await fetchModelList("https://x/v1/chat/completions", "key", fetchImpl);
  assert.deepEqual(ids, ["a", "b"]);
});

test("fetchModelList: non-ok → null (tanpa crash)", async () => {
  const fetchImpl: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "" });
  assert.equal(await fetchModelList("https://x/v1", "", fetchImpl), null);
  assert.equal(await fetchModelList("", "", fetchImpl), null, "base kosong → null");
});

test("buildRows: urut termurah dulu, model tanpa harga di akhir", () => {
  const rows = buildRows(priceMap(), ["cheap-flash", "mid-flash", "no-price-model"], DEFAULT_TOKEN_PROFILE);
  assert.equal(rows[0]!.model, "cheap-flash", "termurah pertama");
  assert.equal(rows[rows.length - 1]!.model, "no-price-model", "tanpa harga terakhir");
  assert.ok(rows[0]!.estimate!.perRunUsd < rows[1]!.estimate!.perRunUsd);
  // model tanpa harga tetap muncul tanpa estimate
  const noprice = rows.find((r) => r.model === "no-price-model")!;
  assert.equal(noprice.estimate, undefined);
});

test("formatRows: tampilkan IDR untuk model native, flag reasoning", () => {
  const rows = buildRows(priceMap(), null, DEFAULT_TOKEN_PROFILE);
  const text = formatRows(rows, DEFAULT_TOKEN_PROFILE);
  assert.match(text, /cheap-flash/);
  assert.match(text, /mid-flash/);
  assert.match(text, /Rp/, "ada baris IDR untuk native");
  assert.match(text, /Profil token\/run: 43100 in \/ 3800 out/);
});

test("runModelsCli: --filter menyaring model", async () => {
  const fetchImpl: FetchLike = async (url: string) => {
    if (url.includes("/models")) {
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "cheap-flash" }, { id: "expensive" }] }), text: async () => "" };
    }
    // pricing URL
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ alias: "cheap-flash", input_credit_per_1k: 0.1, output_credit_per_1k: 0.2 }, { alias: "expensive", input_credit_per_1k: 5, output_credit_per_1k: 10 }], usd_to_idr: USD_TO_IDR }),
      text: async () => "",
    };
  };
  const { output } = await runModelsCli({
    filter: "flash",
    baseURL: "https://router.bynara.id/v1/chat/completions",
    apiKey: "",
    pricingUrl: "https://router.bynara.id/api/pricing",
    fetchImpl,
    profile: DEFAULT_TOKEN_PROFILE,
  });
  assert.match(output, /cheap-flash/);
  assert.doesNotMatch(output, /expensive/, "difilter keluar");
});
