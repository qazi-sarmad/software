/**
 * Assurance-capabilities data layer (stream S2 — D5 / D7 / D8 / D9).
 *
 * Mount point (docs/build/OWNERSHIP.md §4.2): created empty so `src/data/index.ts` is complete before
 * any stream branches. Stream S2 fills this module; no other stream edits it.
 *
 * Every read goes through `src/data/db.ts` (the single client, rule M8). The pure engines live under
 * `src/lib/assurance/**`; this module only loads their inputs and records their outputs. Time is an
 * argument, never a clock read.
 */
import { callRpc, getClient, NOT_CONFIGURED_REASON, type DataResult } from './db';
import type {
  ControlDefinition,
  ControlMonitoringRule,
  ControlMonitoringResult,
  ControlTestEvidence,
  IcfrThresholds,
} from '../lib/assurance/controlMonitoring';
import { monitorControls } from '../lib/assurance/controlMonitoring';
import type { ForensicRule, ForensicRuleResult } from '../lib/assurance/forensicAnalytics';
import { runForensicRules } from '../lib/assurance/forensicAnalytics';
import type { PopulationEntry } from '../lib/analyticsEngine';
import type { GapObligation, GapControl, GapAnalysisResult } from '../lib/assurance/gapAnalysis';
import { analyseGaps } from '../lib/assurance/gapAnalysis';
import type {
  AssuranceMetric,
  AssuranceMetricInput,
  AssuranceOverAssuranceResult,
} from '../lib/assurance/assuranceOverAssurance';
import { assuranceOverAssurance } from '../lib/assurance/assuranceOverAssurance';

// ---------------------------------------------------------------------------
// D5 — continuous control monitoring over ICFR.
// ---------------------------------------------------------------------------

export interface IcfrConfigRead {
  controls: ControlDefinition[];
  rules: ControlMonitoringRule[];
  evidence: ControlTestEvidence[];
  thresholds: IcfrThresholds | null;
}

/** Load one organisation's ICFR controls, their monitoring rules and their latest test evidence. */
export async function listIcfrConfig(orgId: string): Promise<IcfrConfigRead> {
  const sb = getClient();
  if (!sb) return { controls: [], rules: [], evidence: [], thresholds: null };

  const [controls, rules, evidence, thresholds] = await Promise.all([
    sb.from('icfr_controls').select('control_id,taxonomy,component,principle,assertion,owner,test_procedure,compensating_control_id').eq('org_id', orgId),
    sb.from('icfr_monitor_rules').select('rule_id,rule_version,control_id,tolerance_percent').eq('org_id', orgId),
    sb.from('icfr_control_evidence').select('control_id,population,deviations,tested_at').eq('org_id', orgId),
    sb.from('icfr_thresholds').select('significance_threshold_percent,materiality_threshold_percent').eq('org_id', orgId).maybeSingle(),
  ]);

  return {
    controls: (controls.data ?? []).map((r) => ({
      controlId: r.control_id, taxonomy: r.taxonomy, component: r.component, principle: Number(r.principle),
      assertion: r.assertion, owner: r.owner, testProcedure: r.test_procedure,
      compensatingControlId: r.compensating_control_id ?? undefined,
    })) as ControlDefinition[],
    rules: (rules.data ?? []).map((r) => ({
      ruleId: r.rule_id, ruleVersion: Number(r.rule_version), controlId: r.control_id,
      tolerancePercent: Number(r.tolerance_percent),
    })) as ControlMonitoringRule[],
    evidence: (evidence.data ?? []).map((r) => ({
      controlId: r.control_id, population: Number(r.population), deviations: Number(r.deviations),
      testedAt: r.tested_at,
    })) as ControlTestEvidence[],
    thresholds: thresholds.data
      ? {
          significanceThresholdPercent: Number(thresholds.data.significance_threshold_percent),
          materialityThresholdPercent: Number(thresholds.data.materiality_threshold_percent),
        }
      : null,
  };
}

/**
 * Monitor one organisation's controls and append a finding for every breach. The monitored run reads
 * the config (RLS to the caller's org) and records through `icfr_finding_record`, which enforces the
 * right and the feature.
 */
