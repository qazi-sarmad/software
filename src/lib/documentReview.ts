/**
 * Deterministic document review checks (C2.6, spec §13.1).
 *
 * §13.1 names four kinds of deterministic check: structure (placeholders and empty sections; table
 * cross-footing; template and checklist conformance) and consistency (numeric inconsistencies across
 * sections; matching document facts to sample rows). The placeholder/empty-section/signature/date
 * checks live in `analytics.runDocumentReview`; the remaining four live here as pure functions so
 * they can be exercised with fixtures and never depend on a model (L1).
 *
 * Nothing here reads the database, and nothing here is randomised: the same input always yields the
 * same findings in the same order.
 */

export interface DocFinding {
  /** Where the problem is, for the operator: a line number, a section name, or a row reference. */
  where: string;
  detail: string;
}

export interface DocCheckResult {
  rule: string;
  passed: boolean;
  message: string;
  findings: DocFinding[];
}

/** A parsed numeric cell: the raw label as written, and its value once the separators are removed. */
export interface TableRowCells {
  label: string;
  values: number[];
}

/**
 * Parse a plain-text table into rows. A line is a row when it has a label followed by at least one
 * number; columns are separated by two or more spaces, a tab, or a pipe. Blank lines and lines with
 * no number are ignored, so prose between tables never breaks the parse.
 */
export function parseTableRows(text: string): TableRowCells[] {
  const rows: TableRowCells[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const cells = line.split(/\s{2,}|\t|\|/).map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const numbers: number[] = [];
    for (const cell of cells.slice(1)) {
      const n = parseNumber(cell);
      if (n === null) { numbers.length = 0; break; }
      numbers.push(n);
    }
    if (numbers.length === 0) continue;
    rows.push({ label: cells[0], values: numbers });
  }
  return rows;
}

/** A number written with thousands separators, currency symbols, parentheses for negatives, or a %. */
export function parseNumber(cell: string): number | null {
  let s = cell.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[£$€,\s]/g, '').replace(/%$/, '');
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const TOTAL_LABEL = /^(total|totals|sum|subtotal|sub-total|grand total)\b/i;
const FOOTED_LABEL = /^(total|totals|sum|grand total)\b/i;

/**
 * Table cross-footing: in each table, the declared total row must equal the sum of the rows above it,
 * column by column. A table with no total row is not cross-footed here (nothing to check); a total row
 * that disagrees is an exception naming the column and both figures.
 */
