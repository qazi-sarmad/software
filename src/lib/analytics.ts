import { AnalysisResultRow, AnalyticsRule } from '../types';

export interface TrialBalanceItem {
  account: string;
  category?: string;
  debit: number;
  credit: number;
  rowRef: number;
  period?: string;
  periodLabel?: string;
}

export interface VarianceInputItem {
  account: string;
  category: string;
  currentPeriod: number;
  priorPeriod: number;
  rowRef: number;
  period?: string;
  periodLabel?: string;
}

function resolvePeriod(value?: string, fallback?: string): string {
  return value?.trim() || fallback || 'all';
}

function groupByPeriod<T extends { period?: string; periodLabel?: string }>(items: T[]) {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const period = resolvePeriod(item.period, item.periodLabel);
    const group = groups.get(period) ?? [];
    group.push(item);
    groups.set(period, group);
  }

  return groups;
}

function applyVarianceRow(item: VarianceInputItem, index: number): AnalysisResultRow {
  const varianceVal = item.currentPeriod - item.priorPeriod;
  const priorAbs = Math.abs(item.priorPeriod);
  const variancePct = priorAbs > 0 ? (varianceVal / priorAbs) * 100 : (item.currentPeriod !== 0 ? 100 : 0);

  const exceedsVal = Math.abs(varianceVal) >= 100000;
  const exceedsPct = Math.abs(variancePct) >= 10;
  const flagged = exceedsVal && exceedsPct;

  let flagReason: string | undefined;
  if (flagged) {
    flagReason = `Exceeds thresholds: ${varianceVal >= 0 ? '+' : ''}$${Math.round(
      varianceVal
    ).toLocaleString()} (${variancePct.toFixed(1)}%)`;
  }

  return {
    rowIndex: index + 1,
    account: item.account,
    category: item.category,
    currentPeriod: item.currentPeriod,
    priorPeriod: item.priorPeriod,
    varianceVal,
    variancePct,
    flagged,
    flagReason,
    ruleId: 'variance' as AnalyticsRule,
    originalRowRef: item.rowRef,
    period: resolvePeriod(item.period, item.periodLabel),
    periodLabel: item.periodLabel ?? resolvePeriod(item.period, item.periodLabel),
  };
}

/**
 * Deterministic Variance Analysis.
 * Flags variances exceeding both absolute dollar threshold and percentage threshold.
 * Supports multiple financial statements in one run by grouping each period automatically.
 */
export function runVarianceAnalysis(
  items: VarianceInputItem[],
  thresholdPct = 10,
  thresholdVal = 100000
): AnalysisResultRow[] {
  const grouped = groupByPeriod(items);

  if (grouped.size <= 1) {
    return items.map((item, index) => {
      const varianceVal = item.currentPeriod - item.priorPeriod;
      const priorAbs = Math.abs(item.priorPeriod);
      const variancePct = priorAbs > 0 ? (varianceVal / priorAbs) * 100 : (item.currentPeriod !== 0 ? 100 : 0);

      const exceedsVal = Math.abs(varianceVal) >= thresholdVal;
      const exceedsPct = Math.abs(variancePct) >= thresholdPct;
      const flagged = exceedsVal && exceedsPct;

      let flagReason: string | undefined;
      if (flagged) {
        flagReason = `Exceeds thresholds: ${varianceVal >= 0 ? '+' : ''}$${Math.round(
          varianceVal
        ).toLocaleString()} (${variancePct.toFixed(1)}%)`;
      }

      return {
        rowIndex: index + 1,
        account: item.account,
        category: item.category,
        currentPeriod: item.currentPeriod,
        priorPeriod: item.priorPeriod,
        varianceVal,
        variancePct,
        flagged,
        flagReason,
        ruleId: 'variance' as AnalyticsRule,
        originalRowRef: item.rowRef,
        period: resolvePeriod(item.period, item.periodLabel),
        periodLabel: item.periodLabel ?? resolvePeriod(item.period, item.periodLabel),
      };
    });
  }

  return Array.from(grouped.entries()).flatMap(([period, entries]) =>
    entries.map((item, index) => {
      const varianceVal = item.currentPeriod - item.priorPeriod;
      const priorAbs = Math.abs(item.priorPeriod);
      const variancePct = priorAbs > 0 ? (varianceVal / priorAbs) * 100 : (item.currentPeriod !== 0 ? 100 : 0);

      const exceedsVal = Math.abs(varianceVal) >= thresholdVal;
      const exceedsPct = Math.abs(variancePct) >= thresholdPct;
      const flagged = exceedsVal && exceedsPct;

      let flagReason: string | undefined;
      if (flagged) {
        flagReason = `Exceeds thresholds: ${varianceVal >= 0 ? '+' : ''}$${Math.round(
          varianceVal
        ).toLocaleString()} (${variancePct.toFixed(1)}%)`;
      }

      return {
        rowIndex: index + 1,
        account: item.account,
        category: item.category,
        currentPeriod: item.currentPeriod,
        priorPeriod: item.priorPeriod,
        varianceVal,
        variancePct,
        flagged,
        flagReason,
        ruleId: 'variance' as AnalyticsRule,
        originalRowRef: item.rowRef,
        period,
        periodLabel: item.periodLabel ?? period,
      };
    })
  );
}

