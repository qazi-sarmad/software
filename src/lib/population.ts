/**
 * Population ingest (Guide v7 §8.2, Law 3). Pure and deterministic: no I/O, no unseeded randomness, no AI.
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
  /** Which row was treated as the header, and whether the choice was unambiguous. */
  header: HeaderDetection;
  /** True once the header row has been confirmed (or was unambiguously detected). */
  headerConfirmed: boolean;
}

/** A row scored as a possible header: how many of ref/date/amount its labels matched. */
export interface HeaderCandidate {
  index: number; // 0-based row index in the parsed table
  score: number; // 0..3, one per recognised column family
  labels: string[];
}

export interface HeaderDetection {
  index: number; // the row chosen as the header
  confident: boolean; // true only when exactly one row scores best and it is row 0
  candidates: HeaderCandidate[]; // every scored row in the scan window, best first
}

/** How many leading rows are scored when looking for the header. Bounds the work and the ambiguity. */
export const HEADER_SCAN_LIMIT = 8;

/** Optional override a caller supplies after showing the auditor the detected header. */
export interface PopulationCheckOptions {
  /**
   * undefined → use the detected header (and report whether it was confident);
   * a number → the auditor confirmed this row index as the header (0-based).
   */
  headerRow?: number;
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

/** How many of the three column families a row of labels recognises (0..3). */
function scoreHeaderRow(row: string[]): number {
  return [
    findCol(row, REF_ALIASES),
    findCol(row, DATE_ALIASES),
    findCol(row, AMT_ALIASES),
  ].filter((i) => i >= 0).length;
}

/**
 * Detect the header row instead of assuming row 1 (spec §2.1). A header is the row whose cells are
 * column labels: it scores on recognised names and its cells do not parse as data both ways. Scans the
 * first `HEADER_SCAN_LIMIT` rows and returns the best-scoring candidate. `confident` is true only when
 * exactly one row scores best *and* that row is the first — that is the case the caller may accept
 * without asking. Any other shape is ambiguous and the auditor must confirm.
 */
export function detectHeader(table: string[][]): HeaderDetection {
  const limit = Math.min(table.length, HEADER_SCAN_LIMIT);
  const candidates: HeaderCandidate[] = [];
  for (let i = 0; i < limit; i++) {
    const score = scoreHeaderRow(table[i]);
    if (score > 0) candidates.push({ index: i, score, labels: table[i].map((c) => c.trim()) });
  }
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  if (candidates.length === 0) {
    // No row looks like a header at all. Default to the first row (the existing behaviour) but mark it
    // as unconfident so the caller asks rather than counts a label row as data.
    return { index: 0, confident: false, candidates: [] };
  }
  const best = candidates[0];
  const tied = candidates.filter((c) => c.score === best.score);
  return { index: best.index, confident: best.index === 0 && tied.length === 1, candidates };
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
export function checkPopulationCsv(text: string, controlTotal: number | null, options: PopulationCheckOptions = {}): PopulationCheck {
  const issues: PopulationIssue[] = [];
  const empty = (header: HeaderDetection, headerConfirmed: boolean): PopulationCheck =>
    ({ verified: false, rowCount: 0, totalCents: 0, minDate: null, maxDate: null, issues, refs: [], header, headerConfirmed });
  const table = parseCsv(text);
  if (table.length < 2) {
    issues.push({ line: 0, message: 'File has no data rows.' });
    return empty(detectHeader(table), false);
  }
  const detection = detectHeader(table);
  const headerIndex = options.headerRow === undefined ? detection.index : options.headerRow;
  const headerConfirmed = options.headerRow === undefined ? detection.confident : true;
  const header = table[headerIndex] ?? [];
  // Only rows below the header are the population; rows above it are preamble (a title, a note) and
  // are never data. Each body row keeps its 1-based file line so issue numbers stay true.
  const body = table.slice(headerIndex + 1).map((r, i) => ({ r, line: headerIndex + 2 + i }));
  const headerLine = headerIndex + 1;

  if (!headerConfirmed) {
    issues.push({ line: headerLine, message: candidateMessage(detection) });
    return empty({ ...detection, index: headerIndex }, false);
  }

  const ci = { ref: findCol(header, REF_ALIASES), date: findCol(header, DATE_ALIASES), amt: findCol(header, AMT_ALIASES) };
  if (ci.ref < 0) issues.push({ line: headerLine, message: 'Missing a reference column (reference, ref, id, invoice…).' });
  if (ci.date < 0) issues.push({ line: headerLine, message: 'Missing a date column.' });
  if (ci.amt < 0) issues.push({ line: headerLine, message: 'Missing an amount column.' });
  if (issues.length) return empty({ ...detection, index: headerIndex }, true);

  const seen = new Map<string, number>();
  const refs: string[] = [];
  let total = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;
  let rowCount = 0;
  body.forEach(({ r, line }) => {
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
  return {
    verified: issues.length === 0 && rowCount > 0,
    rowCount, totalCents: total, minDate, maxDate, issues, refs,
    header: { ...detection, index: headerIndex ?? detection.index },
    headerConfirmed: true,
  };
}

/** A human-readable message naming the detected header and asking for confirmation (spec §2.1). */
function candidateMessage(d: HeaderDetection): string {
  const best = d.candidates[0];
  if (!best) {
    return 'Could not find a header row. Confirm the header before the population is counted.';
  }
  const where = best.index === 0 ? 'row 1' : `row ${best.index + 1}`;
  if (d.candidates.length > 1) {
    const others = d.candidates.slice(1, 3).map((c) => `row ${c.index + 1}`).join(', ');
    return `Header is ambiguous — detected ${where} (${best.labels.join(', ')}), but ${others} also look like headers. Confirm the header row.`;
  }
  return `Detected a header on ${where} (${best.labels.join(', ')}). Confirm the header row before the population is counted.`;
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