export function crossFootTables(text: string): DocCheckResult {
  const lines = text.split('\n');
  const findings: DocFinding[] = [];
  let tableNumber = 0;
  let current: { line: number; row: TableRowCells }[] = [];

  const flush = () => {
    if (current.length === 0) return;
    tableNumber += 1;
    const totalIndex = current.findIndex((r) => FOOTED_LABEL.test(r.row.label));
    if (totalIndex > 0) {
      const totalRow = current[totalIndex];
      const bodyRows = current.slice(0, totalIndex);
      const columns = Math.min(totalRow.row.values.length, ...bodyRows.map((r) => r.row.values.length));
      for (let c = 0; c < columns; c++) {
        const sum = bodyRows.reduce((acc, r) => acc + r.row.values[c], 0);
        const declared = totalRow.row.values[c];
        if (Math.abs(sum - declared) > 0.005) {
          findings.push({
            where: `table ${tableNumber}, line ${totalRow.line}, column ${c + 1}`,
            detail: `total says ${declared} but the column sums to ${round2(sum)}`,
          });
        }
      }
    }
    current = [];
  };

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) { flush(); return; }
    const parsed = parseTableRows(line)[0];
    if (parsed) current.push({ line: idx + 1, row: parsed });
    else flush();
  });
  flush();

  return {
    rule: 'Table Cross-footing',
    passed: findings.length === 0,
    message: findings.length === 0
      ? 'Every table total agrees with the rows above it'
      : `${findings.length} table total(s) do not agree with the rows above them`,
    findings,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A labelled figure found in prose: "Revenue: 1,200" or "Total assets = £3,400.50". */
export interface LabelledFigure {
  label: string;
  value: number;
  where: string;
}

/** Collect "label <separator> number" pairs from prose lines (a colon, an equals sign or a dash). */
export function extractLabelledFigures(text: string): LabelledFigure[] {
  const out: LabelledFigure[] = [];
  text.split('\n').forEach((rawLine, idx) => {
    const line = rawLine.trim();
    const m = line.match(/^([A-Za-z][A-Za-z0-9 _/&-]{1,60}?)\s*[:=]\s*(.+)$/);
    if (!m) return;
    const value = parseNumber(m[2]);
    if (value === null) return;
    out.push({ label: m[1].trim().toLowerCase(), value, where: `line ${idx + 1}` });
  });
  return out;
}

/**
 * Numeric inconsistency across sections: the same label (case-insensitive, trimmed) carrying two
 * different values in different places. A repeated label with the same value is fine; the first
 * disagreement is reported once per label.
 */
export function inconsistentFigures(text: string): DocCheckResult {
  const figures = extractLabelledFigures(text);
  const byLabel = new Map<string, LabelledFigure[]>();
  for (const f of figures) {
    const list = byLabel.get(f.label) ?? [];
    list.push(f);
    byLabel.set(f.label, list);
  }
  const findings: DocFinding[] = [];
  for (const [label, list] of byLabel) {
    const first = list[0];
    const differing = list.slice(1).find((f) => Math.abs(f.value - first.value) > 0.005);
    if (differing) {
      findings.push({
        where: `${first.where} and ${differing.where}`,
        detail: `"${label}" is ${first.value} in one place and ${differing.value} in another`,
      });
    }
  }
  return {
    rule: 'Numeric Consistency Across Sections',
    passed: findings.length === 0,
    message: findings.length === 0
      ? 'No labelled figure appears with two different values'
      : `${findings.length} labelled figure(s) appear with conflicting values`,
    findings,
  };
}

/** A fact about a sample row that the document must state, and the label it appears under. */
export interface SampleRowFact {
  /** A stable identifier for the row, shown in the finding when it does not match. */
  rowRef: string;
  /** The label the figure appears under in the document (matched case-insensitively). */
  label: string;
  /** The value the document must show for this row. */
  value: number;
}

/**
 * Matching document facts to sample rows: every sample row's fact must appear in the document with
 * the expected value. A missing label and a wrong value are both exceptions; the check reports which.
 */
export function matchFactsToSampleRows(text: string, facts: SampleRowFact[]): DocCheckResult {
  const figures = extractLabelledFigures(text);
  const byLabel = new Map<string, number[]>();
  for (const f of figures) {
    const list = byLabel.get(f.label) ?? [];
    list.push(f.value);
    byLabel.set(f.label, list);
  }
  const findings: DocFinding[] = [];
  for (const fact of facts) {
    const values = byLabel.get(fact.label.trim().toLowerCase());
    if (!values) {
      findings.push({ where: `sample row ${fact.rowRef}`, detail: `the document does not state "${fact.label}"` });
      continue;
    }
    if (!values.some((v) => Math.abs(v - fact.value) <= 0.005)) {
      findings.push({
        where: `sample row ${fact.rowRef}`,
        detail: `"${fact.label}" is ${values.join(', ')} in the document but the sample row says ${fact.value}`,
      });
    }
  }
  return {
    rule: 'Document Facts Match Sample Rows',
    passed: findings.length === 0,
    message: findings.length === 0
      ? 'Every sample row fact appears in the document with the expected value'
      : `${findings.length} sample row(s) are not supported by the document`,
    findings,
  };
}

/** A required checklist item, and words that satisfy it. A match on any alternative passes the item. */
export interface ChecklistItem {
  key: string;
  label: string;
  /** Alternative spellings/phrases, any one of which counts as the item being present. */
  alternatives: string[];
}

/**
 * Template and checklist conformance: every required checklist item must be present in the document.
 * Presence is a case-insensitive substring match on any alternative. This is deliberately literal, so
 * a document cannot pass by being merely similar in meaning (L1: no inference).
 */
export function checkTemplateConformance(text: string, items: ChecklistItem[]): DocCheckResult {
  const haystack = text.toLowerCase();
  const findings: DocFinding[] = [];
  for (const item of items) {
    const present = item.alternatives.some((a) => haystack.includes(a.toLowerCase()));
    if (!present) findings.push({ where: item.key, detail: `required item "${item.label}" is not present` });
  }
  return {
    rule: 'Template and Checklist Conformance',
    passed: findings.length === 0,
    message: findings.length === 0
      ? `All ${items.length} required checklist items are present`
      : `${findings.length} of ${items.length} required checklist items are missing`,
    findings,
  };
}

/**
 * The complete §13.1 rule-based review, deterministic and ordered. The text-based checks from
 * `analytics.runDocumentReview` are prepended by the caller so this module stays free of that import.
 */
export function runStructuralReview(
  text: string, facts: SampleRowFact[] = [], checklist: ChecklistItem[] = []
): DocCheckResult[] {
  const results = [crossFootTables(text), inconsistentFigures(text)];
  if (facts.length > 0) results.push(matchFactsToSampleRows(text, facts));
  if (checklist.length > 0) results.push(checkTemplateConformance(text, checklist));
  return results;
}