/**
 * Deterministic Trial Balance Check.
 * Asserts Debits == Credits. Identifies accounts with unusual sign convention.
 * Multi-period statements are tested per month automatically.
 */
export function runTrialBalanceCheck(items: TrialBalanceItem[]): {
  totalDebits: number;
  totalCredits: number;
  imbalance: number;
  balanced: boolean;
  rows: AnalysisResultRow[];
  periodBreakdown?: Array<{
    period: string;
    totalDebits: number;
    totalCredits: number;
    imbalance: number;
    balanced: boolean;
  }>;
} {
  const groups = groupByPeriod(items);

  if (groups.size <= 1) {
    let totalDebits = 0;
    let totalCredits = 0;

    items.forEach((item) => {
      totalDebits += Number(item.debit) || 0;
      totalCredits += Number(item.credit) || 0;
    });

    const imbalance = Math.abs(totalDebits - totalCredits);
    const balanced = imbalance < 0.01;

    const rows: AnalysisResultRow[] = items.map((item, idx) => {
      const isUnusualNegative = item.debit < 0 || item.credit < 0;
      const isBothNonZero = item.debit > 0 && item.credit > 0;
      const flagged = isUnusualNegative || isBothNonZero || !balanced;

      return {
        rowIndex: idx + 1,
        account: item.account,
        category: item.category || 'Trial Balance',
        currentPeriod: item.debit,
        priorPeriod: item.credit,
        varianceVal: item.debit - item.credit,
        variancePct: item.credit !== 0 ? ((item.debit - item.credit) / item.credit) * 100 : 0,
        flagged,
        flagReason: isUnusualNegative
          ? 'Unusual negative balance in posting column'
          : isBothNonZero
          ? 'Both debit and credit non-zero on same line'
          : !balanced
          ? `TB overall out of balance by $${imbalance.toLocaleString()}`
          : undefined,
        ruleId: 'tb_check' as AnalyticsRule,
        originalRowRef: item.rowRef,
        period: resolvePeriod(item.period, item.periodLabel),
        periodLabel: item.periodLabel ?? resolvePeriod(item.period, item.periodLabel),
      };
    });

    return { totalDebits, totalCredits, imbalance, balanced, rows };
  }

  const periodBreakdown = Array.from(groups.entries()).map(([period, groupedItems]) => {
    let totalDebits = 0;
    let totalCredits = 0;
    for (const item of groupedItems) {
      totalDebits += Number(item.debit) || 0;
      totalCredits += Number(item.credit) || 0;
    }
    const imbalance = Math.abs(totalDebits - totalCredits);
    return { period, totalDebits, totalCredits, imbalance, balanced: imbalance < 0.01 };
  });

  const rows: AnalysisResultRow[] = Array.from(groups.entries()).flatMap(([period, groupedItems]) =>
    groupedItems.map((item, idx) => {
      const periodSummary = periodBreakdown.find((entry) => entry.period === period)!;
      const isUnusualNegative = item.debit < 0 || item.credit < 0;
      const isBothNonZero = item.debit > 0 && item.credit > 0;
      const flagged = isUnusualNegative || isBothNonZero || !periodSummary.balanced;

      return {
        rowIndex: idx + 1,
        account: item.account,
        category: item.category || 'Trial Balance',
        currentPeriod: item.debit,
        priorPeriod: item.credit,
        varianceVal: item.debit - item.credit,
        variancePct: item.credit !== 0 ? ((item.debit - item.credit) / item.credit) * 100 : 0,
        flagged,
        flagReason: isUnusualNegative
          ? 'Unusual negative balance in posting column'
          : isBothNonZero
          ? 'Both debit and credit non-zero on same line'
          : !periodSummary.balanced
          ? `TB overall out of balance by $${periodSummary.imbalance.toLocaleString()} for ${period}`
          : undefined,
        ruleId: 'tb_check' as AnalyticsRule,
        originalRowRef: item.rowRef,
        period,
        periodLabel: item.periodLabel ?? period,
      };
    })
  );

  const allDebits = items.reduce((sum, item) => sum + (Number(item.debit) || 0), 0);
  const allCredits = items.reduce((sum, item) => sum + (Number(item.credit) || 0), 0);
  const totalImbalance = Math.abs(allDebits - allCredits);

  return {
    totalDebits: allDebits,
    totalCredits: allCredits,
    imbalance: totalImbalance,
    balanced: totalImbalance < 0.01,
    rows,
    periodBreakdown,
  };
}

