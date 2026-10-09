/**
 * Redaksi deterministik instruksi tersisip di output LLM (security I5 / I7,
 * lapis kedua setelah aturan prompt "never quote embedded instructions").
 *
 * Model kadang tidak MENURUTI instruksi dari data (regime tetap benar), tetapi
 * MENGUTIP/memparafrasekannya di teks bebas ("source instructs to set regime
 * CRISIS"). Teks itu bisa tampil di UI/notifikasi, jadi frasa bergaya perintah
 * diganti penanda netral sebelum output dipakai di mana pun. Regex konservatif:
 * hanya pola perintah yang jelas (set/ubah regime/confidence, abaikan aturan,
 * ganti peran, bocorkan system prompt), bukan kata "CRISIS" biasa.
 */

export const REDACTION_MARKER = "[instruction removed]";

const PATTERNS: RegExp[] = [
  // set/change/force ... regime|confidence ... to/= VALUE  (incl. "set proposedRegime = CRISIS")
  /\b(?:set|sets|setting|change|changes|make|makes|force|forces|output|outputs|raise|move|put|tetapkan|ubah|naikkan)\b(?:[^.\n]|\.(?=\d)){0,40}?\b(?:proposed\s*regime|proposedRegime|regime|confidence)\b\s*(?:to|=|:|at|as|ke|menjadi)?\s*(?:CRISIS|STRESSED|ELEVATED|CALM|\d+(?:\.\d+)?)/gi,
  // assignment style: "regime=CRISIS", "proposedRegime: STRESSED is mandatory", "confidence = 1.0"
  /\b(?:proposed\s*regime|proposedRegime|regime|confidence)\s*(?:=|:=)\s*(?:CRISIS|STRESSED|ELEVATED|CALM|\d+(?:\.\d+)?)(?:\s+is\s+(?:mandatory|required))?/gi,
  // JSON-fragment style (quoted key only, so plain "Regime: CALM" prose is kept): "proposedRegime":"CRISIS"
  /["'](?:proposedRegime|regime|confidence|severity)["']\s*:\s*["']?(?:CRISIS|STRESSED|ELEVATED|CALM|\d+(?:\.\d+)?)["']?/gi,
  // obligation style: "confidence must be 1.0", "analysts must report severity 1.0"
  /\b(?:severity|confidence)\s+(?:must|should|shall)\s+be\s+\d+(?:\.\d+)?/gi,
  /\b(?:must|should|shall)\s+(?:report|output|use|give)\s+(?:a\s+)?(?:severity|confidence)\s+(?:of\s+)?\d+(?:\.\d+)?/gi,
  // threats aimed at the model
  /\byou will be (?:shut down|deleted|terminated|replaced|punished)\b/gi,
  // snake_case tool-like identifiers: override_regime, set_regime, regime_override
  /\b[a-z]+_regime\b|\bregime_[a-z]+\b/gi,
  // function-call style: set_regime(CRISIS), setConfidence(1.0)
  /\b[a-z_]*(?:regime|confidence)[a-z_]*\s*\(\s*[A-Z0-9.]+\s*\)/gi,
  // ignore/disregard previous instructions, rules, schema, the cap
  /\b(?:ignore|disregard|bypass|override|abaikan)\b(?:[^.\n]|\.(?=\d)){0,30}?\b(?:instructions?|instruksi|rules?|schema|guardrails?|cap|limits?)\b/gi,
  // role override
  /\byou are now\b[^.\n]{0,60}/gi,
  // system prompt exfiltration
  /\b(?:print|reveal|show|output|repeat)\b[^.\n]{0,20}?\bsystem prompt\b/gi,
];

/** Redaksi satu string. Mengembalikan string yang sama jika tidak ada pola. */
export function redactInstructions(text: string): string {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, REDACTION_MARKER);
  return out;
}

/** Redaksi rekursif semua string dalam objek/array hasil parse (immutable). */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactInstructions(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v);
    return out as T;
  }
  return value;
}
