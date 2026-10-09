/**
 * Unit test penulis .env (offline, in-memory + file sementara):
 *  - update kunci yang ada tanpa menyentuh komentar/kunci lain/urutan
 *  - tambah kunci baru di akhir
 *  - penulisan ke file sementara benar-benar hanya mengubah baris target
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEnvUpdates } from "../../src/cli/env-writer.ts";
import { writeRoleModelsToEnv } from "../../src/cli/research.ts";

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
  // kunci lain tidak hilang
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

test("writeRoleModelsToEnv: file sementara, baris lain tidak berubah", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tahansoe-env-"));
  const envPath = join(dir, ".env");
  try {
    await writeFile(
      envPath,
      ["DATABASE_URL=postgres://secret-keep", "# catatan", "LLM_ANALYST=lama", "FRED_API_KEY=xyz"].join("\n") + "\n",
      "utf8",
    );
    await writeRoleModelsToEnv(envPath, {
      analyst: "bynara:deepseek-v4.1-flash",
      debate: "bynara:deepseek-v4.1-flash",
      assessor: "bynara:gpt-strong",
      reflector: "bynara:deepseek-v4.1-flash",
    });
    const after = await readFile(envPath, "utf8");
    assert.match(after, /DATABASE_URL=postgres:\/\/secret-keep/, "baris lain dipertahankan");
    assert.match(after, /# catatan/);
    assert.match(after, /FRED_API_KEY=xyz/);
    assert.match(after, /^LLM_ANALYST=bynara:deepseek-v4\.1-flash$/m);
    assert.match(after, /^LLM_DEBATE=bynara:deepseek-v4\.1-flash$/m);
    assert.match(after, /^LLM_ASSESSOR=bynara:gpt-strong$/m);
    assert.match(after, /^LLM_REFLECTOR=bynara:deepseek-v4\.1-flash$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
