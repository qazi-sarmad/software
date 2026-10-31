/**
 * D5 — Continuous control monitoring over ICFR (docs/ASSURANCE-RULEBOOKS.md §1, F121).
 *
 * The engine monitors a configured internal-control system (COSO ICIF-2013) against evidence from the
 * scheduled control tests, and classifies a failing control by a deterministic ladder (the three-way
 * deficiency split of PCAOB AS 2201, the SOX §404 ICFR standard). Nothing here is a model: every
 * severity is decided by a rule over configured thresholds, and every figure the rule used is named.
 *
 * Sources (verified in docs/ASSURANCE-RULEBOOKS.md §1):
 *   - COSO Internal Control — Integrated Framework, 2013 (ICIF-2013): 5 components, 17 principles.
 *   - PCAOB AS 2201 (An Audit of Internal Control Over Financial Reporting …) — the deficiency ladder.
 *   - ISO/IEC 27001:2022 Annex A — 93 controls in 4 themes (the ISO subset taxonomy).
 *   - NIST SP 800-53 Rev. 5 — control families (the NIST subset taxonomy).
 *   - COBIT 2019 (ISACA) — governance/management objectives (the IT subset taxonomy).
 * We encode the STRUCTURE (ids, counts, themes, standard numbers) and paraphrase in our own words;
 * never the licensed wording (rulebook header).
 *
 * Pure (L4): every input is an argument; no clock, no client, no model. A missing figure is reported
 * as missing — never converted to zero and never a silent pass.
 */

// ---------------------------------------------------------------------------
// The COSO ICIF-2013 taxonomy (structure only; wording paraphrased).
// ---------------------------------------------------------------------------

export type CosoComponent =
  | 'control_environment'
  | 'risk_assessment'
  | 'control_activities'
  | 'information_communication'
  | 'monitoring_activities';

export interface CosoComponentRow {
  id: CosoComponent;
  label: string;
  principleCount: number;
}

/** The five COSO ICIF-2013 components. 5 + 4 + 3 + 3 + 2 = 17 principles across them. */
export const COSO_COMPONENTS: CosoComponentRow[] = [
  { id: 'control_environment', label: 'Control Environment', principleCount: 5 },
  { id: 'risk_assessment', label: 'Risk Assessment', principleCount: 4 },
  { id: 'control_activities', label: 'Control Activities', principleCount: 3 },
  { id: 'information_communication', label: 'Information and Communication', principleCount: 3 },
  { id: 'monitoring_activities', label: 'Monitoring Activities', principleCount: 2 },
];

export interface CosoPrincipleRow {
  /** 1-based principle number, 1..17, as numbered in ICIF-2013. */
  number: number;
  component: CosoComponent;
  /** A short paraphrase of the principle, in our own words. */
  summary: string;
}

/** The 17 COSO ICIF-2013 principles, each under its component. Counts match the rows above. */
export const COSO_PRINCIPLES: CosoPrincipleRow[] = [
  { number: 1, component: 'control_environment', summary: 'the organisation demonstrates a commitment to integrity and ethical values' },
  { number: 2, component: 'control_environment', summary: 'the board exercises oversight of the internal control system' },
  { number: 3, component: 'control_environment', summary: 'management establishes structures and reporting lines to achieve objectives' },
  { number: 4, component: 'control_environment', summary: 'the organisation demonstrates a commitment to competence' },
  { number: 5, component: 'control_environment', summary: 'the organisation holds individuals accountable for their internal control responsibilities' },
  { number: 6, component: 'risk_assessment', summary: 'the organisation specifies objectives with sufficient clarity to enable risk identification' },
  { number: 7, component: 'risk_assessment', summary: 'the organisation identifies and assesses risks to the achievement of its objectives' },
  { number: 8, component: 'risk_assessment', summary: 'the organisation considers the potential for fraud in assessing risks' },
  { number: 9, component: 'risk_assessment', summary: 'the organisation identifies and assesses changes that could significantly affect the system of internal control' },
  { number: 10, component: 'control_activities', summary: 'the organisation selects and develops control activities that mitigate risks' },
  { number: 11, component: 'control_activities', summary: 'the organisation selects and develops general control activities over technology' },
  { number: 12, component: 'control_activities', summary: 'the organisation deploys control activities through policy and procedure' },
  { number: 13, component: 'information_communication', summary: 'the organisation obtains or generates relevant, quality information' },
  { number: 14, component: 'information_communication', summary: 'the organisation communicates internal control information internally' },
  { number: 15, component: 'information_communication', summary: 'the organisation communicates with external parties about matters affecting internal control' },
  { number: 16, component: 'monitoring_activities', summary: 'the organisation selects, develops and performs ongoing and separate evaluations' },
  { number: 17, component: 'monitoring_activities', summary: 'the organisation evaluates and communicates internal control deficiencies in a timely manner' },
];