export async function runIcfrMonitoring(
  orgId: string,
  engagementId: string | null,
  evaluatedAt: string,
): Promise<{ result: ControlMonitoringResult; recorded: DataResult }> {
  const config = await listIcfrConfig(orgId);
  const result = monitorControls({
    controls: config.controls,
    rules: config.rules,
    evidence: config.evidence,
    thresholds: config.thresholds ?? undefined,
  });
  if (!result.breaches.length) return { result, recorded: { ok: true } };

  const recorded = await callRpc('icfr_finding_record', {
    p_org: orgId, p_engagement_id: engagementId, p_evaluated_at: evaluatedAt,
    p_findings: result.breaches.map((b) => ({
      ruleId: b.ruleId, ruleVersion: b.ruleVersion, controlId: b.controlId,
      severity: b.severity, reason: `ICFR control ${b.controlId} breached: ${b.basis}`,
    })),
  });
  return { result, recorded };
}

/** Save an ICFR control (edit_config is enforced at the database). */
export function saveIcfrControl(input: {
  orgId: string; controlId: string; taxonomy: string; component: string; principle: number;
  assertion: string; owner: string; testProcedure: string; compensatingControlId?: string | null;
}): Promise<DataResult> {
  return callRpc('icfr_control_save', {
    p_org: input.orgId, p_control_id: input.controlId, p_taxonomy: input.taxonomy,
    p_component: input.component, p_principle: input.principle, p_assertion: input.assertion,
    p_owner: input.owner, p_test_procedure: input.testProcedure,
    p_compensating_control_id: input.compensatingControlId ?? null,
  });
}

/** Save an ICFR monitoring rule for a control. */
export function saveIcfrRule(input: {
  orgId: string; ruleId: string; ruleVersion: number; controlId: string; tolerancePercent: number;
}): Promise<DataResult> {
  return callRpc('icfr_rule_save', {
    p_org: input.orgId, p_rule_id: input.ruleId, p_rule_version: input.ruleVersion,
    p_control_id: input.controlId, p_tolerance_percent: input.tolerancePercent,
  });
}

/** Save a control's test evidence (the scheduled control test writes here, then monitoring runs). */
export function saveIcfrEvidence(input: {
  orgId: string; controlId: string; population: number; deviations: number; testedAt: string;
}): Promise<DataResult> {
  return callRpc('icfr_evidence_save', {
    p_org: input.orgId, p_control_id: input.controlId, p_population: input.population,
    p_deviations: input.deviations, p_tested_at: input.testedAt,
  });
}

// ---------------------------------------------------------------------------
// D7 — population-level forensic analytics.
// ---------------------------------------------------------------------------

/**
 * Load a locked population's rows as the forensic engine's entries. The row payload is free-form, so
 * the well-known keys are mapped and anything else is left null — a missing value is reported
 * honestly, never invented. RLS filters to the caller's org.
 */
export async function loadForensicPopulation(populationId: string): Promise<PopulationEntry[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data } = await sb.from('population_rows').select('row_ref, data').eq('population_id', populationId);
  return (data ?? []).map((r) => {
    const p = (r.data ?? {}) as Record<string, unknown>;
    const amount = p.amount ?? p.amt ?? p.value;
    const date = p.date ?? p.txn_date ?? p.transaction_date;
    const user = p.user ?? p.created_by;
    const approver = p.approver ?? p.approved_by;
    return {
      rowRef: Number(r.row_ref) || 0,
      amount: typeof amount === 'number' ? amount : null,
      date: typeof date === 'string' ? date : null,
      user: typeof user === 'string' ? user : null,
      approver: typeof approver === 'string' ? approver : null,
      attributes: p as Record<string, unknown>,
    };
  });
}

