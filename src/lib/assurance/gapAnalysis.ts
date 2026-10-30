/**
 * D8 — Policy-to-control gap analysis (docs/ASSURANCE-RULEBOOKS.md §3, F124).
 *
 * Generalises the ISO/IEC 27001:2022 Statement of Applicability shape (obligation → control →
 * included/excluded with justification) to any regulation. A regulation is encoded as obligations;
 * each obligation maps to the controls that satisfy it; coverage is computed obligation × control →
 * covered / partially covered / gap. A gap is a finding that NAMES the policy clause.
 *
 * Bad path (the rulebook's own test): a clause that cannot be interpreted is reported as
 * could-not-interpret, NEVER as compliant.
 *
 * Pure (L4): obligations and controls are arguments; no clock, no client, no model.
 */

export type CoverageStatus = 'covered' | 'partial' | 'gap' | 'not_interpreted';

export interface GapObligation {
  obligationId: string;
  /** The policy/regulation clause the obligation is drawn from. Always named in the finding. */
  sourceClause: string;
  subject: string;
  /**
   * The controls the obligation claims to be satisfied by. `null` marks a clause that could not be
   * interpreted — its coverage is unknown, never "covered".
   */
  controlIds: string[] | null;
}

export interface GapControl {
  controlId: string;
  label: string;
}

export interface GapRow {
  obligationId: string;
  sourceClause: string;
  subject: string;
  status: CoverageStatus;
  /** The controls that cover the obligation (present in the control set). */
  coveredBy: string[];
  /** The controls the obligation names that are NOT in the control set. */
  missingControls: string[];
  reason: string;
}

export interface GapAnalysisResult {
  rows: GapRow[];
  gaps: GapRow[];
  /** Obligations that could not be interpreted — reported, never folded into "covered". */
  notInterpreted: GapRow[];
  coveragePercent: number;
}

/**
 * Analyse coverage.
 *
 * - `controlIds === null` → `not_interpreted` (could-not-interpret). Never covered.
 * - `controlIds === []` → `gap` (the obligation names no control at all).
 * - every named control present → `covered`.
 * - some present, some missing → `partial`, and both lists are reported.
 * - none present → `gap`, and the missing controls are named.
 */
export function analyseGaps(obligations: GapObligation[], controls: GapControl[]): GapAnalysisResult {
  const known = new Set(controls.map((c) => c.controlId));
  const rows: GapRow[] = obligations.map((o) => {
    if (o.controlIds === null) {
      return {
        obligationId: o.obligationId, sourceClause: o.sourceClause, subject: o.subject,
        status: 'not_interpreted', coveredBy: [], missingControls: [],
        reason: `clause ${o.sourceClause} could not be interpreted, so its coverage is unknown — not compliant`,
      };
    }
    const coveredBy = o.controlIds.filter((c) => known.has(c));
    const missingControls = o.controlIds.filter((c) => !known.has(c));
    if (o.controlIds.length === 0) {
      return {
        obligationId: o.obligationId, sourceClause: o.sourceClause, subject: o.subject,
        status: 'gap', coveredBy: [], missingControls: [],
        reason: `clause ${o.sourceClause} names no control, so it is uncovered`,
      };
    }
    if (missingControls.length === 0) {
      return {
        obligationId: o.obligationId, sourceClause: o.sourceClause, subject: o.subject,
        status: 'covered', coveredBy, missingControls: [],
        reason: `clause ${o.sourceClause} is covered by ${coveredBy.join(', ')}`,
      };
    }
    if (coveredBy.length === 0) {
      return {
        obligationId: o.obligationId, sourceClause: o.sourceClause, subject: o.subject,
        status: 'gap', coveredBy: [], missingControls,
        reason: `clause ${o.sourceClause} is a gap: none of ${missingControls.join(', ')} exist`,
      };
    }
    return {
      obligationId: o.obligationId, sourceClause: o.sourceClause, subject: o.subject,
      status: 'partial', coveredBy, missingControls,
      reason: `clause ${o.sourceClause} is partially covered by ${coveredBy.join(', ')}; missing ${missingControls.join(', ')}`,
    };
  });

  const interpreted = rows.filter((r) => r.status !== 'not_interpreted');
  const covered = interpreted.filter((r) => r.status === 'covered').length;
  const coveragePercent = interpreted.length === 0 ? 0 : Math.round((covered / interpreted.length) * 100);

  return {
    rows,
    gaps: rows.filter((r) => r.status === 'gap' || r.status === 'partial'),
    notInterpreted: rows.filter((r) => r.status === 'not_interpreted'),
    coveragePercent,
  };
}
