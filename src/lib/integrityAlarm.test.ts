import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ALARM_BOUNDARY_NOTE,
  alertSentence,
  dashboardBanner,
  INCIDENT_KINDS,
  kindLabel,
  severityLabel,
  severityOf,
  summariseAlerts,
} from './integrityAlarm';
import type { IntegrityAlertRow } from '../data/archival';

function row(over: Partial<IntegrityAlertRow> = {}): IntegrityAlertRow {
  return {
    id: 'a1',
    kind: 'archive_hash_mismatch',
    severity: 'warning',
    objectType: 'archive_job',
    objectId: 'c2',
    expectedHash: 'a'.repeat(64),
    actualHash: 'b'.repeat(64),
    raisedAt: '2026-10-28T00:00:00Z',
    acknowledgedAt: null,
    acknowledgedBy: null,
    ...over,
  };
}

describe('the integrity severity rule (T7)', () => {
  it('a single object failing to verify is a warning, the trail failing is an incident', () => {
    expect(severityOf('archive_hash_mismatch')).toBe('warning');
    expect(severityOf('evidence_hash_mismatch')).toBe('warning');
    expect(severityOf('population_archive_hash_mismatch')).toBe('warning');
    expect(severityOf('ledger_chain_broken')).toBe('incident');
    expect(severityOf('ledger_chain_gap')).toBe('incident');
    expect(severityOf('signature_invalid')).toBe('incident');
    expect(severityOf('timestamp_invalid')).toBe('incident');
    expect(severityOf('timestamp_failed')).toBe('incident');
  });

  it('an unknown kind is never silently upgraded to an incident', () => {
    expect(severityOf('something_brand_new')).toBe('warning');
  });
});

describe('the alarm summary is a rule over the rows (T7)', () => {
  it('counts incidents and warnings and reports unacknowledged', () => {
    const s = summariseAlerts([
      row({ id: '1', kind: 'ledger_chain_broken' }),
      row({ id: '2', kind: 'archive_hash_mismatch' }),
      row({ id: '3', kind: 'archive_hash_mismatch', acknowledgedAt: '2026-10-28T01:00:00Z' }),
    ]);
    expect(s.incidents).toBe(1);
    expect(s.warnings).toBe(2);
    expect(s.unacknowledged).toBe(2);
    expect(s.needsAttention).toBe(true);
    expect(s.headline).toContain('1 integrity incident');
    expect(s.headline).toContain('2 warnings');
  });

  it('an empty list is the verified state, not an error', () => {
    const s = summariseAlerts([]);
    expect(s.needsAttention).toBe(false);
    expect(s.headline).toBe('The integrity trail verifies.');
  });

  it('a fully acknowledged list still counts but does not need attention', () => {
    const s = summariseAlerts([row({ acknowledgedAt: '2026-10-28T01:00:00Z' })]);
    expect(s.warnings).toBe(1);
    expect(s.needsAttention).toBe(false);
  });
});

describe('the dashboard banner (T7)', () => {
  it('is absent when everything is acknowledged', () => {
    expect(dashboardBanner([])).toBeNull();
    expect(dashboardBanner([row({ acknowledgedAt: '2026-10-28T01:00:00Z' })])).toBeNull();
  });

  it('names an incident first when one is present', () => {
    const text = dashboardBanner([row({ kind: 'ledger_chain_broken' }), row({ id: '2' })]);
    expect(text).toContain('Integrity incident');
  });

  it('names the warnings when there is no incident', () => {
    const text = dashboardBanner([row()]);
    expect(text).toContain('1 integrity warning');
    expect(text).not.toContain('incident');
  });
});

describe('plain words (T7)', () => {
  it('labels a known kind, and shows an unknown kind by its own name', () => {
    expect(kindLabel('ledger_chain_broken')).toMatch(/ledger chain/);
    expect(kindLabel('something_new')).toBe('something_new');
  });

  it('labels severity', () => {
    expect(severityLabel('incident')).toBe('Incident');
    expect(severityLabel('warning')).toBe('Warning');
  });

  it('writes a sentence naming what failed and on what', () => {
    const text = alertSentence(row({ kind: 'ledger_chain_broken', objectType: 'ledger', objectId: null }));
    expect(text).toContain('Integrity incident');
    expect(text).toContain('ledger');
  });

  it('never claims prevention', () => {
    expect(ALARM_BOUNDARY_NOTE).toMatch(/tamper-evidence, not tamper-prevention/);
  });
});

/**
 * The severity table is the DATABASE's rule (public.integrity_alert_severity, migration 0112). This
 * module mirrors it so the UI can label a row it was handed; two copies drift, so this test pins them
 * to the migration text, exactly as the CAP-overdue rule is pinned to its SQL.
 */
describe('the app severity rule and the database rule are the same (T7)', () => {
  it('INCIDENT_KINDS is exactly the incident branch of public.integrity_alert_severity', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/0121_integrity_alarm.sql'),
      'utf8'
    );
    const fn = sql.slice(sql.indexOf('function public.integrity_alert_severity'));
    const incidentBranch = fn.slice(fn.indexOf('when p_kind in ('), fn.indexOf(') then'));
    const kinds = [...incidentBranch.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(kinds).toEqual([...INCIDENT_KINDS].sort());
  });
});
