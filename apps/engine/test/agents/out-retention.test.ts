/**
 * Unit test untuk helper retensi output run (apps/engine/src/agents/out-retention.ts).
 *
 * Menguji:
 * - Mempertahankan N folder terbaru dan menghapus folder lama secara rekursif
 * - Mengabaikan file dan folder non-matching (seperti "eval" atau file teks)
 * - Direktori root yang tidak ada mengembalikan { removed: [] } tanpa melempar error
 * - Nilai keep <= 0 di-clamp ke minimal 1
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, access, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pruneOutDirs, OUT_DIR_PATTERN } from "../../src/agents/out-retention.ts";

test("pola OUT_DIR_PATTERN memvalidasi format ISO stamp dengan benar", () => {
  // Format dari defaultOutDir: new Date().toISOString().replace(/[:.]/g, "-")
  assert.equal(OUT_DIR_PATTERN.test("2026-10-14T10-42-01-123Z"), true);
  assert.equal(OUT_DIR_PATTERN.test("2026-01-01T00-00-00-000Z"), true);

  // Format tidak valid / non-matching
  assert.equal(OUT_DIR_PATTERN.test("eval"), false);
  assert.equal(OUT_DIR_PATTERN.test("2026-10-14"), false);
  assert.equal(OUT_DIR_PATTERN.test("2026-10-14T10:42:01.123Z"), false); // masih ada titik/titik dua
  assert.equal(OUT_DIR_PATTERN.test("2026-10-14T10-42-01Z"), false); // tanpa milidetik
  assert.equal(OUT_DIR_PATTERN.test("random-folder"), false);
});

test("keeps newest N: mempertahankan N folder terbaru dan menghapus sisanya secara rekursif", async () => {
  const root = await mkdtemp(join(tmpdir(), "retention-keep-"));
  try {
    const stamps = [
      "2026-01-01T00-00-00-001Z",
      "2026-01-01T00-00-00-002Z",
      "2026-01-01T00-00-00-003Z",
      "2026-01-01T00-00-00-004Z",
    ];

    // Buat folder beserta file di dalamnya untuk menguji penghapusan rekursif
    for (const s of stamps) {
      const folderPath = join(root, s);
      await mkdir(folderPath, { recursive: true });
      await writeFile(join(folderPath, "report.json"), JSON.stringify({ ok: true }));
      await writeFile(join(folderPath, "report.md"), "# Report");
    }

    // Pertahankan 2 folder terbaru (003Z dan 004Z), hapus 001Z dan 002Z
    const result = await pruneOutDirs(root, { keep: 2 });

    assert.deepEqual(result.removed, [
      "2026-01-01T00-00-00-001Z",
      "2026-01-01T00-00-00-002Z",
    ]);

    // Folder lama harus sudah terhapus
    await assert.rejects(async () => access(join(root, "2026-01-01T00-00-00-001Z")));
    await assert.rejects(async () => access(join(root, "2026-01-01T00-00-00-002Z")));

    // Folder terbaru harus tetap ada
    await access(join(root, "2026-01-01T00-00-00-003Z", "report.json"));
    await access(join(root, "2026-01-01T00-00-00-004Z", "report.json"));

    // Jika jumlah folder <= keep, tidak ada yang dihapus
    const secondRun = await pruneOutDirs(root, { keep: 2 });
    assert.deepEqual(secondRun.removed, []);

    const remaining = await readdir(root);
    assert.equal(remaining.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ignores non-matching dirs and files: tidak pernah menghapus file atau folder non-matching", async () => {
  const root = await mkdtemp(join(tmpdir(), "retention-ignore-"));
  try {
    // Subfolder valid
    await mkdir(join(root, "2026-01-01T00-00-00-001Z"), { recursive: true });
    await mkdir(join(root, "2026-01-01T00-00-00-002Z"), { recursive: true });

    // Subfolder non-matching yang tidak boleh disentuh (mis. folder out/eval)
    await mkdir(join(root, "eval"), { recursive: true });
    await writeFile(join(root, "eval", "summary.md"), "# Eval Summary");
    await mkdir(join(root, "2026-01-01"), { recursive: true });
    await mkdir(join(root, "not-a-stamp"), { recursive: true });

    // File biasa di rootDir
    await writeFile(join(root, "info.txt"), "catatan");

    // File biasa yang namanya kebetulan menyerupai format ISO stamp
    await writeFile(join(root, "2026-01-01T00-00-00-000Z"), "file bukan direktori");

    // Pangkas dengan keep: 1 (harus menghapus 001Z saja)
    const result = await pruneOutDirs(root, { keep: 1 });

    assert.deepEqual(result.removed, ["2026-01-01T00-00-00-001Z"]);

    // Folder matching yang lama terhapus
    await assert.rejects(async () => access(join(root, "2026-01-01T00-00-00-001Z")));

    // Folder matching yang terbaru tetap ada
    await access(join(root, "2026-01-01T00-00-00-002Z"));

    // Semua entri non-matching harus tetap utuh
    await access(join(root, "eval", "summary.md"));
    await access(join(root, "2026-01-01"));
    await access(join(root, "not-a-stamp"));
    await access(join(root, "info.txt"));
    await access(join(root, "2026-01-01T00-00-00-000Z"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing root returns empty: rootDir tidak ada mengembalikan { removed: [] } tanpa melempar", async () => {
  const nonExistent = join(tmpdir(), `non-existent-${Date.now()}`);
  const result = await pruneOutDirs(nonExistent, { keep: 5 });
  assert.deepEqual(result, { removed: [] });
});

test("keep clamp: keep <= 0 di-clamp ke minimal 1", async () => {
  const root = await mkdtemp(join(tmpdir(), "retention-clamp-"));
  try {
    const stamps = [
      "2026-01-01T00-00-00-001Z",
      "2026-01-01T00-00-00-002Z",
      "2026-01-01T00-00-00-003Z",
    ];

    for (const s of stamps) {
      await mkdir(join(root, s), { recursive: true });
    }

    // keep: 0 di-clamp ke 1 -> mempertahankan 1 terbaru (003Z), menghapus 001Z & 002Z
    const resultZero = await pruneOutDirs(root, { keep: 0 });
    assert.deepEqual(resultZero.removed, [
      "2026-01-01T00-00-00-001Z",
      "2026-01-01T00-00-00-002Z",
    ]);

    await assert.rejects(async () => access(join(root, "2026-01-01T00-00-00-001Z")));
    await assert.rejects(async () => access(join(root, "2026-01-01T00-00-00-002Z")));
    await access(join(root, "2026-01-01T00-00-00-003Z"));

    // Uji juga nilai negatif: keep: -10 pada sisa 1 folder
    const resultNeg = await pruneOutDirs(root, { keep: -10 });
    assert.deepEqual(resultNeg.removed, []);
    await access(join(root, "2026-01-01T00-00-00-003Z"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
