/**
 * Analyst engine (spec §12). Every check is a pure, deterministic function with unit tests. No
 * randomness, no AI, no I/O. Each result row carries the row references it flagged so the UI can offer
 * "Raise finding" with the rule id, the parameters used and those references.
 *
 * This module is the Phase 4 engine. The database-side population gate, sampling and row testing live
 * in migrations 0026–0028; this file analyses the population and financial data the auditor supplies.
 */

export type AnalyticsCheckId =
  | 'duplicates'
  | 'near_duplicates'
  | 'sequence_gaps'
  | 'outliers_zscore'
  | 'outliers_iqr'
  | 'benford_first_digit'
  | 'round_numbers'
  | 'weekend_postings'
  | 'same_user_create_approve'
  | 'missing_attributes'
  | 'period_variance'
  | 'gl_to_tb'
  | 'sira_vs_planning'
  | 'controls_vs_tests';

export interface PopulationEntry {
  rowRef: number;
  amount?: number | null;
  date?: string | null; // ISO YYYY-MM-DD
  user?: string | null;
  approver?: string | null;
  /** Any other attributes the population carries, for duplicate and completeness checks. */
  attributes?: Record<string, unknown>;
}

export interface CheckRow {
  rowRef: number;
  flagged: boolean;
  reason: string;
  details?: Record<string, unknown>;
}

export interface CheckResult {
  checkId: AnalyticsCheckId;
  params: Record<string, unknown>;
  rows: CheckRow[];
  flaggedCount: number;
}

/** The payload "Raise finding" attaches to an observation (spec §12). */
export interface FindingIntent {
  ruleId: AnalyticsCheckId;
  params: Record<string, unknown>;
  rowRefs: number[];
}

function result(checkId: AnalyticsCheckId, params: Record<string, unknown>, rows: CheckRow[]): CheckResult {
  return { checkId, params, rows, flaggedCount: rows.filter((r) => r.flagged).length };
}

// ---------------------------------------------------------------------------
// Population checks
// ---------------------------------------------------------------------------

/** Exact duplicates: two rows whose full attribute set is identical. */
export function checkDuplicates(entries: PopulationEntry[]): CheckResult {
  const seen = new Map<string, number[]>();
  for (const e of entries) {
    const key = canonicalKey(e);
    const list = seen.get(key) ?? [];
    list.push(e.rowRef);
    seen.set(key, list);
  }
  const dupRefs = new Set<number>();
  for (const list of seen.values()) {
    if (list.length > 1) list.forEach((r) => dupRefs.add(r));
  }
  const rows = entries.map((e) => ({
    rowRef: e.rowRef,
    flagged: dupRefs.has(e.rowRef),
    reason: dupRefs.has(e.rowRef) ? 'Exact duplicate of another row' : 'Unique row',
  }));
  return result('duplicates', { key: 'all attributes' }, rows);
}

