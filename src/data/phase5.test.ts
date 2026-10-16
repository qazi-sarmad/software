/**
 * Tests for the Phase 5 data modules (5F). Same split as phase4.test.ts: with no
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

describe('observations data module (5F)', () => {
  it('writes go through the 5A RPCs', async () => {
    const m = await import('./observations');
    await m.createObservation('e1', 'w1', 'Title', { context: 'c' });
    expect(rpcMock).toHaveBeenCalledWith('create_observation', { p_engagement_id: 'e1', p_workpaper_id: 'w1', p_title: 'Title', p_sections: { context: 'c' } });
    await m.promoteToFinding('o1', 'sev1');
    expect(rpcMock).toHaveBeenCalledWith('promote_to_finding', { p_observation_id: 'o1', p_severity_level_id: 'sev1' });
    await m.createIssue('Issue', null, ['f1']);
    expect(rpcMock).toHaveBeenCalledWith('create_issue', { p_title: 'Issue', p_severity_level_id: null, p_finding_ids: ['f1'] });
  });

  it('reads missing readability sections', async () => {
    const m = await import('./observations');
    rpcMock.mockResolvedValue({ data: ['effect', 'risk'], error: null });
    expect(await m.missingReadabilitySections('o1')).toEqual(['effect', 'risk']);
    expect(rpcMock).toHaveBeenCalledWith('missing_readability_sections', { p_observation_id: 'o1' });
  });

  it('maps observations and severity levels', async () => {
    const m = await import('./observations');
    queryResult = { data: [{ id: 'o1', engagement_id: 'e1', workpaper_id: null, title: 'T', sections: { context: 'c' }, status: 'draft', submitted_at: null, submitted_by: null }], error: null };
    const obs = await m.listObservations('e1');
    expect(lastQuery.table).toBe('observations');
    expect(obs[0].status).toBe('draft');
    queryResult = { data: [{ id: 's1', name: 'High', color_token: 'cinnabar', rank: 3 }], error: null };
    const sev = await m.listSeverityLevels();
    expect(sev[0]).toEqual({ id: 's1', name: 'High', colorToken: 'cinnabar', rank: 3 });
  });

  it('reads return empty when not configured', async () => {
    clientMissing = true;
    const m = await import('./observations');
    expect(await m.listObservations('e1')).toEqual([]);
    expect(await m.missingReadabilitySections('o1')).toEqual([]);
  });
});

describe('conclusion data module (5F)', () => {
  it('calls the conclusion RPCs and maps the record', async () => {
    const m = await import('./conclusion');
    rpcMock.mockResolvedValue({ data: true, error: null });
    expect(await m.testingSignedOff('e1')).toBe(true);
    await m.pullExceptions('e1');
    expect(rpcMock).toHaveBeenCalledWith('pull_exceptions', { p_engagement_id: 'e1' });
    await m.signConclusion('e1');
    expect(rpcMock).toHaveBeenCalledWith('sign_conclusion', { p_engagement_id: 'e1' });
    queryResult = { data: { id: 'c1', engagement_id: 'e1', exceptions: [], exceptions_pulled_at: null, overall_opinion: 'unqualified', prepared_by: 'u1', signed_off_at: null, signed_off_by: null, locked_at: null }, error: null };
    const rec = await m.getConclusion('e1');
    expect(rec?.overallOpinion).toBe('unqualified');
  });

  it('reads return empty when not configured', async () => {
    clientMissing = true;
    const m = await import('./conclusion');
    expect(await m.testingSignedOff('e1')).toBe(false);
    expect(await m.getConclusion('e1')).toBeNull();
  });
});

describe('documents data module (5F)', () => {
  it('searches through the RPC and maps hits', async () => {
    const m = await import('./documents');
    rpcMock.mockResolvedValue({ data: [{ file_id: 'f1', extraction_id: 'x1', filename: 'a.pdf', page_count: 3, status: 'done', headline: 'hello' }], error: null });
    const hits = await m.searchDocuments('e1', 'hello', 'testing');
    expect(rpcMock).toHaveBeenCalledWith('search_documents', { p_engagement_id: 'e1', p_query: 'hello', p_stage: 'testing' });
    expect(hits[0]).toEqual({ fileId: 'f1', extractionId: 'x1', filename: 'a.pdf', pageCount: 3, status: 'done', snippet: 'hello' });
  });

  it('validates the stage and requests extraction', async () => {
    const m = await import('./documents');
    expect(m.isDocumentStage('planning')).toBe(true);
    expect(m.isDocumentStage('nope')).toBe(false);
    await m.requestExtraction('f1');
    expect(rpcMock).toHaveBeenCalledWith('request_extraction', { p_file_id: 'f1' });
  });

  it('reads return empty when not configured', async () => {
    clientMissing = true;
    const m = await import('./documents');
    expect(await m.searchDocuments('e1', 'x')).toEqual([]);
    expect(await m.listEvidenceFiles('e1')).toEqual([]);
  });
});
