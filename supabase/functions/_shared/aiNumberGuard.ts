/**
 * The number guard (F8). The prompt carries the numbers the model may use (allowed_numbers). The
 * gateway extracts numeric tokens from the response (integers, decimals, percentages, dates) that
 * are not in the allow-list and flags them as unverified_figures, so a suggestion with an invented
 * figure cannot be accepted until the user edits the text or confirms each flagged figure.
 *
 * Pure and deterministic (L1): no randomness, no AI.
 */

export interface FlaggedFigure {
  token: string;
  context: string;
}

/** Normalise a numeric token to a comparable form: strip commas, a trailing %, a leading +, and
 *  trailing zeros in a decimal. "1,234.50" and "1234.5" compare equal; "50%" and "50" compare
 *  equal because the percent sign is not part of the number's magnitude. */
export function normaliseNumber(token: string): string {
  let t = token.replace(/,/g, '').replace(/^\+/, '');
  t = t.replace(/%$/, '');
  if (t.includes('.')) {
    t = t.replace(/0+$/, '').replace(/\.$/, '');
  }
  return t;
}

/**
 * Extract numeric tokens from text. Recognises integers, decimals (with or without a thousands
 * separator), percentages and ISO dates (YYYY-MM-DD), plus dates like 2024/05/01.
 */
export function extractNumbers(text: string): string[] {
  const out: string[] = [];
  const dateRe = /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = dateRe.exec(text)) !== null) out.push(m[0]);
  const stripped = text.replace(dateRe, ' ');
  const numRe = /(?<![\w.])\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|\d+(?:\.\d+)?%?/g;
  while ((m = numRe.exec(stripped)) !== null) out.push(m[0]);
  return out;
}

/**
 * Return the figures in `response` that are not in `allowedNumbers`. Comparison is by the normalised
 * value, so "1,000" is allowed when the prompt carried "1000".
 */
export function findUnverifiedFigures(response: string, allowedNumbers: string[]): FlaggedFigure[] {
  const allowed = new Set(allowedNumbers.map(normaliseNumber));
  const flagged: FlaggedFigure[] = [];
  const seen = new Set<string>();
  for (const token of extractNumbers(response)) {
    const key = normaliseNumber(token);
    if (allowed.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const at = response.indexOf(token);
    const context = response.slice(Math.max(0, at - 30), Math.min(response.length, at + token.length + 30));
    flagged.push({ token, context });
  }
  return flagged;
}
