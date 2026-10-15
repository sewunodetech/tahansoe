/**
 * Helper retensi folder output research run di apps/engine/out/ (ADR 0004).
 *
 * Setiap research run menulis folder apps/engine/out/<ISO-stamp>/
 * (format: YYYY-MM-DDTHH-mm-ss-sssZ). Fungsi pruneOutDirs menghapus folder
 * lama secara rekursif dan mempertahankan N folder terbaru, mencegah
 * penumpukan disk tanpa batas oleh scheduler yang berjalan berkala.
 */

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * Format nama direktori output dari defaultOutDir (run.ts):
 * new Date().toISOString().replace(/[:.]/g, "-")
 * Contoh: 2026-10-14T10-42-01-123Z
 */
export const OUT_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

export interface PruneOutDirsOptions {
  /** Jumlah folder run terbaru yang dipertahankan (minimal 1). */
  keep: number;
}

export interface PruneOutDirsResult {
  /** Daftar nama folder yang berhasil dihapus. */
  removed: string[];
}

/**
 * Pangkas direktori run lama di dalam rootDir.
 *
 * Aturan:
 * - Hanya memproses subdirektori langsung yang namanya cocok dengan pola ISO stamp.
 * - File dan direktori dengan nama lain (misal "eval", file ".txt") tidak pernah dihapus.
 * - Mengurutkan berdasarkan nama (kronologis) dan mempertahankan `keep` folder terbaru.
 * - Jika rootDir tidak ada, mengembalikan { removed: [] } tanpa melempar error.
 * - Nilai keep <= 0 akan di-clamp ke minimal 1.
 * - Kegagalan pada penghapusan satu folder tidak menghentikan proses folder lainnya.
 */
export async function pruneOutDirs(
  rootDir: string,
  opts: { keep: number },
): Promise<{ removed: string[] }> {
  const keep = Number.isFinite(opts.keep) ? Math.max(1, Math.floor(opts.keep)) : 1;

  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err.code === "ENOENT" || err.code === "ENOTDIR")
    ) {
      return { removed: [] };
    }
    throw err;
  }

  // Filter hanya subdirektori langsung yang sesuai pola ISO stamp
  const matchingDirs = entries
    .filter((entry) => entry.isDirectory() && OUT_DIR_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (matchingDirs.length <= keep) {
    return { removed: [] };
  }

  const toRemove = matchingDirs.slice(0, matchingDirs.length - keep);
  const removed: string[] = [];

  for (const dirName of toRemove) {
    const targetPath = join(rootDir, dirName);
    try {
      await rm(targetPath, { recursive: true, force: true });
      removed.push(dirName);
    } catch {
      // Jangan melempar error bila satu penghapusan gagal; lewati dan lanjutkan
    }
  }

  return { removed };
}
