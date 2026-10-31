/**
 * D14 — auto-adjusted risk factors, and the manual override (F143).
 *
 * Sources: docs/RISK-ASSESSMENT-MODEL.md §5 (the auto-adjustment taxonomy, the proposal object, the
 * override rules) and §6 (the five PwC themes). Every auto-derived value is a *proposal*:
 *   { factor_key, proposed_value, inputs: [...], rule_id, rule_version, source }
 * and the rule that derived it is named and versioned. Where the input is unknown the proposed value
 * is `null` ("unknown"), NEVER 0 — an unknown input must not pull a SIRA score down.
 *
 * L1/L4: pure. The entity's facts and the observation instant are arguments; no clock, no client, no
 * model. `bandedCount` is a deterministic step function, not a learned threshold.
 */

/** The library the product names for each auto-derived factor (docs/RISK-ASSESSMENT-MODEL.md §5). */
export interface DerivationRule {
  ruleId: string;
  ruleVersion: number;
  source: string;
  /** The factor key this rule derives. */
  factorKey: string;
}

export const DERIVATION_RULES: DerivationRule[] = [
  { ruleId: 'risk.auto.inherent_risk', ruleVersion: 1, factorKey: 'inherent_risk', source: 'docs/RISK-ASSESSMENT-MODEL.md §5 — the library default for the selected risk' },
  { ruleId: 'risk.auto.complexity', ruleVersion: 1, factorKey: 'complexity', source: 'docs/RISK-ASSESSMENT-MODEL.md §5 — entity attributes + linked processes, banded count' },
  { ruleId: 'risk.auto.regulatory_exposure', ruleVersion: 1, factorKey: 'regulatory_exposure', source: 'docs/RISK-ASSESSMENT-MODEL.md §5 — classification (D10) + the regimes that bind it' },
  { ruleId: 'risk.auto.prior_findings', ruleVersion: 1, factorKey: 'prior_findings', source: 'docs/RISK-ASSESSMENT-MODEL.md §5 — open findings by severity, banded' },
  { ruleId: 'risk.auto.time_since_audit', ruleVersion: 1, factorKey: 'time_since_audit', source: 'docs/RISK-ASSESSMENT-MODEL.md §5 — days since the last sealed engagement, banded' },
  { ruleId: 'risk.auto.materiality', ruleVersion: 1, factorKey: 'materiality', source: 'docs/RISK-ASSESSMENT-MODEL.md §5 — the entity materiality figure, pass-through or unknown' },
  { ruleId: 'risk.auto.kri_breach', ruleVersion: 1, factorKey: 'kri_breach', source: 'docs/RISK-ASSESSMENT-MODEL.md §5 — KRI values vs tolerance, count of breaches in the window' },
  { ruleId: 'risk.auto.incident_rate', ruleVersion: 1, factorKey: 'incident_rate', source: 'docs/RISK-ASSESSMENT-MODEL.md §5 — incidents linked to the entity, banded' },
  { ruleId: 'risk.auto.control_test_failure', ruleVersion: 1, factorKey: 'control_test_failure', source: 'docs/RISK-ASSESSMENT-MODEL.md §5 — failed control tests for the entity, banded' },
  { ruleId: 'risk.auto.change_velocity', ruleVersion: 1, factorKey: 'change_velocity', source: 'docs/RISK-ASSESSMENT-MODEL.md §5 — change records / open CAPs added in the window, banded' },
];

/** The 1..max point a value is clamped to. An out-of-range value is refused, never silently clamped. */
export const SIRA_MAX_POINT = 5;

export interface FactorProposal {
  factorKey: string;
  /** The 1..max point, or null when the input is unknown. Never 0. */
  proposedValue: number | null;
  /** The inputs the rule read, named. */
  inputs: string[];
  ruleId: string;
  ruleVersion: number;
  source: string;
  /** The human reason, always in words. */
  reason: string;
}

/**
 * A deterministic step function: count → 1..max. Bands are half-open [threshold, next), so a count
 * exactly on a boundary is unambiguous. An empty band list, or a negative count, yields 1.
 */
export function bandedCount(count: number, thresholds: number[], max = SIRA_MAX_POINT): number {
  if (!Number.isFinite(count) || count < 0) return 1;
  let point = 1;
  for (const t of thresholds) {
    if (count >= t) point += 1;
  }
  return Math.min(point, max);
}

