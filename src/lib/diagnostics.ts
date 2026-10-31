/**
 * The self-diagnostic engine (spec §11.1; the owner's "diagnose itself" requirement).
 *
 * A deterministic rule engine that reads a SNAPSHOT OF COUNTS AND FLAGS — never a row of tenant
 * content — and reports what is wrong, how serious it is, and where to go to fix it. It is the same
 * shape as the rest of Systeligon: every finding names the rule that produced it and the exact
 * numbers behind it, and re-running it on the same snapshot always produces the same findings.
 *
 * Determinism (Law L1): a fixed rule table, no model, no clock. `runDiagnostics` takes the facts and
 * the day as arguments and reads nothing else.
 *
 * Law L2: the snapshot is counts and booleans only. This module never sees tenant content, never
 * queries, and never decides access — the RPC that builds the snapshot enforces the caller's right
 * and org scope, and the screen only renders what it was handed.
 *
 * BOUNDARY: a diagnostic is tamper-EVIDENCE and a self-check, never a claim of prevention. A finding
 * names a fact that is wrong NOW; it does not assert that anything was or was not changed by hand.
 */

export type DiagnosticScope = 'org' | 'platform';
export type DiagnosticSeverity = 'critical' | 'warning' | 'info';

/** The org-scoped facts. Every field is a count or a flag; none is a row of content. */
export interface OrgDiagnosticFacts {
  universes: number;
  entities: number;
  engagements: number;
  is_empty: boolean;
  roles_total: number;
  members_total: number;
  sampling_rules: number;
  populations: number;
  populations_without_rows: number;
  workpapers: number;
  workpapers_sampled: number;
  caps_open: number;
  caps_overdue: number;
  proposals_pending: number;
  acceptances_outstanding: number;
  sira_cycles: number;
  sira_cycles_published: number;
  alerts_incident: number;
  alerts_warning: number;
  alerts_unacknowledged: number;
  incidents_open: number;
  evidence_rows: number;
  evidence_without_storage: number;
  evidence_unverified: number;
  connectors_total: number;
  connectors_failing: number;
  /** The first broken ledger sequence, or null when the chain is intact. */
  ledger_broken_at: number | null;
  /** The day the snapshot was taken, as an argument — never read from the clock. */
  as_of: string;
}

/** The platform-scoped facts, for the super admin. */
export interface PlatformDiagnosticFacts {
  tenants: number;
  tenants_suspended: number;
  jobs_total: number;
  jobs_failing: number;
  incidents_open: number;
  alerts_incident: number;
  alerts_unacknowledged: number;
  as_of: string;
}

export interface DiagnosticFinding {
  ruleId: string;
  scope: DiagnosticScope;
  severity: DiagnosticSeverity;
  title: string;
  detail: string;
  /** The plain action that resolves the finding. */
  remedy: string;
  /** The exact facts behind the finding, so a reader can re-derive it. */
  evidence: Record<string, number | string | boolean | null>;
  /** Where to go to act on it (a screen id), or null when it is a report-only item. */
  screenId: string | null;
}

export interface DiagnosticRule<F> {
  id: string;
  scope: DiagnosticScope;
  severity: DiagnosticSeverity;
  title: string;
  /** True when the fact is wrong and the finding should be reported. */
  check: (f: F) => boolean;
  detail: (f: F) => string;
  remedy: string;
  evidence: (f: F) => Record<string, number | string | boolean | null>;
  screenId: string | null;
}

