// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  runRules, assertValidRule, RuleRegistry, ruleFingerprint,
  definePack, packRules, releasedRules, structuralRules, numericRules, justBelowThreshold,
  type SysteligonRule, type RuleInput, type RuleFinding,
} from './index';

const AT = '2026-10-29T00:00:00Z';

/** A trivial released rule for runner tests: flags any row whose `amount` is negative. */
const negativeAmount: SysteligonRule = {
  id: 'test.negative_amount', version: 1, kind: 'round_numbers', appliesTo: 'population',
  title: 'Negative amount', params: {}, standards: [], status: 'released', severity: 'low',
  evaluate: (input, ctx) =>
    input.rows
      .filter((r) => Number(r.values.amount) < 0)
      .map((r): RuleFinding => ({
        ruleId: 'ignored', ruleVersion: 999, kind: 'pattern', severity: 'info',
        reason: 'Amount is negative.', refs: [r.ref],
      })),
};

const draftOnly: SysteligonRule = {
  ...negativeAmount, id: 'test.draft', status: 'draft',
};

const input = (rows: RuleInput['rows']): RuleInput => ({ rows });

describe('runRules (S1)', () => {
  it('runs a released rule and stamps provenance from the rule, not the finding', () => {
    const r = runRules([negativeAmount], input([
      { ref: 'r2', values: { amount: -5 } },
      { ref: 'r1', values: { amount: -5 } },
      { ref: 'r3', values: { amount: 5 } },
    ]), { evaluatedAt: AT });
    expect(r.findings).toHaveLength(2);
    // The finding lied about its identity; the runner re-stamps it.
    expect(r.findings.every((f) => f.ruleId === 'test.negative_amount' && f.ruleVersion === 1)).toBe(true);
    expect(r.findings.every((f) => f.kind === 'round_numbers' && f.severity === 'low')).toBe(true);
    expect(r.ran).toEqual([{ id: 'test.negative_amount', version: 1 }]);
  });

  it('is order-independent: same input yields identical findings', () => {
    const a = runRules([negativeAmount], input([{ ref: 'r1', values: { amount: -1 } }, { ref: 'r2', values: { amount: -2 } }]), { evaluatedAt: AT });
    const b = runRules([negativeAmount], input([{ ref: 'r2', values: { amount: -2 } }, { ref: 'r1', values: { amount: -1 } }]), { evaluatedAt: AT });
    expect(a.findings).toEqual(b.findings);
    expect(a.findings.map((f) => f.refs[0])).toEqual(['r1', 'r2']);
  });

  it('skips draft rules unless drafts are requested', () => {
    const skipped = runRules([draftOnly], input([{ ref: 'r1', values: { amount: -1 } }]), { evaluatedAt: AT });
    expect(skipped.ran).toEqual([]);
    expect(skipped.skipped).toEqual([{ id: 'test.draft', version: 1 }]);
    const included = runRules([draftOnly], input([{ ref: 'r1', values: { amount: -1 } }]), { evaluatedAt: AT, includeDrafts: true });
    expect(included.ran).toEqual([{ id: 'test.draft', version: 1 }]);
  });

  it('collapses a rule shipped twice to a single run', () => {
    const r = runRules([negativeAmount, negativeAmount], input([{ ref: 'r1', values: { amount: -1 } }]), { evaluatedAt: AT });
    expect(r.ran).toHaveLength(1);
    expect(r.findings).toHaveLength(1);
  });

  it('turns a throwing rule into a finding against its own identity, not a crash', () => {
    const bad: SysteligonRule = {
      ...negativeAmount, id: 'test.throws',
      evaluate: () => { throw new Error('boom'); },
    };
    const r = runRules([bad, negativeAmount], input([{ ref: 'r1', values: { amount: -1 } }]), { evaluatedAt: AT });
    expect(r.findings.some((f) => f.ruleId === 'test.throws' && /failed to run/.test(f.reason))).toBe(true);
    expect(r.findings.some((f) => f.ruleId === 'test.negative_amount')).toBe(true);
  });

  it('filters to a target when asked', () => {
    const r = runRules([negativeAmount], input([{ ref: 'r1', values: { amount: -1 } }]), { evaluatedAt: AT, target: 'minutes' });
    expect(r.findings).toEqual([]);
    expect(r.ran).toEqual([]);
  });
});

describe('assertValidRule (S1)', () => {
  it('rejects a rule with no id, a bad version, or no evaluator', () => {
    expect(() => assertValidRule({ ...negativeAmount, id: '' })).toThrow(/id/);
    expect(() => assertValidRule({ ...negativeAmount, version: 0 })).toThrow(/version/);
    expect(() => assertValidRule({ ...negativeAmount, evaluate: undefined as unknown as SysteligonRule['evaluate'] })).toThrow(/evaluate/);
  });
});

describe('RuleRegistry versioning (S1)', () => {
  it('is append-only: a re-registered version with a changed definition throws', () => {
    const reg = new RuleRegistry();
    reg.register(negativeAmount);
    reg.register(negativeAmount); // identical → idempotent
    const changed = { ...negativeAmount, params: { threshold: 5 } };
    expect(() => reg.register(changed)).toThrow(/different definition/);
  });

  it('refuses to register an older version after a newer one', () => {
    const reg = new RuleRegistry();
    reg.register({ ...negativeAmount, version: 2 });
    expect(() => reg.register(negativeAmount)).toThrow(/older/);
  });

  it('tracks the latest version and the full history', () => {
    const reg = new RuleRegistry();
    reg.register(negativeAmount);
    reg.register({ ...negativeAmount, version: 2, params: { note: 'v2' } });
    expect(reg.latestOf('test.negative_amount')?.version).toBe(2);
    expect(reg.history().map((h) => h.version)).toEqual([1, 2]);
  });

  it('fingerprints behaviour but not status', () => {
    const f1 = ruleFingerprint(negativeAmount);
    const f2 = ruleFingerprint({ ...negativeAmount, status: 'draft' });
    expect(f1).toBe(f2);
    const f3 = ruleFingerprint({ ...negativeAmount, severity: 'high' });
    expect(f3).not.toBe(f1);
  });
});

