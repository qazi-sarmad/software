/**
 * D9 — Assurance over assurance (docs/ASSURANCE-RULEBOOKS.md §4, F125).
 *
 * Measures the audit function itself against the IIA Global Internal Audit Standards (2024), and
 * produces the evidence an External Quality Assessment reviewer would request. The standard numbers
 * are taken from `docs/iia-standards-reference.md` (verified against the IIA's condensed 2024 text);
 * we use the numbers and never paraphrase the wording.
 *
 * Bad path (the rulebook's own test): a metric whose input is missing is reported "unknown", NEVER 0.
 *
 * Pure (L4): every input is an argument (including `asOf`); no clock, no client, no model.
 */

export interface AssuranceMetric {
  metricId: string;
  /** The IIA standard number the metric grounds in, e.g. "12.2". */
  standard: string;
  label: string;
  /** The measured value, or null when the input is missing (→ "unknown"). */
  value: number | null;
  evidenceRef: string | null;
}

export interface AssuranceMetricInput {
  metrics: AssuranceMetric[];
  asOf: string;
}

export type MetricState = 'measured' | 'unknown';

export interface AssuranceMetricRow {
  metricId: string;
  standard: string;
  label: string;
  state: MetricState;
  value: number | null;
  evidenceRef: string | null;
  reason: string;
}

export interface AssuranceOverAssuranceResult {
  rows: AssuranceMetricRow[];
  measured: number;
  unknown: number;
  /** The standards the product knows it can ground a metric in (from the reference file). */
  standards: string[];
  /** True only when every metric has a value — an unknown metric is not a pass. */
  complete: boolean;
  asOf: string;
}

/**
 * The IIA 2024 standards D9 grounds in (docs/ASSURANCE-RULEBOOKS.md §4). Structure only: the numbers
 * and their titles, never the wording.
 */
export const IIA_STANDARDS: { standard: string; title: string }[] = [
  { standard: '8.3', title: 'Quality' },
  { standard: '8.4', title: 'External Quality Assessment' },
  { standard: '12.1', title: 'Internal Quality Assessment' },
  { standard: '12.2', title: 'Performance Measurement' },
  { standard: '12.3', title: 'Oversee and Improve Engagement Performance' },
  { standard: '13.1', title: 'Engagement communication' },
  { standard: '13.2', title: 'Engagement risk assessment' },
  { standard: '13.3', title: 'Engagement objectives and scope' },
  { standard: '13.4', title: 'Engagement criteria' },
  { standard: '13.5', title: 'Engagement resources' },
  { standard: '13.6', title: 'Engagement work program' },
  { standard: '14.1', title: 'Gathering information' },
  { standard: '14.2', title: 'Analyses' },
  { standard: '14.3', title: 'Evaluation of findings' },
  { standard: '14.4', title: 'Recommendations' },
  { standard: '14.5', title: 'Conclusions' },
  { standard: '14.6', title: 'Documentation' },
  { standard: '15.1', title: 'Final communication' },
  { standard: '15.2', title: 'Confirming implementation' },
];

/**
 * Measure each metric. A metric with `value === null` is "unknown" — reported as such, never turned
 * into 0 and never counted as a pass. A measured metric names its evidence reference.
 */
export function assuranceOverAssurance(input: AssuranceMetricInput): AssuranceOverAssuranceResult {
  const rows: AssuranceMetricRow[] = input.metrics.map((m) => {
    if (m.value == null) {
      return {
        metricId: m.metricId, standard: m.standard, label: m.label, state: 'unknown',
        value: null, evidenceRef: m.evidenceRef,
        reason: `metric ${m.metricId} (IIA ${m.standard}) has no input, so it is unknown — not zero`,
      };
    }
    return {
      metricId: m.metricId, standard: m.standard, label: m.label, state: 'measured',
      value: m.value, evidenceRef: m.evidenceRef,
      reason: `metric ${m.metricId} (IIA ${m.standard}) measured ${m.value}${m.evidenceRef ? `, evidence ${m.evidenceRef}` : ', with no evidence reference'}`,
    };
  });
  const measured = rows.filter((r) => r.state === 'measured').length;
  const unknown = rows.length - measured;
  return {
    rows, measured, unknown,
    standards: IIA_STANDARDS.map((s) => s.standard),
    complete: rows.length > 0 && unknown === 0,
    asOf: input.asOf,
  };
}
