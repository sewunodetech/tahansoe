/**
 * CLI pengelola settings NON-RAHASIA v2 (ADR 0009 — satu gateway).
 *
 *   tsx --env-file-if-exists=.env src/cli/settings.ts <command> [args]
 *
 * Commands:
 *   show                               Settings efektif + status gateway (tanpa secret).
 *   init                               Salin settings.example.json → settings.json (bila belum ada).
 *   set-role <role> <model[,model]>    Set daftar fallback NAMA MODEL untuk sebuah peran.
 *   set <path> <value>                 Set nilai generik, mis. `set estimate.runsPerDay 24`.
 *
 * Gateway (LLM_API_URL/LLM_API_KEY) ada di .env, bukan di settings. Penulisan
 * atomik (tmp lalu rename), JSON rapi 2 spasi. JANGAN cetak secret (I8).
 */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { loadSettings, writeSettings, settingsPath, settingsExamplePath, parseSettings } from "../settings/settings.ts";
import { emptySettings, stripProviderPrefix, type Settings } from "../settings/schema.ts";
import { gatewayConfig, isGatewayConfigured } from "../llm/registry.ts";

type Role = "analyst" | "debate" | "assessor" | "reflector";
const ROLES: Role[] = ["analyst", "debate", "assessor", "reflector"];

/** Terapkan `set <path> <value>` pada objek settings (salinan). Pure. */
export function applyGenericSet(settings: Settings, path: string, rawValue: string): Settings {
  const parts = path.split(".");
  if (parts.length === 0) throw new Error("path kosong");
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

/** Format `show` jadi teks (tanpa secret). Pure untuk test (env & gateway di-inject). */
export function formatShow(
  settings: Settings,
  path: string,
  exists: boolean,
  gateway: { baseURL: string; apiKey: string },
): string {
  const lines: string[] = [];
  lines.push(`settings: ${path}${exists ? "" : " (belum ada — pakai default; jalankan `init`)"}`);
  lines.push(`version: ${settings.version}`);
  lines.push("");

  // Gateway: tampilkan URL + status key (tanpa nilai).
  const configured = gateway.baseURL.length > 0 && gateway.apiKey.length > 0;
  const keyState = gateway.apiKey.length > 0 ? "LLM_API_KEY ✓" : "LLM_API_KEY ✗ (belum diisi)";
  const urlState = gateway.baseURL.length > 0 ? gateway.baseURL : "(LLM_API_URL belum diisi)";
  lines.push(`gateway: ${urlState} · ${keyState} → ${configured ? "siap" : "BELUM siap"}`);
  lines.push("");

  lines.push("roles (nama model, urutan fallback):");
  for (const role of ROLES) {
    const list = settings.roles[role];
    lines.push(`  ${role}: ${list && list.length ? list.join(", ") : "(default)"}`);
  }

  lines.push("");
  lines.push(`pricingUrl: ${settings.pricingUrl ?? "(none)"}`);
  lines.push(`modelPrices: ${Object.keys(settings.modelPrices).length} entri (manual, USD/1M)`);
  lines.push(`estimate.runsPerDay: ${settings.estimate.runsPerDay ?? "(default 12)"}`);
  return lines.join("\n");
}

async function main(argv: string[]): Promise<void> {
  const cmd = argv[0];
  const path = settingsPath();

  if (cmd === "show") {
    const { settings, exists, warnings } = await loadSettings(path);
    for (const w of warnings) console.error(w);
    console.log(formatShow(settings, path, exists, gatewayConfig()));
    if (!isGatewayConfigured()) {
      console.error("\nCatatan: set LLM_API_URL + LLM_API_KEY di apps/engine/.env agar gateway siap.");
    }
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
      example = parseSettings(raw, settingsExamplePath()).settings; // validasi + migrasi bila perlu
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
      console.error("pakai: set-role <analyst|debate|assessor|reflector> <model[,model]>");
      process.exitCode = 1;
      return;
    }
    const { settings } = await loadSettings(path);
    const list = spec.split(",").map((s) => stripProviderPrefix(s.trim())).filter(Boolean);
    const next: Settings = { ...settings, roles: { ...settings.roles, [role]: list } };
    await writeSettings(next, path);
    console.log(`roles.${role} = ${list.join(", ")}`);
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

  console.error("Commands: show | init | set-role <role> <model[,model]> | set <path> <value>");
  process.exitCode = cmd ? 1 : 0;
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error("[engine] settings CLI gagal:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