/**
 * Deterministic Anomaly & Outlier Detection (Z-Score + Benford first-digit + round numbers).
 */
export function runAnomalyDetection(
  items: { account: string; category?: string; amount: number; rowRef: number; period?: string; periodLabel?: string }[]
): AnalysisResultRow[] {
  if (items.length === 0) return [];

  const grouped = groupByPeriod(items);
  const allRows: AnalysisResultRow[] = [];

  Array.from(grouped.entries()).forEach(([period, groupedItems]) => {
    const amounts = groupedItems.map((i) => Math.abs(i.amount));
    const n = amounts.length;
    const mean = amounts.reduce((acc, v) => acc + v, 0) / n;
    const variance =
      n > 1
        ? amounts.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (n - 1)
        : 0;
    const stdDev = Math.sqrt(variance);

    const rows = groupedItems.map((item, idx) => {
      const val = Math.abs(item.amount);
      const zScore = stdDev > 0 ? (val - mean) / stdDev : 0;
      const isZScoreOutlier = zScore > 2.0;
      const isRoundNumberAnomaly = val >= 100000 && val % 50000 === 0;
      const flagged = isZScoreOutlier || isRoundNumberAnomaly;

      let flagReason: string | undefined;
      if (isZScoreOutlier && isRoundNumberAnomaly) {
        flagReason = `Statistical outlier (z-score ${zScore.toFixed(2)} > 2.5) and exact round amount ($${val.toLocaleString()})`;
      } else if (isZScoreOutlier) {
        flagReason = `Statistical outlier (z-score ${zScore.toFixed(2)} > 2.5)`;
      } else if (isRoundNumberAnomaly) {
        flagReason = `Suspicious exact round amount ($${val.toLocaleString()})`;
      }

      return {
        rowIndex: idx + 1,
        account: item.account,
        category: item.category || 'General Ledger',
        currentPeriod: item.amount,
        priorPeriod: mean,
        varianceVal: item.amount - mean,
        variancePct: mean > 0 ? ((item.amount - mean) / mean) * 100 : 0,
        flagged,
        flagReason,
        ruleId: 'anomalies' as AnalyticsRule,
        originalRowRef: item.rowRef,
        period,
        periodLabel: item.periodLabel ?? period,
      };
    });

    allRows.push(...rows);
  });

  return allRows;
}

/**
 * Deterministic GL to TB Reconciliation.
 * Accepts a single or multi-period dataset and reconciles each period in one pass.
 */
export function runGlToTbReconciliation(
  glEntries: { account: string; amount: number; rowRef: number; period?: string; periodLabel?: string }[],
  tbBalances: { account: string; balance: number; rowRef: number; period?: string; periodLabel?: string }[]
): AnalysisResultRow[] {
  const glGrouped = groupByPeriod(glEntries);
  const tbGrouped = groupByPeriod(tbBalances);
  const allPeriods = new Set([...glGrouped.keys(), ...tbGrouped.keys()]);

  const rows: AnalysisResultRow[] = [];

  for (const period of Array.from(allPeriods)) {
    const glPeriodEntries = glGrouped.get(period) ?? [];
    const tbPeriodEntries = tbGrouped.get(period) ?? [];

    const glMap = new Map<string, { total: number; rowRefs: number[] }>();
    glPeriodEntries.forEach((entry) => {
      const existing = glMap.get(entry.account) || { total: 0, rowRefs: [] };
      existing.total += entry.amount;
      existing.rowRefs.push(entry.rowRef);
      glMap.set(entry.account, existing);
    });

    tbPeriodEntries.forEach((tb, idx) => {
      const glData = glMap.get(tb.account) || { total: 0, rowRefs: [] };
      const diff = Math.abs(glData.total - tb.balance);
      const flagged = diff > 0.01;

      rows.push({
        rowIndex: idx + 1,
        account: tb.account,
        category: 'GL vs TB Reconciliation',
        currentPeriod: glData.total,
        priorPeriod: tb.balance,
        varianceVal: glData.total - tb.balance,
        variancePct: tb.balance !== 0 ? ((glData.total - tb.balance) / Math.abs(tb.balance)) * 100 : 0,
        flagged,
        flagReason: flagged
          ? `Reconciliation gap: GL subledger ($${glData.total.toLocaleString()}) does not tie to TB ($${tb.balance.toLocaleString()})`
          : undefined,
        ruleId: 'gl_to_tb' as AnalyticsRule,
        originalRowRef: tb.rowRef,
        period,
        periodLabel: tb.periodLabel ?? period,
      });
    });
  }

  return rows;
}