/** The ICFR assertion set (PCAOB AS 2201): the assertion a control supports. */
export type Assertion =
  | 'existence_occurrence'
  | 'completeness'
  | 'accuracy_valuation'
  | 'cutoff'
  | 'classification'
  | 'presentation';

export const ASSERTIONS: { id: Assertion; label: string }[] = [
  { id: 'existence_occurrence', label: 'Existence / occurrence' },
  { id: 'completeness', label: 'Completeness' },
  { id: 'accuracy_valuation', label: 'Accuracy / valuation' },
  { id: 'cutoff', label: 'Cutoff' },
  { id: 'classification', label: 'Classification' },
  { id: 'presentation', label: 'Presentation' },
];

// ---------------------------------------------------------------------------
// Alternative control taxonomies (ISO 27001, NIST SP 800-53, COBIT) — the subset spines.
// ---------------------------------------------------------------------------

export type TaxonomyId = 'coso_icif_2013' | 'iso_27001_2022' | 'nist_sp_800_53_r5' | 'cobit_2019';

export interface Taxonomy {
  id: TaxonomyId;
  label: string;
  source: string;
  /** Control count when the source publishes one (ISO 27001: 93). Null when it does not. */
  controlCount: number | null;
  /** The themes / families / objectives the taxonomy groups controls into. */
  groups: string[];
}

export const TAXONOMIES: Taxonomy[] = [
  {
    id: 'coso_icif_2013', label: 'COSO Internal Control — Integrated Framework (2013)',
    source: 'COSO ICIF-2013', controlCount: null,
    groups: COSO_COMPONENTS.map((c) => c.label),
  },
  {
    id: 'iso_27001_2022', label: 'ISO/IEC 27001:2022 Annex A',
    source: 'ISO/IEC 27001:2022 §Annex A', controlCount: 93,
    groups: ['Organizational', 'People', 'Physical', 'Technological'],
  },
  {
    id: 'nist_sp_800_53_r5', label: 'NIST SP 800-53 Rev. 5 control families',
    source: 'NIST SP 800-53 Rev. 5', controlCount: null,
    groups: ['AC', 'AU', 'CA', 'CM', 'RA', 'SI', 'SC', 'CP', 'IR', 'AT'],
  },
  {
    id: 'cobit_2019', label: 'COBIT 2019 governance and management objectives',
    source: 'COBIT 2019 (ISACA)', controlCount: null,
    groups: ['EDM', 'APO', 'BAI', 'DSS', 'MEA'],
  },
];

// ---------------------------------------------------------------------------
// Control definitions and their monitored evidence.
// ---------------------------------------------------------------------------

export interface ControlDefinition {
  controlId: string;
  /** Which taxonomy the control belongs to. */
  taxonomy: TaxonomyId;
  component: CosoComponent;
  /** The COSO principle (1..17) the control realises. */
  principle: number;
  assertion: Assertion;
  owner: string;
  /** The test procedure the control is monitored with, in our own words. */
  testProcedure: string;
  /** A compensating control id, when one exists. A compensating control caps severity at deficiency. */
  compensatingControlId?: string;
}

export type Severity = 'deficiency' | 'significant_deficiency' | 'material_weakness';

export const SEVERITY_LADDER: { severity: Severity; test: string }[] = [
  { severity: 'deficiency', test: 'operated with a deviation below the significance threshold, or a compensating control exists' },
  { severity: 'significant_deficiency', test: 'a deficiency, or combination, less severe than a material weakness yet meriting attention by those charged with governance' },
  { severity: 'material_weakness', test: 'a reasonable possibility a material misstatement would not be prevented or detected on a timely basis' },
];

