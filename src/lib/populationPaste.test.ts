import { describe, expect, it } from 'vitest';
import {
  assessAgainstFloor,
  detectDelimiter,
  parsePopulationPaste,
  pasteColumns,
  toSampleItems,
} from './populationPaste';

describe('detectDelimiter', () => {
  it('prefers a tab when the first line carries both a tab and a comma', () => {
    expect(detectDelimiter('ref\tamount,note\n1\t100,x')).toBe('\t');
  });
  it('falls back to a comma for a CSV paste', () => {
    expect(detectDelimiter('ref,amount\n1,100')).toBe(',');
  });
  it('returns the first delimiter for an empty block', () => {
    expect(detectDelimiter('')).toBe('\t');
  });
});

describe('parsePopulationPaste — columns map by position', () => {
  it('reads the first non-empty line as the header and later lines by index', () => {
    const result = parsePopulationPaste('ref\tamount\tnote\n1\t100\tok\n2\t200\tlate');
    expect(result.header).toEqual(['ref', 'amount', 'note']);
    expect(result.rows).toEqual([
      { rowRef: 1, data: { ref: '1', amount: '100', note: 'ok' } },
      { rowRef: 2, data: { ref: '2', amount: '200', note: 'late' } },
    ]);
    expect(result.errors).toEqual([]);
  });

  it('skips blank lines but keeps the data positions contiguous', () => {
    const result = parsePopulationPaste('ref\tamount\n\n1\t100\n\n2\t200\n');
    expect(result.rows.map((r) => r.rowRef)).toEqual([1, 2]);
  });

  it('rejects a short line with the exact line number and pads nothing', () => {
    const result = parsePopulationPaste('ref\tamount\tnote\n1\t100\tok\n2\t200');
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([
      { line: 3, message: 'Line 3 has 2 field(s) but the header has 3.' },
    ]);
  });

  it('trims a long line to the header width with a warning, inventing no column', () => {
    const result = parsePopulationPaste('ref\tamount\n1\t100\textra');
    expect(result.rows[0].data).toEqual({ ref: '1', amount: '100' });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].line).toBe(2);
  });

  it('honours a quoted field that contains the delimiter', () => {
    const result = parsePopulationPaste('ref,note\n1,"a, b"');
    expect(result.rows[0].data).toEqual({ ref: '1', note: 'a, b' });
  });

  it('is empty for an empty block, and never throws', () => {
    expect(parsePopulationPaste('')).toEqual({
      header: [], delimiter: '\t', rows: [], errors: [], warnings: [], headerLine: 0,
    });
  });

  it('exposes the header columns in order', () => {
    expect(pasteColumns(parsePopulationPaste('b\ta\tc\n1\t2\t3'))).toEqual(['b', 'a', 'c']);
  });
});

describe('assessAgainstFloor — a paste is never auto-padded', () => {
  it('reports the shortfall when the paste is below the floor', () => {
    expect(assessAgainstFloor(2, 5)).toEqual({ pasted: 2, floor: 5, meetsFloor: false, shortfall: 3 });
  });
  it('meets the floor exactly at the floor', () => {
    expect(assessAgainstFloor(5, 5)).toEqual({ pasted: 5, floor: 5, meetsFloor: true, shortfall: 0 });
  });
  it('treats an unknown floor as met, but keeps the count', () => {
    expect(assessAgainstFloor(3, null)).toEqual({ pasted: 3, floor: null, meetsFloor: true, shortfall: 0 });
  });
});

describe('toSampleItems — the one shape compute_sample accepts', () => {
  it('emits row_ref objects, sorted, so a bare number is never sent', () => {
    const rows = parsePopulationPaste('ref\tamount\n1\t100\n2\t200').rows;
    expect(toSampleItems(rows)).toEqual([
      { row_ref: 1, data: { ref: '1', amount: '100' } },
      { row_ref: 2, data: { ref: '2', amount: '200' } },
    ]);
  });
});
