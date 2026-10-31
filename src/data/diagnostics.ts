/**
 * Diagnostics data module — reads the self-diagnostic snapshots (migration 0120).
 *
 * The snapshot is counts, flags and one broken-ledger sequence number (Law L2). It is never a row of
 * tenant content, so it may be read across the tenant and returned to its own integrity owner without
 * widening any read. The RPC enforces the caller's right and org scope; this module only carries the
 * result. Components never import the Supabase client.
 */
import { getClient } from './db';
import type { OrgDiagnosticFacts, PlatformDiagnosticFacts } from '../lib/diagnostics';

/** Read the org's diagnostic facts. Returns null when the data module is not configured (inert path). */
export async function getOrgDiagnosticSnapshot(): Promise<OrgDiagnosticFacts | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('org_diagnostic_snapshot');
  if (error) throw new Error(error.message);
  return normaliseOrg(data as Record<string, unknown>);
}

/** Read the platform's diagnostic facts. Returns null when not configured, or when the caller is not a platform admin. */
export async function getPlatformDiagnosticSnapshot(): Promise<PlatformDiagnosticFacts | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('platform_diagnostic_snapshot');
  if (error) {
    // A non-platform caller is refused by the RPC; that is a fact, not a crash.
    if (/platform administrator/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  return normalisePlatform(data as Record<string, unknown>);
}

const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
const s = (v: unknown, fallback: string): string => (typeof v === 'string' && v.length > 0 ? v : fallback);

export function normaliseOrg(raw: Record<string, unknown>): OrgDiagnosticFacts {
  const broken = raw.ledger_broken_at;
  return {
    universes: n(raw.universes),
    entities: n(raw.entities),
    engagements: n(raw.engagements),
    is_empty: raw.is_empty === true,
    roles_total: n(raw.roles_total),
    members_total: n(raw.members_total),
    sampling_rules: n(raw.sampling_rules),
    populations: n(raw.populations),
    populations_without_rows: n(raw.populations_without_rows),
    workpapers: n(raw.workpapers),
    workpapers_sampled: n(raw.workpapers_sampled),
    caps_open: n(raw.caps_open),
    caps_overdue: n(raw.caps_overdue),
    proposals_pending: n(raw.proposals_pending),
    acceptances_outstanding: n(raw.acceptances_outstanding),
    sira_cycles: n(raw.sira_cycles),
    sira_cycles_published: n(raw.sira_cycles_published),
    alerts_incident: n(raw.alerts_incident),
    alerts_warning: n(raw.alerts_warning),
    alerts_unacknowledged: n(raw.alerts_unacknowledged),
    incidents_open: n(raw.incidents_open),
    evidence_rows: n(raw.evidence_rows),
    evidence_without_storage: n(raw.evidence_without_storage),
    evidence_unverified: n(raw.evidence_unverified),
    connectors_total: n(raw.connectors_total),
    connectors_failing: n(raw.connectors_failing),
    ledger_broken_at: broken === null || broken === undefined ? null : n(broken),
    as_of: s(raw.as_of, ''),
  };
}

export function normalisePlatform(raw: Record<string, unknown>): PlatformDiagnosticFacts {
  return {
    tenants: n(raw.tenants),
    tenants_suspended: n(raw.tenants_suspended),
    jobs_total: n(raw.jobs_total),
    jobs_failing: n(raw.jobs_failing),
    incidents_open: n(raw.incidents_open),
    alerts_incident: n(raw.alerts_incident),
    alerts_unacknowledged: n(raw.alerts_unacknowledged),
    as_of: s(raw.as_of, ''),
  };
}