/** Near-duplicates: same amount and date, different user (a likely double posting). */
export function checkNearDuplicates(entries: PopulationEntry[]): CheckResult {
  const groups = new Map<string, PopulationEntry[]>();
  for (const e of entries) {
    if (e.amount == null || !e.date) continue;
    const key = `${e.amount}|${e.date}`;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  const near = new Set<number>();
  for (const list of groups.values()) {
    if (list.length > 1 && new Set(list.map((e) => e.user ?? '')).size > 1) {
      list.forEach((e) => near.add(e.rowRef));
    }
  }
  const rows = entries.map((e) => ({
    rowRef: e.rowRef,
    flagged: near.has(e.rowRef),
    reason: near.has(e.rowRef) ? 'Same amount and date as another row by a different user' : 'No near duplicate',
  }));
  return result('near_duplicates', { match: 'amount+date, different user' }, rows);
}

/**
 * Sequence gaps: a numeric sequence attribute skips a value. The caller names the attribute (default
 * "seq"). A gap is reported on the row that follows the missing value.
 */
export function checkSequenceGaps(entries: PopulationEntry[], attribute = 'seq'): CheckResult {
  const withSeq = entries
    .map((e) => ({ ref: e.rowRef, seq: Number(e.attributes?.[attribute]) }))
    .filter((x) => Number.isFinite(x.seq))
    .sort((a, b) => a.seq - b.seq);
  const gapRefs = new Set<number>();
  const details = new Map<number, number>();
  for (let i = 1; i < withSeq.length; i += 1) {
    const diff = withSeq[i].seq - withSeq[i - 1].seq;
    if (diff > 1) {
      gapRefs.add(withSeq[i].ref);
      details.set(withSeq[i].ref, diff - 1);
    }
  }
  const rows = entries.map((e) => ({
    rowRef: e.rowRef,
    flagged: gapRefs.has(e.rowRef),
    reason: gapRefs.has(e.rowRef) ? `Sequence gap: ${details.get(e.rowRef)} value(s) missing before this row` : 'In sequence',
  }));
  return result('sequence_gaps', { attribute }, rows);
}

function amountsOf(entries: PopulationEntry[]): { ref: number; amount: number }[] {
  return entries
    .filter((e) => e.amount != null && Number.isFinite(Number(e.amount)))
    .map((e) => ({ ref: e.rowRef, amount: Math.abs(Number(e.amount)) }));
}

/** Outliers by z-score. threshold defaults to 3 (spec §12 "z-score"). */
export function checkOutliersZScore(entries: PopulationEntry[], threshold = 3): CheckResult {
  const values = amountsOf(entries);
  const n = values.length;
  const mean = n > 0 ? values.reduce((a, v) => a + v.amount, 0) / n : 0;
  const variance = n > 1 ? values.reduce((a, v) => a + (v.amount - mean) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const flagged = new Map<number, number>();
  if (sd > 0) {
    for (const v of values) {
      const z = (v.amount - mean) / sd;
      if (Math.abs(z) >= threshold) flagged.set(v.ref, z);
    }
  }
  const rows = entries.map((e) => ({
    rowRef: e.rowRef,
    flagged: flagged.has(e.rowRef),
    reason: flagged.has(e.rowRef) ? `z-score ${flagged.get(e.rowRef)!.toFixed(2)} exceeds ${threshold}` : 'Within range',
    details: flagged.has(e.rowRef) ? { zScore: Number(flagged.get(e.rowRef)!.toFixed(4)) } : undefined,
  }));
  return result('outliers_zscore', { threshold, mean, sd }, rows);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (base + 1 < sorted.length) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}

/** Outliers by the 1.5×IQR fence (spec §12 "IQR"). */
export function checkOutliersIqr(entries: PopulationEntry[], k = 1.5): CheckResult {
  const sorted = amountsOf(entries).map((v) => v.amount).sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const low = q1 - k * iqr;
  const high = q3 + k * iqr;
  const flagged = new Set<number>();
  for (const v of amountsOf(entries)) if (v.amount < low || v.amount > high) flagged.add(v.ref);
  const rows = entries.map((e) => ({
    rowRef: e.rowRef,
    flagged: flagged.has(e.rowRef),
    reason: flagged.has(e.rowRef) ? `Outside the ${k}×IQR fence [${low.toFixed(2)}, ${high.toFixed(2)}]` : 'Within IQR fence',
  }));
  return result('outliers_iqr', { k, q1, q3, low, high }, rows);
}

const BENFORD_EXPECTED = [0.30103, 0.17609, 0.12494, 0.09691, 0.07918, 0.06695, 0.05799, 0.05115, 0.04576];

function firstDigit(n: number): number {
  const s = Math.abs(n).toString();
  for (const ch of s) {
    if (ch >= '1' && ch <= '9') return Number(ch);
    if (ch === '0' || ch === '.') continue;
  }
  return 0;
}

/** Benford first-digit, judged by chi-square (df=8) and by mean absolute deviation (spec §12). */
export function checkBenfordFirstDigit(
  entries: PopulationEntry[],
  madThreshold = 0.015,
  chiSquareThreshold = 15.507
): CheckResult {
  const amounts = amountsOf(entries);
  const counts = new Array(10).fill(0);
  for (const v of amounts) {
    const d = firstDigit(v.amount);
    if (d >= 1 && d <= 9) counts[d] += 1;
  }
  const n = counts.reduce((a, b) => a + b, 0);
  const observed = counts.slice(1).map((c) => (n > 0 ? c / n : 0));
  let chiSquare = 0;
  if (n > 0) {
    for (let i = 0; i < 9; i += 1) {
      const expected = BENFORD_EXPECTED[i] * n;
      chiSquare += (counts[i + 1] - expected) ** 2 / expected;
    }
  }
  const mad = n > 0 ? observed.reduce((a, o, i) => a + Math.abs(o - BENFORD_EXPECTED[i]), 0) / 9 : 0;
  const conforms = chiSquare <= chiSquareThreshold && mad <= madThreshold;
  // Benford is a distribution-level check: it is reported on every leading digit, not on rows.
  const rows: CheckRow[] = [];
  for (let d = 1; d <= 9; d += 1) {
    rows.push({
      rowRef: d,
      flagged: !conforms && observed[d - 1] > BENFORD_EXPECTED[d - 1],
      reason: `Digit ${d}: observed ${(observed[d - 1] * 100).toFixed(2)}% vs expected ${(BENFORD_EXPECTED[d - 1] * 100).toFixed(2)}%`,
      details: { digit: d, observed: observed[d - 1], expected: BENFORD_EXPECTED[d - 1] },
    });
  }
  return result(
    'benford_first_digit',
    { n, chiSquare, mad, madThreshold, chiSquareThreshold, conforms, sampleSize: amounts.length },
    rows
  );
}

/** Round-number clustering: amounts that are exact multiples of 1000, or end in many zeros. */
export function checkRoundNumbers(entries: PopulationEntry[]): CheckResult {
  const rows = entries.map((e) => {
    const a = e.amount == null ? null : Math.abs(Number(e.amount));
    let flagged = false;
    let reason = 'Not a round number';
    if (a != null && a >= 1000) {
      if (a % 100000 === 0) {
        flagged = true;
        reason = 'Exact multiple of 100,000';
      } else if (a % 10000 === 0) {
        flagged = true;
        reason = 'Exact multiple of 10,000';
      } else if (a % 1000 === 0) {
        flagged = true;
        reason = 'Exact multiple of 1,000';
      }
    }
    return { rowRef: e.rowRef, flagged, reason };
  });
  return result('round_numbers', { multiples: ['1000', '10000', '100000'] }, rows);
}

/** Weekend postings. `holidays` is an explicit ISO date list (no locale lookup, so it is testable). */
export function checkWeekendPostings(entries: PopulationEntry[], holidays: string[] = []): CheckResult {
  const holidaySet = new Set(holidays);
  const rows = entries.map((e) => {
    if (!e.date) return { rowRef: e.rowRef, flagged: false, reason: 'No date' };
    const day = new Date(`${e.date}T00:00:00Z`).getUTCDay();
    const isWeekend = day === 0 || day === 6;
    const isHoliday = holidaySet.has(e.date);
    return {
      rowRef: e.rowRef,
      flagged: isWeekend || isHoliday,
      reason: isHoliday ? 'Posted on a listed holiday' : isWeekend ? 'Posted on a weekend' : 'Posted on a business day',
    };
  });
  return result('weekend_postings', { holidays }, rows);
}

/** Same-user create and approve (segregation of duties). */
export function checkSameUserCreateApprove(entries: PopulationEntry[]): CheckResult {
  const rows = entries.map((e) => {
    const same = e.user != null && e.approver != null && e.user === e.approver;
    return {
      rowRef: e.rowRef,
      flagged: same,
      reason: same ? 'The creator and the approver are the same user' : 'Creator and approver differ or are unset',
    };
  });
  return result('same_user_create_approve', {}, rows);
}

/** Missing mandatory attributes named by the caller. */
export function checkMissingAttributes(entries: PopulationEntry[], required: string[]): CheckResult {
  const rows = entries.map((e) => {
    const missing = required.filter((attr) => {
      const value = e.attributes?.[attr];
      return value == null || (typeof value === 'string' && value.trim() === '');
    });
    return {
      rowRef: e.rowRef,
      flagged: missing.length > 0,
      reason: missing.length > 0 ? `Missing mandatory attribute(s): ${missing.join(', ')}` : 'All mandatory attributes present',
      details: missing.length > 0 ? { missing } : undefined,
    };
  });
  return result('missing_attributes', { required }, rows);
}

// ---------------------------------------------------------------------------
// Financial checks
// ---------------------------------------------------------------------------

export interface FinancialLine {
  rowRef: number;
  account: string;
  accountCode?: string;
  currentPeriod: number;
  priorPeriod: number;
}

/** Period variance with configurable percentage and absolute thresholds (spec §12). */
export function checkPeriodVariance(
  lines: FinancialLine[],
  thresholdPct = 10,
  thresholdAbs = 100000
): CheckResult {
  const rows = lines.map((l) => {
    const delta = l.currentPeriod - l.priorPeriod;
    const pct = l.priorPeriod !== 0 ? (delta / Math.abs(l.priorPeriod)) * 100 : l.currentPeriod !== 0 ? 100 : 0;
    const flagged = Math.abs(delta) >= thresholdAbs && Math.abs(pct) >= thresholdPct;
    return {
      rowRef: l.rowRef,
      flagged,
      reason: flagged
        ? `Variance ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} (${pct.toFixed(1)}%) exceeds thresholds`
        : 'Within variance thresholds',
      details: { delta, pct },
    };
  });
  return result('period_variance', { thresholdPct, thresholdAbs }, rows);
}

/** GL-to-TB reconciliation per account: the GL balance must equal the TB balance. */
export function checkGlToTb(
  gl: { rowRef: number; account: string; balance: number }[],
  tb: { account: string; balance: number }[]
): CheckResult {
  const tbByAccount = new Map(tb.map((t) => [t.account, t.balance]));
  const rows = gl.map((g) => {
    const expected = tbByAccount.get(g.account);
    const diff = expected == null ? null : Math.abs(g.balance - expected);
    const flagged = diff == null || diff >= 0.01;
    return {
      rowRef: g.rowRef,
      flagged,
      reason:
        diff == null
          ? `Account ${g.account} is not in the trial balance`
          : flagged
          ? `GL ${g.balance} vs TB ${expected} differ by ${diff.toFixed(2)}`
          : 'Reconciled',
      details: diff == null ? undefined : { diff },
    };
  });
  return result('gl_to_tb', {}, rows);
}

// ---------------------------------------------------------------------------
// Reconciliations (SIRA vs Planning; controls vs test records)
// ---------------------------------------------------------------------------

/** Every risk in the planning RCM must be present in the SIRA cycle. */
export function checkSiraVsPlanning(
  planningRisks: { rowRef: number; riskId: string }[],
  siraRiskIds: string[]
): CheckResult {
  const set = new Set(siraRiskIds);
  const rows = planningRisks.map((r) => ({
    rowRef: r.rowRef,
    flagged: !set.has(r.riskId),
    reason: set.has(r.riskId) ? 'Risk present in SIRA' : `Risk ${r.riskId} is absent from SIRA`,
    details: { riskId: r.riskId },
  }));
  return result('sira_vs_planning', { siraCount: siraRiskIds.length }, rows);
}

/** Every selected control must have at least one test record. */
export function checkControlsVsTests(
  controls: { rowRef: number; controlId: string }[],
  testedControlIds: string[]
): CheckResult {
  const set = new Set(testedControlIds);
  const rows = controls.map((c) => ({
    rowRef: c.rowRef,
    flagged: !set.has(c.controlId),
    reason: set.has(c.controlId) ? 'Control has a test record' : `Control ${c.controlId} has no test record`,
    details: { controlId: c.controlId },
  }));
  return result('controls_vs_tests', { testedCount: testedControlIds.length }, rows);
}

// ---------------------------------------------------------------------------
// Raise finding
// ---------------------------------------------------------------------------

/**
 * The intent "Raise finding" attaches to a new observation. Phase 5A's create_observation is the real
 * RPC; until it exists this records the intent so 4F is independently green (decision D-5A-STUB).
 */
export function raiseFindingIntent(check: CheckResult, rowRefs: number[]): FindingIntent {
  return { ruleId: check.checkId, params: check.params, rowRefs };
}

/** TEMPORARY (D-5A-STUB): records a finding intent for 5A's create_observation to consume. */
export interface FindingIntentSink {
  record(intent: FindingIntent): void;
}

export function createObservationStub(sink: FindingIntentSink, check: CheckResult, rowRefs: number[]): void {
  sink.record(raiseFindingIntent(check, rowRefs));
}

function canonicalKey(e: PopulationEntry): string {
  const attrs = e.attributes ?? {};
  const keys = Object.keys(attrs).sort();
  const parts = keys.map((k) => `${k}=${JSON.stringify(attrs[k])}`);
  return [e.amount ?? '', e.date ?? '', e.user ?? '', e.approver ?? '', ...parts].join('|');
}
