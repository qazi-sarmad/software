// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  runRules, documentRules, patternRules, sequentialRules, type RuleInput,
} from '../index';

/** A contract with no signature, an approval with an out-of-range date and no date field. */
function documentsFixture(over: Partial<RuleInput> = {}): RuleInput {
  return {
    rows: [],
    documents: [
      { ref: 'contract-1', kind: 'contract', elements: [{ ref: 'c1.1', role: 'clause', line: 1, label: '1', text: 'The parties agree.' }] },
      { ref: 'appr-1', kind: 'approval', elements: [{ ref: 'a1.1', role: 'clause', line: 1, label: '1', text: 'Approved on 2026-11-15.' }] },
    ],
    ...over,
  };
}

/** Two minutes: an item raised in the first and never mentioned again. */
function sequentialFixture(over: Partial<RuleInput> = {}): RuleInput {
  return {
    rows: [],
    documents: [
      { ref: 'min-1', kind: 'minutes', date: '2026-01-01', elements: [
        { ref: 'min1.ai', role: 'action_item', line: 3, label: 'Ada', value: '2026-02-01', text: 'Fix the ledger', attributes: { itemId: 'A1', owner: 'Ada', due: '2026-02-01', status: 'open' } },
      ] },
      { ref: 'min-2', kind: 'minutes', date: '2026-02-01', elements: [
        { ref: 'min2.h', role: 'heading', line: 1, value: 'Minutes' },
      ] },
    ],
    ...over,
  };
}

/** Source text carrying the shapes the pattern rules look for. */
function patternFixture(): RuleInput {
  return {
    rows: [],
    sourceFiles: [{ ref: 'svc.ts', text: [
      "const password = 'hunter2';",
      "const rows = db.query('SELECT * FROM users');",
      'while (true) {}',
      '// eslint-disable-next-line',
    ].join('\n') }],
  };
}

describe('structural document rules (S8, spec §3.2)', () => {
  it('flags a contract with no signature block and an approval with no date', () => {
    const input = documentsFixture();
    const r = runRules(documentRules, input, { evaluatedAt: '2026-10-29T00:00:00Z' });
    expect(r.findings.some((f) => f.ruleId === 'doc.contract_signature')).toBe(true);
    expect(r.findings.some((f) => f.ruleId === 'doc.approval_date')).toBe(true);
  });

  it('flags a date after the report date', () => {
    const input = documentsFixture({ scope: { reportDate: '2026-10-01' } });
    const r = runRules(documentRules, input, { evaluatedAt: '2026-10-29T00:00:00Z' });
    expect(r.findings.some((f) => f.ruleId === 'doc.date_after_report')).toBe(true);
  });

  it('flags an action item with no later record (absent follow-through)', () => {
    const r = runRules(documentRules, sequentialFixture(), { evaluatedAt: '2026-10-29T00:00:00Z' });
    expect(r.findings.some((f) => f.ruleId === 'doc.absent_follow_through')).toBe(true);
  });
});

describe('pattern rules (S9, spec §3.3)', () => {
  it('finds hardcoded credentials, SELECT *, a disabled check and an unbounded loop', () => {
    const r = runRules(patternRules, patternFixture(), { evaluatedAt: '2026-10-29T00:00:00Z' });
    const ids = new Set(r.findings.map((f) => f.ruleId));
    expect(ids.has('pattern.hardcoded_credentials')).toBe(true);
    expect(ids.has('pattern.select_star')).toBe(true);
    expect(ids.has('pattern.disabled_check')).toBe(true);
    expect(ids.has('pattern.unbounded_loop')).toBe(true);
  });

  it('does not flag a credential read from the environment', () => {
    const r = runRules([patternRules[0]], { rows: [], sourceFiles: [{ ref: 'a.ts', text: "const k = process.env.API_KEY;" }] }, { evaluatedAt: '2026-10-29T00:00:00Z' });
    expect(r.findings).toEqual([]);
  });
});

describe('sequential rules (S14/S15, spec §3.3)', () => {
  it('reports the action-item register with each item’s history as refs', () => {
    const r = runRules([sequentialRules[0]], sequentialFixture({ scope: { asOf: '2026-12-01' } }), { evaluatedAt: '2026-10-29T00:00:00Z' });
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings.some((f) => /never mentioned again/.test(f.reason))).toBe(true);
    expect(r.findings.every((f) => f.refs.length > 0)).toBe(true);
  });

  it('reports policy/procedure mismatch and its own coverage (an unparsed clause is not clean)', () => {
    const docs = [
      { ref: 'pol', kind: 'policy' as const, elements: [
        { ref: 'pol.1', role: 'clause' as const, label: '4.1', line: 1, crossRefs: ['4.1'], text: 'Must do X.' },
        { ref: 'pol.2', role: 'clause' as const, label: '', line: 2 }, // no key → uninterpreted
      ] },
      { ref: 'proc', kind: 'procedure' as const, elements: [] },
    ];
    const r = runRules([sequentialRules[1]], { rows: [], documents: docs }, { evaluatedAt: '2026-10-29T00:00:00Z' });
    expect(r.findings.some((f) => f.ruleId === 'doc.policy_comparison' && /no procedure/.test(f.reason))).toBe(true);
    expect(r.findings.some((f) => /could not be interpreted/.test(f.reason))).toBe(true);
  });
});
