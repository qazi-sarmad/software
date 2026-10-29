/**
 * D2 — Population and evidence intelligence (docs/SYSTELIGON.md §11.1a).
 *
 * Five deterministic capabilities over a population of rows and the evidence attached to a test:
 *
 *   - population profile       — row count, value range, null density, duplicate density, period coverage
 *   - stratification suggestion — propose strata and sample sizes from the population's own shape
 *   - evidence sufficiency      — does the evidence cover the whole tested period and value, or part
 *   - evidence freshness        — evidence dated after the report, or before the period it covers
 *   - chain of custody          — who attached each item, when, and its hash, so a change is detectable
 *
 * Pure: rows, evidence and the reference day are all arguments. No clock, no client, no model. The
 * arithmetic is deterministic and every output names the rule and the row references it used.
 */

/** One population row as the app holds it: a reference and a free-form record. */
export interface PopulationRecord {
  rowRef: number | string;
  /** The monetary value of the row, in minor units (cents), when it has one. */
  amountCents?: number | null;
  /** The transaction date (ISO), when it has one. */
  date?: string | null;
  /** The account or category the row belongs to, when it has one. */
  category?: string | null;
}

export interface PopulationProfile {
  rowCount: number;
  /** Rows with an amount. */
  withAmount: number;
  totalCents: number;
  minCents: number | null;
  maxCents: number | null;
  /** mean of the amounts, rounded to the nearest cent; null when no row has an amount. */
  meanCents: number | null;
  /** Rows missing an amount (a null-density measure for the money column). */
  nullAmounts: number;
  /** Rows with no date. */
  nullDates: number;
  /** Exact duplicate rows: the same amount AND the same date AND the same category. */
  duplicateRows: number;
  /** The distinct dates span, as [earliest, latest] ISO days, or null. */
  period: [string, string] | null;
  /** Distinct categories, sorted. */
  categories: string[];
  /** Findings the profile raises on its own — anything implausible before testing starts. */
  flags: string[];
}

/**
 * Population profile. Deterministic description of the population's own shape, so anything
 * implausible (a single row, an all-null money column, every row dated the same day) is flagged
 * before testing starts.
 */
export function populationProfile(rows: PopulationRecord[]): PopulationProfile {
  const amounts = rows.map((r) => r.amountCents).filter((v): v is number => typeof v === 'number');
  const withAmount = amounts.length;
  const totalCents = amounts.reduce((a, b) => a + b, 0);
  const dates = rows.map((r) => r.date).filter((d): d is string => !!d).map((d) => d.slice(0, 10)).sort();
  const categories = [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c))].sort();

  const seen = new Set<string>();
  let duplicateRows = 0;
  for (const r of rows) {
    const key = `${r.amountCents ?? 'null'}|${r.date?.slice(0, 10) ?? 'null'}|${r.category ?? 'null'}`;
    if (seen.has(key)) duplicateRows++;
    else seen.add(key);
  }

  const flags: string[] = [];
  if (rows.length === 0) flags.push('empty_population');
  if (rows.length > 0 && withAmount === 0) flags.push('no_amounts');
  if (rows.length > 0 && withAmount < rows.length) flags.push('null_amounts');
  if (dates.length > 0 && new Set(dates).size === 1) flags.push('single_date');
  if (duplicateRows > 0) flags.push('duplicates');

  return {
    rowCount: rows.length,
    withAmount,
    totalCents,
    minCents: withAmount ? Math.min(...amounts) : null,
    maxCents: withAmount ? Math.max(...amounts) : null,
    meanCents: withAmount ? Math.round(totalCents / withAmount) : null,
    nullAmounts: rows.length - withAmount,
    nullDates: rows.length - dates.length,
    duplicateRows,
    period: dates.length ? [dates[0], dates[dates.length - 1]] : null,
    categories,
    flags,
  };
}

export interface Stratum {
  /** The key that identifies the stratum (a category, or a value band label). */
  key: string;
  label: string;
  /** Rows in this stratum. */
  population: number;
  /** The suggested sample size for this stratum. */
  sample: number;
  /** The stratum's total value in cents, when amounts are present. */
  totalCents: number;
}

