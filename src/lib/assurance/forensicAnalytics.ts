/**
 * D7 — Population-level forensic analytics (docs/ASSURANCE-RULEBOOKS.md §2, F123).
 *
 * Runs the classic forensic checks over a WHOLE population (not a sample), wraps them as named,
 * versioned rules, and adds the AS 2401 journal-entry family and Benford's second digit. Every rule
 * cites its source. Where the source publishes no number we do not invent one.
 *
 * Sources (verified in docs/ASSURANCE-RULEBOOKS.md §2):
 *   - Benford's Law — first- and second-digit expected distributions, chi-square/MAD conformity.
 *   - PCAOB AS 2401 / AU-C 240 — testing journal entries: unusual/unrelated accounts, entries by
 *     individuals who do not normally make them, unusual times, round numbers, back-dated or posted
 *     to a closed period, entries lacking a description.
 *   - ISA 530 / AU-C 530 — audit sampling; a sample can never exceed its population.
 *   - The classic forensic set already in `analyticsEngine.ts`.
 *
 * Pure (L4): the population and the rules are arguments; the engine reads no clock. Deterministic
 * arithmetic only, and every result names the rows it flagged.
 */
import type { CheckResult, PopulationEntry } from '../analyticsEngine';
import {
  checkDuplicates,
  checkNearDuplicates,
  checkSequenceGaps,
  checkOutliersZScore,
  checkOutliersIqr,
  checkBenfordFirstDigit,
  checkRoundNumbers,
  checkWeekendPostings,
  checkSameUserCreateApprove,
  checkMissingAttributes,
} from '../analyticsEngine';

export interface ForensicRule {
  ruleId: string;
  ruleVersion: number;
  /** The engine check this rule wraps, when it wraps one of the classic checks. */
  checkId?: string;
  /** A short description, in our own words. */
  description: string;
  /** The verified source this rule cites. */
  source: string;
}

export interface ForensicRuleResult {
  ruleId: string;
  ruleVersion: number;
  checkId: string;
  source: string;
  reason: string;
  flaggedCount: number;
  rowRefs: number[];
}

/** The named, versioned rule pack. Each rule cites its source; nothing is invented. */
export const FORENSIC_RULES: ForensicRule[] = [
  { ruleId: 'forensic.duplicates', ruleVersion: 1, checkId: 'duplicates', description: 'exactly duplicated rows in the population', source: 'ISA 530 — population completeness' },
  { ruleId: 'forensic.near_duplicates', ruleVersion: 1, checkId: 'near_duplicates', description: 'rows whose full attribute set nearly matches another', source: 'PCAOB AS 2401 — journal-entry testing' },
  { ruleId: 'forensic.sequence_gaps', ruleVersion: 1, checkId: 'sequence_gaps', description: 'gaps in a sequential identifier', source: 'PCAOB AS 2401 — completeness of entries' },
  { ruleId: 'forensic.outliers_zscore', ruleVersion: 1, checkId: 'outliers_zscore', description: 'amounts more than three standard deviations from the mean', source: 'PCAOB AS 2401 — unusual entries' },
  { ruleId: 'forensic.outliers_iqr', ruleVersion: 1, checkId: 'outliers_iqr', description: 'amounts outside 1.5× the interquartile range', source: 'PCAOB AS 2401 — unusual entries' },
  { ruleId: 'forensic.benford_first_digit', ruleVersion: 1, checkId: 'benford_first_digit', description: 'first-digit distribution against Benford', source: "Benford's Law (first digit)" },
  { ruleId: 'forensic.benford_second_digit', ruleVersion: 1, description: 'second-digit distribution against Benford', source: "Benford's Law (second digit)" },
  { ruleId: 'forensic.round_numbers', ruleVersion: 1, checkId: 'round_numbers', description: 'entries posted as round numbers', source: 'PCAOB AS 2401 — round numbers' },
  { ruleId: 'forensic.weekend_postings', ruleVersion: 1, checkId: 'weekend_postings', description: 'entries posted at unusual times (weekends)', source: 'PCAOB AS 2401 — unusual times' },
  { ruleId: 'forensic.same_user_create_approve', ruleVersion: 1, checkId: 'same_user_create_approve', description: 'entries created and approved by the same user', source: 'PCAOB AS 2401 — segregation of duties' },
  { ruleId: 'forensic.missing_attributes', ruleVersion: 1, checkId: 'missing_attributes', description: 'entries lacking a required attribute (e.g. description)', source: 'PCAOB AS 2401 — entries lacking a description' },
];

