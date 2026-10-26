import { describe, expect, it } from 'vitest';
import {
  PREFLIGHT_CHECKS, preflightSummary, runPreflight, type PreflightInput,
} from './preflight';

function clean(): PreflightInput {
  return {
    exceptions: [{ id: 'ex1', rationale: 'Approved by the CFO.' }],
    flags: [{ id: 'f1', resolved: true }],
    evidence: [{ id: 'ev1', required: true, present: true }],
    sample: { requiredFloor: 25, actualSize: 40 },
    signOffs: [{ workpaperId: 'wp1', preparerId: 'u1', reviewerId: 'u2' }],
    findings: [{ id: 'fi1', complete: true }],
    comments: [{ id: 'cm1', answered: true }],
    population: { gateMet: true },
    acknowledgements: [],
  };
}

describe('§11.4 pre-flight: a clean engagement passes', () => {
  it('passes with no items and no blockers', () => {
    const result = runPreflight(clean());
    expect(result.passed).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.blocking).toEqual([]);
  });

  it('lists all eight checks', () => {
    expect(PREFLIGHT_CHECKS).toHaveLength(8);
  });
});

describe('§11.4 pre-flight: each of the eight checks is detected', () => {
  it('detects an exception without a rationale', () => {
    const input = clean();
    input.exceptions = [{ id: 'ex1', rationale: '   ' }];
    const result = runPreflight(input);
    expect(result.passed).toBe(false);
    expect(result.blocking.some((b) => b.check === 'exceptions_without_rationale')).toBe(true);
  });

  it('detects an unresolved flag', () => {
    const input = clean();
    input.flags = [{ id: 'f1', resolved: false }];
    expect(runPreflight(input).blocking.some((b) => b.check === 'unresolved_flags')).toBe(true);
  });

  it('detects missing evidence', () => {
    const input = clean();
    input.evidence = [{ id: 'ev1', required: true, present: false }];
    expect(runPreflight(input).blocking.some((b) => b.check === 'missing_evidence')).toBe(true);
  });

  it('detects a sample below the floor', () => {
    const input = clean();
    input.sample = { requiredFloor: 25, actualSize: 10 };
    expect(runPreflight(input).blocking.some((b) => b.check === 'sample_below_floor')).toBe(true);
  });

  it('detects a reviewer who is the preparer', () => {
    const input = clean();
    input.signOffs = [{ workpaperId: 'wp1', preparerId: 'u1', reviewerId: 'u1' }];
    expect(runPreflight(input).blocking.some((b) => b.check === 'reviewer_equals_preparer')).toBe(true);
  });

  it('detects an incomplete finding', () => {
    const input = clean();
    input.findings = [{ id: 'fi1', complete: false }];
    expect(runPreflight(input).blocking.some((b) => b.check === 'incomplete_findings')).toBe(true);
  });

  it('detects an unanswered comment', () => {
    const input = clean();
    input.comments = [{ id: 'cm1', answered: false }];
    expect(runPreflight(input).blocking.some((b) => b.check === 'unanswered_comments')).toBe(true);
  });

  it('detects an unmet population gate', () => {
    const input = clean();
    input.population = { gateMet: false };
    expect(runPreflight(input).blocking.some((b) => b.check === 'population_gate')).toBe(true);
  });
});

describe('§11.4 pre-flight: acknowledgement with a reason clears a blocker', () => {
  it('a full acknowledgement clears every blocker and passes', () => {
    const input = clean();
    input.exceptions = [{ id: 'ex1', rationale: '' }];
    input.comments = [{ id: 'cm1', answered: false }];
    input.acknowledgements = [
      { check: 'exceptions_without_rationale', itemId: 'ex1', reason: 'Reviewed by the manager.', acknowledgedBy: 'u2', acknowledgedAt: '2026-10-01T00:00:00Z' },
      { check: 'unanswered_comments', itemId: 'cm1', reason: 'Comment is not relevant.', acknowledgedBy: 'u2', acknowledgedAt: '2026-10-01T00:00:00Z' },
    ];
    const result = runPreflight(input);
    expect(result.passed).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.blocking).toEqual([]);
  });

  it('a blank reason does not clear a blocker', () => {
    const input = clean();
    input.flags = [{ id: 'f1', resolved: false }];
    input.acknowledgements = [
      { check: 'unresolved_flags', itemId: 'f1', reason: '  ', acknowledgedBy: 'u2', acknowledgedAt: '2026-10-01T00:00:00Z' },
    ];
    expect(runPreflight(input).passed).toBe(false);
  });

  it('acknowledging one item does not wave through another', () => {
    const input = clean();
    input.exceptions = [
      { id: 'ex1', rationale: '' },
      { id: 'ex2', rationale: '' },
    ];
    input.acknowledgements = [
      { check: 'exceptions_without_rationale', itemId: 'ex1', reason: 'Accepted.', acknowledgedBy: 'u2', acknowledgedAt: '2026-10-01T00:00:00Z' },
    ];
    const result = runPreflight(input);
    expect(result.passed).toBe(false);
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0].itemId).toBe('ex2');
  });
});

describe('§11.4 pre-flight: determinism and the summary', () => {
  it('is deterministic and orders items by check then id', () => {
    const input = clean();
    input.exceptions = [{ id: 'ex2', rationale: '' }, { id: 'ex1', rationale: '' }];
    input.comments = [{ id: 'cm1', answered: false }];
    const a = runPreflight(input);
    const b = runPreflight(input);
    expect(a).toEqual(b);
    expect(a.items.map((i) => i.itemId)).toEqual(['ex1', 'ex2', 'cm1']);
  });

  it('summarises the count per check', () => {
    const input = clean();
    input.exceptions = [{ id: 'ex1', rationale: '' }, { id: 'ex2', rationale: '' }];
    const summary = preflightSummary(runPreflight(input));
    expect(summary.exceptions_without_rationale).toBe(2);
    expect(summary.unresolved_flags).toBe(0);
  });
});
