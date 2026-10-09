/**
 * Population ingest (Guide v7 §8.2, Law 3). Pure and deterministic: no I/O, no Math.random, no AI.
 * CSV only for now (xls/xlsx need a parser library and are NOT supported yet).
 * Money is summed in integer cents so totals never drift.
 */

export interface PopulationRow {
  reference: string;
  date: string; // YYYY-MM-DD
  amountCents: number;
}

export interface PopulationIssue {
  line: number; // 1-based line in the file (header = 1); 0 = file level
  message: string;
}

export interface PopulationCheck {
  verified: boolean;
  rowCount: number;
  totalCents: number;
  minDate: string | null;
  maxDate: string | null;
  issues: PopulationIssue[];
  refs: string[];
}

export const POPULATION_MAX_BYTES = 10 * 1024 * 1024;

/** RFC-4180-style CSV split: handles BOM, CRLF, quoted commas/newlines and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const REF_ALIASES = ['reference', 'ref', 'id', 'invoice', 'invoice number', 'document number', 'document no', 'payment id'];
const DATE_ALIASES = ['date', 'posting date', 'invoice date', 'payment date'];
const AMT_ALIASES = ['amount', 'value', 'total', 'amount usd'];

function findCol(header: string[], aliases: string[]): number {
  const h = header.map((c) => c.trim().toLowerCase());
  return h.findIndex((c) => aliases.includes(c));
}

/** Returns integer cents or null. Accepts -1234.56 and 1,234.56; rejects blanks, NaN, Infinity, (1.00), 1e3. */
export function parseAmountCents(raw: string): number | null {
  const t = raw.trim();
  if (!/^-?(\d{1,3}(,\d{3})+|\d+)(\.\d{1,4})?$/.test(t)) return null;
  const n = Number(t.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Integrity checks + reconciliation against the control total the auditor typed in.
 * `verified` is true ONLY when there are zero issues, at least one row, and the total
 * matches the control total within half a cent.
 */
export function checkPopulationCsv(text: string, controlTotal: number | null): PopulationCheck {
  const issues: PopulationIssue[] = [];
  const empty = (): PopulationCheck => ({ verified: false, rowCount: 0, totalCents: 0, minDate: null, maxDate: null, issues, refs: [] });
  const table = parseCsv(text);
  if (table.length < 2) {
    issues.push({ line: 0, message: 'File has no data rows.' });
    return empty();
  }
  const [header, ...body] = table;
  const ci = { ref: findCol(header, REF_ALIASES), date: findCol(header, DATE_ALIASES), amt: findCol(header, AMT_ALIASES) };
  if (ci.ref < 0) issues.push({ line: 1, message: 'Missing a reference column (reference, ref, id, invoice…).' });
  if (ci.date < 0) issues.push({ line: 1, message: 'Missing a date column.' });
  if (ci.amt < 0) issues.push({ line: 1, message: 'Missing an amount column.' });
  if (issues.length) return empty();

  const seen = new Map<string, number>();
  const refs: string[] = [];
  let total = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;
  let rowCount = 0;
  body.forEach((r, i) => {
    const line = i + 2;
    const ref = (r[ci.ref] ?? '').trim();
    const date = (r[ci.date] ?? '').trim();
    const cents = parseAmountCents(r[ci.amt] ?? '');
    let bad = false;
    if (!ref) { issues.push({ line, message: 'Blank reference.' }); bad = true; }
    else if (seen.has(ref)) { issues.push({ line, message: `Duplicate reference "${ref}" (first on line ${seen.get(ref)}).` }); bad = true; }
    else seen.set(ref, line);
    if (!isValidIsoDate(date)) { issues.push({ line, message: `Invalid date "${date}" (use YYYY-MM-DD).` }); bad = true; }
    if (cents === null) { issues.push({ line, message: `Blank or invalid amount "${(r[ci.amt] ?? '').trim()}".` }); bad = true; }
    if (bad) return;
    rowCount++;
    refs.push(ref);
    total += cents as number;
    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
  });

  if (controlTotal === null || !Number.isFinite(controlTotal)) {
    issues.push({ line: 0, message: 'Enter the control total to reconcile against.' });
  } else if (Math.abs(total - Math.round(controlTotal * 100)) > 0) {
    issues.push({ line: 0, message: `Total ${(total / 100).toFixed(2)} does not equal the control total ${controlTotal.toFixed(2)}.` });
  }
  return { verified: issues.length === 0 && rowCount > 0, rowCount, totalCents: total, minDate, maxDate, issues, refs };
}

/** SHA-256 of the RAW bytes (no text re-encoding). Throws if secure crypto is unavailable: never falls back. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Secure hashing (WebCrypto) is unavailable; cannot verify a population.');
  const d = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Extension allow-list for population uploads. Content sniffing for xls/xlsx arrives with the parser. */
export function isSupportedPopulationFile(name: string): { ok: boolean; reason?: string } {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'csv') return { ok: true };
  if (ext === 'xls' || ext === 'xlsx') return { ok: false, reason: 'Excel files are not supported yet. Export the population to CSV.' };
  return { ok: false, reason: 'Only CSV populations are supported right now.' };
}
