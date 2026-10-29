/**
 * The deterministic capability library — the catalogue and one uniform evaluator (D1-D4).
 *
 * Twenty capabilities across four families. Each is a pure function in its own module; this file
 * names them, declares what inputs each needs, and evaluates one against a bundle of already-scoped
 * inputs. The screen has ONE call site (`evaluateCapability`) for the whole library, so a capability
 * cannot be added to a module and left unreachable.
 *
 * Pure: `evaluateCapability` takes the inputs and the day as arguments and returns a uniform result.
 * It reads no clock and no client. When a capability's inputs are not present it returns
 * `awaiting_input` and names exactly what is missing — it never invents a number and never silently
 * shows an empty result as a clean bill of health.
 */
import type { AuditControl, AuditEntity, AuditEngagement, AuditIssue, WorkingPaper } from '../../types';
import type { CapabilityKind } from '../../data/capabilities';
import { rightsForRole, type Right } from '../rights';
import type { Role } from '../../types';
import {
  controlCoverageMatrix,
  controlEffectivenessHistory,
  keyControlIndicator,
  residualRiskDrift,
  riskAppetiteBreach,
  type ControlDependency,
  type RiskSnapshot,
} from './riskControl';
import {
  chainOfCustody,
  evidenceFreshness,
  evidenceSufficiency,
  populationProfile,
  stratificationSuggestion,
  type EvidenceItem,
  type PopulationRecord,
} from './populationEvidence';
import {
  delegationOfAuthorityBreach,
  meetingGovernance,
  policyExceptionRegister,
  regulatoryChangeImpact,
  segregationOfDuties,
  type ApprovalRecord,
  type DelegationLimit,
  type MeetingRecord,
  type PolicyException,
  type PolicyReference,
  type PrincipalRights,
  type Regulation,
} from './processGovernance';
import {
  auditTrailCompleteness,
  engagementHealth,
  findingAgeingAndRecurrence,
  reportConsistency,
  reviewerLoadAndAgeing,
  type ReportFigure,
} from './assuranceOps';

export * from './riskControl';
export * from './populationEvidence';
export * from './processGovernance';
export * from './assuranceOps';

export interface CapabilityConfigValues {
  riskTolerance: AuditEntity['residualRisk'];
  stratificationSample: number;
  reviewerAgeingDays: number;
}

export const DEFAULT_CONFIG_VALUES: CapabilityConfigValues = {
  riskTolerance: 'high',
  stratificationSample: 25,
  reviewerAgeingDays: 14,
};

/** The bundle of already-scoped inputs the screen hands to the evaluator. Every field is optional. */
export interface CapabilityInputs {
  asOf: string;
  entities?: AuditEntity[];
  controls?: AuditControl[];
  engagements?: AuditEngagement[];
  issues?: AuditIssue[];
  workpapers?: WorkingPaper[];
  /** Prior risk snapshots for the drift capability. */
  riskSnapshots?: RiskSnapshot[];
  /** Control dependency edges for the key-control indicator. */
  controlDependencies?: ControlDependency[];
  /** Per-control observation history (oldest first) for effectiveness history. */
  controlHistory?: Record<string, string[]>;
  /** Population rows for the population/evidence family. */
  populationRows?: PopulationRecord[];
  /** Evidence items for the population/evidence family. */
  evidenceItems?: EvidenceItem[];
  /** The period a test covers, for sufficiency and freshness. */
  testPeriod?: [string, string];
  /** The report date, for freshness. */
  reportDate?: string;
  /** Population value totals, for sufficiency. */
  populationTotalCents?: number;
  coveredCents?: number;
  /** Governance inputs. */
  delegationLimits?: DelegationLimit[];
  approvals?: ApprovalRecord[];
  policyExceptions?: PolicyException[];
  meetings?: MeetingRecord[];
  regulations?: Regulation[];
  policyReferences?: PolicyReference[];
  /** The event keys the engagement's audit trail holds, and the required set. */
  trailPresentKeys?: string[];
  trailRequired?: Array<{ key: string; label: string }>;
  trailEngagementId?: string;
  /** Report figures, for consistency. */
  reportFigures?: ReportFigure[];
  /** The principal-rights set for the SoD matrix; when absent the seed roles are used. */
  principals?: PrincipalRights[];
}