const SEVERITY_ORDER: Record<DiagnosticSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** The org rules. Order here is the tie-break within a severity. */
export const ORG_DIAGNOSTIC_RULES: DiagnosticRule<OrgDiagnosticFacts>[] = [
  {
    id: 'ledger.chain_broken',
    scope: 'org',
    severity: 'critical',
    title: 'The ledger chain is broken',
    check: (f) => f.ledger_broken_at !== null,
    detail: (f) => `The append-only ledger fails to verify at entry ${f.ledger_broken_at}. The chain that proves the record was not altered is itself discontinuous.`,
    remedy: 'Open the integrity alarm, acknowledge the alert and start a guided incident. Do not seal any further report until it is resolved.',
    evidence: (f) => ({ ledger_broken_at: f.ledger_broken_at }),
    screenId: 'OA-29',
  },
  {
    id: 'integrity.incident_alert',
    scope: 'org',
    severity: 'critical',
    title: 'An integrity alert of incident severity is open',
    check: (f) => f.alerts_incident > 0,
    detail: (f) => `${f.alerts_incident} incident-severity row(s) are open. A broken chain, a failed signature or a failed timestamp is an incident, not a warning.`,
    remedy: 'Acknowledge each incident alert and open a guided incident to restore, re-derive and re-seal.',
    evidence: (f) => ({ alerts_incident: f.alerts_incident }),
    screenId: 'OA-29',
  },
  {
    id: 'integrity.unacknowledged',
    scope: 'org',
    severity: 'warning',
    title: 'Integrity alerts are unacknowledged',
    check: (f) => f.alerts_unacknowledged > 0,
    detail: (f) => `${f.alerts_unacknowledged} unacknowledged rows remain. Detection is complete; nothing has confirmed a human has seen them.`,
    remedy: 'Acknowledge each alert so the record shows it was seen.',
    evidence: (f) => ({ alerts_unacknowledged: f.alerts_unacknowledged }),
    screenId: 'OA-29',
  },
  {
    id: 'population.verified_without_rows',
    scope: 'org',
    severity: 'warning',
    title: 'A verified population has no rows stored',
    check: (f) => f.populations_without_rows > 0,
    detail: (f) => `${f.populations_without_rows} population(s) are verified but carry no rows. A sample cannot be drawn from a population with no rows, so testing cannot proceed on them.`,
    remedy: 'Open the population panel and paste or import the rows for each population.',
    evidence: (f) => ({ populations_without_rows: f.populations_without_rows, populations: f.populations }),
    screenId: 'AF-05',
  },
  {
    id: 'sira.proposals_pending',
    scope: 'org',
    severity: 'warning',
    title: 'SIRA proposals are outstanding',
    check: (f) => f.proposals_pending > 0,
    detail: (f) => `${f.proposals_pending} emergent-risk proposal(s) are pending. The next-year cycle is blocked from publication until they are resolved.`,
    remedy: 'Decide each proposal (accept or reject with a reason) on the SIRA screen.',
    evidence: (f) => ({ proposals_pending: f.proposals_pending }),
    screenId: 'AF-13',
  },
  {
    id: 'sira.acceptance_outstanding',
    scope: 'org',
    severity: 'warning',
    title: 'A SIRA cycle awaits the auditor acceptance',
    check: (f) => f.acceptances_outstanding > 0,
    detail: (f) => `${f.acceptances_outstanding} cycle(s) are endorsed but not accepted. The finaliser's endorsement is not a closure; the auditors must accept, and silence is a finding.`,
    remedy: 'Remind the auditors and record their acceptance, or report the silence as a finding.',
    evidence: (f) => ({ acceptances_outstanding: f.acceptances_outstanding, sira_cycles_published: f.sira_cycles_published }),
    screenId: 'AF-13',
  },
  {
    id: 'cap.overdue',
    scope: 'org',
    severity: 'warning',
    title: 'Corrective actions are overdue',
    check: (f) => f.caps_overdue > 0,
    detail: (f) => `${f.caps_overdue} corrective action(s) are past their due date and not verified.`,
    remedy: 'Chase the owners or escalate the overdue actions on the CAP register.',
    evidence: (f) => ({ caps_overdue: f.caps_overdue, caps_open: f.caps_open }),
    screenId: 'AF-16',
  },
  {
    id: 'evidence.without_storage',
    scope: 'org',
    severity: 'warning',
    title: 'Evidence is recorded without stored bytes',
    check: (f) => f.evidence_without_storage > 0,
    detail: (f) => `${f.evidence_without_storage} evidence record(s) carry a hash but no stored file. The hash verifies bytes nobody kept.`,
    remedy: 'Re-upload the affected evidence so the bytes are stored, then verify it again.',
    evidence: (f) => ({ evidence_without_storage: f.evidence_without_storage, evidence_rows: f.evidence_rows }),
    screenId: 'AF-10',
  },
  {
    id: 'connector.failing',
    scope: 'org',
    severity: 'warning',
    title: 'A connector is failing',
    check: (f) => f.connectors_failing > 0,
    detail: (f) => `${f.connectors_failing} connector instance(s) are in a failing state.`,
    remedy: 'Open the connector monitor, read the last run and correct the connection.',
    evidence: (f) => ({ connectors_failing: f.connectors_failing, connectors_total: f.connectors_total }),
    screenId: 'OA-27',
  },
  {
    id: 'roles.none',
    scope: 'org',
    severity: 'warning',
    title: 'No roles are configured',
    check: (f) => !f.is_empty && f.roles_total === 0,
    detail: () => 'The organisation holds data but no roles. Rights are carried by roles, so no member can hold a right.',
    remedy: 'Seed the default roles on the organisation settings screen.',
    evidence: (f) => ({ roles_total: f.roles_total, members_total: f.members_total }),
    screenId: 'OA-05',
  },
  {
    id: 'sampling.no_rules',
    scope: 'org',
    severity: 'info',
    title: 'No sampling rules are configured',
    check: (f) => !f.is_empty && f.sampling_rules === 0,
    detail: () => 'No sampling rule exists, so the floor cannot be computed and a sample cannot be sized.',
    remedy: 'Add the organisation sampling rules on the organisation settings screen.',
    evidence: (f) => ({ sampling_rules: f.sampling_rules }),
    screenId: 'OA-12',
  },
  {
    id: 'workpaper.never_sampled',
    scope: 'org',
    severity: 'info',
    title: 'Workpapers exist but none is sampled',
    check: (f) => f.workpapers > 0 && f.workpapers_sampled === 0,
    detail: (f) => `${f.workpapers} workpaper(s) exist and none has a locked sample. Testing has not started.`,
    remedy: 'Open a workpaper and compute and lock a sample.',
    evidence: (f) => ({ workpapers: f.workpapers, workpapers_sampled: f.workpapers_sampled }),
    screenId: 'AF-06',
  },
  {
    id: 'org.empty',
    scope: 'org',
    severity: 'info',
    title: 'The organisation is empty',
    check: (f) => f.is_empty,
    detail: () => 'This organisation holds no universe yet. A wall of zeros is not a health check.',
    remedy: 'Create the first universe to begin.',
    evidence: (f) => ({ universes: f.universes, entities: f.entities, engagements: f.engagements }),
    screenId: 'AF-01',
  },
];

