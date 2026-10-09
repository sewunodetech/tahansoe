/**
 * Util argumen & exit code bersama untuk CLI `tahansoe` (spec m3-cli §3.4).
 * Exit code: 0 ok, 1 error, 2 config salah (mis. LLM_API_URL/KEY hilang).
 */

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_CONFIG = 2;

/** Pisahkan nilai CSV "ETH,USDC" → ["ETH","USDC"]. */
export function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * npm/PowerShell kadang "menelan" flag boolean tak bernilai setelah `--` dan
 * mengekspornya sebagai env `npm_config_<name>` (nilai "" atau "true"). Beberapa
 * flag juga ditulis-ulang: `--dry` → `npm_config_dry_run`. Helper ini mengecek
 * kehadiran flag lewat argv (parseArgs) ATAU env npm_config (termasuk alias).
 *
 * @param present nilai boolean dari parseArgs (prioritas)
 * @param name nama flag (mis. "json", "once", "dry")
 * @param aliases nama env npm_config tambahan (mis. "dry_run" untuk "dry")
 */
export function flagOrNpm(
  present: boolean | undefined,
  name: string,
  aliases: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (present) return true;
  if (env[`npm_config_${name}`] !== undefined) return true;
  for (const a of aliases) {
    const v = env[`npm_config_${a}`];
    if (v !== undefined && v !== "" && v !== "false") return true;
    if (v === "") return true; // flag hadir tanpa nilai
  }
  return false;
}
