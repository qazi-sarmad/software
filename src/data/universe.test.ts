/**
 * Universe / entity data module (3I).
 *
 * Two layers are tested: the pure row mappers (no client at all), and the module behaviour when the
 * Supabase environment variables are unset (reads return empty, writes report not configured, so no
 * request leaves the process). A fake client is injected for the read path.
 */
import { describe, expect, it, vi } from 'vitest';

describe('universe data module (not configured)', () => {
  it('reads return empty collections and writes report not configured', async () => {
    const m = await import('./universe');
    expect(await m.listUniverses()).toEqual([]);
    expect(await m.listEntities()).toEqual([]);
    expect(await m.entityHistory('e1')).toEqual([]);
    expect(await m.entityApprovalConfig('org')).toBeNull();
    const nc = { ok: false, reason: 'The data module is not configured.' };
    expect(await m.submitEntity('e1')).toEqual(nc);
    expect(await m.decideEntity('e1', true)).toEqual(nc);
  });
});

describe('universe row mappers', () => {
  it('maps a universe row', async () => {
    const { mapUniverse } = await import('./universe');
    expect(mapUniverse({ id: 'u1', name: 'Core', domain: 'banking' })).toEqual({
      id: 'u1', name: 'Core', domain: 'banking',
    });
    expect(mapUniverse({ id: 'u2', name: 'Ops' }).domain).toBeNull();
  });

  it('maps an entity row, defaulting status to draft and approved to false', async () => {
    const { mapEntity } = await import('./universe');
    expect(mapEntity({
      id: 'e1', universe_id: 'u1', name: 'Bank', kind: 'fs', status: null, approved: false, rejection_reason: null,
    })).toEqual({
      id: 'e1', universeId: 'u1', name: 'Bank', kind: 'fs', status: 'draft', approved: false, rejectionReason: null,
    });
    expect(mapEntity({ id: 'e2', universe_id: 'u1', name: 'X', status: 'approved', approved: true }).status).toBe('approved');
  });
});

describe('universe data module (fake client)', () => {
  it('reads rows through the client and maps them', async () => {
    vi.resetModules();
    vi.doMock('./db', () => ({
      getClient: () => ({
        from: () => ({
          select: () => ({ order: async () => ({ data: [{ id: 'u1', name: 'Core', domain: null }], error: null }) }),
        }),
      }),
      callRpc: async () => ({ ok: true }),
      NOT_CONFIGURED_REASON: 'The data module is not configured.',
    }));
    const m = await import('./universe');
    expect(await m.listUniverses()).toEqual([{ id: 'u1', name: 'Core', domain: null }]);
    vi.doUnmock('./db');
  });
});