/** The platform rules, for the super admin. */
export const PLATFORM_DIAGNOSTIC_RULES: DiagnosticRule<PlatformDiagnosticFacts>[] = [
  {
    id: 'jobs.failing',
    scope: 'platform',
    severity: 'critical',
    title: 'A scheduled job is failing',
    check: (f) => f.jobs_failing > 0,
    detail: (f) => `${f.jobs_failing} scheduled job(s) last ran with a failure. Sealing, anchoring and notification jobs run here.`,
    remedy: 'Open platform health, read the last run message and correct the job.',
    evidence: (f) => ({ jobs_failing: f.jobs_failing, jobs_total: f.jobs_total }),
    screenId: 'SA-02',
  },
  {
    id: 'integrity.incident_alert_platform',
    scope: 'platform',
    severity: 'critical',
    title: 'An incident-severity integrity alert is open somewhere',
    check: (f) => f.alerts_incident > 0,
    detail: (f) => `${f.alerts_incident} incident-severity row(s) are open across the platform.`,
    remedy: 'Identify the tenant and work the incident with its integrity owner.',
    evidence: (f) => ({ alerts_incident: f.alerts_incident }),
    screenId: 'SA-04',
  },
  {
    id: 'incidents.open',
    scope: 'platform',
    severity: 'warning',
    title: 'Integrity incidents are open',
    check: (f) => f.incidents_open > 0,
    detail: (f) => `${f.incidents_open} integrity incident(s) are open and not yet closed on proof.`,
    remedy: 'Follow each incident to a re-run verification before closing it.',
    evidence: (f) => ({ incidents_open: f.incidents_open }),
    screenId: 'SA-04',
  },
  {
    id: 'integrity.unacknowledged_platform',
    scope: 'platform',
    severity: 'warning',
    title: 'Platform integrity alerts are unacknowledged',
    check: (f) => f.alerts_unacknowledged > 0,
    detail: (f) => `${f.alerts_unacknowledged} unacknowledged rows remain.`,
    remedy: 'Acknowledge each alert so the record shows it was seen.',
    evidence: (f) => ({ alerts_unacknowledged: f.alerts_unacknowledged }),
    screenId: 'SA-04',
  },
  {
    id: 'tenant.suspended',
    scope: 'platform',
    severity: 'info',
    title: 'A tenant is suspended',
    check: (f) => f.tenants_suspended > 0,
    detail: (f) => `${f.tenants_suspended} tenant(s) are suspended.`,
    remedy: 'Confirm the suspension is intended and recorded.',
    evidence: (f) => ({ tenants_suspended: f.tenants_suspended, tenants: f.tenants }),
    screenId: 'SA-01',
  },
];

/**
 * Evaluate the rules against a snapshot and return the failing ones, ordered by severity then by
 * rule order. A rule whose check is false produces no finding — the engine never reports a clean
 * item, because a health screen full of "OK" lines is the wall of zeros in another costume.
 */
export function runDiagnostics<F>(rules: DiagnosticRule<F>[], facts: F): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  rules.forEach((rule, index) => {
    if (!rule.check(facts)) return;
    findings.push({
      ruleId: rule.id,
      scope: rule.scope,
      severity: rule.severity,
      title: rule.title,
      detail: rule.detail(facts),
      remedy: rule.remedy,
      evidence: rule.evidence(facts),
      screenId: rule.screenId,
    });
    void index;
  });
  // Stable sort: severity first, then the rule table order (already the array order).
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity] || a.i - b.i)
    .map((x) => x.f);
}

export interface DiagnosticSummary {
  critical: number;
  warning: number;
  info: number;
  total: number;
  /** One sentence a human can read at the top of the screen. */
  headline: string;
}

/** Summarise a finding set into counts and one headline sentence. */
export function summariseFindings(findings: DiagnosticFinding[]): DiagnosticSummary {
  const critical = findings.filter((f) => f.severity === 'critical').length;
  const warning = findings.filter((f) => f.severity === 'warning').length;
  const info = findings.filter((f) => f.severity === 'info').length;
  const total = findings.length;
  let headline: string;
  if (total === 0) headline = 'No diagnostic findings. Every check passed.';
  else if (critical > 0) headline = critical === 1
    ? '1 critical issue needs attention now.'
    : `${critical} critical issues need attention now.`;
  else if (warning > 0) headline = `${warning} warning${warning === 1 ? '' : 's'} to review.`;
  else headline = `${info} informational item${info === 1 ? '' : 's'}.`;
  return { critical, warning, info, total, headline };
}