/** The facts a derivation may read for one entity. Every field may be absent (→ unknown). */
export interface EntityRiskFacts {
  /** The library risk's default inherent rating, when the library row carries one. */
  inherentRating: number | null;
  /** Entity attributes count plus linked processes. */
  complexityCount: number | null;
  /** The tenant's classification code (D10), e.g. "C6". */
  classification: string | null;
  openFindings: number | null;
  openFindingsSevere: number | null;
  daysSinceLastAudit: number | null;
  /** The entity's materiality figure mapped to a 1..5 point, or null when unset. */
  materialityPoint: number | null;
  kriBreaches: number | null;
  incidentCount: number | null;
  controlTestFailures: number | null;
  changeVelocity: number | null;
}

/** C1–C8 → a regulatory-exposure point (docs/PAKISTAN-ASSURANCE-REGIMES.md §2: C6/C7 the highest). */
const EXPOSURE_BY_CLASS: Record<string, number> = {
  C1: 4, C2: 3, C3: 2, C4: 1, C5: 1, C6: 5, C7: 5, C8: 3,
};

function rule(factorKey: string): DerivationRule {
  const r = DERIVATION_RULES.find((x) => x.factorKey === factorKey);
  if (!r) throw new Error(`derivation: no rule for factor ${factorKey}`);
  return r;
}

function proposal(
  factorKey: string,
  value: number | null,
  inputs: string[],
  reason: string,
): FactorProposal {
  const r = rule(factorKey);
  return {
    factorKey,
    proposedValue: value == null ? null : Math.min(Math.max(value, 1), SIRA_MAX_POINT),
    inputs,
    ruleId: r.ruleId,
    ruleVersion: r.ruleVersion,
    source: r.source,
    reason,
  };
}

/**
 * Derive every auto-adjustable factor for an entity. Deterministic and total: every rule returns a
 * proposal, and an input the facts do not carry yields `null` (unknown), never 0.
 */
export function deriveFactors(facts: EntityRiskFacts): FactorProposal[] {
  const out: FactorProposal[] = [];

  out.push(facts.inherentRating == null
    ? proposal('inherent_risk', null, ['inherentRating'], 'the library risk carries no inherent rating')
    : proposal('inherent_risk', facts.inherentRating, ['inherentRating'], `the library default is ${facts.inherentRating}`));

  out.push(facts.complexityCount == null
    ? proposal('complexity', null, ['complexityCount'], 'the entity has no complexity count')
    : proposal('complexity', bandedCount(facts.complexityCount, [3, 6, 10, 15]), ['complexityCount'],
        `${facts.complexityCount} attributes/processes`));

  const exposure = facts.classification ? EXPOSURE_BY_CLASS[facts.classification] : undefined;
  out.push(exposure == null
    ? proposal('regulatory_exposure', null, ['classification'], 'the organisation has no classification')
    : proposal('regulatory_exposure', exposure, ['classification'], `classification ${facts.classification}`));

  out.push(facts.openFindings == null
    ? proposal('prior_findings', null, ['openFindings'], 'no findings were read')
    : proposal('prior_findings', bandedCount((facts.openFindings ?? 0) + 2 * (facts.openFindingsSevere ?? 0), [1, 3, 6, 10]),
        ['openFindings', 'openFindingsSevere'],
        `${facts.openFindings} open, ${facts.openFindingsSevere ?? 0} severe`));

  out.push(facts.daysSinceLastAudit == null
    ? proposal('time_since_audit', null, ['daysSinceLastAudit'], 'the entity has no sealed engagement')
    : proposal('time_since_audit', bandedCount(facts.daysSinceLastAudit, [180, 365, 730, 1095]), ['daysSinceLastAudit'],
        `${facts.daysSinceLastAudit} days since the last sealed engagement`));

  out.push(facts.materialityPoint == null
    ? proposal('materiality', null, ['materialityPoint'], 'no materiality figure is set')
    : proposal('materiality', facts.materialityPoint, ['materialityPoint'], `materiality point ${facts.materialityPoint}`));

  out.push(facts.kriBreaches == null
    ? proposal('kri_breach', null, ['kriBreaches'], 'no KRI values were read')
    : proposal('kri_breach', bandedCount(facts.kriBreaches, [1, 2, 4, 6]), ['kriBreaches'], `${facts.kriBreaches} KRI breaches`));

  out.push(facts.incidentCount == null
    ? proposal('incident_rate', null, ['incidentCount'], 'no incidents were read')
    : proposal('incident_rate', bandedCount(facts.incidentCount, [1, 3, 6, 10]), ['incidentCount'], `${facts.incidentCount} incidents`));

  out.push(facts.controlTestFailures == null
    ? proposal('control_test_failure', null, ['controlTestFailures'], 'no control tests were read')
    : proposal('control_test_failure', bandedCount(facts.controlTestFailures, [1, 2, 5, 9]), ['controlTestFailures'],
        `${facts.controlTestFailures} failed control tests`));

  out.push(facts.changeVelocity == null
    ? proposal('change_velocity', null, ['changeVelocity'], 'no change records were read')
    : proposal('change_velocity', bandedCount(facts.changeVelocity, [2, 5, 10, 20]), ['changeVelocity'],
        `${facts.changeVelocity} changes in the window`));

  return out;
}

