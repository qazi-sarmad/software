/**
 * Fixtures for the deterministic §13.1 document review (C2.6). The same input must always give the
 * same findings, so these fixtures are fixed strings, not generators.
 */
import { describe, expect, it } from 'vitest';
import {
  checkTemplateConformance,
  crossFootTables,
  inconsistentFigures,
  matchFactsToSampleRows,
  parseNumber,
  parseTableRows,
  runStructuralReview,
  type ChecklistItem,
  type SampleRowFact,
} from './documentReview';

describe('C2.6 document review: number and table parsing', () => {
  it('parses plain, currency, parenthesised and percentage numbers', () => {
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('£3,400.50')).toBe(3400.5);
    expect(parseNumber('(1,200)')).toBe(-1200);
    expect(parseNumber('12.5%')).toBe(12.5);
    expect(parseNumber('not a number')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });

  it('parses only label-plus-number lines as table rows', () => {
    const rows = parseTableRows('Cash    100    200\nThis is prose with no number.\nDebt\t50\t60');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ label: 'Cash', values: [100, 200] });
    expect(rows[1]).toEqual({ label: 'Debt', values: [50, 60] });
  });
});

describe('C2.6 document review: table cross-footing', () => {
  it('passes when every declared total equals the rows above it', () => {
    const doc = 'Cash    100    200\nDebt     50     60\nTotal   150    260';
    const r = crossFootTables(doc);
    expect(r.passed).toBe(true);
    expect(r.findings).toHaveLength(0);
  });

  it('fails and names the column when a total disagrees', () => {
    const doc = 'Cash    100    200\nDebt     50     60\nTotal   140    260';
    const r = crossFootTables(doc);
    expect(r.passed).toBe(false);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].where).toContain('column 1');
  });

  it('does not cross-foot a table with no total row', () => {
    expect(crossFootTables('Cash    100    200\nDebt     50     60').passed).toBe(true);
  });

  it('checks each table independently and reports each bad total once', () => {
    const doc = 'A  1  1\nB  1  1\nTotal  1  2\n\nX  5\nY  5\nTotal  11';
    const r = crossFootTables(doc);
    expect(r.passed).toBe(false);
    expect(r.findings).toHaveLength(2);
  });
});

describe('C2.6 document review: numeric consistency across sections', () => {
  it('passes when the same label always carries the same value', () => {
    const doc = 'Revenue: 1,200\nNote: Revenue: 1,200';
    expect(inconsistentFigures(doc).passed).toBe(true);
  });

  it('fails when a label carries two different values', () => {
    const doc = 'Revenue: 1,200\n...\nRevenue: 1,500';
    const r = inconsistentFigures(doc);
    expect(r.passed).toBe(false);
    expect(r.findings[0].detail).toContain('revenue');
  });

  it('treats a label with a repeated equal value as consistent', () => {
    expect(inconsistentFigures('Total assets: 100\nTotal assets: 100.00').passed).toBe(true);
  });
});

describe('C2.6 document review: document facts against sample rows', () => {
  const facts: SampleRowFact[] = [
    { rowRef: 'R-1', label: 'Cash balance', value: 1200 },
    { rowRef: 'R-2', label: 'Debt balance', value: 400 },
  ];

  it('passes when every sample row fact is stated with the right value', () => {
    const doc = 'Cash balance: 1,200\nDebt balance: 400';
    expect(matchFactsToSampleRows(doc, facts).passed).toBe(true);
  });

  it('fails, naming the row, when a fact is missing altogether', () => {
    const r = matchFactsToSampleRows('Cash balance: 1,200', facts);
    expect(r.passed).toBe(false);
    expect(r.findings[0].where).toBe('sample row R-2');
    expect(r.findings[0].detail).toContain('does not state');
  });

  it('fails, naming the row, when the stated value disagrees with the sample row', () => {
    const r = matchFactsToSampleRows('Cash balance: 1,200\nDebt balance: 999', facts);
    expect(r.passed).toBe(false);
    expect(r.findings[0].where).toBe('sample row R-2');
    expect(r.findings[0].detail).toContain('999');
  });
});

describe('C2.6 document review: template and checklist conformance', () => {
  const checklist: ChecklistItem[] = [
    { key: 'scope', label: 'Scope statement', alternatives: ['scope'] },
    { key: 'signoff', label: 'Sign-off block', alternatives: ['approved by', 'signed by'] },
  ];

  it('passes when every required item is present by any alternative', () => {
    expect(checkTemplateConformance('Scope of this review\nSigned by: A. Auditor', checklist).passed).toBe(true);
  });

  it('fails when a required item is absent', () => {
    const r = checkTemplateConformance('Scope of this review', checklist);
    expect(r.passed).toBe(false);
    expect(r.findings[0].where).toBe('signoff');
  });

  it('does not pass on a similar meaning; presence is literal', () => {
    expect(checkTemplateConformance('We looked at what we would look at', checklist).passed).toBe(false);
  });
});

describe('C2.6 document review: the ordered deterministic review', () => {
  it('returns the structural checks in a fixed order', () => {
    const rules = runStructuralReview(
      'Cash 1 1\nDebt 1 1\nTotal 1 2',
      [{ rowRef: 'R-1', label: 'cash', value: 1 }],
      [{ key: 'scope', label: 'Scope', alternatives: ['scope'] }],
    ).map((r) => r.rule);
    expect(rules).toEqual([
      'Table Cross-footing',
      'Numeric Consistency Across Sections',
      'Document Facts Match Sample Rows',
      'Template and Checklist Conformance',
    ]);
  });

  it('is deterministic: the same input twice gives identical findings', () => {
    const doc = 'Cash 1 1\nDebt 1 1\nTotal 1 3\nRevenue: 5\nRevenue: 7';
    const a = runStructuralReview(doc, [{ rowRef: 'R-1', label: 'revenue', value: 5 }]);
    const b = runStructuralReview(doc, [{ rowRef: 'R-1', label: 'revenue', value: 5 }]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('omits the fact and checklist checks when none are supplied', () => {
    const rules = runStructuralReview('nothing numeric here').map((r) => r.rule);
    expect(rules).toEqual(['Table Cross-footing', 'Numeric Consistency Across Sections']);
  });
});