/**
 * Stratification suggestion. The rule is explicit and deterministic: group by category when the
 * population has one, else band by value into deciles of the value range. Each stratum's sample is
 * the ceiling of its share of the population times the requested total sample, floored at one, so a
 * small stratum is never left untested. The sample is never larger than the stratum.
 */
export function stratificationSuggestion(rows: PopulationRecord[], totalSample: number): Stratum[] {
  if (rows.length === 0) return [];
  const byCategory = rows.some((r) => !!r.category);
  const groups = new Map<string, PopulationRecord[]>();
  if (byCategory) {
    for (const r of rows) {
      const key = r.category ?? '(none)';
      const list = groups.get(key);
      if (list) list.push(r);
      else groups.set(key, [r]);
    }
  } else {
    const amounts = rows.map((r) => r.amountCents ?? 0).sort((a, b) => a - b);
    const min = amounts[0];
    const max = amounts[amounts.length - 1];
    const span = Math.max(1, max - min);
    for (const r of rows) {
      const decile = Math.min(9, Math.floor((((r.amountCents ?? 0) - min) / span) * 10));
      const key = `band-${decile}`;
      const list = groups.get(key);
      if (list) list.push(r);
      else groups.set(key, [r]);
    }
  }

  const strata: Stratum[] = [];
  for (const [key, members] of groups) {
    const share = members.length / rows.length;
    const sample = Math.min(members.length, Math.max(1, Math.ceil(share * totalSample)));
    strata.push({
      key,
      label: key,
      population: members.length,
      sample,
      totalCents: members.reduce((a, r) => a + (r.amountCents ?? 0), 0),
    });
  }
  // Largest population first, then by key, so two runs agree.
  return strata.sort((a, b) => b.population - a.population || a.key.localeCompare(b.key));
}

export interface EvidenceItem {
  id: string;
  name: string;
  /** When the evidence was attached (ISO). */
  attachedAt: string;
  attachedBy: string;
  sha256: string;
  /** The period the evidence purports to cover, when stated. */
  coversFrom?: string | null;
  coversTo?: string | null;
}

export interface EvidenceSufficiencyInput {
  items: EvidenceItem[];
  /** The period the test covers, as [from, to] ISO days. */
  period: [string, string];
  /** The total population value the evidence should account for, in cents, when known. */
  populationTotalCents?: number;
  /** The value the attached evidence accounts for, in cents, when known. */
  coveredCents?: number;
}

export interface EvidenceSufficiency {
  itemCount: number;
  /** True when at least one item covers the whole period. */
  coversPeriod: boolean;
  /** The uncovered stretches of the period, as [from, to] ISO days. */
  uncovered: Array<[string, string]>;
  /** True when the value the evidence accounts for reaches the population total. */
  coversValue: boolean;
  /** The fraction of value covered, 0..1, or null when value is not known. */
  valueFraction: number | null;
  /** True when the evidence is sufficient on both the period and the value axis. */
  sufficient: boolean;
  reasons: string[];
}

/** True when `[aFrom,aTo]` fully contains `[bFrom,bTo]` (inclusive, ISO day compare). */
function covers(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom <= bFrom && aTo >= bTo;
}

/**
 * Evidence sufficiency. Deterministic date arithmetic: does the evidence cover the whole tested
 * period and the whole tested value, or only part of it? The uncovered stretches are named, not
 * summarised, so the gap can be closed.
 */
