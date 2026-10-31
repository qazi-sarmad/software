/**
 * D1 — Risk and control intelligence (docs/SYSTELIGON.md §11.1a).
 *
 * Five deterministic capabilities over the risk register and the control set the app already holds:
 *
 *   - residual-risk drift      — each entity's residual rating moved against its own prior snapshot
 *   - control coverage matrix  — which risks have controls, which controls have tests, which have neither
 *   - control effectiveness    — per control, the trend of its test outcomes
 *   - key-control indicator    — controls whose failure exposes the most other controls (dependency graph)
 *   - risk appetite breach     — live exposure compared against the organisation's stated appetite
 *
 * Every function here is PURE: it takes the rows and the day as arguments, reads no clock, no client
 * and no tenant store. That is what makes a finding reproducible forever and what lets it name the
 * exact rows it was derived from. Nothing here is a model call (Law L1): each output names the rule
 * that produced it.
 */
import type { AuditControl, AuditEntity, RiskRating } from '../../types';

/** A risk rating on an ordinal scale, so "drift" is a signed step count, not a guess. */
export const RISK_ORDER: RiskRating[] = ['low', 'medium', 'high', 'critical'];

/** The ordinal position of a rating (0 = low). An unknown rating sorts lowest rather than throwing. */
export function riskRank(rating: RiskRating | string | null | undefined): number {
  const i = RISK_ORDER.indexOf(rating as RiskRating);
  return i < 0 ? 0 : i;
}

/** A prior snapshot of one entity's risk posture, as the caller held it at `asOf`. */
export interface RiskSnapshot {
  entityId: string;
  residualRisk: RiskRating;
  siraScore: number;
  asOf: string;
}

export type DriftDirection = 'improved' | 'worsened' | 'unchanged';

export interface ResidualDriftRow {
  entityId: string;
  name: string;
  prior: RiskRating;
  current: RiskRating;
  /** Signed steps: current rank minus prior rank (positive is worse). */
  step: number;
  direction: DriftDirection;
  priorScore: number;
  currentScore: number;
  /** True when the move is toward or past the organisation's tolerance. */
  breaches: boolean;
}

export interface ResidualDriftInput {
  entities: AuditEntity[];
  snapshots: RiskSnapshot[];
  /** The rating the organisation treats as breaching tolerance (inclusive and worse). */
  tolerance: RiskRating;
}

/**
 * Residual-risk drift: each entity's residual rating against its own prior snapshot. An entity with
 * no prior snapshot is reported as unchanged (there is nothing to drift from — it is not silently
 * dropped, and it is not invented as a movement).
 */
export function residualRiskDrift(input: ResidualDriftInput): ResidualDriftRow[] {
  const prior = new Map(input.snapshots.map((s) => [s.entityId, s]));
  const tolRank = riskRank(input.tolerance);
  const rows: ResidualDriftRow[] = [];
  for (const e of input.entities) {
    const p = prior.get(e.id);
    if (!p) continue;
    const step = riskRank(e.residualRisk) - riskRank(p.residualRisk);
    rows.push({
      entityId: e.id,
      name: e.name,
      prior: p.residualRisk,
      current: e.residualRisk,
      step,
      direction: step > 0 ? 'worsened' : step < 0 ? 'improved' : 'unchanged',
      priorScore: p.siraScore,
      currentScore: e.siraScore,
      breaches: riskRank(e.residualRisk) >= tolRank,
    });
  }
  // Worst drift first, then by name, so two runs give the same order.
  return rows.sort((a, b) => b.step - a.step || a.name.localeCompare(b.name));
}

/** A cell of the control coverage matrix: a risk and whether it has a control, and whether that
 *  control has a test. `gap` names what is missing, which is what becomes a finding. */
export interface CoverageCell {
  entityId: string;
  entityName: string;
  riskRating: RiskRating;
  hasControl: boolean;
  /** True when at least one control on the entity has been tested (effectiveness !== 'not_tested'). */
  hasTestedControl: boolean;
  controlCount: number;
  testedControlCount: number;
  /** The gap the cell represents, or null when the risk is covered and tested. */
  gap: 'no_control' | 'control_untested' | null;
}

export interface CoverageMatrix {
  cells: CoverageCell[];
  /** Totals for the headline sentence. */
  total: number;
  covered: number;
  tested: number;
  /** Cells with a gap, worst-first (no_control before control_untested), then by risk. */
  gaps: CoverageCell[];
}

/**
 * Control coverage matrix: pure set arithmetic over the register. A risk with no control and a
 * control with no test are both gaps; the cell says which one it is.
 */
