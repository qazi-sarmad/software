/**
 * Diagnostic destination (self-diagnostic) — the PURE map from a finding's screen id to the place a
 * user can act on it.
 *
 * A diagnostic finding is only useful if it can be reached. The engine names a screen id
 * (`screenId`); this module turns that id into the shell action that opens the screen, so the panel
 * never hard-codes navigation and the mapping is testable without a DOM. It is data, not a rule: an
 * id with no destination returns null and the panel shows the id as plain text rather than a button
 * that goes nowhere.
 *
 * Determinism (Law L1): a fixed table, no model, no clock, no access decision — the shell re-checks
 * the caller's rights when it opens the surface.
 */

export type DiagnosticDestination =
  | { kind: 'inspector'; inspector: string; data?: Record<string, unknown> }
  | { kind: 'tab'; tab: string };

const DESTINATIONS: Record<string, DiagnosticDestination> = {
  // The audit-file screens live inside the audit-file tab.
  'AF-01': { kind: 'tab', tab: 'audit_file' },
  'AF-05': { kind: 'tab', tab: 'audit_file' },
  'AF-06': { kind: 'tab', tab: 'audit_file' },
  'AF-10': { kind: 'tab', tab: 'audit_file' },
  'AF-13': { kind: 'tab', tab: 'audit_file' },
  'AF-16': { kind: 'tab', tab: 'audit_file' },
  // Roles and rights are administered in the people panel.
  'OA-05': { kind: 'inspector', inspector: 'people_admin' },
  // The org control plane hosts the integrity, attestation, incident, escalation and setup tabs.
  'OA-29': { kind: 'inspector', inspector: 'org_control', data: { tab: 'integrity' } },
  'OA-30': { kind: 'inspector', inspector: 'org_control', data: { tab: 'attestation' } },
  'OA-31': { kind: 'inspector', inspector: 'org_control', data: { tab: 'incidents' } },
  'OA-12': { kind: 'inspector', inspector: 'org_control', data: { tab: 'escalation' } },
  'SA-01': { kind: 'inspector', inspector: 'org_control', data: { tab: 'setup' } },
  'OA-27': { kind: 'inspector', inspector: 'import_wizard' },
};

/** The shell action that opens a finding's screen, or null when there is no destination. */
export function destinationForScreen(screenId: string | null): DiagnosticDestination | null {
  if (!screenId) return null;
  return DESTINATIONS[screenId] ?? null;
}