/** Run the named forensic rules over a population and record the findings. */
export async function runForensicAnalytics(
  orgId: string,
  populationId: string,
  engagementId: string | null,
  evaluatedAt: string,
  rules: ForensicRule[],
): Promise<{ results: ForensicRuleResult[]; recorded: DataResult }> {
  const entries = await loadForensicPopulation(populationId);
  const results = runForensicRules(entries, rules);
  const fired = results.filter((r) => r.flaggedCount > 0);
  if (!fired.length) return { results, recorded: { ok: true } };
  const recorded = await callRpc('forensic_finding_record', {
    p_org: orgId, p_population_id: populationId, p_engagement_id: engagementId,
    p_evaluated_at: evaluatedAt,
    p_findings: fired.map((r) => ({
      ruleId: r.ruleId, ruleVersion: r.ruleVersion, checkId: r.checkId,
      flaggedCount: r.flaggedCount, rowRefs: r.rowRefs, source: r.source, reason: r.reason,
    })),
  });
  return { results, recorded };
}

// ---------------------------------------------------------------------------
// D8 — policy-to-control gap analysis.
// ---------------------------------------------------------------------------

/** Load an organisation's obligations and its controls, then analyse coverage. */
export async function loadGapInputs(orgId: string): Promise<{ obligations: GapObligation[]; controls: GapControl[] }> {
  const sb = getClient();
  if (!sb) return { obligations: [], controls: [] };
  const [obl, ctrl] = await Promise.all([
    sb.from('policy_obligations').select('obligation_id,source_clause,subject,control_ids').eq('org_id', orgId),
    sb.from('policy_controls').select('control_id,label').eq('org_id', orgId),
  ]);
  return {
    obligations: (obl.data ?? []).map((r) => ({
      obligationId: r.obligation_id, sourceClause: r.source_clause, subject: r.subject,
      controlIds: r.control_ids == null ? null : ((r.control_ids ?? []) as string[]),
    })) as GapObligation[],
    controls: (ctrl.data ?? []).map((r) => ({ controlId: r.control_id, label: r.label })) as GapControl[],
  };
}

export async function runGapAnalysis(orgId: string): Promise<{ result: GapAnalysisResult; recorded: DataResult }> {
  const { obligations, controls } = await loadGapInputs(orgId);
  const result = analyseGaps(obligations, controls);
  if (!result.gaps.length) return { result, recorded: { ok: true } };
  const recorded = await callRpc('gap_finding_record', {
    p_org: orgId,
    p_findings: result.gaps.map((g) => ({
      obligationId: g.obligationId, sourceClause: g.sourceClause, status: g.status, reason: g.reason,
    })),
  });
  return { result, recorded };
}

// ---------------------------------------------------------------------------
// D9 — assurance over assurance (IIA Global Internal Audit Standards 2024).
// ---------------------------------------------------------------------------

/** Load the metrics D9 measures. A metric with no input is reported "unknown", never 0. */
export async function loadAssuranceMetricInputs(orgId: string): Promise<AssuranceMetricInput> {
  const sb = getClient();
  if (!sb) return { metrics: [], asOf: '' };
  const { data } = await sb.from('assurance_metrics').select('metric_id,standard,label,value,evidence_ref').eq('org_id', orgId);
  const metrics: AssuranceMetric[] = (data ?? []).map((r) => ({
    metricId: r.metric_id, standard: r.standard, label: r.label,
    value: r.value == null ? null : Number(r.value), evidenceRef: r.evidence_ref ?? null,
  }));
  return { metrics, asOf: '' };
}

export async function runAssuranceOverAssurance(
  orgId: string,
  asOf: string,
): Promise<AssuranceOverAssuranceResult> {
  const inputs = await loadAssuranceMetricInputs(orgId);
  return assuranceOverAssurance({ ...inputs, asOf });
}

/** Save an IIA-2024 metric. A metric saved with no value is unknown, never 0 (edit_config enforced). */
export function saveAssuranceMetric(input: {
  orgId: string; metricId: string; standard: string; label: string;
  value: number | null; evidenceRef?: string | null;
}): Promise<DataResult> {
  return callRpc('assurance_metric_save', {
    p_org: input.orgId, p_metric_id: input.metricId, p_standard: input.standard,
    p_label: input.label, p_value: input.value, p_evidence_ref: input.evidenceRef ?? null,
  });
}

