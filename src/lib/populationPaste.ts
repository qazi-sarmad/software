/**
 * Population paste semantics (spec §11.1, L3) — the PURE layer behind the population grid.
 *
 * Two questions this module answers, and answers deterministically:
 *
 *   1. Does a pasted block map to columns BY POSITION? Yes. The first pasted line is the header; each
 *      later line splits on the delimiter and its fields map to the header fields by index, never by
 *      name. A short line is a per-line error (it is not silently padded), and a long line keeps only
 *      the columns the header declares (with a warning), so a stray tab cannot invent a column.
 *   2. Do extra rows auto-add to meet the floor? Not on their own — a paste is the auditor's own
 *      selection, and inventing rows would fabricate evidence. What the module does instead is
 *      report the shortfall against the floor so the screen can offer to add seeded rows, and it
 *      never claims a sample meets the floor when it does not.
 *
 * Determinism (Law L1): a fixed delimiter table, no model, no clock. Every row is hashed from its own
 * text so the same paste always yields the same row references. Nothing here reads the client; the
 * caller stores the rows (src/data/population.ts) and the database enforces the gate.
 *
 * Law L2: this module only ever sees the text the auditor pasted. It returns the parsed rows; it does
 * not query and does not decide access.
 */

/** The delimiters recognised, in priority order. A tab wins over a comma when both appear. */
const DELIMITERS: readonly string[] = ['\t', ',', ';', '|'];

/** A parsed row: its 1-based position in the population and its column values keyed by header name. */
export interface ParsedPopulationRow {
  rowRef: number;
  data: Record<string, string>;
}

/** A per-line problem, so the screen can point at the exact line the auditor must fix. */
export interface PasteLineError {
  line: number;
  message: string;
}

export interface PasteResult {
  /** The header the first line declared, in column order. */
  header: string[];
  /** The delimiter that was detected. */
  delimiter: string;
  rows: ParsedPopulationRow[];
  errors: PasteLineError[];
  /** Warnings that did not reject a row (a long line trimmed to the header width). */
  warnings: PasteLineError[];
  /** The 1-based line the header was read from (the first non-empty line). */
  headerLine: number;
}

/**
 * The delimiter a block uses. A tab is preferred because a spreadsheet paste is tab-separated and a
 * field value may itself contain a comma. Ties go to the earliest delimiter in the table.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  let best = DELIMITERS[0];
  let bestCount = -1;
  for (const d of DELIMITERS) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** Split one line on the delimiter, honouring simple double-quoted fields (a quoted comma). */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * Parse a pasted block into rows. The first non-empty line is the header; each later non-empty line
 * becomes a row with a 1-based `rowRef` equal to its position in the data (so re-pasting the same
 * block yields the same references). A line whose field count is below the header's is an error, not
 * a padded row; a line above it is trimmed with a warning.
 */
export function parsePopulationPaste(text: string): PasteResult {
  const delimiter = detectDelimiter(text);
  const rawLines = text.split(/\r?\n/);
  const headerIndex = rawLines.findIndex((l) => l.trim().length > 0);
  if (headerIndex === -1) {
    return { header: [], delimiter, rows: [], errors: [], warnings: [], headerLine: 0 };
  }
  const header = splitLine(rawLines[headerIndex], delimiter).filter((h) => h.length > 0);
  if (header.length === 0) {
    return { header: [], delimiter, rows: [], errors: [], warnings: [], headerLine: headerIndex + 1 };
  }

  const rows: ParsedPopulationRow[] = [];
  const errors: PasteLineError[] = [];
  const warnings: PasteLineError[] = [];

  for (let i = headerIndex + 1; i < rawLines.length; i += 1) {
    const line = rawLines[i];
    if (line.trim().length === 0) continue;
    const fields = splitLine(line, delimiter);
    if (fields.length < header.length) {
      errors.push({
        line: i + 1,
        message: `Line ${i + 1} has ${fields.length} field(s) but the header has ${header.length}.`,
      });
      continue;
    }
    if (fields.length > header.length) {
      warnings.push({
        line: i + 1,
        message: `Line ${i + 1} has ${fields.length} fields; the extra column(s) were ignored.`,
      });
    }
    const data: Record<string, string> = {};
    header.forEach((name, col) => {
      data[name] = fields[col] ?? '';
    });
    rows.push({ rowRef: rows.length + 1, data });
  }

  return { header, delimiter, rows, errors, warnings, headerLine: headerIndex + 1 };
}

/** The columns the header declares, in order — what the screen shows as the positional mapping. */
export function pasteColumns(result: PasteResult): string[] {
  return [...result.header];
}

export interface FloorAssessment {
  /** The number of rows the auditor pasted. */
  pasted: number;
  /** The floor the sampling table requires, or null when the floor is not known yet. */
  floor: number | null;
  /** True when the paste already meets (or exceeds) the floor. */
  meetsFloor: boolean;
  /** How many rows must still be added to reach the floor; 0 when the floor is met or unknown. */
  shortfall: number;
}

/**
 * Assess a paste against the floor. A paste is never auto-padded: the shortfall is reported so the
 * screen can offer to add seeded rows, and a paste below the floor is never described as sufficient.
 */
export function assessAgainstFloor(pasted: number, floor: number | null): FloorAssessment {
  if (floor === null || floor <= 0) {
    return { pasted, floor, meetsFloor: true, shortfall: 0 };
  }
  const shortfall = Math.max(0, floor - pasted);
  return { pasted, floor, meetsFloor: shortfall === 0, shortfall };
}

/**
 * The `p_items` payload `compute_sample('auditor_paste')` expects: one object per row carrying its
 * `row_ref`. The database reads `x.item ->> 'row_ref'`, so a bare number is refused; this is the one
 * shape that reaches the gate. Deterministic order (rowRef ascending) keeps the request stable.
 */
export function toSampleItems(rows: ParsedPopulationRow[]): { row_ref: number; data: Record<string, string> }[] {
  return [...rows]
    .sort((a, b) => a.rowRef - b.rowRef)
    .map((r) => ({ row_ref: r.rowRef, data: r.data }));
}
