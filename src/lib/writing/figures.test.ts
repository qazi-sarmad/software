import { describe, expect, it } from 'vitest';
import {
  buildLineage, evaluateFigure, figureFunctionById, lineageHash, recomputeFigures,
  roundingConsistent, toBinding, type SourceRecord,
} from './figures';
import { decimalToString, decimal } from './canonical';
import { lineageCsv, lineagePanel } from './lineagePanel';

const T = '2026-10-25T09:00:00Z';

function rec(type: string, id: string, seed: string): SourceRecord {
  return { type, id, contentHash: seed.repeat(64).slice(0, 64) };
}

describe('W4.1 / W4.2 figure functions and lineage', () => {
  it('evaluates a ratio figure and records exactly the records the function reads', () => {
    const fn = figureFunctionById('fig.exception_rate')!;
    const records = [rec('test_rows', 'r1', 'a'), rec('test_rows', 'r2', 'b'), rec('test_rows', 'r3', 'c'), rec('test_rows', 'r4', 'd')];
    const columns = new Map([['test_rows', new Map([['r1', 'exception'], ['r2', 'pass'], ['r3', 'pass'], ['r4', 'pass']])]]);
    const evaln = evaluateFigure(fn, records, columns);
    expect(evaln.result).toBe('0.2500');
    expect(evaln.rowCount).toBe(4);
    expect(evaln.records.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('refuses a record the function does not declare', () => {
    const fn = figureFunctionById('fig.findings_count')!;
    expect(() => evaluateFigure(fn, [rec('secret_table', 'x', 'a')], new Map())).toThrow(/not declared/);
  });

  it('sums money as exact minor units, never floating point', () => {
    const fn = figureFunctionById('fig.payments_unapproved_value')!;
    const records = [rec('sample_rows', 'p1', 'a'), rec('sample_rows', 'p2', 'b')];
    const columns = new Map([['sample_rows', new Map([['p1', '12500'], ['p2', '75']])]]);
    const evaln = evaluateFigure(fn, records, columns);
    expect(evaln.result).toBe('12575');
    expect(decimalToString(decimal(evaln.result, 0))).toBe('12575');
  });

  it('hashes a lineage deterministically and detects a changed record', async () => {
    const fn = figureFunctionById('fig.controls_tested')!;
    const records = [rec('test_rows', 'r1', 'a')];
    const evaln = evaluateFigure(fn, records, new Map());
    const l1 = await buildLineage(fn, { engagementId: 'e1' }, evaln, T);
    const l2 = await buildLineage(fn, { engagementId: 'e1' }, evaln, T);
    expect(l1.lineageHash).toBe(l2.lineageHash);
    const tampered = await buildLineage(fn, { engagementId: 'e1' }, evaluateFigure(fn, [rec('test_rows', 'r1', 'b')], new Map()), T);
    expect(tampered.lineageHash).not.toBe(l1.lineageHash);
  });

  it('recomputes and reports a stale figure after a record changes', async () => {
    const fn = figureFunctionById('fig.controls_tested')!;
    const records = [rec('test_rows', 'r1', 'a')];
    const columns = new Map([['test_rows', new Map([['r1', 'x']])]]);
    const evaln = evaluateFigure(fn, records, columns);
    const lineage = await buildLineage(fn, { engagementId: 'e1' }, evaln, T);
    const claims = [{ id: 'c1', figures: [toBinding(fn, lineage)] }];
    const stored = new Map([['c1', [lineage]]]);

    // No change: no difference.
    const clean = await recomputeFigures(claims, stored, new Map([['test_rows', records]]), columns, T);
    expect(clean).toEqual([]);

    // A record added: the count changes and the lineage hash changes.
    const more = [...records, rec('test_rows', 'r2', 'b')];
    const columns2 = new Map([['test_rows', new Map([['r1', 'x'], ['r2', 'y']])]]);
    const dirty = await recomputeFigures(claims, stored, new Map([['test_rows', more]]), columns2, T);
    expect(dirty).toHaveLength(1);
    expect(dirty[0].stored).toBe('1');
    expect(dirty[0].recomputed).toBe('2');
    expect(dirty[0].storedLineageHash).not.toBe(dirty[0].recomputedLineageHash);
  });

  it('checks rounding consistency of displayed parts against a displayed total', () => {
    expect(roundingConsistent(['1.50', '2.50', '6.00'], '10.00', 2)).toBe(true);
    expect(roundingConsistent(['1.50', '2.50', '6.00'], '10.01', 2)).toBe(false);
  });
});

describe('W4.3 the lineage panel and its CSV', () => {
  it('shows the plain-words description, parameters, records, row count and both values', async () => {
    const fn = figureFunctionById('fig.exception_rate')!;
    const records = [rec('test_rows', 'r1', 'a'), rec('test_rows', 'r2', 'b')];
    const columns = new Map([['test_rows', new Map([['r1', 'exception'], ['r2', 'pass']])]]);
    const evaln = evaluateFigure(fn, records, columns);
    const lineage = await buildLineage(fn, { engagementId: 'e1' }, evaln, T);
    const panel = lineagePanel(fn, lineage, evaln.result);
    expect(panel.description).toBe(fn.description);
    expect(panel.parameters).toEqual({ engagementId: 'e1' });
    expect(panel.rowCount).toBe(2);
    expect(panel.storedValue).toBe(lineage.result);
    expect(panel.recomputedValue).toBe(evaln.result);
    expect(panel.lineageHash).toBe(lineage.lineageHash);
    expect(panel.records.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('exports the record list as CSV with the lineage hash on every row', async () => {
    const fn = figureFunctionById('fig.controls_tested')!;
    const records = [rec('test_rows', 'r1', 'a'), rec('test_rows', 'r2', 'b')];
    const evaln = evaluateFigure(fn, records, new Map([['test_rows', new Map([['r1', 'x'], ['r2', 'y']])]]));
    const lineage = await buildLineage(fn, { engagementId: 'e1' }, evaln, T);
    const csv = lineageCsv(lineage);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('figure_id,figure_version,record_type,record_id,content_hash,lineage_hash');
    expect(lines).toHaveLength(3);
    for (const line of lines.slice(1)) expect(line).toContain(lineage.lineageHash);
  });

  it('marks an out-of-scope record as not available without leaking it', () => {
    const fn = figureFunctionById('fig.controls_tested')!;
    const records = [rec('test_rows', 'r1', 'a'), rec('test_rows', 'r2', 'b')];
    const evaln = evaluateFigure(fn, records, new Map());
    const lineage = {
      figureId: fn.id, figureVersion: fn.version, parameters: {}, records: evaln.records,
      rowCount: 2, result: evaln.result, timeArgument: T, lineageHash: 'h',
    };
    const panel = lineagePanel(fn, lineage, evaln.result, new Set(['r1']));
    const r2 = panel.records.find((r) => r.id === 'r2')!;
    expect(r2.available).toBe(false);
    expect(r2.contentHash).toBe('not available');
  });
});
