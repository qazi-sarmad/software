import { describe, expect, it } from 'vitest';
import { analyseGaps, type GapObligation, type GapControl } from './gapAnalysis';

const controls: GapControl[] = [
  { controlId: 'C-01', label: 'Access review' },
  { controlId: 'C-02', label: 'Change approval' },
];

function obl(over: Partial<GapObligation> & { obligationId: string }): GapObligation {
  return { sourceClause: 'CL-1', subject: 'subject', controlIds: [], ...over };
}

describe('D8: policy-to-control gap analysis', () => {
  it('a fully covered obligation names the clauses and controls', () => {
    const r = analyseGaps([obl({ obligationId: 'O-1', sourceClause: 'ISO-A.5.15', controlIds: ['C-01'] })], controls);
    expect(r.rows[0].status).toBe('covered');
    expect(r.rows[0].reason).toContain('ISO-A.5.15');
    expect(r.rows[0].reason).toContain('C-01');
    expect(r.gaps).toHaveLength(0);
    expect(r.coveragePercent).toBe(100);
  });

  it('a partially covered obligation names both the covering and the missing controls', () => {
    const r = analyseGaps([obl({ obligationId: 'O-2', sourceClause: 'CL-2', controlIds: ['C-01', 'C-99'] })], controls);
    expect(r.rows[0].status).toBe('partial');
    expect(r.rows[0].coveredBy).toEqual(['C-01']);
    expect(r.rows[0].missingControls).toEqual(['C-99']);
    expect(r.rows[0].reason).toContain('partially covered');
    expect(r.rows[0].reason).toContain('C-99');
    expect(r.gaps).toHaveLength(1);
  });

  it('a gap with no covering control is a gap, never covered', () => {
    const r = analyseGaps([obl({ obligationId: 'O-3', sourceClause: 'CL-3', controlIds: ['C-99'] })], controls);
    expect(r.rows[0].status).toBe('gap');
    expect(r.rows[0].reason).toContain('is a gap');
    expect(r.gaps).toHaveLength(1);
    expect(r.coveragePercent).toBe(0);
  });

  it('BAD: an obligation naming no control at all is a gap', () => {
    const r = analyseGaps([obl({ obligationId: 'O-4', sourceClause: 'CL-4', controlIds: [] })], controls);
    expect(r.rows[0].status).toBe('gap');
    expect(r.rows[0].reason).toContain('names no control');
  });

  it('BAD: a clause that cannot be interpreted is reported could-not-interpret, NEVER covered', () => {
    const r = analyseGaps([obl({ obligationId: 'O-5', sourceClause: 'CL-5', controlIds: null })], controls);
    expect(r.rows[0].status).toBe('not_interpreted');
    expect(r.rows[0].reason).toContain('could not be interpreted');
    expect(r.rows[0].reason).toContain('not compliant');
    expect(r.notInterpreted).toHaveLength(1);
    // A not-interpreted clause is excluded from the coverage denominator.
    expect(r.coveragePercent).toBe(0);
  });

  it('coverage percent is over interpreted clauses only', () => {
    const r = analyseGaps([
      obl({ obligationId: 'O-6', sourceClause: 'CL-6', controlIds: ['C-01'] }), // covered
      obl({ obligationId: 'O-7', sourceClause: 'CL-7', controlIds: ['C-99'] }), // gap
      obl({ obligationId: 'O-8', sourceClause: 'CL-8', controlIds: null }),     // unknown
    ], controls);
    expect(r.coveragePercent).toBe(50); // 1 covered of 2 interpreted
  });
});
