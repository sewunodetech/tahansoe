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
