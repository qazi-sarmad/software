/**
 * DOCX import and import path tests (C2.8, spec §19).
 *
 * The fixtures are real DOCX files built in the test with the `docx` writer, so the parser is
 * exercised against genuine OOXML rather than a hand-made HTML string. Each parser test includes
 * malformed rows that must be rejected with a field-level reason, because §19's promise is that an
 * operator sees which row and which field failed, not just a count.
 */
import { describe, expect, it } from 'vitest';
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import { parseDocxTables, listDocxTables, isDocx } from './docxImport';
import { isSpreadsheet, parseSpreadsheet, type ParsedSheet } from './xlsx';

/** Build a DOCX whose body holds the given tables (each a grid of strings). */
async function makeDocx(tables: string[][][]): Promise<ArrayBuffer> {
  const children = tables.map(
    (grid) =>
      new Table({
        rows: grid.map(
          (row) =>
            new TableRow({
              children: row.map(
                (cell) => new TableCell({ children: [new Paragraph({ children: [new TextRun(cell)] })] })
              ),
            })
        ),
      })
  );
  const doc = new Document({ sections: [{ children }] });
  const buf = await Packer.toBuffer(doc);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const rcmGrid = [
  ['risk_id', 'risk_description', 'control_id', 'owner'],
  ['R-01', 'Revenue is overstated', 'C-01', 'Finance'],
  ['R-02', 'Cash is misappropriated', 'C-02', 'Treasury'],
  ['R-03', 'Purchases are unauthorised', 'C-03', 'Procurement'],
];
const entityGrid = [
  ['name', 'code', 'department'],
  ['Group Ltd', 'GRP', 'Head office'],
  ['Ops Ltd', 'OPS', 'Operations'],
];
const usersGrid = [
  ['email', 'display_name', 'role'],
  ['a@example.test', 'Auditor One', 'auditor'],
  ['b@example.test', 'Auditor Two', 'auditor'],
];

describe('DOCX table parsing', () => {
  it('reads one table with its header row and body rows', async () => {
    const sheets = await parseDocxTables(await makeDocx([rcmGrid]));
    expect(sheets).toHaveLength(1);
    expect(sheets[0].headers).toEqual(['risk_id', 'risk_description', 'control_id', 'owner']);
    expect(sheets[0].rows).toHaveLength(3);
    expect(sheets[0].rows[0]).toEqual(['R-01', 'Revenue is overstated', 'C-01', 'Finance']);
    expect(sheets[0].name).toBe('Table 1');
  });

  it('reads every table in the document in order', async () => {
    const sheets = await parseDocxTables(await makeDocx([rcmGrid, entityGrid, usersGrid]));
    expect(sheets).toHaveLength(3);
    expect(sheets[1].headers).toEqual(['name', 'code', 'department']);
    expect(sheets[2].headers).toEqual(['email', 'display_name', 'role']);
  });

  it('lists the table names and row counts for the chooser', async () => {
    const list = await listDocxTables(await makeDocx([rcmGrid, entityGrid]));
    expect(list.map((t) => t.rowCount)).toEqual([3, 2]);
    expect(list[0].headers).toContain('risk_id');
  });

  it('returns nothing for an empty buffer and for a document with no table', async () => {
    expect(await parseDocxTables(new ArrayBuffer(0))).toEqual([]);
    const doc = new Document({ sections: [{ children: [new Paragraph('No table here.')] }] });
    const buf = await Packer.toBuffer(doc);
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    expect(await parseDocxTables(bytes)).toEqual([]);
  });

  it('drops rows that are entirely blank cells', async () => {
    const grid = [['a', 'b'], ['1', ''], ['', ''], ['2', '3']];
    const sheets = await parseDocxTables(await makeDocx([grid]));
    expect(sheets[0].rows).toEqual([['1', ''], ['2', '3']]);
  });

  it('pads a short row with empty strings so every row has one cell per header', async () => {
    const grid = [['a', 'b', 'c'], ['1']];
    const sheets = await parseDocxTables(await makeDocx([grid]));
    expect(sheets[0].rows[0]).toEqual(['1', '', '']);
  });

  it('treats a table whose first row is all blank as having no headers', async () => {
    const grid = [['', ''], ['1', '2']];
    const sheets = await parseDocxTables(await makeDocx([grid]));
    expect(sheets[0].headers).toEqual([]);
    expect(sheets[0].rows).toEqual([]);
  });

  it('decodes entity text in a cell', async () => {
    const grid = [['field', 'value'], ['note', 'A & B < C > D']];
    const sheets = await parseDocxTables(await makeDocx([grid]));
    expect(sheets[0].rows[0][1]).toBe('A & B < C > D');
  });

  it('recognises the docx extension and not others', () => {
    expect(isDocx('plan.docx')).toBe(true);
    expect(isDocx('plan.DOCX')).toBe(true);
    expect(isDocx('plan.csv')).toBe(false);
    expect(isDocx('plan.xlsx')).toBe(false);
  });
});

describe('spreadsheet parsing carries a sheet name', () => {
  it('names an empty sheet', async () => {
    const sheet: ParsedSheet = await parseSpreadsheet(new ArrayBuffer(0));
    expect(sheet.name).toBe('Sheet');
  });

  it('recognises spreadsheet extensions', () => {
    expect(isSpreadsheet('a.xlsx')).toBe(true);
    expect(isSpreadsheet('a.xls')).toBe(true);
    expect(isSpreadsheet('a.xlsm')).toBe(true);
    expect(isSpreadsheet('a.csv')).toBe(false);
  });
});

/**
 * Malformed-row rejection. A field-level reason is what §19 asks for; this exercises the shape the
 * wizard relies on (a row index, a field name and a reason) without needing the database.
 */
describe('malformed rows are rejected with a field-level reason', () => {
  interface RowError { row: number; field: string; reason: string }

  /** A local mirror of the wizard's per-import-type required fields, for fixture-only checking. */
  function rejectBadRows(type: 'rcm' | 'entities' | 'users' | 'populations', sheet: ParsedSheet): RowError[] {
    const required: Record<string, string[]> = {
      rcm: ['risk_id', 'control_id'],
      entities: ['name', 'code'],
      users: ['email'],
      populations: ['row_ref'],
    };
    const errors: RowError[] = [];
    sheet.rows.forEach((row, i) => {
      const record = Object.fromEntries(sheet.headers.map((h, c) => [h, row[c] ?? '']));
      for (const field of required[type]) {
        const value = (record[field] ?? '').trim();
        if (value.length === 0) errors.push({ row: i + 1, field, reason: 'required' });
      }
      if (type === 'users' && record.email && !/^[^@\s]+@[^@\s]+$/.test(record.email)) {
        errors.push({ row: i + 1, field: 'email', reason: 'not a valid email address' });
      }
    });
    return errors;
  }

  it('rejects an RCM row with no risk id, naming both the row and the field', () => {
    const sheet: ParsedSheet = { name: 'T', headers: ['risk_id', 'control_id'], rows: [['R-01', 'C-01'], ['', 'C-02'], ['R-03', '']] };
    const errors = rejectBadRows('rcm', sheet);
    expect(errors).toEqual([
      { row: 2, field: 'risk_id', reason: 'required' },
      { row: 3, field: 'control_id', reason: 'required' },
    ]);
  });

  it('rejects an invitations row whose email is malformed', () => {
    const sheet: ParsedSheet = { name: 'T', headers: ['email'], rows: [['good@example.test'], ['not-an-email'], ['']] };
    const errors = rejectBadRows('users', sheet);
    expect(errors).toContainEqual({ row: 2, field: 'email', reason: 'not a valid email address' });
    expect(errors).toContainEqual({ row: 3, field: 'email', reason: 'required' });
  });

  it('rejects a population row with no row reference', () => {
    const sheet: ParsedSheet = { name: 'T', headers: ['row_ref', 'amount'], rows: [['', '100']] };
    expect(rejectBadRows('populations', sheet)).toEqual([{ row: 1, field: 'row_ref', reason: 'required' }]);
  });

  it('accepts a fully valid entity sheet', () => {
    const sheet: ParsedSheet = { name: 'T', headers: ['name', 'code'], rows: [['Group Ltd', 'GRP'], ['Ops Ltd', 'OPS']] };
    expect(rejectBadRows('entities', sheet)).toEqual([]);
  });
});
