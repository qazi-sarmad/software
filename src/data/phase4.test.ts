/**
 * Tests for the Phase 4 data modules (4H). Behaviour splits in two: with no environment variables
 * every module is inert (reads empty, writes report not configured); with a client present each
 * function calls the right RPC / table and maps the rows it gets back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();
let queryResult: { data: unknown; error: unknown };
let lastQuery: { table?: string; selects: string[]; eqs: [string, unknown][] };
// When true, getClient returns null, modelling a build with no Supabase environment variables.
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

describe('planning data module (4H)', () => {
  it('maps SIRA pre-fill suggestions', async () => {
    const m = await import('./planning');
    rpcMock.mockResolvedValue({ data: [{ suggestion_id: 'risk:r1', risk_id: 'r1', inherent_rating: 'high', suggested_controls: ['c'], prior_finding_count: 2, risk_band: 'High' }], error: null });
    const s = await m.populateSuggestions('e1');
    expect(rpcMock).toHaveBeenCalledWith('populate_planning_suggestions', { p_engagement_id: 'e1' });
    expect(s).toEqual([{ suggestionId: 'risk:r1', riskId: 'r1', inherentRating: 'high', suggestedControls: ['c'], priorFindingCount: 2, riskBand: 'High' }]);
  });

  it('writes go through the 4B RPCs', async () => {
    const m = await import('./planning');
    await m.decideSuggestion('e1', 's1', false, 'not relevant');
    expect(rpcMock).toHaveBeenCalledWith('decide_planning_suggestion', { p_engagement_id: 'e1', p_suggestion_id: 's1', p_accepted: false, p_reason: 'not relevant' });
    await m.saveSection('e1', 'scope', { summary: 'x' });
    expect(rpcMock).toHaveBeenCalledWith('save_planning_section', { p_engagement_id: 'e1', p_section_type: 'scope', p_content: { summary: 'x' } });
    await m.signPlanning('e1');
    expect(rpcMock).toHaveBeenCalledWith('sign_planning', { p_engagement_id: 'e1' });
  });

  it('maps planning sections', async () => {
    const m = await import('./planning');
    queryResult = { data: [{ id: 'x', section_type: 'scope', content: { a: 1 }, prepared_by: null, signed_off_at: null, signed_off_by: null }], error: null };
    const rows = await m.listSections('e1');
    expect(lastQuery.table).toBe('planning_sections');
    expect(rows[0].sectionType).toBe('scope');
  });

  it('reads return empty when not configured', async () => {
    clientMissing = true;
    const m = await import('./planning');
    expect(await m.populateSuggestions('e1')).toEqual([]);
    expect(await m.listSections('e1')).toEqual([]);
    expect(await m.checkReconciliation('e1')).toBe(false);
  });
});

describe('population data module (4H)', () => {
  it('maps populations and calls the lock RPCs', async () => {
    const m = await import('./population');
    queryResult = { data: [{ id: 'p1', engagement_id: 'e1', workpaper_id: 'w1', filename: 'f.csv', row_count: 10, sha256: 'ab', status: 'verified', verified_at: 't', verified_by: 'u' }], error: null };
    const rows = await m.listPopulations('e1');
    expect(rows[0]).toEqual({ id: 'p1', engagementId: 'e1', workpaperId: 'w1', filename: 'f.csv', rowCount: 10, sha256: 'ab', status: 'verified', verifiedAt: 't', verifiedBy: 'u' });
    await m.lockPopulation('p1');
    expect(rpcMock).toHaveBeenCalledWith('lock_population', { p_population_id: 'p1' });
  });

  it('hashes bytes to a hex SHA-256 that matches the DB hash format', async () => {
    const m = await import('./population');
    const bytes = new TextEncoder().encode('abc').buffer;
    expect(await m.sha256Hex(bytes)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('reads return empty when not configured', async () => {
    clientMissing = true;
    const m = await import('./population');
    expect(await m.listPopulations('e1')).toEqual([]);
  });
});

describe('sampling data module (4H)', () => {
  it('maps sampling rules and forwards the floor size RPC', async () => {
    const m = await import('./sampling');
    queryResult = { data: [{ id: 'r1', control_type: 'any', frequency: 'any', pop_band: 'small', method: 'random', base_size: 5, pct: 0.1 }], error: null };
    const rules = await m.listSamplingRules('o1');
    expect(rules[0]).toEqual({ id: 'r1', controlType: 'any', frequency: 'any', popBand: 'small', method: 'random', baseSize: 5, pct: 0.1 });
    rpcMock.mockResolvedValue({ data: 7, error: null });
    expect(await m.getSampleSize('o1', 'any', 'any', 'small', 40)).toBe(7);
    expect(rpcMock).toHaveBeenCalledWith('get_sample_size', { p_org_id: 'o1', p_control_type: 'any', p_frequency: 'any', p_pop_band: 'small', p_pop_count: 40 });
  });

  it('computes a sample through the RPC', async () => {
    const m = await import('./sampling');
    await m.computeSample('w1', 'system');
    expect(rpcMock).toHaveBeenCalledWith('compute_sample', { p_workpaper_id: 'w1', p_mode: 'system', p_items: null });
    await m.replaceSample('s1', 'corrected extract');
    expect(rpcMock).toHaveBeenCalledWith('replace_sample', { p_sample_id: 's1', p_rationale: 'corrected extract' });
  });
});

describe('row testing data module (4H)', () => {
  it('records a row and signs off through the 4E RPCs', async () => {
    const m = await import('./rowTesting');
    await m.recordRow('w1', '1', 'cross', 'amount differs');
    expect(rpcMock).toHaveBeenCalledWith('record_workpaper_row', { p_workpaper_id: 'w1', p_row_ref: '1', p_result: 'cross', p_rationale: 'amount differs', p_exception_flag: null });
    await m.signOffWorkpaper('w1');
    expect(rpcMock).toHaveBeenCalledWith('sign_off_workpaper', { p_workpaper_id: 'w1' });
    await m.reopenWorkpaper('w1', 'late evidence');
    expect(rpcMock).toHaveBeenCalledWith('reopen_workpaper', { p_workpaper_id: 'w1', p_justification: 'late evidence' });
  });

  it('maps workpaper rows including the four-eyes review fields', async () => {
    const m = await import('./rowTesting');
    queryResult = { data: [{ id: 'r1', workpaper_id: 'w1', row_ref: '1', result: 'tick', rationale: null, exception_flag: false, prepared_by: 'u1', prepared_at: 't', reviewed_by: 'u2', reviewed_at: 't2', reviewed_result: 'accepted' }], error: null };
    const rows = await m.listRows('w1');
    expect(rows[0].reviewedResult).toBe('accepted');
    expect(rows[0].exceptionFlag).toBe(false);
  });

  it('reads return empty when not configured', async () => {
    clientMissing = true;
    const m = await import('./rowTesting');
    expect(await m.listRows('w1')).toEqual([]);
    expect(await m.getWorkpaper('w1')).toBeNull();
  });
});

describe('analytics data module (4H)', () => {
  it('raises a finding with the rule id, params and row refs', async () => {
    const m = await import('./analytics');
    await m.raiseFinding('e1', 'p1', 'duplicates', { window: 2 }, [3, 4]);
    expect(rpcMock).toHaveBeenCalledWith('create_observation_stub', { p_engagement_id: 'e1', p_population_id: 'p1', p_rule_id: 'duplicates', p_params: { window: 2 }, p_row_refs: [3, 4] });
  });

  it('maps analysis results and is inert when not configured', async () => {
    const m = await import('./analytics');
    queryResult = { data: [{ id: 'a1', engagement_id: 'e1', workpaper_id: null, population_id: 'p1', rule_id: 'benford', params: {}, row_refs: [1], created_at: 't' }], error: null };
    expect((await m.listAnalysisResults('e1'))[0].ruleId).toBe('benford');
    clientMissing = true;
    expect(await m.listAnalysisResults('e1')).toEqual([]);
  });
});
