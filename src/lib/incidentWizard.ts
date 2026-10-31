/**
 * The guided integrity incident wizard model (T6; docs/SYSTELIGON.md §11.3a).
 *
 * An integrity alert names a change that was PROVED. This module turns the alert and its append-only
 * action trail into the plain words a human needs — what changed, when, by whom, and what it affects
 * — and derives the incident's status from its own trail. The status is never stored: an incident
 * that can be quietly closed is not evidence, so the only writer is the append-only trail and this
 * pure function reads it.
 *
 * Everything here is a pure function of its arguments. No clock, no client, no tenant read; `todayIso`
 * is passed in so an age is deterministic.
 *
 * BOUNDARY (never blurred): this is tamper-EVIDENCE, not tamper-prevention. The wizard offers
 * restore / re-derive / freeze / escalate, and each one reports what it actually achieved; where an
 * action cannot apply it says so rather than showing a button that pretends.
 */
import type { IntegrityAlertRow } from '../data/archival';
import { kindLabel, severityOf, type AlertSeverity } from './integrityAlarm';
import { daysBetween } from './boardPackVisuals';

/** The guided steps, in the order spec §11.3a lists them. */
export type IncidentAction = 'annotate' | 'restore' | 'rederive' | 'freeze' | 'escalate';

/** The steps a human may take (the trail also carries 'open' and 'verify', which are not choices). */
export const INCIDENT_ACTIONS: IncidentAction[] = ['restore', 'rederive', 'freeze', 'escalate', 'annotate'];

/** One recorded step of an incident, as `integrity_incidents_list` returns it. */
export interface IncidentActionRow {
  id: string;
  action: string;
  reason: string;
  outcome: string;
  detail: Record<string, unknown>;
  actorId: string | null;
  createdAt: string | null;
}

/** An incident with its append-only trail. */
export interface IntegrityIncidentRow {
  id: string;
  alertId: string | null;
  kind: string;
  severity: AlertSeverity;
  objectType: string;
  objectId: string | null;
  engagementId: string | null;
  expectedHash: string | null;
  actualHash: string | null;
  detail: Record<string, unknown>;
  openedBy: string | null;
  openedAt: string | null;
  actions: IncidentActionRow[];
}

/** The derived status of an incident. Never stored; always recomputed from the trail. */
export type IncidentStatus = 'open' | 'mitigated' | 'resolved';

export interface IncidentModel {
  id: string;
  kind: string;
  /** Plain words for the kind ("Stored evidence no longer matches the hash recorded for it"). */
  kindLabel: string;
  severity: AlertSeverity;
  severityLabel: string;
  status: IncidentStatus;
  statusLabel: string;
  /** What changed, in one sentence a human can act on. */
  whatChanged: string;
  /** What the incident affects, in plain words. */
  affects: string;
  /** When it opened, and how long ago. */
  openedAt: string | null;
  ageDays: number;
  ageLabel: string;
  /** Who opened it, resolved to a name when the host could, else the id. */
  openedByLabel: string;
  expectedHash: string | null;
  actualHash: string | null;
  /** The steps taken so far, newest last, each with its plain outcome. */
  steps: { action: string; actionLabel: string; outcome: string; outcomeLabel: string; reason: string; at: string | null }[];
  /** The most recent verification's outcome, when one has run. */
  lastVerification: string | null;
  /** True once a verification has run and found the object back in agreement. */
  verifiedClean: boolean;
  /** The steps still available. `restore` is offered only when a sealed copy could exist. */
  availableActions: IncidentAction[];
}

/** Plain words for an action. */
export const ACTION_LABELS: Record<string, string> = {
  open: 'Incident opened',
  annotate: 'Note added',
  restore: 'Restored from the sealed copy',
  rederive: 'Re-derived and re-sealed',
  freeze: 'Engagement frozen',
  escalate: 'Escalated to the platform admin',
  verify: 'Verification re-run',
};