export type CapabilityStatus = 'ready' | 'empty' | 'awaiting_input';

export interface CapabilityRow {
  label: string;
  detail: string;
  /** The record ids behind this row, so it drills to its source. */
  refs?: string[];
}

export interface CapabilityEvaluation {
  id: string;
  kind: CapabilityKind;
  label: string;
  status: CapabilityStatus;
  /** A one-sentence plain statement of what the capability found. */
  headline: string;
  rows: CapabilityRow[];
  /** The input the capability needs but does not have, when `awaiting_input`. */
  needs: string | null;
  /** The rule that produced the result, in plain words, for the explain layer. */
  rule: string;
}

export interface CapabilityDescriptor {
  id: string;
  kind: CapabilityKind;
  label: string;
  summary: string;
}

/** The twenty capabilities, in a stable order. The screen renders this; the gate reads it. */
export const CAPABILITY_CATALOG: CapabilityDescriptor[] = [
  { id: 'risk.residual_drift', kind: 'risk_control', label: 'Residual-risk drift', summary: 'Each entity’s residual rating against its own prior snapshot.' },
  { id: 'risk.coverage_matrix', kind: 'risk_control', label: 'Control coverage matrix', summary: 'Which risks have a control and whether that control has been tested.' },
  { id: 'risk.effectiveness_history', kind: 'risk_control', label: 'Control effectiveness history', summary: 'The trend of each control’s test outcomes.' },
  { id: 'risk.key_control', kind: 'risk_control', label: 'Key-control indicator', summary: 'Controls whose failure exposes the most other controls.' },
  { id: 'risk.appetite_breach', kind: 'risk_control', label: 'Risk appetite breach', summary: 'Live exposure against the organisation’s stated tolerance.' },
  { id: 'pop.profile', kind: 'population_evidence', label: 'Population profile', summary: 'Row count, value range, null and duplicate density, period coverage.' },
  { id: 'pop.stratification', kind: 'population_evidence', label: 'Stratification suggestion', summary: 'Proposed strata and sample sizes from the population’s own shape.' },
  { id: 'pop.sufficiency', kind: 'population_evidence', label: 'Evidence sufficiency', summary: 'Whether evidence covers the whole tested period and value.' },
  { id: 'pop.freshness', kind: 'population_evidence', label: 'Evidence freshness', summary: 'Evidence dated after the report, or stale before the period.' },
  { id: 'pop.custody', kind: 'population_evidence', label: 'Chain of custody', summary: 'Who attached each item, when, and its hash.' },
  { id: 'gov.sod', kind: 'process_governance', label: 'Segregation-of-duties matrix', summary: 'Principals that hold an incompatible combination of rights.' },
  { id: 'gov.delegation', kind: 'process_governance', label: 'Delegation-of-authority breach', summary: 'Approvals above the approver’s own limit.' },
  { id: 'gov.exceptions', kind: 'process_governance', label: 'Policy exception register', summary: 'Exceptions granted, and which have expired.' },
  { id: 'gov.meetings', kind: 'process_governance', label: 'Meeting-governance score', summary: 'Quorum held, actions assigned, prior actions closed.' },
  { id: 'gov.regulatory', kind: 'process_governance', label: 'Regulatory change impact', summary: 'Policies aligned to an older regulation version.' },
  { id: 'ops.engagement_health', kind: 'assurance_ops', label: 'Engagement health', summary: 'Behind, overdue or blocked, from each engagement’s own timestamps.' },
  { id: 'ops.reviewer_load', kind: 'assurance_ops', label: 'Reviewer load and ageing', summary: 'How long items sit in review, by reviewer.' },
  { id: 'ops.finding_ageing', kind: 'assurance_ops', label: 'Finding ageing and recurrence', summary: 'Findings open too long, and findings recurring across periods.' },
  { id: 'ops.report_consistency', kind: 'assurance_ops', label: 'Report consistency', summary: 'The same figure in two places with different values.' },
  { id: 'ops.trail_completeness', kind: 'assurance_ops', label: 'Audit-trail completeness', summary: 'Every required event present, with the gap named.' },
];

