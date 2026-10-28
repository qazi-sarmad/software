/**
 * Integrity incident data module (T6; docs/SYSTELIGON.md §11.3a).
 *
 * The alarm (T7) detects and tells. This module is the RESPONSE half: opening an incident from an
 * alert, reading the org's incidents with their append-only trail, and performing one guided step —
 * restore, re-derive and re-seal, freeze the engagement, escalate, or annotate. Every step is a
 * security-definer RPC in migration 0114, each requiring a reason and each appending to the ledger;
 * the outcome is computed in the database, never asserted here.
 *
 * Components never import the Supabase client (rule M8). When the module is inert (no
 * `VITE_SUPABASE_*`), reads return empty and a step reports that the module is not configured — it
 * never pretends a write happened.
 */
import { callRpc, getClient, NOT_CONFIGURED_REASON, type DataResult } from './db';
import type { IncidentAction, IncidentActionRow, IntegrityIncidentRow } from '../lib/incidentWizard';
import type { AlertSeverity } from '../lib/integrityAlarm';

function mapAction(a: Record<string, unknown>): IncidentActionRow {
  return {
    id: a.id as string,
    action: a.action as string,
    reason: (a.reason as string) ?? '',
    outcome: (a.outcome as string) ?? '',
    detail: (a.detail as Record<string, unknown>) ?? {},
    actorId: (a.actor_id as string | null) ?? null,
    createdAt: (a.created_at as string | null) ?? null,
  };
}

function mapIncident(i: Record<string, unknown>): IntegrityIncidentRow {
  return {
    id: i.id as string,
    alertId: (i.alert_id as string | null) ?? null,
    kind: i.kind as string,
    severity: ((i.severity as AlertSeverity | null) ?? 'warning') as AlertSeverity,
    objectType: i.object_type as string,
    objectId: (i.object_id as string | null) ?? null,
    engagementId: (i.engagement_id as string | null) ?? null,
    expectedHash: (i.expected_hash as string | null) ?? null,
    actualHash: (i.actual_hash as string | null) ?? null,
    detail: (i.detail as Record<string, unknown>) ?? {},
    openedBy: (i.opened_by as string | null) ?? null,
    openedAt: (i.opened_at as string | null) ?? null,
    actions: ((i.actions as Array<Record<string, unknown>>) ?? []).map(mapAction),
  };
}

/** The organisation's integrity incidents, newest first, with their append-only trail. Rights-gated
 *  in the database (an integrity owner is required); an empty list is a normal answer, not an error. */
export async function listIntegrityIncidents(): Promise<IntegrityIncidentRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('integrity_incidents_list');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map(mapIncident);
}

/** Open (or return) the incident for an alert. Idempotent per alert: a second call returns the same
 *  incident. Returns the incident id, or a reason when the module is inert or the caller is refused. */
export async function openIntegrityIncident(alertId: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED_REASON };
  const { data, error } = await sb.rpc('integrity_incident_open', { p_alert_id: alertId });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: data as string };
}

/** Perform one guided step. A reason is mandatory (the database refuses an empty one); the returned
 *  outcome is what actually happened, computed by the database. */
export async function incidentAction(
  incidentId: string,
  action: IncidentAction,
  reason: string
): Promise<{ ok: true; outcome: string } | { ok: false; reason: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED_REASON };
  const { data, error } = await sb.rpc('integrity_incident_action', {
    p_incident_id: incidentId,
    p_action: action,
    p_reason: reason,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, outcome: data as string };
}

/** Re-run verification and record the result, so the incident closes on proof. */
export async function verifyIntegrityIncident(
  incidentId: string
): Promise<{ ok: true; outcome: string } | { ok: false; reason: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED_REASON };
  const { data, error } = await sb.rpc('integrity_incident_verify', { p_incident_id: incidentId });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, outcome: data as string };
}

/** Whether the incident module can reach the database at all (used to say "not configured" rather
 *  than show an empty panel as if it were healthy). */
export function incidentStorageReady(): boolean {
  return getClient() !== null;
}

/** Type re-export so a component needs one import for the row shape. */
export type { IntegrityIncidentRow, IncidentActionRow, IncidentAction } from '../lib/incidentWizard';

/** Re-export the inert DataResult shape so a caller can reuse it. */
export type { DataResult };
