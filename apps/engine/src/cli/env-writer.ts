import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Root direktori apps/engine */
export function engineRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // src/cli
  return resolve(here, "..", ".."); // apps/engine
}

/** Path file .env apps/engine, dengan dukungan override TAHANSOE_ENV_FILE */
export function defaultEnvPath(envVars: Record<string, string | undefined> = process.env): string {
  const override = envVars.TAHANSOE_ENV_FILE?.trim();
  if (override) return resolve(override);
  return join(engineRoot(), ".env");
}

/** Path file .env.example apps/engine */
export function defaultEnvExamplePath(): string {
  return join(engineRoot(), ".env.example");
}

export interface WriteEnvOptions {
  envPath?: string;
  examplePath?: string;
  updates: Record<string, string>;
  commentedDefaults?: string[];
}

/**
 * Tulis / update file .env secara aman tanpa mencetak secret ke log:
 *  - Jika file .env sudah ada, baca dan terapkan updates.
 *  - Jika belum ada, gunakan .env.example sebagai template dasar.
 *  - Jika .env.example juga belum ada, mulai dari string kosong.
 *  - Tulis hasil transformasi atomik ke envPath.
 */
export async function writeEnvUpdates(options: WriteEnvOptions): Promise<string> {
  const targetPath = options.envPath ?? defaultEnvPath();
  const examplePath = options.examplePath ?? defaultEnvExamplePath();

  let baseContent = "";
  try {
    baseContent = await readFile(targetPath, "utf8");
  } catch {
    try {
      baseContent = await readFile(examplePath, "utf8");
    } catch {
      baseContent = "";
    }
  }

  const updatedContent = applyEnvUpdates(baseContent, options.updates, options.commentedDefaults);
  await mkdir(dirname(targetPath), { recursive: true }).catch(() => {});
  await writeFile(targetPath, updatedContent, "utf8");
  return targetPath;
}

export function applyEnvUpdates(
  content: string,
  updates: Record<string, string>,
  commentedDefaults?: string[],
): string {
  const remaining = new Map(Object.entries(updates));
  // Pertahankan gaya akhir baris file (LF). Pecah dengan mempertahankan baris.
  const lines = content.length === 0 ? [] : content.split("\n");

  const out = lines.map((line) => {
    // Hanya cocokkan baris "KEY=..." (abaikan komentar & baris tanpa '=').
    const m = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*)=/.exec(line);
    if (!m) return line;
    const key = m[2]!;
    if (!remaining.has(key)) return line;
    const value = remaining.get(key)!;
    remaining.delete(key);
    return `${key}=${value}`;
  });

  // Kunci baru: tambahkan di akhir.
  if (remaining.size > 0) {
    for (const [key, value] of remaining) out.push(`${key}=${value}`);
  }

  // Tambahkan baris komentar default jika variabelnya belum pernah disebutkan
  if (commentedDefaults && commentedDefaults.length > 0) {
    const fullTextSoFar = out.join("\n");
    for (const def of commentedDefaults) {
      const m = /(?:#\s*)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(def);
      const varName = m ? m[1]! : null;
      if (varName && !fullTextSoFar.includes(varName)) {
        out.push(def);
      }
    }
  }

  let result = out.join("\n");
  // Jaga trailing newline bila file asli punya (atau file baru).
  if (content.endsWith("\n") && !result.endsWith("\n")) result += "\n";
  if (content.length === 0 && result.length > 0 && !result.endsWith("\n")) result += "\n";
  return result;
}
