/**
 * CLI pengelola settings NON-RAHASIA (ADR 0008).
 *
 *   tsx --env-file-if-exists=.env src/cli/settings.ts <command> [args]
 *
 * Commands:
 *   show                                  Tampilkan settings efektif + sumber tiap
 *                                         nilai (tanpa secret; tandai provider yang
 *                                         env key-nya belum ada).
 *   init                                  Salin settings.example.json → settings.json
 *                                         bila belum ada.
 *   set-role <role> <provider:model[,…]>  Set daftar fallback model untuk sebuah peran.
 *   add-provider <name> <baseUrl> [--key-env NAME] [--pricing-url URL] [--local]
 *   remove-provider <name>
 *   set <path> <value>                    Set nilai generik, mis. `set estimate.runsPerDay 24`.
 *
 * Penulisan atomik (tmp lalu rename), JSON rapi 2 spasi. JANGAN cetak secret (I8).
 */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  loadSettings,
  writeSettings,
  settingsPath,
  settingsExamplePath,
  resolveProviders,
  resolveRoleSpecList,
} from "../settings/settings.ts";
import { emptySettings, type Settings } from "../settings/schema.ts";

type Role = "analyst" | "debate" | "assessor" | "reflector";
const ROLES: Role[] = ["analyst", "debate", "assessor", "reflector"];

/** Terapkan `set <path> <value>` pada objek settings (mutasi salinan). Pure. */
export function applyGenericSet(settings: Settings, path: string, rawValue: string): Settings {
  const parts = path.split(".");
  if (parts.length === 0) throw new Error("path kosong");
  // Nilai: coba number/boolean, selain itu string.
  let value: unknown = rawValue;
  if (rawValue === "true") value = true;
  else if (rawValue === "false") value = false;
  else if (rawValue !== "" && !Number.isNaN(Number(rawValue))) value = Number(rawValue);

  const next = structuredClone(settings) as Record<string, unknown>;
  let cursor = next;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof cursor[key] !== "object" || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
  return next as unknown as Settings;
}

/** Format `show` jadi teks (tanpa secret). Pure untuk test. */
export function formatShow(
  settings: Settings,
  path: string,
  exists: boolean,
  envVars: Record<string, string | undefined> = process.env,
): string {
  const lines: string[] = [];
  lines.push(`settings: ${path}${exists ? "" : " (belum ada — pakai default; jalankan `init`)"}`);
  lines.push(`version: ${settings.version}`);
  lines.push("");

  const { providers, warnings } = resolveProviders(settings, envVars);
  lines.push("providers:");
  const names = Object.keys(providers).sort();
  if (names.length === 0) lines.push("  (none)");
  for (const name of names) {
    const p = providers[name]!;
    const keyState = p.local
      ? "local (no key)"
      : p.apiKeyEnv
        ? p.apiKey.length > 0
          ? `key via ${p.apiKeyEnv} ✓`
          : `key via ${p.apiKeyEnv} ✗ (env belum diisi → provider TIDAK tersedia)`
        : "no apiKeyEnv (base-only)";
    const pricing = p.pricingUrl ? ` · pricingUrl: ${p.pricingUrl}` : "";
    lines.push(`  ${name} [${p.source}]: ${p.baseURL} · ${keyState}${pricing}`);
  }

  lines.push("");
  lines.push("roles:");
  for (const role of ROLES) {
    const { list } = resolveRoleSpecList(role, settings, envVars);
    lines.push(`  ${role}: ${list && list.length ? list.join(", ") : "(default)"}`);
  }

  lines.push("");
  lines.push(`modelPrices: ${Object.keys(settings.modelPrices).length} entri (manual, USD/1M)`);
  lines.push(`estimate.runsPerDay: ${settings.estimate.runsPerDay ?? "(default 12)"}`);

  if (warnings.length > 0) {
    lines.push("");
    lines.push("peringatan:");
    for (const w of warnings) lines.push(`  - ${w}`);
  }
  return lines.join("\n");
}

