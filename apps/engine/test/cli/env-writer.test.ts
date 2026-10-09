/**
 * Unit test penulis .env minimal `applyEnvUpdates` (util teks murni; MASIH ada
 * untuk kompatibilitas, tapi research CLI kini menulis ke settings.json —
 * lihat test/cli/settings-writer.test.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEnvUpdates } from "../../src/cli/env-writer.ts";

test("applyEnvUpdates: ganti kunci yang ada, pertahankan baris lain", () => {
  const input = [
    "# komentar",
    "DATABASE_URL=postgres://keep-me",
    "LLM_ANALYST=old",
    "",
    "LLM_ASSESSOR=old-assessor # trailing",
    "RESEARCH_ENABLED=false",
  ].join("\n");
  const out = applyEnvUpdates(input, { LLM_ANALYST: "custom:a", LLM_ASSESSOR: "custom:b" });
  assert.match(out, /# komentar/);
  assert.match(out, /DATABASE_URL=postgres:\/\/keep-me/);
  assert.match(out, /^LLM_ANALYST=custom:a$/m);
  assert.match(out, /^LLM_ASSESSOR=custom:b$/m);
  assert.match(out, /RESEARCH_ENABLED=false/);
  assert.equal(out.split("\n").filter((l) => l.startsWith("DATABASE_URL")).length, 1);
});

test("applyEnvUpdates: tambah kunci baru di akhir", () => {
  const input = "FOO=1\n";
  const out = applyEnvUpdates(input, { LLM_DEBATE: "custom:d" });
  assert.match(out, /^FOO=1$/m);
  assert.match(out, /^LLM_DEBATE=custom:d$/m);
});

test("applyEnvUpdates: file kosong → hanya kunci baru", () => {
  const out = applyEnvUpdates("", { LLM_REFLECTOR: "custom:r" });
  assert.equal(out.trim(), "LLM_REFLECTOR=custom:r");
});

test("applyEnvUpdates: tidak mengubah baris komentar yang menyerupai kunci", () => {
  const input = "# LLM_ANALYST=jangan-diubah\nLLM_ANALYST=real\n";
  const out = applyEnvUpdates(input, { LLM_ANALYST: "new" });
  assert.match(out, /# LLM_ANALYST=jangan-diubah/);
  assert.match(out, /^LLM_ANALYST=new$/m);
});
