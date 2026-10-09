/**
 * Pilih ≤ 5 lesson relevan untuk run berikutnya (spec §3.1, ADR 0005 §3).
 *
 * `rankLessons` adalah fungsi murni (diuji unit: ≤5, hanya aktif, irisan jalur —
 * spec §6). `selectLessons` membungkus pengambilan dari DB + ranking.
 */

import type { AnalystReport, Lesson, TransmissionPath } from "../agents/schemas.ts";
import { config } from "../config.ts";

/** Lesson tersimpan (dari research_lessons) dengan metadata seleksi. */
export interface StoredLesson extends Lesson {
  id: string;
  active: boolean;
  createdAt: Date;
}

/** Kumpulkan jalur yang muncul di laporan analyst run ini. */
export function pathsFromReports(reports: AnalystReport[]): Set<TransmissionPath> {
  const set = new Set<TransmissionPath>();
  for (const r of reports) for (const f of r.findings) set.add(f.path);
  return set;
}

/**
 * Rangking & pangkas lesson: hanya yang aktif, punya irisan jalur dengan run ini,
 * diurutkan dari irisan terbanyak lalu terbaru, dibatasi config.maxLessonsPerRun.
 */
export function rankLessons(
  stored: StoredLesson[],
  relevantPaths: Set<TransmissionPath>,
): Lesson[] {
  return stored
    .filter((l) => l.active)
    .map((l) => ({
      lesson: l,
      overlap: l.paths.filter((p) => relevantPaths.has(p)).length,
    }))
    .filter((x) => x.overlap > 0)
    .sort(
      (a, b) =>
        b.overlap - a.overlap ||
        b.lesson.createdAt.getTime() - a.lesson.createdAt.getTime(),
    )
    .slice(0, config.maxLessonsPerRun)
    .map((x) => ({ paths: x.lesson.paths, lesson: x.lesson.lesson }));
}

/**
 * Ambil lesson relevan untuk run (dipanggil run.ts sebelum assessor).
 *
 * TODO(dev):
 *  - Query research_lessons WHERE active = true.
 *  - relevantPaths = pathsFromReports(reports).
 *  - return rankLessons(stored, relevantPaths).
 */
export async function selectLessons(_reports: AnalystReport[]): Promise<Lesson[]> {
  throw new Error(
    "[engine/reflection/lessons] selectLessons belum diimplementasikan — lihat TODO (spec §3.1). Gunakan rankLessons untuk logika seleksi.",
  );
}
