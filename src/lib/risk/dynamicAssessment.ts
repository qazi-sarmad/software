/**
 * D15 — the dynamic risk assessment (F144).
 *
 * Sources: docs/RISK-ASSESSMENT-MODEL.md §8 (the five PwC themes) and docs/ASSURANCE-RULEBOOKS.md §6.
 * The five themes, deterministically:
 *   1. standardised inputs and a common taxonomy — the derivation factors (D14) plus this taxonomy;
 *   2. alignment to ERM — map an auditable entity/topic to an enterprise risk theme and show the
 *      coverage verdict (direct / limited / monitoring / none), surfacing a top risk with NO coverage
 *      as a gap;
 *   3. continuous audit planning — a trigger (KRI breach, incident, management request, strategic
 *      change) produces a plan-change proposal (track / defer / cancel / rescope) with a rationale;
 *   4. translating risk into coverage — the narrative from data (what changed, the drivers, the
 *      affected people/process/technology, the tradeoffs);
 *   5. KRI and appetite/tolerance.
 *
 * L1/L4: pure. No model, no clock, no client. A KRI with no value is "unknown", never within tolerance.
 */

export type CoverageVerdict = 'direct' | 'limited' | 'monitoring' | 'none';

export interface ErmTheme {
  /** The enterprise risk theme (docs/RISK-ASSESSMENT-MODEL.md §8 — the seven PwC ERM themes). */
  theme: string;
  /** Whether the theme is a top (ranked) risk for the organisation. */
  isTopRisk: boolean;
  /** The auditable entities/topics mapped to this theme. */
  mappedEntities: string[];
  /** The engagements covering the theme (their status). */
  engagements: { id: string; status: 'planned' | 'in_progress' | 'complete'; scope: 'full' | 'partial' }[];
  /** The KRIs the theme carries. */
  kris: { id: string; value: number | null; tolerance: number | null }[];
}

export interface ThemeCoverage {
  theme: string;
  verdict: CoverageVerdict;
  reason: string;
  /** A top ERM risk with no coverage at all — the gap the map must surface. */
  isGap: boolean;
}

/**
 * The coverage verdict for a theme. Deterministic:
 *   - a complete engagement with full scope covers it directly;
 *   - an in-progress or partial engagement covers it limitedly;
 *   - mapped entities with no engagement are monitored (monitoring only);
 *   - no mapping and no engagement is none.
 * A top risk whose verdict is `none` is a gap.
 */
export function coverageVerdict(theme: ErmTheme): ThemeCoverage {
  const complete = theme.engagements.some((e) => e.status === 'complete' && e.scope === 'full');
  const partial = theme.engagements.some((e) => e.status === 'in_progress' || e.scope === 'partial');
  const mapped = theme.mappedEntities.length > 0 || theme.engagements.length > 0;

  let verdict: CoverageVerdict;
  let reason: string;
  if (complete) {
    verdict = 'direct';
    reason = 'a completed engagement covers the theme in full';
  } else if (partial) {
    verdict = 'limited';
    reason = 'an in-progress or partial-scope engagement covers the theme';
  } else if (mapped) {
    verdict = 'monitoring';
    reason = 'the theme is mapped but no engagement covers it yet';
  } else {
    verdict = 'none';
    reason = 'the theme is neither mapped nor covered';
  }

  return {
    theme: theme.theme,
    verdict,
    reason,
    isGap: theme.isTopRisk && verdict === 'none',
  };
}

export interface ErmMap {
  rows: ThemeCoverage[];
  /** The top risks with no coverage — the gaps the map surfaces. */
  gaps: ThemeCoverage[];
  /** True only when every top risk has at least monitoring coverage. */
  complete: boolean;
}

export function ermMap(themes: ErmTheme[]): ErmMap {
  const rows = themes.map(coverageVerdict);
  const gaps = rows.filter((r) => r.isGap);
  const topRisks = themes.filter((t) => t.isTopRisk);
  return {
    rows,
    gaps,
    complete: topRisks.every((t) => coverageVerdict(t).verdict !== 'none'),
  };
}