/** The seed roles as principal-rights, for the SoD matrix when the caller supplies no principals. */
export function seedPrincipals(): PrincipalRights[] {
  const roles: Role[] = ['cia', 'audit_manager', 'reviewer', 'preparer', 'observer', 'auditee', 'org_admin'];
  return roles.map((role) => ({
    id: `role.${role}`,
    label: role,
    rights: rightsForRole(role) as Partial<Record<Right, boolean>>,
  }));
}

function has<T>(v: T[] | undefined): v is T[] {
  return Array.isArray(v) && v.length > 0;
}

/**
 * Evaluate one capability against the inputs. Total: it always returns a result. When the inputs a
 * capability needs are absent it returns `awaiting_input` and names the missing input; when the
 * inputs are present but there is nothing to report it returns `empty` (an honest clean result, not a
 * fabricated finding).
 */
export function evaluateCapability(
  id: string,
  input: CapabilityInputs,
  config: CapabilityConfigValues = DEFAULT_CONFIG_VALUES
): CapabilityEvaluation {
  const base = CAPABILITY_CATALOG.find((c) => c.id === id);
  if (!base) {
    return {
      id, kind: 'assurance_ops', label: 'Unknown capability', status: 'awaiting_input',
      headline: 'This capability is not in the catalogue.', rows: [], needs: 'a catalogue entry',
      rule: 'A capability must be declared in CAPABILITY_CATALOG before it can run.',
    };
  }
  const meta = { id, kind: base.kind, label: base.label };
  const awaiting = (needs: string, rule: string): CapabilityEvaluation => ({
    ...meta, status: 'awaiting_input', headline: `Awaiting input: ${needs}.`, rows: [], needs, rule,
  });
  const done = (headline: string, rows: CapabilityRow[], rule: string): CapabilityEvaluation => ({
    ...meta, status: rows.length ? 'ready' : 'empty', headline, rows, needs: null, rule,
  });

  switch (id) {
    case 'risk.residual_drift': {
      if (!has(input.entities)) return awaiting('the scoped entities', 'Each entity is compared to its own prior snapshot; a movement is a signed step count.');
      if (!has(input.riskSnapshots)) return awaiting('a prior risk snapshot', 'Drift needs a prior snapshot to move from; without one there is nothing to compare.');
      const rows = residualRiskDrift({ entities: input.entities, snapshots: input.riskSnapshots, tolerance: config.riskTolerance });
      const moved = rows.filter((r) => r.direction !== 'unchanged');
      return done(
        `${moved.length} of ${rows.length} entities moved; ${rows.filter((r) => r.breaches).length} at or above the ${config.riskTolerance} tolerance.`,
        moved.map((r) => ({ label: r.name, detail: `${r.prior} → ${r.current} (${r.step > 0 ? '+' : ''}${r.step})`, refs: [r.entityId] })),
        'Each entity’s residual rating is compared to its own prior snapshot; the step is signed and the tolerance is the organisation’s.'
      );
    }
    case 'risk.coverage_matrix': {
      if (!has(input.entities)) return awaiting('the scoped entities', 'Coverage is a set operation over the register.');
      const m = controlCoverageMatrix(input.entities, input.controls ?? []);
      return done(
        `${m.covered} of ${m.total} entities have a control; ${m.tested} have a tested control; ${m.gaps.length} gaps.`,
        m.gaps.map((g) => ({ label: g.entityName, detail: g.gap === 'no_control' ? 'no control on the entity' : `${g.controlCount} control(s), none tested`, refs: [g.entityId] })),
        'A risk with no control and a control with no test are both gaps; the cell says which.'
      );
    }
    case 'risk.effectiveness_history': {
      if (!has(input.controls)) return awaiting('the scoped controls', 'Effectiveness is the trend of a control’s own observations.');
      const rows = controlEffectivenessHistory(input.controls, input.controlHistory ?? {});
      const flagged = rows.filter((r) => r.trend === 'deteriorating');
      return done(
        `${flagged.length} control(s) deteriorating; ${rows.filter((r) => r.trend === 'improving').length} improving.`,
        flagged.map((r) => ({ label: `${r.code} · ${r.title}`, detail: `${r.consecutiveFailures} consecutive failing observations`, refs: [r.controlId] })),
        'Two or more consecutive failing observations is a deteriorating control; a run of effective observations after a failure is improving.'
      );
    }
    case 'risk.key_control': {
      if (!has(input.controls)) return awaiting('the scoped controls', 'A blast radius is a graph traversal over the control dependencies.');
      if (!has(input.controlDependencies)) return awaiting('the control dependency edges', 'A blast radius needs the dependency graph; with no edges no control exposes another.');
      const rows = keyControlIndicator(input.controls, input.controlDependencies);
      const top = rows.filter((r) => r.blastRadius > 0);
      return done(
        `${top.length} control(s) expose another control; the widest blast radius is ${rows[0]?.blastRadius ?? 0}.`,
        top.map((r) => ({ label: `${r.code} · ${r.title}`, detail: `failure exposes ${r.blastRadius} control(s)`, refs: [r.controlId, ...r.exposes] })),
        'A control’s blast radius is the number of distinct other controls reachable from it through the dependency graph.'
      );
    }
    case 'risk.appetite_breach': {
      if (!has(input.entities)) return awaiting('the scoped entities', 'Appetite compares live exposure to the stated tolerance.');
      const b = riskAppetiteBreach(input.entities, config.riskTolerance);
      return done(
        b.withinAppetite
          ? `No entity breaches the ${config.riskTolerance} tolerance.`
          : `${b.breaches.length} entity/entities breach the ${config.riskTolerance} tolerance.`,
        b.breaches.map((r) => ({ label: r.name, detail: `${r.residualRisk} residual, ${r.stepsPast} step(s) past tolerance`, refs: [r.entityId] })),
        'An entity at or above the stated tolerance is a breach; how far past is reported so the worst is visible first.'
      );
    }
    case 'pop.profile': {
      if (!has(input.populationRows)) return awaiting('a population’s rows', 'A profile describes the population’s own shape.');
      const p = populationProfile(input.populationRows);
      return done(
        `${p.rowCount} rows, ${p.withAmount} with a value, ${p.nullAmounts} missing a value, ${p.duplicateRows} duplicate.`,
        p.flags.map((f) => ({ label: f, detail: flagDetail(f) })),
        'A deterministic description of the population’s shape; anything implausible is flagged before testing starts.'
      );
    }
    case 'pop.stratification': {
      if (!has(input.populationRows)) return awaiting('a population’s rows', 'Strata are derived from the population’s own shape.');
      const strata = stratificationSuggestion(input.populationRows, config.stratificationSample);
      return done(
        `${strata.length} stratum/strata proposed for a sample of ${config.stratificationSample}.`,
        strata.map((s) => ({ label: s.label, detail: `${s.population} rows → sample ${s.sample}` })),
        'Group by category when present, else band by value; each stratum’s sample is its share of the total, floored at one.'
      );
    }
    case 'pop.sufficiency': {
      if (!has(input.evidenceItems)) return awaiting('the evidence items', 'Sufficiency is a comparison of evidence cover against the tested period and value.');
      if (!input.testPeriod) return awaiting('the tested period', 'Sufficiency needs the period the test covers.');
      const s = evidenceSufficiency({
        items: input.evidenceItems, period: input.testPeriod,
        populationTotalCents: input.populationTotalCents, coveredCents: input.coveredCents,
      });
      return done(
        s.sufficient ? 'The evidence covers the whole period and value.' : `Insufficient: ${s.reasons.join(', ')}.`,
        s.uncovered.map(([from, to]) => ({ label: `${from} → ${to}`, detail: 'uncovered stretch' })),
        'Does the evidence cover the whole tested period and the whole tested value, or only part?'
      );
    }
    case 'pop.freshness': {
      if (!has(input.evidenceItems)) return awaiting('the evidence items', 'Freshness compares attachment dates to the report and the period.');
      if (!input.reportDate || !input.testPeriod) return awaiting('the report date and the tested period', 'Freshness needs the report date and the period it purports to cover.');
      const findings = evidenceFreshness({ items: input.evidenceItems, reportDate: input.reportDate, period: input.testPeriod });
      return done(
        findings.length ? `${findings.length} freshness issue(s).` : 'No freshness issue.',
        findings.map((f) => ({ label: f.name, detail: f.detail, refs: [f.id] })),
        'Evidence attached after the report, or whose cover ends before the period starts, is flagged.'
      );
    }
    case 'pop.custody': {
      if (!has(input.evidenceItems)) return awaiting('the evidence items', 'Custody is the attacher, time and hash of each item.');
      const c = chainOfCustody(input.evidenceItems);
      return done(
        c.complete ? `The chain is complete across ${c.entries.length} item(s).` : `${c.broken.length} item(s) break the chain.`,
        c.broken.map((id) => ({ label: id, detail: 'no attacher or a malformed hash', refs: [id] })),
        'Every item carries who attached it, when, and its hash, so any later change is detectable.'
      );
    }
    case 'gov.sod': {
      const principals = has(input.principals) ? input.principals : seedPrincipals();
      const m = segregationOfDuties(principals);
      return done(
        m.clean ? 'No principal holds an incompatible combination of rights.' : `${m.conflicts.length} conflict(s) across ${m.conflictedPrincipals.length} principal(s).`,
        m.conflicts.map((c) => ({ label: c.principalLabel, detail: `${c.a} + ${c.b}: ${c.reason}`, refs: [c.principalId] })),
        'The forbidden right combinations are data; a principal holding both halves of a control is a conflict.'
      );
    }
    case 'gov.delegation': {
      if (!has(input.approvals)) return awaiting('the recorded approvals', 'A delegation breach compares an approval to the approver’s limit.');
      const r = delegationOfAuthorityBreach(input.delegationLimits ?? [], input.approvals);
      return done(
        r.clean ? `No approval exceeds its approver’s limit.` : `${r.breaches.length} approval(s) exceed their approver’s limit.`,
        r.breaches.map((b) => ({ label: b.subject, detail: `${b.principalLabel}: ${b.amountCents} over limit ${b.limitCents}`, refs: [b.approvalId] })),
        'An approval above the approver’s own limit is a breach; an approver with no limit is counted, not ignored.'
      );
    }
    case 'gov.exceptions': {
      if (!has(input.policyExceptions)) return awaiting('the granted policy exceptions', 'The register lists exceptions and whether they have expired.');
      const reg = policyExceptionRegister(input.policyExceptions, input.asOf);
      return done(
        reg.expired.length ? `${reg.expired.length} exception(s) expired.` : `No exception has expired; ${reg.active.length} active.`,
        reg.expired.map((e) => ({ label: `${e.policy} → ${e.grantedTo}`, detail: `expired ${e.expiresAt ?? ''}`, refs: [e.id] })),
        'An exception is expired when its expiry is before the as-at day; time is an argument.'
      );
    }
    case 'gov.meetings': {
      if (!has(input.meetings)) return awaiting('the recorded meetings', 'The score is quorum, actions assigned and prior actions closed.');
      const g = meetingGovernance(input.meetings);
      return done(
        g.averageScore === null ? 'No meetings recorded.' : `Average governance score ${g.averageScore.toFixed(2)} of 3; ${g.failingQuorum.length} meeting(s) without quorum.`,
        g.failingQuorum.map((id) => ({ label: id, detail: 'quorum not held', refs: [id] })),
        'Three deterministic points per meeting: quorum held, at least one action assigned, every prior action closed.'
      );
    }
    case 'gov.regulatory': {
      if (!has(input.policyReferences) || !has(input.regulations)) return awaiting('the policies and the regulations they reference', 'Impact compares a policy’s aligned version to the version in force.');
      const r = regulatoryChangeImpact(input.regulations, input.policyReferences);
      return done(
        r.clean ? 'Every policy is aligned to the version in force.' : `${r.stale.length} policy/policies out of date.`,
        r.stale.map((s) => ({ label: s.policyTitle, detail: `aligned ${s.alignedVersion}, in force ${s.currentVersion}`, refs: [s.policyId, s.regulationId] })),
        'A policy aligned to an older version than the one in force is out of date.'
      );
    }
    case 'ops.engagement_health': {
      if (!has(input.engagements)) return awaiting('the scoped engagements', 'Health is overdue, behind the clock and blocked.');
      const rows = engagementHealth({ engagements: input.engagements, asOf: input.asOf });
      const flagged = rows.filter((r) => r.health !== 'healthy');
      return done(
        `${flagged.length} of ${rows.length} engagement(s) need attention.`,
        flagged.map((r) => ({ label: r.title, detail: `${r.health}: ${r.reasons.join(', ')}`, refs: [r.engagementId] })),
        'A closed engagement is healthy; otherwise overdue alone, or two signals, is at risk, and a blocked record is blocked.'
      );
    }
    case 'ops.reviewer_load': {
      if (!has(input.workpapers)) return awaiting('the scoped workpapers', 'Load is how many items sit with each reviewer and for how long.');
      const rows = reviewerLoadAndAgeing({ workpapers: input.workpapers, asOf: input.asOf, ageingThresholdDays: config.reviewerAgeingDays });
      const ageing = rows.filter((r) => r.ageing.length > 0);
      return done(
        `${rows.length} reviewer(s) hold work; ${ageing.length} hold an item older than ${config.reviewerAgeingDays} days.`,
        ageing.map((r) => ({ label: r.reviewerId, detail: `${r.inReview} in review, oldest ${r.oldestDays} days`, refs: r.ageing })),
        'Age is measured from the paper’s prepared date to the as-at day; ordered by load then age.'
      );
    }
    case 'ops.finding_ageing': {
      if (!has(input.issues)) return awaiting('the scoped issues', 'Ageing is arithmetic from the identified date; recurrence is exact-title matching.');
      const r = findingAgeingAndRecurrence(input.issues, input.asOf);
      return done(
        `${r.overdue.length} overdue, ${r.recurring.length} recurring.`,
        [...r.overdue.map((x) => ({ label: x.title, detail: `overdue, ${x.ageDays} days old`, refs: [x.issueId] })),
         ...r.recurring.map((x) => ({ label: x.title, detail: `recurs from ${x.recursOf.join(', ')}`, refs: [x.issueId, ...x.recursOf] }))],
        'Ageing is arithmetic; recurrence is exact-title matching against an earlier identified date — a deterministic signal, not a semantic judgement.'
      );
    }
    case 'ops.report_consistency': {
      if (!has(input.reportFigures)) return awaiting('the report figures', 'Consistency compares the same labelled figure across its locations.');
      const r = reportConsistency(input.reportFigures);
      return done(
        r.consistent ? 'No figure appears with two different values.' : `${r.inconsistencies.length} figure(s) appear with different values.`,
        r.inconsistencies.map((i) => ({ label: i.label, detail: `${i.values.length} values, spread ${i.spread}`, refs: i.values.map((v) => v.id) })),
        'The same labelled figure with two values is caught before issue; values are compared exactly.'
      );
    }
    case 'ops.trail_completeness': {
      if (!input.trailRequired || input.trailRequired.length === 0) return awaiting('the required-event set', 'Completeness is the set difference between the trail and the required events.');
      const r = auditTrailCompleteness(input.trailEngagementId ?? '', input.trailPresentKeys ?? [], input.trailRequired);
      return done(
        r.complete ? 'The trail holds every required event.' : `${r.missing.length} required event(s) missing.`,
        r.missing.map((key) => ({ label: key, detail: 'required but absent from the trail' })),
        'The set difference between the events the trail holds and the events the organisation requires.'
      );
    }
    default:
      return awaiting('a catalogue entry', 'This capability is not implemented.');
  }
}

function flagDetail(flag: string): string {
  switch (flag) {
    case 'empty_population': return 'the population has no rows';
    case 'no_amounts': return 'no row carries a value';
    case 'null_amounts': return 'some rows are missing a value';
    case 'single_date': return 'every row is dated the same day';
    case 'duplicates': return 'exact duplicate rows are present';
    default: return flag;
  }
}
