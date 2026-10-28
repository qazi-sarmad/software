/**
 * Tenant data loader (Phase 1, task 1.1).
 *
 * Two layers: the loader with no configured project (every read returns empty, nothing throws, so the
 * shell can still render), and the loader against a fake client that returns rows (the rows are mapped
 * into the shell's seed shape, and snapshotToSeed marks the data non-demo and reuses the read ledger).
 */
import { describe, expect, it, vi } from 'vitest';
import type { User } from '../types';

const user: User = {
  id: 'u1', name: 'Test', email: 't@example.invalid', avatar: 'T', role: 'cia',
  universeIds: [], entityIds: [], orgId: 'org-1',
};

describe('tenant loader (not configured)', () => {
  it('returns an empty snapshot and never throws', async () => {
    const m = await import('./tenant');
    const warnings: string[] = [];
    const snap = await m.loadTenantSnapshot(warnings);
    expect(snap.universes).toEqual([]);
    expect(snap.entities).toEqual([]);
    expect(snap.engagements).toEqual([]);
    expect(snap.workpapers).toEqual([]);
    expect(snap.ledger).toEqual([]);
    expect(snap.analyticsSample).toEqual({ varianceItems: [], tbItems: [], anomalyItems: [] });
  });

  it('snapshotToSeed marks the data non-demo and returns the read ledger from buildLedger', async () => {
    const m = await import('./tenant');
    const snap = await m.loadTenantSnapshot();
    const seed = m.snapshotToSeed(snap, user);
    expect(seed.isDemo).toBe(false);
    expect(seed.tenantId).toBe('org-1');
    expect(await seed.buildLedger()).toEqual([]);
  });
});

describe('tenant loader (fake client)', () => {
  it('maps database rows into the seed shape', async () => {
    vi.resetModules();
    const rows: Record<string, unknown[]> = {
      universes: [{ id: 'u1', name: 'Core', domain: 'banking' }],
      entities: [{ id: 'e1', universe_id: 'u1', name: 'Bank', kind: 'fs', status: 'approved', approved: true, rejection_reason: null }],
      engagements: [{ id: 'g1', universe_id: 'u1', entity_id: 'e1', title: 'Cash', stage: 'testing', sealed: false, ad_hoc: false, created_at: '2026-01-01T00:00:00Z' }],
      workpapers: [{ id: 'w1', engagement_id: 'g1', control_id: 'c1', stage: 'testing', status: 'in_progress', prepared: false, prepared_by: 'u1', prepared_at: null, signed_off_at: null, signed_off_by: null }],
      observations: [],
      issues: [],
      caps: [],
      report_comments: [],
      ledger_entries: [{ seq: 1, prev_hash: 'p', hash: 'h', payload_hash: 'ph', actor_id: 'u1', action: 'audit_sign_off', payload: { summary: 'sealed' }, ts: '2026-01-02T00:00:00Z' }],
    };
    vi.doMock('./client', () => ({
      getClient: () => ({ from: (t: string) => ({ select: async () => ({ data: rows[t] ?? [], error: null }) }) }),
      hasSupabaseConfig: () => true,
    }));
    const m = await import('./tenant');
    const warnings: string[] = [];
    const snap = await m.loadTenantSnapshot(warnings);
    expect(snap.universes[0]).toMatchObject({ id: 'u1', name: 'Core' });
    expect(snap.entities[0]).toMatchObject({ id: 'e1', universeId: 'u1', status: 'active' });
    expect(snap.engagements[0]).toMatchObject({ id: 'g1', entityId: 'e1', stage: 'testing' });
    expect(snap.workpapers[0]).toMatchObject({ id: 'w1', engagementId: 'g1', entityId: 'e1' });
    expect(snap.ledger[0]).toMatchObject({ seq: 1, hash: 'h', eventType: 'audit_sign_off', payloadSummary: 'sealed' });
    expect(warnings).toEqual([]);
    vi.doUnmock('./client');
  });

  it('a failing read is recorded as a warning and yields an empty list, not a throw', async () => {
    vi.resetModules();
    vi.doMock('./client', () => ({
      getClient: () => ({ from: () => ({ select: async () => ({ data: null, error: { message: 'permission denied' } }) }) }),
      hasSupabaseConfig: () => true,
    }));
    const m = await import('./tenant');
    const warnings: string[] = [];
    const snap = await m.loadTenantSnapshot(warnings);
    expect(snap.universes).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('permission denied');
    vi.doUnmock('./client');
  });
});