/** Plain words for an action's outcome. Never claims more than happened. */
export const OUTCOME_LABELS: Record<string, string> = {
  open: 'opened',
  restored: 'the record once again agrees with what was sealed',
  still_mismatched: 'the record still does not agree with what was sealed',
  no_sealed_copy: 'no sealed copy of the bytes was ever kept, so nothing can be restored',
  not_applicable: 'this step does not apply to this kind of record',
  intact: 'the ledger chain is intact',
  broken: 'the ledger chain is still broken',
  matches: 'the re-derived root matches the sealed root',
  diverges: 'the re-derived root diverges from the sealed root',
  frozen: 'the engagement is frozen and can no longer move or seal',
  no_engagement: 'the incident affects no single engagement, so there is nothing to freeze',
  escalated: 'the platform admin has been told',
  verified: 'the record verifies against what was sealed',
  mismatch: 'the record still fails verification',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function outcomeLabel(outcome: string): string {
  return OUTCOME_LABELS[outcome] ?? outcome;
}

/** The outcomes that mean the object is back in agreement with what was sealed. */
const CLEAN_OUTCOMES = new Set(['restored', 'intact', 'matches', 'verified']);

/**
 * Derive the incident's status from its trail. Deterministic: the same trail always gives the same
 * status. `resolved` requires a verification that came back clean — the incident closes on proof.
 */
export function incidentStatus(incident: IntegrityIncidentRow): IncidentStatus {
  const hasVerification = incident.actions.some((a) => a.action === 'verify');
  const lastVerification = [...incident.actions].reverse().find((a) => a.action === 'verify');
  if (hasVerification && lastVerification && CLEAN_OUTCOMES.has(lastVerification.outcome)) {
    return 'resolved';
  }
  const hasMitigation = incident.actions.some(
    (a) => a.action === 'restore' || a.action === 'rederive' || a.action === 'freeze'
  );
  return hasMitigation ? 'mitigated' : 'open';
}

export function statusLabel(status: IncidentStatus): string {
  return status === 'resolved' ? 'Resolved' : status === 'mitigated' ? 'Mitigated' : 'Open';
}

/** The action names that could plausibly apply, given what the incident is about. */
export function availableActions(incident: IntegrityIncidentRow): IncidentAction[] {
  const out: IncidentAction[] = [];
  // A restore needs bytes that were sealed. Evidence, population and activity archives have a
  // recorded hash to restore against; a ledger or a report graph is re-derived instead.
  if (['evidence_file', 'population_archive', 'archive_job'].includes(incident.objectType)) {
    out.push('restore');
  }
  out.push('rederive');
  if (incident.engagementId) out.push('freeze');
  out.push('escalate', 'annotate');
  return out;
}

/** What the incident affects, in plain words. */
function affects(incident: IntegrityIncidentRow, engagementTitle: string | null): string {
  if (incident.objectType === 'ledger') return 'the organisation\u2019s ledger chain';
  if (incident.objectType === 'archive_job') return 'the activity archive for the affected period';
  if (engagementTitle) {
    if (incident.objectType === 'evidence_file') return `evidence on ${engagementTitle}`;
    if (incident.objectType === 'population_archive') return `the archived population of ${engagementTitle}`;
    return engagementTitle;
  }
  if (incident.objectType === 'population_archive') return 'an archived population';
  return `${incident.objectType} ${incident.objectId ?? ''}`.trim();
}

export interface IncidentModelInput {
  incident: IntegrityIncidentRow;
  /** The org-local today, so the age is deterministic. */
  todayIso: string;
  /** A name for the opener, when the host screen could resolve the id. */
  openedByName?: string | null;
  /** The title of the affected engagement, when the host could resolve it. */
  engagementTitle?: string | null;
}

/** Build the wizard's model for one incident. */
export function incidentModel(input: IncidentModelInput): IncidentModel {
  const { incident, todayIso } = input;
  const status = incidentStatus(incident);
  const ageDays = incident.openedAt ? Math.max(0, daysBetween(incident.openedAt, todayIso)) : 0;
  const lastVerification = [...incident.actions].reverse().find((a) => a.action === 'verify');
  return {
    id: incident.id,
    kind: incident.kind,
    kindLabel: kindLabel(incident.kind),
    severity: incident.severity,
    severityLabel: incident.severity === 'incident' ? 'Incident' : 'Warning',
    status,
    statusLabel: statusLabel(status),
    whatChanged: kindLabel(incident.kind),
    affects: affects(incident, input.engagementTitle ?? null),
    openedAt: incident.openedAt,
    ageDays,
    ageLabel: ageDays === 0 ? 'today' : ageDays === 1 ? '1 day ago' : `${ageDays} days ago`,
    openedByLabel: input.openedByName ?? incident.openedBy ?? 'unknown',
    expectedHash: incident.expectedHash,
    actualHash: incident.actualHash,
    steps: incident.actions.map((a) => ({
      action: a.action,
      actionLabel: actionLabel(a.action),
      outcome: a.outcome,
      outcomeLabel: outcomeLabel(a.outcome),
      reason: a.reason,
      at: a.createdAt,
    })),
    lastVerification: lastVerification?.outcome ?? null,
    verifiedClean: status === 'resolved',
    availableActions: availableActions(incident),
  };
}

/** The plain-words description of what the wizard does — and does not — do. Shown with the panel. */
export const INCIDENT_BOUNDARY_NOTE =
  'This is tamper-evidence, not tamper-prevention. Restoring a record re-checks that it once again ' +
  'agrees with what was sealed; it cannot conjure back bytes that were never kept. Every step is ' +
  'recorded in an append-only trail, so the incident cannot be quietly closed.';

/** The summary sentence for the panel header, incident-first. */
export function incidentsHeadline(incidents: IntegrityIncidentRow[]): string {
  if (incidents.length === 0) return 'No integrity incidents.';
  let open = 0;
  let mitigated = 0;
  let resolved = 0;
  for (const i of incidents) {
    const s = incidentStatus(i);
    if (s === 'open') open += 1;
    else if (s === 'mitigated') mitigated += 1;
    else resolved += 1;
  }
  const parts: string[] = [];
  if (open) parts.push(`${open} open`);
  if (mitigated) parts.push(`${mitigated} mitigated`);
  if (resolved) parts.push(`${resolved} resolved`);
  return `${incidents.length} integrity incident${incidents.length === 1 ? '' : 's'}: ${parts.join(', ')}.`;
}