/** Ambil flag `--name value` dari argv; mengembalikan nilai atau undefined. */
function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

async function main(argv: string[]): Promise<void> {
  const cmd = argv[0];
  const path = settingsPath();

  if (cmd === "show") {
    const { settings, exists } = await loadSettings(path);
    console.log(formatShow(settings, path, exists));
    return;
  }

  if (cmd === "init") {
    const { exists } = await loadSettings(path);
    if (exists) {
      console.log(`settings.json sudah ada di ${path} — tidak ditimpa.`);
      return;
    }
    let example: Settings;
    try {
      const raw = await readFile(settingsExamplePath(), "utf8");
      example = JSON.parse(raw) as Settings;
    } catch {
      example = emptySettings();
    }
    await writeSettings(example, path);
    console.log(`settings.json dibuat di ${path} (dari settings.example.json).`);
    return;
  }

  if (cmd === "set-role") {
    const role = argv[1] as Role;
    const spec = argv[2];
    if (!ROLES.includes(role) || !spec) {
      console.error("pakai: set-role <analyst|debate|assessor|reflector> <provider:model[,provider:model]>");
      process.exitCode = 1;
      return;
    }
    const { settings } = await loadSettings(path);
    const list = spec.split(",").map((s) => s.trim()).filter(Boolean);
    const next: Settings = { ...settings, roles: { ...settings.roles, [role]: list } };
    await writeSettings(next, path);
    console.log(`roles.${role} = ${list.join(", ")}`);
    return;
  }

  if (cmd === "add-provider") {
    const name = argv[1]?.toLowerCase();
    const baseUrl = argv[2];
    if (!name || !baseUrl) {
      console.error("pakai: add-provider <name> <baseUrl> [--key-env NAME] [--pricing-url URL] [--local]");
      process.exitCode = 1;
      return;
    }
    const { settings } = await loadSettings(path);
    const provider = {
      baseUrl,
      ...(flag(argv, "--key-env") ? { apiKeyEnv: flag(argv, "--key-env") } : {}),
      ...(flag(argv, "--pricing-url") ? { pricingUrl: flag(argv, "--pricing-url") } : {}),
      ...(hasFlag(argv, "--local") ? { local: true } : {}),
    };
    const next: Settings = { ...settings, providers: { ...settings.providers, [name]: provider } };
    await writeSettings(next, path);
    console.log(`provider "${name}" ditambahkan (baseUrl: ${baseUrl}).`);
    return;
  }

  if (cmd === "remove-provider") {
    const name = argv[1]?.toLowerCase();
    if (!name) {
      console.error("pakai: remove-provider <name>");
      process.exitCode = 1;
      return;
    }
    const { settings } = await loadSettings(path);
    const providers = { ...settings.providers };
    if (!(name in providers)) {
      console.error(`provider "${name}" tidak ada di settings.`);
      process.exitCode = 1;
      return;
    }
    delete providers[name];
    await writeSettings({ ...settings, providers }, path);
    console.log(`provider "${name}" dihapus.`);
    return;
  }

  if (cmd === "set") {
    const p = argv[1];
    const v = argv[2];
    if (!p || v === undefined) {
      console.error("pakai: set <path> <value>  (mis. set estimate.runsPerDay 24)");
      process.exitCode = 1;
      return;
    }
    const { settings } = await loadSettings(path);
    const next = applyGenericSet(settings, p, v);
    await writeSettings(next, path); // writeSettings memvalidasi via zod
    console.log(`${p} = ${v}`);
    return;
  }

  console.error(
    [
      "Commands: show | init | set-role <role> <spec> | add-provider <name> <baseUrl> [--key-env N] [--pricing-url U] [--local] | remove-provider <name> | set <path> <value>",
    ].join("\n"),
  );
  process.exitCode = cmd ? 1 : 0;
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error("[engine] settings CLI gagal:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