describe('rule packs (S1)', () => {
  it('builds a pack and rejects a rule whose target disagrees with the pack', () => {
    const pack = definePack('population', 1, 'population', [negativeAmount]);
    expect(pack.name).toBe('population');
    expect(() => definePack('wrong', 1, 'minutes', [negativeAmount])).toThrow(/applies to/);
  });

  it('packRules collapses duplicates across packs', () => {
    const a = definePack('a', 1, 'population', [negativeAmount]);
    const b = definePack('b', 1, 'population', [negativeAmount]);
    expect(packRules([a, b])).toHaveLength(1);
  });

  it('releasedRules excludes drafts', () => {
    const pack = definePack('p', 1, 'population', [negativeAmount, draftOnly]);
    expect(releasedRules(pack).map((r) => r.id)).toEqual(['test.negative_amount']);
  });
});

describe('structural rules (S1, spec §3.2/§3.3)', () => {
  it('reports a minute with no quorum and an action item with no owner or due date', () => {
    const doc: RuleInput['documents'] = [{
      ref: 'min-1', kind: 'minutes',
      elements: [
        { ref: 'min-1.ai-1', role: 'action_item', line: 3, label: 'Ada', value: '2026-11-01' },
        { ref: 'min-1.ai-2', role: 'action_item', line: 5 },
      ],
    }];
    const r = runRules(structuralRules, { rows: [], documents: doc }, { evaluatedAt: AT });
    expect(r.findings.some((f) => /no quorum/.test(f.reason))).toBe(true);
    expect(r.findings.some((f) => /min-1.ai-2/.test(f.reason) && /owner or due date/.test(f.reason))).toBe(true);
    // The complete action item is not flagged.
    expect(r.findings.some((f) => f.refs.includes('min-1.ai-1'))).toBe(false);
  });

  it('reports a policy clause no procedure cites, and does not report a covered one', () => {
    const doc: RuleInput['documents'] = [
      { ref: 'pol', kind: 'policy', elements: [
        { ref: 'pol.c1', role: 'clause', line: 1, crossRefs: ['4.2'] },
        { ref: 'pol.c2', role: 'clause', line: 2, crossRefs: ['9.9'] },
      ] },
      { ref: 'proc', kind: 'procedure', elements: [
        { ref: 'proc.p1', role: 'clause', line: 1, crossRefs: ['4.2'] },
      ] },
    ];
    const r = runRules(structuralRules, { rows: [], documents: doc }, { evaluatedAt: AT });
    expect(r.findings.some((f) => f.refs.includes('pol.c2'))).toBe(true);
    expect(r.findings.some((f) => f.refs.includes('pol.c1'))).toBe(false);
  });
});

describe('numeric rules (S6, spec §3.1)', () => {
  it('ports the analytics checks into versioned rules with provenance', () => {
    const rows: RuleInput['rows'] = [
      { ref: 'a', values: { amount: 100, date: '2026-01-03', user: 'u1', approver: 'u1', seq: 1 } },
      { ref: 'b', values: { amount: 100, date: '2026-01-03', user: 'u1', approver: 'u1', seq: 3 } },
    ];
    const r = runRules(numericRules, { rows }, { evaluatedAt: AT });
    // Segregation of duties: both rows have the same creator and approver.
    const sod = r.findings.filter((f) => f.ruleId === 'numeric.segregation_of_duties');
    expect(sod.map((f) => f.refs[0]).sort()).toEqual(['a', 'b']);
    expect(sod.every((f) => f.ruleVersion === 1 && f.kind === 'segregation_of_duties')).toBe(true);
    // Sequence gap: 2 is missing before row b.
    expect(r.findings.some((f) => f.ruleId === 'numeric.sequence_gaps' && f.refs[0] === 'b')).toBe(true);
    // Every finding names the rule and its version — the provenance a sealed report stores.
    expect(r.findings.every((f) => f.ruleId && f.ruleVersion >= 1)).toBe(true);
  });

  it('benford reports on digits, not rows, so it carries no row refs', () => {
    const rows: RuleInput['rows'] = Array.from({ length: 200 }, (_, i) => ({
      ref: `r${i}`, values: { amount: 100 + i }, // all first digit 1..2 → deviates
    }));
    const r = runRules(numericRules.filter((x) => x.id === 'numeric.benford_first_digit'), { rows }, { evaluatedAt: AT });
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings.every((f) => f.refs.length === 0)).toBe(true);
  });

  it('just-below-threshold flags the band under the limit and nothing else', () => {
    const rows: RuleInput['rows'] = [
      { ref: 'under', values: { amount: 9800 } }, // inside the 5% band below 10000
      { ref: 'at', values: { amount: 10000 } }, // at the limit — not flagged
      { ref: 'low', values: { amount: 500 } }, // well below — not flagged
    ];
    const r = runRules([justBelowThreshold], { rows }, { evaluatedAt: AT });
    expect(r.findings.map((f) => f.refs[0])).toEqual(['under']);
  });
});
