/**
 * The aggregate registry (E5/U1, gate G8; docs/EXPLAIN-LAYER.md §7).
 *
 * Every number the product renders that is an aggregate over records is declared here with the
 * family it drills to. The G8 gate reads this list and the screen sources: a declared drillable
 * aggregate whose element is missing, or which carries no `data-drill-kind`, fails the build. A
 * number that genuinely cannot drill states why in `reason` and drills to nothing, which is honest
 * rather than silent.
 *
 * This is a declaration, not a scrape. A screen that renders a new aggregate must add its row here
 * (and its contract section) in the same change, which is the same discipline the UI contract uses.
 */
import type { DrillKind } from './drilldown';

export interface AggregateSurface {
  /** Screen id, e.g. `DB-01`. */
  screenId: string;
  /** The element testid, exactly as it appears in the source. */
  testId: string;
  /** What the number counts. */
  label: string;
  /** The family it drills to, or null when it cannot drill (then `reason` is required). */
  drill: DrillKind | null;
  /** Why it cannot drill. Required when `drill` is null. */
  reason?: string;
}

export const AGGREGATE_SURFACES: AggregateSurface[] = [
  {
    screenId: 'DB-01',
    testId: 'DB-01-tile-entities',
    label: 'Scoped entities',
    drill: 'entities',
  },
  {
    screenId: 'DB-01',
    testId: 'DB-01-tile-engagements',
    label: 'Engagements in fieldwork',
    drill: 'engagements',
  },
  {
    screenId: 'DB-01',
    testId: 'DB-01-tile-issues',
    label: 'Open audit issues',
    drill: 'issues',
  },
  {
    screenId: 'DB-01',
    testId: 'DB-01-tile-workpapers',
    label: 'Sealed working papers',
    drill: 'workpapers',
  },
  {
    screenId: 'DB-01',
    testId: 'DB-01-cap-hub-drilldown',
    label: 'CAP hub total',
    drill: 'caps',
  },
  {
    screenId: 'CH-07',
    testId: 'CH-07-comment-status-open',
    label: 'Open review comments',
    drill: 'comments',
  },
];

/** Every aggregate that declares a drill target. */
export function drillableAggregates(): AggregateSurface[] {
  return AGGREGATE_SURFACES.filter((a) => a.drill !== null);
}
