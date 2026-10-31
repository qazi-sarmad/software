import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AGGREGATE_SURFACES, drillableAggregates } from '../lib/drilldownAggregates';

/**
 * G8 — Drilldown (docs/EXPLAIN-LAYER.md §7).
 *
 * Rule: every rendered aggregate has a drilldown target, and the target reaches the exact records.
 * A number with no way to reach its records is the failure this gate exists to catch.
 *
 * The gate reads the real screen sources and checks three things for every declared aggregate:
 *   1. the element with its testid exists in some component;
 *   2. a drillable aggregate's element carries `data-drill-kind="<kind>"` (so a walk test can follow
 *      it and so the drilldown cannot silently point at the wrong family);
 *   3. the same screen mounts `DrilldownPanel`, so the declared target is actually rendered.
 *
 * A declared aggregate that cannot drill must say so (`drill: null` plus a `reason`), which is
 * honest rather than silent.
 */
const SRC = resolve(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(tsx|ts)$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}

const files = walk(SRC).map((f) => ({ path: f, text: readFileSync(f, 'utf8') }));

const findOwner = (testId: string) => files.find((f) => f.text.includes(`data-testid="${testId}"`));

describe('G8 — every aggregate drills to its records', () => {
  it('declares at least one drillable aggregate', () => {
    expect(drillableAggregates().length).toBeGreaterThan(0);
  });

  it('every declared aggregate element exists in a component', () => {
    for (const agg of AGGREGATE_SURFACES) {
      expect(findOwner(agg.testId), `${agg.screenId} ${agg.testId} is declared but no component renders it`).toBeTruthy();
    }
  });

  it('every drillable aggregate carries its data-drill-kind', () => {
    for (const agg of drillableAggregates()) {
      const owner = findOwner(agg.testId)!;
      // The attribute sits on the same element as the testid.
      const tag = owner.text.slice(owner.text.indexOf(`data-testid="${agg.testId}"`));
      const line = tag.slice(0, tag.indexOf('>'));
      expect(line, `${agg.testId} must carry data-drill-kind="${agg.drill}"`).toContain(
        `data-drill-kind="${agg.drill}"`
      );
    }
  });

  it('every screen with a drillable aggregate mounts the DrilldownPanel', () => {
    const screens = new Set(drillableAggregates().map((a) => a.screenId));
    for (const screenId of screens) {
      const mounted = files.some(
        (f) => f.text.includes('DrilldownPanel') && f.text.includes(`screenId="${screenId}"`)
      );
      expect(mounted, `${screenId} declares a drillable aggregate but mounts no DrilldownPanel`).toBe(true);
    }
  });

  it('an aggregate that cannot drill states a reason', () => {
    for (const agg of AGGREGATE_SURFACES) {
      if (agg.drill === null) {
        expect(agg.reason, `${agg.testId} declares no drill and gives no reason`).toBeTruthy();
      }
    }
  });
});