export function evidenceSufficiency(input: EvidenceSufficiencyInput): EvidenceSufficiency {
  const [pFrom, pTo] = input.period;
  const withCover = input.items.filter((i) => i.coversFrom && i.coversTo);
  const coversPeriod = withCover.some((i) => covers(i.coversFrom as string, i.coversTo as string, pFrom, pTo));

  // Uncovered stretches: walk the days covered by any item, then name the gaps.
  const coveredDays = new Set<string>();
  for (const i of withCover) {
    const from = (i.coversFrom as string).slice(0, 10);
    const to = (i.coversTo as string).slice(0, 10);
    for (let d = from; d <= to; d = nextDay(d)) coveredDays.add(d);
  }
  const uncovered: Array<[string, string]> = [];
  if (withCover.length > 0) {
    let runStart: string | null = null;
    for (let d = pFrom; d <= pTo; d = nextDay(d)) {
      const isCovered = coveredDays.has(d);
      if (!isCovered && runStart === null) runStart = d;
      if (isCovered && runStart !== null) {
        uncovered.push([runStart, prevDay(d)]);
        runStart = null;
      }
    }
    if (runStart !== null) uncovered.push([runStart, pTo]);
  } else if (input.items.length === 0) {
    uncovered.push([pFrom, pTo]);
  }

  let valueFraction: number | null = null;
  let coversValue = false;
  if (typeof input.populationTotalCents === 'number' && input.populationTotalCents > 0 && typeof input.coveredCents === 'number') {
    valueFraction = Math.min(1, input.coveredCents / input.populationTotalCents);
    coversValue = input.coveredCents >= input.populationTotalCents;
  }

  const reasons: string[] = [];
  if (input.items.length === 0) reasons.push('no_evidence');
  else if (!coversPeriod) reasons.push('period_not_covered');
  if (valueFraction !== null && !coversValue) reasons.push('value_not_covered');

  return {
    itemCount: input.items.length,
    coversPeriod,
    uncovered,
    coversValue,
    valueFraction,
    sufficient: input.items.length > 0 && coversPeriod && (valueFraction === null || coversValue),
    reasons,
  };
}

/** Next ISO day. Pure string arithmetic on the date part. */
export function nextDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Previous ISO day. */
export function prevDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface FreshnessFinding {
  id: string;
  name: string;
  issue: 'after_report' | 'before_period';
  detail: string;
}

export interface EvidenceFreshnessInput {
  items: EvidenceItem[];
  /** The day the report is dated (ISO). */
  reportDate: string;
  /** The period the evidence purports to cover, as [from, to] ISO days. */
  period: [string, string];
}

/**
 * Evidence freshness. Two deterministic checks: evidence attached AFTER the report date (the report
 * cannot cite what did not exist when it was written), and evidence whose stated cover ENDS before
 * the period it purports to cover starts (a stale document presented as current).
 */
export function evidenceFreshness(input: EvidenceFreshnessInput): FreshnessFinding[] {
  const [pFrom] = input.period;
  const findings: FreshnessFinding[] = [];
  for (const i of input.items) {
    const attached = i.attachedAt.slice(0, 10);
    if (attached > input.reportDate.slice(0, 10)) {
      findings.push({
        id: i.id,
        name: i.name,
        issue: 'after_report',
        detail: `Attached ${attached}, after the report date ${input.reportDate.slice(0, 10)}.`,
      });
    }
    if (i.coversTo && i.coversTo.slice(0, 10) < pFrom.slice(0, 10)) {
      findings.push({
        id: i.id,
        name: i.name,
        issue: 'before_period',
        detail: `Covers to ${i.coversTo.slice(0, 10)}, before the period starts ${pFrom.slice(0, 10)}.`,
      });
    }
  }
  return findings.sort((a, b) => a.id.localeCompare(b.id));
}

export interface CustodyEntry {
  id: string;
  name: string;
  attachedBy: string;
  attachedAt: string;
  sha256: string;
  /** True when the sha256 is a well-formed 64-hex string. */
  hashWellFormed: boolean;
}

export interface ChainOfCustody {
  entries: CustodyEntry[];
  /** True when every item carries a well-formed hash and an attacher. */
  complete: boolean;
  /** Ids that break the chain (no attacher or a malformed hash). */
  broken: string[];
}

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * Chain of custody. Every evidence item carries who attached it, when, and its hash, so any later
 * change is detectable. This reports the chain as it stands; the detection itself is the hash
 * comparison the evidence verification already performs.
 */
export function chainOfCustody(items: EvidenceItem[]): ChainOfCustody {
  const entries: CustodyEntry[] = items
    .map((i) => ({
      id: i.id,
      name: i.name,
      attachedBy: i.attachedBy,
      attachedAt: i.attachedAt,
      sha256: i.sha256,
      hashWellFormed: HEX64.test(i.sha256),
    }))
    .sort((a, b) => a.attachedAt.localeCompare(b.attachedAt) || a.id.localeCompare(b.id));
  const broken = entries.filter((e) => !e.hashWellFormed || !e.attachedBy).map((e) => e.id);
  return { entries, complete: broken.length === 0, broken };
}
