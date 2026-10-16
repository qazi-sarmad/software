/**
 * Tests for the Phase 7 data modules (7F). Same split as phase4.test.ts: with no
 * environment variables every module is inert (reads empty, writes report not configured); with a
 * client present each function calls the right RPC / table and maps the rows it gets back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();
let queryResult: { data: unknown; error: unknown };
let lastQuery: { table?: string; selects: string[]; eqs: [string, unknown][] };
let clientMissing = false;

function chain() {
  const c: Record<string, unknown> = {};
  c.select = (s: string) => { lastQuery.selects.push(s); return c; };
  c.eq = (col: string, val: unknown) => { lastQuery.eqs.push([col, val]); return c; };
  c.order = () => c;
  c.limit = () => c;
  c.maybeSingle = async () => queryResult;
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(queryResult).then(resolve);
  return c;
}

vi.mock('./client', () => ({
  getClient: () => (clientMissing ? null : {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (table: string) => { lastQuery.table = table; return chain(); },
  }),
}));

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: null, error: null });
  queryResult = { data: [], error: null };
  clientMissing = false;
  lastQuery = { selects: [], eqs: [] };
});

describe('exports data module (7F)', () => {
  it('logs an export and returns the log id', async () => {
    const m = await import('./exports');
    rpcMock.mockResolvedValue({ data: 'log1', error: null });
    expect(await m.logExport('workpaper', 'w1', 'csv', { a: 1 }, 'hash')).toBe('log1');
    expect(rpcMock).toHaveBeenCalledWith('log_export', { p_object_type: 'workpaper', p_object_id: 'w1', p_format: 'csv', p_filters: { a: 1 }, p_content_hash: 'hash' });
  });

  it('calls each per-object export RPC', async () => {
    const m = await import('./exports');
    await m.exportWorkpaper('w1');
    expect(rpcMock).toHaveBeenCalledWith('export_workpaper', { p_workpaper_id: 'w1' });
    await m.exportFullTenant('o1');
    expect(rpcMock).toHaveBeenCalledWith('export_full_tenant', { p_org_id: 'o1' });
    await m.exportActivityLog('o1', null, null);
    expect(rpcMock).toHaveBeenCalledWith('export_activity_log', { p_org_id: 'o1', p_since: null, p_until: null });
  });

  it('reads return empty when not configured', async () => {
    clientMissing = true;
    const m = await import('./exports');
    expect(await m.listExports()).toEqual([]);
    expect(await m.logExport('workpaper', 'w1', 'csv', {}, 'h')).toBeNull();
  });
});

describe('imports data module (7F)', () => {
  it('runs the three import steps', async () => {
    const m = await import('./imports');
    rpcMock.mockResolvedValue({ data: 'job1', error: null });
    expect(await m.startImport('rcm', 'a.csv')).toBe('job1');
    expect(rpcMock).toHaveBeenCalledWith('start_import', { p_import_type: 'rcm', p_source_filename: 'a.csv' });
    rpcMock.mockResolvedValue({ data: { valid: 2, invalid: 1, errors: [{ row: 3, field: 'name', reason: 'missing' }] }, error: null });
    expect(await m.validateImport('job1', [])).toEqual({ valid: 2, invalid: 1, errors: [{ row: 3, field: 'name', reason: 'missing' }] });
    rpcMock.mockResolvedValue({ data: 2, error: null });
    expect(await m.commitImport('job1', [])).toBe(2);
  });

  it('calls the prior-year import RPCs', async () => {
    const m = await import('./imports');
    rpcMock.mockResolvedValue({ data: 'py1', error: null });
    expect(await m.importPriorYearItem('e0', 'scope', 'e1')).toBe('py1');
    expect(rpcMock).toHaveBeenCalledWith('import_prior_year_item', { p_source_engagement_id: 'e0', p_item_type: 'scope', p_engagement_id: 'e1' });
    rpcMock.mockResolvedValue({ data: null, error: null });
    await m.confirmPriorYearItem('py1');
    expect(rpcMock).toHaveBeenCalledWith('confirm_prior_year_item', { p_import_id: 'py1' });
    await m.revertPriorYearItem('py1');
    expect(rpcMock).toHaveBeenCalledWith('revert_prior_year_item', { p_import_id: 'py1' });
    rpcMock.mockResolvedValue({ data: 1, error: null });
    expect(await m.unconfirmedPriorYearImports('e1')).toBe(1);
  });

  it('maps import jobs and prior-year imports', async () => {
    const m = await import('./imports');
    queryResult = { data: [{ id: 'job1', import_type: 'rcm', source_filename: 'a.csv', status: 'done', error_rows: [], created_at: 't', created_by: null }], error: null };
    const jobs = await m.listImportJobs();
    expect(jobs[0].status).toBe('done');
    queryResult = { data: [{ id: 'py1', engagement_id: 'e1', item_type: 'scope', source_engagement_id: 'e0', status: 'imported_confirm', imported_at: 't', confirmed_at: null }], error: null };
    const py = await m.listPriorYearImports('e1');
    expect(py[0].status).toBe('imported_confirm');
  });

  it('reads return empty when not configured', async () => {
    clientMissing = true;
    const m = await import('./imports');
    expect(await m.listImportJobs()).toEqual([]);
    expect(await m.startImport('rcm', 'a.csv')).toBeNull();
    expect(await m.unconfirmedPriorYearImports('e1')).toBe(0);
  });
});

describe('archival data module (7F)', () => {
  it('archives a period and maps jobs', async () => {
    const m = await import('./archival');
    await m.archiveActivityPeriod('o1', '2026-01-01', '2026-01-31');
    expect(rpcMock).toHaveBeenCalledWith('archive_activity_period', { p_org_id: 'o1', p_period_start: '2026-01-01', p_period_end: '2026-01-31' });
    queryResult = { data: [{ id: 'a1', period_start: '2026-01-01', period_end: '2026-01-31', archived_row_count: 5, storage_path: 'p', content_hash: 'h', status: 'done', created_at: 't' }], error: null };
    const jobs = await m.listArchiveJobs();
    expect(jobs[0]).toEqual({ id: 'a1', periodStart: '2026-01-01', periodEnd: '2026-01-31', archivedRowCount: 5, storagePath: 'p', contentHash: 'h', status: 'done', createdAt: 't' });
  });

  it('reads return empty when not configured', async () => {
    clientMissing = true;
    const m = await import('./archival');
    expect(await m.listArchiveJobs()).toEqual([]);
  });
});
