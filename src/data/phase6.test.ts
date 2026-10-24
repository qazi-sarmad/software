/**
 * Tests for the Phase 6 data modules (6G). Same split as phase4.test.ts: with no
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

describe('reports data module (6G)', () => {
  it('calls the report RPCs', async () => {
    const m = await import('./reports');
    await m.composeReport('e1');
    expect(rpcMock).toHaveBeenCalledWith('compose_report', { p_engagement_id: 'e1' });
    await m.freezeReport('rv1');
    expect(rpcMock).toHaveBeenCalledWith('freeze_report', { p_report_version_id: 'rv1' });
    await m.issueReport('rv1');
    expect(rpcMock).toHaveBeenCalledWith('issue_report', { p_report_version_id: 'rv1' });
    await m.addReportComment('rv1', 'b1', 'text');
    expect(rpcMock).toHaveBeenCalledWith('add_report_comment', { p_report_version_id: 'rv1', p_block_id: 'b1', p_comment_text: 'text' });
    await m.resolveReportComment('c1', 'incorporated', 'ok');
    expect(rpcMock).toHaveBeenCalledWith('resolve_report_comment', { p_comment_id: 'c1', p_status: 'incorporated', p_reason: 'ok' });
  });

  it('maps the summary and the open-comment count', async () => {
    const m = await import('./reports');
    rpcMock.mockResolvedValue({ data: { findings_by_severity: { High: 2 }, issues_by_severity: {}, tests_passed: 8, tests_failed: 1 }, error: null });
    const s = await m.computeReportSummary('rv1');
    expect(s).toEqual({ findingsBySeverity: { High: 2 }, issuesBySeverity: {}, testsPassed: 8, testsFailed: 1 });
    rpcMock.mockResolvedValue({ data: 3, error: null });
    expect(await m.openReportCommentCount('rv1')).toBe(3);
  });

  it('maps report versions and blocks', async () => {
    const m = await import('./reports');
    queryResult = { data: [{ id: 'rv1', engagement_id: 'e1', version_number: 1, status: 'draft', frozen_at: null, issued_at: null, created_at: 't' }], error: null };
    const versions = await m.listReportVersions('e1');
    expect(versions[0].status).toBe('draft');
    queryResult = { data: [{ id: 'b1', report_version_id: 'rv1', section_type: 'scope', block_type: 'text', content: {}, position: 0, is_placeholder: true, edited_at: null, edited_by: null }], error: null };
    const blocks = await m.listReportBlocks('rv1');
    expect(blocks[0].isPlaceholder).toBe(true);
  });

  it('reads return empty when not configured', async () => {
    clientMissing = true;
    const m = await import('./reports');
    expect(await m.listReportVersions('e1')).toEqual([]);
    expect(await m.computeReportSummary('rv1')).toBeNull();
    expect(await m.openReportCommentCount('rv1')).toBe(0);
  });
});

describe('caps data module (6G)', () => {
  it('calls the CAP RPCs and maps rows', async () => {
    const m = await import('./caps');
    await m.updateCap('c1', 'action', 'evidence');
    expect(rpcMock).toHaveBeenCalledWith('update_cap', { p_cap_id: 'c1', p_action_description: 'action', p_remediation_evidence: 'evidence' });
    await m.closeCap('c1', true, false);
    expect(rpcMock).toHaveBeenCalledWith('close_cap', { p_cap_id: 'c1', p_verified: true, p_delay: false });
    rpcMock.mockResolvedValue({ data: true, error: null });
    expect(await m.checkCapReconciliation('rv1')).toBe(true);
    queryResult = { data: [{ id: 'c1', report_id: null, engagement_id: 'e1', finding_id: 'f1', issue_id: null, responsible_dept: 'Ops', due_date: '2026-01-01', action_description: null, remediation_evidence: null, status: 'open', verified_at: null, verified_by: null }], error: null };
    const caps = await m.listCaps('e1');
    expect(caps[0].status).toBe('open');
  });

  it('reads return empty when not configured', async () => {
    clientMissing = true;
    const m = await import('./caps');
    expect(await m.listCaps('e1')).toEqual([]);
    expect(await m.checkCapReconciliation('rv1')).toBe(false);
  });
});

describe('email data module (6G)', () => {
  it('maps the queue and the settings', async () => {
    const m = await import('./email');
    queryResult = { data: [{ id: 'q1', to_addresses: ['a@b.c'], subject: 'S', status: 'sent', error_text: null, sent_at: 't', created_at: 't', metadata: {} }], error: null };
    const rows = await m.listEmailQueue();
    expect(lastQuery.table).toBe('email_queue');
    expect(rows[0].status).toBe('sent');
    queryResult = { data: { org_id: 'o1', provider: 'stub' }, error: null };
    const settings = await m.getEmailSettings();
    expect(settings).toEqual({ orgId: 'o1', provider: 'stub' });
  });

  it('reads return empty when not configured', async () => {
    clientMissing = true;
    const m = await import('./email');
    expect(await m.listEmailQueue()).toEqual([]);
    expect(await m.getEmailSettings()).toBeNull();
  });
});
