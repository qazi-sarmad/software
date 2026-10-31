/**
 * Integrity-alarm presentation model (T7; docs/SYSTELIGON.md §11.3a).
 *
 * Detection is the database's (integrity_alerts + raise_integrity_alert + the severity rule in
 * migration 0112). This module is the PURE presentation rule the alarm surface reads: it turns the
 * rows the database returned into the plain words a human needs — what changed, and how serious it
 * is — and never queries and never decides access.
 *
 * The severity split is a property of the KIND, and the database owns that table
 * (integrity_alert_severity). This module mirrors it so the UI can label and order an alert it was
 * handed, and a parity test pins the two together, exactly as the CAP-overdue rule is pinned. A
 * mismatch is a build failure, not a silent drift.
 *
 * BOUNDARY: this is tamper-EVIDENCE, never tamper-prevention. Nothing here claims to stop a change;
 * it names the change that was proved.
 */
import type { IntegrityAlertRow } from '../data/archival';

export type AlertSeverity = 'warning' | 'incident';

/**
 * The kinds that are an INCIDENT rather than a warning. The trail itself — the ledger chain, a
 * signature, a timestamp — failing is an incident; one object failing to verify is a warning. This
 * mirrors public.integrity_alert_severity (migration 0112); integrityAlarmParity.test.ts pins them.
 */
export const INCIDENT_KINDS: readonly string[] = [
  'ledger_chain_broken',
  'ledger_chain_gap',
  'signature_invalid',
  'timestamp_invalid',
  'timestamp_failed',
];

/** The severity of an alert kind. Unknown kinds are a warning: never silently upgraded. */
export function severityOf(kind: string): AlertSeverity {
  return INCIDENT_KINDS.includes(kind) ? 'incident' : 'warning';
}

/** Plain words for a kind. A kind with no entry is shown by its own name, never hidden. */
export const ALERT_KIND_LABELS: Record<string, string> = {
  archive_hash_mismatch: 'An archived file no longer matches its recorded hash',
  population_archive_hash_mismatch: 'A population archive no longer matches its recorded hash',
  population_archive_download_mismatch: 'A downloaded population archive did not match its hash',
  evidence_hash_mismatch: 'Stored evidence no longer matches the hash recorded for it',
  ledger_chain_broken: 'The ledger chain does not verify — a link is broken',
  ledger_chain_gap: 'The ledger chain has a gap — a sequence is missing',
  signature_invalid: 'A signature does not verify against its root',
  timestamp_invalid: 'A timestamp does not cover the root it claims to',
  timestamp_failed: 'A timestamp authority could not stamp a root',
};

export function kindLabel(kind: string): string {
  return ALERT_KIND_LABELS[kind] ?? kind;
}

/** The heading for a severity, in the spec's own terms. */
export function severityLabel(severity: AlertSeverity): string {
  return severity === 'incident' ? 'Incident' : 'Warning';
}

/** One sentence a human can act on: what failed, and on what. */
export function alertSentence(alert: IntegrityAlertRow): string {
  const subject = alert.objectId
    ? `${alert.objectType} ${alert.objectId}`
    : alert.objectType;
  const lead = severityOf(alert.kind) === 'incident'
    ? 'Integrity incident'
    : 'Integrity warning';
  return `${lead}: ${kindLabel(alert.kind).toLowerCase()} (${subject}).`;
}

export interface AlertSummary {
  incidents: number;
  warnings: number;
  unacknowledged: number;
  /** True when anything at all is unacknowledged — the dashboard banner condition. */
  needsAttention: boolean;
  headline: string;
}

/** Count and summarise, incident-first. Deterministic: the same rows give the same summary. */
export function summariseAlerts(alerts: IntegrityAlertRow[]): AlertSummary {
  let incidents = 0;
  let warnings = 0;
  let unacknowledged = 0;
  for (const a of alerts) {
    if (severityOf(a.kind) === 'incident') incidents += 1;
    else warnings += 1;
    if (!a.acknowledgedAt) unacknowledged += 1;
  }
  const parts: string[] = [];
  if (incidents) parts.push(`${incidents} integrity incident${incidents === 1 ? '' : 's'}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  const headline = parts.length === 0
    ? 'The integrity trail verifies.'
    : `${parts.join(' and ')}${unacknowledged ? `, ${unacknowledged} unacknowledged` : ''}.`;
  return { incidents, warnings, unacknowledged, needsAttention: unacknowledged > 0, headline };
}

/** The banner text for the dashboard, or null when there is nothing to show. */
export function dashboardBanner(alerts: IntegrityAlertRow[]): string | null {
  const summary = summariseAlerts(alerts);
  if (!summary.needsAttention) return null;
  if (summary.incidents > 0) {
    return `Integrity incident: ${summary.incidents} incident${summary.incidents === 1 ? '' : 's'} and ${summary.warnings} warning${summary.warnings === 1 ? '' : 's'} need attention.`;
  }
  return `${summary.warnings} integrity warning${summary.warnings === 1 ? '' : 's'} need attention.`;
}

/** The plain-words description of what the alarm does — and does not — do. Shown with the panel. */
export const ALARM_BOUNDARY_NOTE =
  'This is tamper-evidence, not tamper-prevention. It proves that a change happened and preserves the ' +
  'before and after values; it does not stop a person with direct database access from changing a row.';