/** The configured, versioned thresholds the ladder reads. Config-as-ledger: reason-stamped upstream. */
export interface IcfrThresholds {
  /** A deviation rate (percent, 0..100) below this is a plain deficiency. */
  significanceThresholdPercent: number;
  /** A deviation rate at or above this is a material weakness. */
  materialityThresholdPercent: number;
}

export const DEFAULT_ICFR_THRESHOLDS: IcfrThresholds = {
  significanceThresholdPercent: 2,
  materialityThresholdPercent: 10,
};

export interface ControlTestEvidence {
  controlId: string;
  /** Rows the control operated over. */
  population: number;
  /** Rows where the control did not operate as designed. */
  deviations: number;
  /** The test instant — always an argument, never read from a clock. */
  testedAt: string;
}

export interface ControlMonitoringRule {
  ruleId: string;
  ruleVersion: number;
  controlId: string;
  /** The rule fires when the deviation rate is at or above `tolerancePercent`. */
  tolerancePercent: number;
}

export interface ControlBreach {
  controlId: string;
  ruleId: string;
  ruleVersion: number;
  severity: Severity;
  /** The deviation rate the rule measured, in percent; null when the population was empty. */
  deviationPercent: number | null;
  population: number;
  deviations: number;
  /** The exact figures the ladder used, so the auditor can reproduce the classification. */
  basis: string;
  compensatingControlId: string | null;
}

export type ControlOutcome = 'pass' | 'breach' | 'no_evidence' | 'unmonitored';

export interface ControlMonitoringRow {
  controlId: string;
  outcome: ControlOutcome;
  /** Present only when outcome is `breach`. */
  breach?: ControlBreach;
  /** A plain reason: why it passed, why it breached, or why it cannot be judged. */
  reason: string;
}

export interface ControlMonitoringResult {
  rows: ControlMonitoringRow[];
  /** Controls with no evidence at all — reported, never silently green. */
  noEvidence: string[];
  /** Controls configured but with no monitoring rule. */
  unmonitored: string[];
  breaches: ControlBreach[];
  /** Overall readiness: false when any control has no evidence or is unmonitored. */
  complete: boolean;
}

export interface ControlMonitoringInput {
  controls: ControlDefinition[];
  rules: ControlMonitoringRule[];
  evidence: ControlTestEvidence[];
  thresholds?: IcfrThresholds;
}

/**
 * Classify a failing control by the deterministic ladder.
 *
 * Order matters and is deliberate: a compensating control caps the severity at `deficiency` (the
 * rulebook's own test), because a compensated failure is still a deficiency but not a material one.
 * Below the significance threshold is also a plain deficiency. At or above materiality is a material
 * weakness. Between the two is a significant deficiency. A missing figure (an empty population) is
 * NOT zero — it is reported as missing by the caller, never classified here.
 */