export function controlCoverageMatrix(entities: AuditEntity[], controls: AuditControl[]): CoverageMatrix {
  const byEntity = new Map<string, AuditControl[]>();
  for (const c of controls) {
    const list = byEntity.get(c.entityId);
    if (list) list.push(c);
    else byEntity.set(c.entityId, [c]);
  }
  const cells: CoverageCell[] = entities.map((e) => {
    const cs = byEntity.get(e.id) ?? [];
    const tested = cs.filter((c) => c.effectiveness !== 'not_tested');
    const hasControl = cs.length > 0;
    const hasTestedControl = tested.length > 0;
    return {
      entityId: e.id,
      entityName: e.name,
      riskRating: e.residualRisk,
      hasControl,
      hasTestedControl,
      controlCount: cs.length,
      testedControlCount: tested.length,
      gap: !hasControl ? 'no_control' : !hasTestedControl ? 'control_untested' : null,
    };
  });
  const gaps = cells
    .filter((c) => c.gap !== null)
    .sort(
      (a, b) =>
        (a.gap === 'no_control' ? 0 : 1) - (b.gap === 'no_control' ? 0 : 1) ||
        riskRank(b.riskRating) - riskRank(a.riskRating) ||
        a.entityName.localeCompare(b.entityName)
    );
  return {
    cells,
    total: cells.length,
    covered: cells.filter((c) => c.hasControl).length,
    tested: cells.filter((c) => c.hasTestedControl).length,
    gaps,
  };
}

export type EffectivenessTrend = 'improving' | 'stable' | 'deteriorating' | 'unknown';

export interface EffectivenessHistoryRow {
  controlId: string;
  code: string;
  title: string;
  entityId: string;
  /** The observed outcomes, oldest first, as the caller recorded them. */
  history: string[];
  /** The trend derived from the history: three failures running is a failure, not three events. */
  trend: EffectivenessTrend;
  /** How many of the most recent observations are 'ineffective'. */
  consecutiveFailures: number;
}

const FAILING = new Set(['ineffective', 'needs_improvement']);

/**
 * Control effectiveness history: per control, the trend of its test outcomes. The rule is explicit —
 * two or more consecutive failing observations is a deteriorating control; a run of effective
 * observations after a failure is improving; otherwise stable. With fewer than two observations the
 * trend is `unknown`, never invented.
 */
export function controlEffectivenessHistory(
  controls: AuditControl[],
  historyByControl: Record<string, string[]>
): EffectivenessHistoryRow[] {
  return controls.map((c) => {
    const history = historyByControl[c.id] ?? [];
    let consecutiveFailures = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (FAILING.has(history[i])) consecutiveFailures++;
      else break;
    }
    let trend: EffectivenessTrend = 'unknown';
    if (history.length >= 2) {
      if (consecutiveFailures >= 2) trend = 'deteriorating';
      else if (history[history.length - 1] === 'effective') trend = 'improving';
      else trend = 'stable';
    }
    return {
      controlId: c.id,
      code: c.code,
      title: c.title,
      entityId: c.entityId,
      history,
      trend,
      consecutiveFailures,
    };
  });
}

/** A directed edge: `controlId` fails and exposes `exposesId`. */
export interface ControlDependency {
  controlId: string;
  exposesId: string;
}

export interface KeyControlRow {
  controlId: string;
  code: string;
  title: string;
  /** How many other controls this control's failure exposes, transitively. */
  blastRadius: number;
  /** The controls exposed, in a deterministic order. */
  exposes: string[];
}

/**
 * Key-control indicator: pure graph traversal. A control's blast radius is the number of DISTINCT
 * other controls reachable from it through the dependency graph. Cycles terminate (visited set), so
 * the traversal is total. Ordered by blast radius, then code, so two runs agree.
 */
export function keyControlIndicator(controls: AuditControl[], edges: ControlDependency[]): KeyControlRow[] {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const list = adjacency.get(e.controlId);
    if (list) list.push(e.exposesId);
    else adjacency.set(e.controlId, [e.exposesId]);
  }
  const byId = new Map(controls.map((c) => [c.id, c]));
  const rows: KeyControlRow[] = controls.map((c) => {
    const visited = new Set<string>();
    const stack = [...(adjacency.get(c.id) ?? [])];
    while (stack.length) {
      const next = stack.pop() as string;
      if (visited.has(next) || next === c.id) continue;
      visited.add(next);
      for (const deeper of adjacency.get(next) ?? []) stack.push(deeper);
    }
    const exposes = [...visited].filter((id) => byId.has(id)).sort();
    return {
      controlId: c.id,
      code: c.code,
      title: c.title,
      blastRadius: exposes.length,
      exposes,
    };
  });
  return rows.sort((a, b) => b.blastRadius - a.blastRadius || a.code.localeCompare(b.code));
}

export interface AppetiteBreachRow {
  entityId: string;
  name: string;
  residualRisk: RiskRating;
  /** How many steps past the tolerance the entity sits (0 when within appetite). */
  stepsPast: number;
}

export interface AppetiteBreach {
  tolerance: RiskRating;
  breaches: AppetiteBreachRow[];
  /** True when nothing breaches the stated appetite. */
  withinAppetite: boolean;
}

/**
 * Risk appetite breach: compare live exposure (each entity's residual rating) against the
 * organisation's stated tolerance. An entity at or above the tolerance is a breach; how far past is
 * reported so the worst is visible first.
 */
export function riskAppetiteBreach(entities: AuditEntity[], tolerance: RiskRating): AppetiteBreach {
  const tolRank = riskRank(tolerance);
  const breaches = entities
    .filter((e) => riskRank(e.residualRisk) >= tolRank)
    .map((e) => ({
      entityId: e.id,
      name: e.name,
      residualRisk: e.residualRisk,
      stepsPast: riskRank(e.residualRisk) - tolRank,
    }))
    .sort((a, b) => b.stepsPast - a.stepsPast || a.name.localeCompare(b.name));
  return { tolerance, breaches, withinAppetite: breaches.length === 0 };
}
