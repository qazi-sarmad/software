/**
 * R6a: the persisted-record reads added to the plan and deployment data modules. With a mocked
 * client each function must hit the right table/column and map the row it gets back; with no client
 * the module stays inert.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();
let queryResult: { data: unknown; error: unknown };
let lastQuery: { table?: string; selects: string[]; eqs: [string, unknown][]; orderCol?: string; limitN?: number };
let clientMissing = false;

function chain() {
  const c: Record<string, unknown> = {};
  c.select = (s: string) => { lastQuery.selects.push(s); return c; };
  c.eq = (col: string, val: unknown) => { lastQuery.eqs.push([col, val]); return c; };
  c.order = (col: string) => { lastQuery.orderCol = col; return c; };
  c.limit = (n: number) => { lastQuery.limitN = n; return c; };
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

describe('latestPlanForUniverse (R6a)', () => {
  it('reads the newest plan for the universe and maps it', async () => {
    const m = await import('./plan');
    queryResult = {
      data: { id: 'p1', universe_id: 'u1', period: '2026', status: 'approved', current_version: 3, approved_at: '2026-01-01T00:00:00Z' },
      error: null,
    };
    const plan = await m.latestPlanForUniverse('u1');
    expect(lastQuery.table).toBe('plans');
    expect(lastQuery.eqs).toContainEqual(['universe_id', 'u1']);
    expect(lastQuery.orderCol).toBe('created_at');
    expect(lastQuery.limitN).toBe(1);
    expect(plan).toEqual({
      id: 'p1', universeId: 'u1', period: '2026', status: 'approved', currentVersion: 3, approvedAt: '2026-01-01T00:00:00Z',
    });
  });

  it('returns null when the universe has no plan', async () => {
    const m = await import('./plan');
    queryResult = { data: null, error: null };
    expect(await m.latestPlanForUniverse('u1')).toBeNull();
  });

  it('returns null with no client', async () => {
    clientMissing = true;
    const m = await import('./plan');
    expect(await m.latestPlanForUniverse('u1')).toBeNull();
  });
});

describe('listGateOutcomes (R6a)', () => {
  it('filters the activity log by action and universe and maps the detail', async () => {
    const m = await import('./deployment');
    queryResult = {
      data: [
        { object_id: 'e1', detail: { universe_id: 'u1', entity_id: 'ent1', plan_id: 'p1' }, ts: '2026-02-01T00:00:00Z' },
      ],
      error: null,
    };
    const rows = await m.listGateOutcomes('u1');
    expect(lastQuery.table).toBe('activity_log');
    expect(lastQuery.eqs).toContainEqual(['action', 'engagement_deployed']);
    expect(lastQuery.eqs).toContainEqual(['detail->>universe_id', 'u1']);
    expect(rows).toEqual([
      { engagementId: 'e1', entityId: 'ent1', planId: 'p1', detail: { universe_id: 'u1', entity_id: 'ent1', plan_id: 'p1' }, ts: '2026-02-01T00:00:00Z' },
    ]);
  });

  it('returns empty with no client', async () => {
    clientMissing = true;
    const m = await import('./deployment');
    expect(await m.listGateOutcomes('u1')).toEqual([]);
  });
});