/** Benford's expected second-digit distribution (probability per digit 0..9), to 4 decimal places. */
export const BENFORD_SECOND_DIGIT: number[] = [
  0.1197, 0.1139, 0.1088, 0.1043, 0.1003, 0.0967, 0.0934, 0.0904, 0.0876, 0.0850,
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Benford second digit: the distribution of the second significant digit of each amount. Returns a
 * per-digit observed count and the expected share, plus the maximum absolute deviation (MAD). No
 * number is asserted beyond the published Benford distribution.
 */
export function checkBenfordSecondDigit(entries: PopulationEntry[]): CheckResult {
  const counts = new Array(10).fill(0) as number[];
  let total = 0;
  for (const e of entries) {
    const digits = String(Math.abs(e.amount ?? 0)).replace(/[^0-9]/g, '');
    if (digits.length >= 2) {
      const d2 = Number(digits[1]);
      counts[d2] += 1;
      total += 1;
    }
  }
  const rows = counts.map((observed, digit) => {
    const share = total === 0 ? 0 : observed / total;
    const expected = BENFORD_SECOND_DIGIT[digit];
    const deviation = Math.abs(share - expected);
    return {
      rowRef: digit,
      flagged: false,
      reason: `digit ${digit}: observed ${observed} (${round2(share * 100)}%), expected ${round2(expected * 100)}%, deviation ${round2(deviation * 100)}%`,
      details: { digit, observed, share: round2(share), expected, mad: round2(deviation) },
    };
  });
  const mad = rows.reduce((m, r) => Math.max(m, (r.details as { mad: number }).mad), 0);
  return {
    checkId: 'benford_first_digit', params: { digits: 'second', total, mad: round2(mad) }, rows,
    flaggedCount: rows.filter((r) => r.flagged).length,
  };
}

/**
 * Run the named forensic rules over a population.
 *
 * The classic checks come from `analyticsEngine`. Benford's SECOND digit is computed here (the engine
 * covers only the first). A rule whose check produces no flagged row contributes no finding. An empty
 * population yields no findings and is reported by the caller as "not clean" — an empty population is
 * unknown, not clean (the D7 bad path).
 */
export function runForensicRules(entries: PopulationEntry[], rules: ForensicRule[]): ForensicRuleResult[] {
  const results: ForensicRuleResult[] = [];
  for (const rule of rules) {
    let check: CheckResult | null = null;
    switch (rule.checkId) {
      case 'duplicates': check = checkDuplicates(entries); break;
      case 'near_duplicates': check = checkNearDuplicates(entries); break;
      case 'sequence_gaps': check = checkSequenceGaps(entries); break;
      case 'outliers_zscore': check = checkOutliersZScore(entries); break;
      case 'outliers_iqr': check = checkOutliersIqr(entries); break;
      case 'benford_first_digit': check = checkBenfordFirstDigit(entries); break;
      case 'round_numbers': check = checkRoundNumbers(entries); break;
      case 'weekend_postings': check = checkWeekendPostings(entries); break;
      case 'same_user_create_approve': check = checkSameUserCreateApprove(entries); break;
      case 'missing_attributes': check = checkMissingAttributes(entries, ['description']); break;
      default: break;
    }
    if (rule.ruleId === 'forensic.benford_second_digit') check = checkBenfordSecondDigit(entries);
    if (!check) continue;

    const flagged = check.rows.filter((r) => r.flagged);
    results.push({
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      checkId: rule.checkId ?? 'benford_second_digit',
      source: rule.source,
      reason: flagged.length
        ? `${flagged.length} row${flagged.length === 1 ? '' : 's'} matched: ${flagged[0].reason}`
        : 'no row matched the rule',
      flaggedCount: flagged.length,
      rowRefs: flagged.map((r) => r.rowRef),
    });
  }
  return results;
}

/** The D7 bad-path guard: a sample can never exceed its population (ISA 530). */
export function sampleWithinPopulation(sampleSize: number, populationSize: number): { ok: boolean; reason: string } {
  if (populationSize <= 0) return { ok: false, reason: 'the population is empty, so no sample can be drawn' };
  if (sampleSize > populationSize) {
    return { ok: false, reason: `the sample ${sampleSize} exceeds the population ${populationSize}, which ISA 530 forbids` };
  }
  return { ok: true, reason: `the sample ${sampleSize} fits within the population ${populationSize}` };
}
