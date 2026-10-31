/**
 * Diagnostics data module (self-diagnostic). Not-configured behaviour: with no Supabase environment
 * both snapshot reads are inert (null), so a bare checkout renders "not configured" rather than
 * throwing. The normalisers are pure and are exercised directly with a raw payload.
 */
import { describe, expect, it } from 'vitest';
import { normaliseOrg, normalisePlatform } from './diagnostics';

describe('diagnostics data module (not configured)', () => {
  it('is inert: both snapshot reads are null', async () => {
    const m = await import('./diagnostics');
    expect(await m.getOrgDiagnosticSnapshot()).toBeNull();
    expect(await m.getPlatformDiagnosticSnapshot()).toBeNull();
  });
});

describe('normaliseOrg', () => {
  it('maps a raw snapshot and defaults missing fields to zero, never undefined', () => {
    const facts = normaliseOrg({
      universes: 2, entities: 3, engagements: 1, is_empty: false,
      roles_total: 7, members_total: 4, sampling_rules: 2, populations: 1,
      populations_without_rows: 0, workpapers: 5, workpapers_sampled: 2,
      caps_open: 1, caps_overdue: 0, proposals_pending: 0, acceptances_outstanding: 0,
      sira_cycles: 1, sira_cycles_published: 0, alerts_incident: 0, alerts_warning: 1,
      alerts_unacknowledged: 1, incidents_open: 0, evidence_rows: 3, evidence_without_storage: 0,
      evidence_unverified: 1, connectors_total: 2, connectors_failing: 0,
      ledger_broken_at: 7, as_of: '2026-10-28',
    });
    expect(facts.ledger_broken_at).toBe(7);
    expect(facts.alerts_warning).toBe(1);
    expect(facts.as_of).toBe('2026-10-28');
  });

  it('treats a null ledger flag as an intact chain and never NaN', () => {
    const facts = normaliseOrg({ ledger_broken_at: null, as_of: '2026-10-28' });
    expect(facts.ledger_broken_at).toBeNull();
    expect(facts.universes).toBe(0);
  });

  it('accepts numeric strings (a JSON number arriving as text) without producing NaN', () => {
    const facts = normaliseOrg({ universes: '5' as unknown as number, as_of: 'x' });
    expect(facts.universes).toBe(5);
  });
});

describe('normalisePlatform', () => {
  it('maps a raw platform snapshot', () => {
    const facts = normalisePlatform({
      tenants: 12, tenants_suspended: 1, jobs_total: 5, jobs_failing: 0,
      incidents_open: 2, alerts_incident: 1, alerts_unacknowledged: 3, as_of: '2026-10-28',
    });
    expect(facts.tenants).toBe(12);
    expect(facts.jobs_failing).toBe(0);
    expect(facts.alerts_unacknowledged).toBe(3);
  });
});