// ---------------------------------------------------------------------------
// KRI and appetite / tolerance.
// ---------------------------------------------------------------------------

export type KriState = 'within' | 'breach' | 'unknown';

/** A KRI against its tolerance. A missing value or tolerance is unknown, never within. */
export function kriState(value: number | null, tolerance: number | null): KriState {
  if (value == null || tolerance == null) return 'unknown';
  return value > tolerance ? 'breach' : 'within';
}

// ---------------------------------------------------------------------------
// Continuous audit planning — the trigger and its plan-change proposal.
// ---------------------------------------------------------------------------

export type PlanChangeAction = 'track' | 'defer' | 'cancel' | 'rescope';

export type TriggerKind = 'kri_breach' | 'incident' | 'management_request' | 'strategic_change';

export interface PlanTrigger {
  kind: TriggerKind;
  /** The evidence: what fired the trigger. */
  detail: string;
  /** The auditable entity/topic affected. */
  entity: string;
}

export interface PlanChangeProposal {
  action: PlanChangeAction;
  rationale: string;
  trigger: TriggerKind;
  entity: string;
}

/**
 * Turn a trigger into a plan-change proposal. Deterministic:
 *   - a KRI breach of a covered theme rescopes (deepen the existing coverage);
 *   - a KRI breach of an uncovered theme tracks a new engagement;
 *   - an incident defers (assess before committing);
 *   - a management request tracks;
 *   - a strategic change rescopes.
 */
export function planChangeFor(trigger: PlanTrigger, covered: boolean): PlanChangeProposal {
  let action: PlanChangeAction;
  let rationale: string;
  switch (trigger.kind) {
    case 'kri_breach':
      action = covered ? 'rescope' : 'track';
      rationale = covered
        ? `${trigger.entity} is already covered; the breach deepens the existing scope`
        : `${trigger.entity} has no coverage; the breach adds it to the plan`;
      break;
    case 'incident':
      action = 'defer';
      rationale = `an incident on ${trigger.entity} is assessed before the plan commits`;
      break;
    case 'management_request':
      action = 'track';
      rationale = `a management request adds ${trigger.entity} to the plan`;
      break;
    case 'strategic_change':
      action = 'rescope';
      rationale = `a strategic change rescopes the coverage of ${trigger.entity}`;
      break;
  }
  return { action, rationale, trigger: trigger.kind, entity: trigger.entity };
}

// ---------------------------------------------------------------------------
// Translating risk into coverage — the narrative from data.
// ---------------------------------------------------------------------------

export interface CoverageNarrative {
  whatChanged: string;
  drivers: string[];
  affectedPeople: string[];
  affectedProcess: string[];
  affectedTechnology: string[];
  tradeoffs: string[];
}

export interface NarrativeInput {
  changeSummary: string;
  drivers: string[];
  people: string[];
  process: string[];
  technology: string[];
  tradeoffs: string[];
}

/** Assemble the risk-to-coverage narrative from data only — no generated text. */
export function riskToCoverageNarrative(input: NarrativeInput): CoverageNarrative {
  return {
    whatChanged: input.changeSummary,
    drivers: [...input.drivers],
    affectedPeople: [...input.people],
    affectedProcess: [...input.process],
    affectedTechnology: [...input.technology],
    tradeoffs: [...input.tradeoffs],
  };
}

// ---------------------------------------------------------------------------
// The common taxonomy (§8 theme 1).
// ---------------------------------------------------------------------------

export const RISK_TAXONOMY_THEMES = [
  'cybersecurity and data privacy',
  'regulatory and compliance change',
  'strategic execution',
  'operational resilience / BCP',
  'third-party / supply chain',
  'talent and workforce',
  'financial performance and liquidity',
] as const;

export type RiskTaxonomyTheme = (typeof RISK_TAXONOMY_THEMES)[number];
