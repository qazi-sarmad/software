import { describe, expect, it } from 'vitest';
import {
  ORG_DIAGNOSTIC_RULES,
  PLATFORM_DIAGNOSTIC_RULES,
  runDiagnostics,
  summariseFindings,
  type OrgDiagnosticFacts,
  type PlatformDiagnosticFacts,
} from './diagnostics';

const healthyOrg = (over: Partial<OrgDiagnosticFacts> = {}): OrgDiagnosticFacts => ({
  universes: 3,
  entities: 9,
  engagements: 4,
  is_empty: false,
  roles_total: 7,
  members_total: 5,
  sampling_rules: 4,
  populations: 4,
  populations_without_rows: 0,
  workpapers: 6,
  workpapers_sampled: 3,
  caps_open: 2,
  caps_overdue: 0,
  proposals_pending: 0,
  acceptances_outstanding: 0,
  sira_cycles: 2,
  sira_cycles_published: 1,
  alerts_incident: 0,
  alerts_warning: 0,
  alerts_unacknowledged: 0,
  incidents_open: 0,
  evidence_rows: 5,
  evidence_without_storage: 0,
  evidence_unverified: 0,
  connectors_total: 2,
  connectors_failing: 0,
  ledger_broken_at: null,
  as_of: '2026-10-28',
  ...over,
});

describe('runDiagnostics — a healthy org produces no findings', () => {
  it('reports nothing when every check passes', () => {
    expect(runDiagnostics(ORG_DIAGNOSTIC_RULES, healthyOrg())).toEqual([]);
  });
});

describe('runDiagnostics — a broken ledger is a critical finding', () => {
  it('names the broken sequence and orders it first', () => {
    const findings = runDiagnostics(ORG_DIAGNOSTIC_RULES, healthyOrg({ ledger_broken_at: 42, alerts_incident: 1 }));
    expect(findings[0].ruleId).toBe('ledger.chain_broken');
    expect(findings[0].severity).toBe('critical');
    expect(findings[0].evidence.ledger_broken_at).toBe(42);
    // The incident alert is also critical, and comes after the chain rule.
    expect(findings[1].ruleId).toBe('integrity.incident_alert');
  });
});

describe('runDiagnostics — ordering is by severity then rule order', () => {
  it('puts criticals before warnings before infos', () => {
    const findings = runDiagnostics(ORG_DIAGNOSTIC_RULES, healthyOrg({
      alerts_incident: 1,
      caps_overdue: 3,
      sampling_rules: 0,
    }));
    const severities = findings.map((f) => f.severity);
    expect(severities).toEqual([...severities].sort(
      (a, b) => ({ critical: 0, warning: 1, info: 2 })[a] - ({ critical: 0, warning: 1, info: 2 })[b],
    ));
    expect(findings[0].severity).toBe('critical');
    expect(findings[findings.length - 1].severity).toBe('info');
  });

  it('is deterministic: the same snapshot always yields the same findings', () => {
    const facts = healthyOrg({ caps_overdue: 2, proposals_pending: 1, evidence_without_storage: 3 });
    expect(runDiagnostics(ORG_DIAGNOSTIC_RULES, facts)).toEqual(runDiagnostics(ORG_DIAGNOSTIC_RULES, facts));
  });
});

describe('runDiagnostics — the specific rules the audit found', () => {
  it('reports a verified population with no rows', () => {
    const findings = runDiagnostics(ORG_DIAGNOSTIC_RULES, healthyOrg({ populations_without_rows: 2 }));
    expect(findings.map((f) => f.ruleId)).toContain('population.verified_without_rows');
  });
  it('reports outstanding SIRA proposals and acceptances', () => {
    const findings = runDiagnostics(ORG_DIAGNOSTIC_RULES, healthyOrg({ proposals_pending: 3, acceptances_outstanding: 1 }));
    const ids = findings.map((f) => f.ruleId);
    expect(ids).toContain('sira.proposals_pending');
    expect(ids).toContain('sira.acceptance_outstanding');
  });
  it('reports evidence recorded without stored bytes', () => {
    const findings = runDiagnostics(ORG_DIAGNOSTIC_RULES, healthyOrg({ evidence_without_storage: 4 }));
    expect(findings.map((f) => f.ruleId)).toContain('evidence.without_storage');
  });
  it('does not report the empty-org info when the org holds data', () => {
    const findings = runDiagnostics(ORG_DIAGNOSTIC_RULES, healthyOrg());
    expect(findings.map((f) => f.ruleId)).not.toContain('org.empty');
  });
  it('reports the empty-org info for a brand-new org', () => {
    const findings = runDiagnostics(ORG_DIAGNOSTIC_RULES, healthyOrg({
      universes: 0, entities: 0, engagements: 0, is_empty: true, roles_total: 0,
      sampling_rules: 0, populations: 0, workpapers: 0, workpapers_sampled: 0,
      sira_cycles: 0, sira_cycles_published: 0, evidence_rows: 0, connectors_total: 0,
    }));
    const ids = findings.map((f) => f.ruleId);
    expect(ids).toContain('org.empty');
    // roles.none and sampling.no_rules are suppressed for a genuinely empty org.
    expect(ids).not.toContain('roles.none');
    expect(ids).not.toContain('sampling.no_rules');
  });
});

describe('platform rules', () => {
  const facts = (over: Partial<PlatformDiagnosticFacts> = {}): PlatformDiagnosticFacts => ({
    tenants: 12, tenants_suspended: 0, jobs_total: 5, jobs_failing: 0,
    incidents_open: 0, alerts_incident: 0, alerts_unacknowledged: 0, as_of: '2026-10-28', ...over,
  });
  it('reports nothing when healthy', () => {
    expect(runDiagnostics(PLATFORM_DIAGNOSTIC_RULES, facts())).toEqual([]);
  });
  it('reports a failing job as critical', () => {
    const findings = runDiagnostics(PLATFORM_DIAGNOSTIC_RULES, facts({ jobs_failing: 2 }));
    expect(findings[0].ruleId).toBe('jobs.failing');
    expect(findings[0].severity).toBe('critical');
  });
});

describe('summariseFindings', () => {
  it('headlines a clean run', () => {
    expect(summariseFindings([]).headline).toBe('No diagnostic findings. Every check passed.');
  });
  it('headlines criticals first', () => {
    const findings = runDiagnostics(ORG_DIAGNOSTIC_RULES, healthyOrg({ ledger_broken_at: 1, caps_overdue: 1 }));
    const s = summariseFindings(findings);
    expect(s.critical).toBe(1);
    expect(s.warning).toBe(1);
    expect(s.headline).toBe('1 critical issue needs attention now.');
  });
});