export function classifySeverity(input: {
  population: number;
  deviations: number;
  thresholds: IcfrThresholds;
  compensatingControlId?: string;
}): { severity: Severity; deviationPercent: number; basis: string } {
  const { population, deviations, thresholds } = input;
  const rate = population === 0 ? 0 : (deviations / population) * 100;
  const rateText = `${round2(rate)}%`;
  if (input.compensatingControlId) {
    return {
      severity: 'deficiency',
      deviationPercent: rate,
      basis: `the deviation rate is ${rateText}, but compensating control ${input.compensatingControlId} caps the severity at a deficiency`,
    };
  }
  if (rate < thresholds.significanceThresholdPercent) {
    return {
      severity: 'deficiency',
      deviationPercent: rate,
      basis: `the deviation rate is ${rateText}, below the significance threshold ${thresholds.significanceThresholdPercent}%`,
    };
  }
  if (rate >= thresholds.materialityThresholdPercent) {
    return {
      severity: 'material_weakness',
      deviationPercent: rate,
      basis: `the deviation rate is ${rateText}, at or above the materiality threshold ${thresholds.materialityThresholdPercent}%`,
    };
  }
  return {
    severity: 'significant_deficiency',
    deviationPercent: rate,
    basis: `the deviation rate is ${rateText}, at or above the significance threshold ${thresholds.significanceThresholdPercent}% and below the materiality threshold ${thresholds.materialityThresholdPercent}%`,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Monitor every configured control.
 *
 * A control with no rule is reported `unmonitored` — it is NOT a pass. A control with a rule but no
 * evidence is `no_evidence` — also NOT a pass. A control whose deviation rate is at or above the
 * rule's tolerance breaches, and the breach carries its control id, the rule id AND version, and the
 * ladder's severity with its basis.
 */
export function monitorControls(input: ControlMonitoringInput): ControlMonitoringResult {
  const thresholds = input.thresholds ?? DEFAULT_ICFR_THRESHOLDS;
  const rulesByControl = new Map<string, ControlMonitoringRule>();
  for (const r of input.rules) rulesByControl.set(r.controlId, r);
  const evidenceByControl = new Map<string, ControlTestEvidence>();
  for (const e of input.evidence) evidenceByControl.set(e.controlId, e);

  const rows: ControlMonitoringRow[] = [];
  const noEvidence: string[] = [];
  const unmonitored: string[] = [];
  const breaches: ControlBreach[] = [];

  for (const control of input.controls) {
    const rule = rulesByControl.get(control.controlId);
    if (!rule) {
      unmonitored.push(control.controlId);
      rows.push({
        controlId: control.controlId, outcome: 'unmonitored',
        reason: `control ${control.controlId} has no monitoring rule, so it is not monitored — not a pass`,
      });
      continue;
    }
    const evidence = evidenceByControl.get(control.controlId);
    if (!evidence) {
      noEvidence.push(control.controlId);
      rows.push({
        controlId: control.controlId, outcome: 'no_evidence',
        reason: `control ${control.controlId} has a rule but no test evidence, so it cannot be judged — not a pass`,
      });
      continue;
    }
    if (evidence.population <= 0) {
      noEvidence.push(control.controlId);
      rows.push({
        controlId: control.controlId, outcome: 'no_evidence',
        reason: `control ${control.controlId} was tested over an empty population (0 rows), so the rate is unknown — not zero and not a pass`,
      });
      continue;
    }
    const rate = (evidence.deviations / evidence.population) * 100;
    if (rate + 1e-9 < rule.tolerancePercent) {
      rows.push({
        controlId: control.controlId, outcome: 'pass',
        reason: `control ${control.controlId} deviated ${round2(rate)}%, below the rule ${rule.ruleId} tolerance ${rule.tolerancePercent}%`,
      });
      continue;
    }
    const classified = classifySeverity({
      population: evidence.population,
      deviations: evidence.deviations,
      thresholds,
      compensatingControlId: control.compensatingControlId,
    });
    const breach: ControlBreach = {
      controlId: control.controlId,
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      severity: classified.severity,
      deviationPercent: classified.deviationPercent,
      population: evidence.population,
      deviations: evidence.deviations,
      basis: classified.basis,
      compensatingControlId: control.compensatingControlId ?? null,
    };
    breaches.push(breach);
    rows.push({
      controlId: control.controlId, outcome: 'breach', breach,
      reason: `control ${control.controlId} deviated ${round2(rate)}% over ${evidence.population} rows, at or above the rule ${rule.ruleId} v${rule.ruleVersion} tolerance ${rule.tolerancePercent}%`,
    });
  }

  return {
    rows,
    noEvidence,
    unmonitored,
    breaches,
    complete: noEvidence.length === 0 && unmonitored.length === 0,
  };
}

/**
 * The finding payload a breach opens — the shape `systeligon_finding_record` and the screen consume.
 * Every breach carries its control id, the rule id and version, and the severity with its basis.
 */
export interface ControlFindingIntent {
  ruleId: string;
  ruleVersion: number;
  controlId: string;
  severity: Severity;
  reason: string;
  basis: string;
}

export function breachFindingIntent(breach: ControlBreach): ControlFindingIntent {
  return {
    ruleId: breach.ruleId,
    ruleVersion: breach.ruleVersion,
    controlId: breach.controlId,
    severity: breach.severity,
    reason: `ICFR control ${breach.controlId} breached: ${breach.basis}`,
    basis: breach.basis,
  };
}

/** Group the taxonomy for the panel: components with their principle counts, and the totals. */
export function taxonomySummary(): {
  components: CosoComponentRow[];
  principleCount: number;
  taxonomies: Taxonomy[];
} {
  return {
    components: COSO_COMPONENTS,
    principleCount: COSO_PRINCIPLES.length,
    taxonomies: TAXONOMIES,
  };
}