// ---------------------------------------------------------------------------
// The manual override (docs/RISK-ASSESSMENT-MODEL.md §6).
// ---------------------------------------------------------------------------

export interface FactorOverride {
  factorKey: string;
  overrideValue: number;
  /** Mandatory; an empty reason is refused (the same rule as decideSuggestion). */
  overrideReason: string;
  overrideBy: string;
  overrideAt: string;
  /** The automatic value at the moment of override — kept, never destroyed. */
  autoValueAtOverride: number | null;
  ruleId: string;
  ruleVersion: number;
}

export interface OverrideRequest {
  factorKey: string;
  overrideValue: number;
  overrideReason: string;
  overrideBy: string;
  overrideAt: string;
  proposal: FactorProposal;
}

/**
 * Record a manual override of an auto-derived factor. Refuses an empty reason and an out-of-range
 * value; the automatic value is copied into `autoValueAtOverride` so it is never destroyed.
 */
export function applyOverride(req: OverrideRequest): FactorOverride {
  if (!req.overrideReason || !req.overrideReason.trim()) {
    throw new Error('override: a reason is required — an empty reason is refused');
  }
  if (!Number.isInteger(req.overrideValue) || req.overrideValue < 1 || req.overrideValue > SIRA_MAX_POINT) {
    throw new Error(`override: value ${req.overrideValue} is outside 1..${SIRA_MAX_POINT}`);
  }
  return {
    factorKey: req.factorKey,
    overrideValue: req.overrideValue,
    overrideReason: req.overrideReason.trim(),
    overrideBy: req.overrideBy,
    overrideAt: req.overrideAt,
    autoValueAtOverride: req.proposal.proposedValue,
    ruleId: req.proposal.ruleId,
    ruleVersion: req.proposal.ruleVersion,
  };
}

/** Revert an override: the automatic value returns, and the revert is itself recorded. */
export function revertOverride(o: FactorOverride, revertedBy: string, revertedAt: string): FactorOverride {
  return { ...o, overrideReason: `${o.overrideReason} [reverted by ${revertedBy} at ${revertedAt}]` };
}

export interface ResolvedFactor {
  factorKey: string;
  /** The value used in the score: the override when present, else the proposed value. */
  value: number | null;
  source: 'override' | 'auto' | 'unknown';
  /** True when the override moved the value into a different band — flagged for D9. */
  bandChanged: boolean;
}

/**
 * Resolve the effective value per factor from the proposals and the overrides. An override wins; an
 * unknown (null) with no override stays unknown.
 */
export function resolveFactors(
  proposals: FactorProposal[],
  overrides: FactorOverride[],
  bandOf: (v: number) => string | null,
): ResolvedFactor[] {
  return proposals.map((p) => {
    const o = overrides.find((x) => x.factorKey === p.factorKey);
    if (o) {
      const changed = p.proposedValue != null && bandOf(o.overrideValue) !== bandOf(p.proposedValue);
      return { factorKey: p.factorKey, value: o.overrideValue, source: 'override' as const, bandChanged: changed };
    }
    if (p.proposedValue == null) {
      return { factorKey: p.factorKey, value: null, source: 'unknown' as const, bandChanged: false };
    }
    return { factorKey: p.factorKey, value: p.proposedValue, source: 'auto' as const, bandChanged: false };
  });
}

/** The factor values a score consumes: only the resolved, known values. */
export function factorValuesOf(resolved: ResolvedFactor[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of resolved) if (r.value != null) out[r.factorKey] = r.value;
  return out;
}