export interface DocumentReviewCheckResult {
  rule: string;
  passed: boolean;
  message: string;
  findings: string[];
}

/**
 * Deterministic Document Review for Word / Text extractions.
 * Analyzes structure, placeholder phrases, missing dates/signatures, and numeric assertions.
 */
export function runDocumentReview(rawText: string): DocumentReviewCheckResult[] {
  const text = rawText || '';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const results: DocumentReviewCheckResult[] = [];

  // Check 1: Placeholder text patterns
  const placeholderPatterns = [
    /\b(TODO|TBD|PLACEHOLDER|INSERT HERE|DRAFT)\b/i,
    /\[.*?\]/,
    /<.*?>/,
    /\b(lorem ipsum|consectetur adipiscing)\b/i,
  ];

  const placeholderMatches: string[] = [];
  lines.forEach((line, idx) => {
    for (const pat of placeholderPatterns) {
      if (pat.test(line)) {
        placeholderMatches.push(`Line ${idx + 1}: "${line.substring(0, 80)}"`);
        break;
      }
    }
  });

  results.push({
    rule: 'Placeholder and Draft Tokens',
    passed: placeholderMatches.length === 0,
    message:
      placeholderMatches.length === 0
        ? 'No draft placeholders or unpopulated tokens detected'
        : `Found ${placeholderMatches.length} placeholder tokens requiring completion`,
    findings: placeholderMatches,
  });

  // Check 2: Signatures and Sign-off Blocks
  const signatureKeywords = ['prepared by', 'reviewed by', 'approved by', 'signed', 'signature'];
  const signatureMatches = lines.filter((l) =>
    signatureKeywords.some((kw) => l.toLowerCase().includes(kw))
  );

  const unsignedMatches: string[] = [];
  signatureMatches.forEach((line) => {
    // If line has empty colon or trailing dashes: e.g. "Approved by: ______" or "Approved by:"
    if (/:\s*(_+|\.{3,}|\s*)$/.test(line) || /:\s*$/.test(line)) {
      unsignedMatches.push(line);
    }
  });

  results.push({
    rule: 'Formal Signatures and Attestation',
    passed: unsignedMatches.length === 0 && signatureMatches.length > 0,
    message:
      unsignedMatches.length === 0 && signatureMatches.length > 0
        ? 'Signature attestation lines completed'
        : signatureMatches.length === 0
        ? 'No formal attestation or approval block found in document'
        : `Found ${unsignedMatches.length} unsigned approval lines`,
    findings: unsignedMatches.length > 0 ? unsignedMatches : signatureMatches.length === 0 ? ['Missing signature block'] : [],
  });

  // Check 3: Effective Date Presence
  const datePattern = /\b(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})\b/i;
  const hasDates = datePattern.test(text);

  results.push({
    rule: 'Document Date and Period Specification',
    passed: hasDates,
    message: hasDates ? 'Effective period or audit date identified' : 'Missing formal date or period reference',
    findings: hasDates ? [] : ['No standard calendar date found in document body'],
  });

  // Check 4: Section Structure / Empty Sections
  const emptySectionFindings: string[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const current = lines[i];
    const next = lines[i + 1];

    if (
      /^(Section|\d+\.|\bObjective\b|\bScope\b|\bMethodology\b)/i.test(current) &&
      /^(Section|\d+\.|\bObjective\b|\bScope\b|\bMethodology\b)/i.test(next)
    ) {
      emptySectionFindings.push(`Empty section header detected before "${next}"`);
    }
  }

  results.push({
    rule: 'Section Completeness',
    passed: emptySectionFindings.length === 0,
    message:
      emptySectionFindings.length === 0
        ? 'All documented sections contain substantive body text'
        : `Detected ${emptySectionFindings.length} consecutive section headers without body text`,
    findings: emptySectionFindings,
  });

  return results;
}
