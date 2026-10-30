import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  SCREEN_MOUNTS,
  MOUNTED_SCREENS,
  PLANNED_SCREENS,
  screenMount,
  mountsForStream,
  plannedScreens,
  isMounted,
  type StreamId,
} from '../nav/registry';
import { CAPABILITY_FAMILIES, capabilityFamily, familiesForStream, type CapabilityOwner } from '../lib/capabilities/registry';
import { CAPABILITY_KINDS } from '../data/capabilities';

/**
 * Mount-point guard (integrator).
 *
 * The mount points (docs/build/OWNERSHIP.md §4) are what let the seven build streams work in
 * parallel without editing a shared file. This guard is the integrator's proof that they are
 * well-formed: a slot names a screen id, one owner, and a component path inside a directory that
 * owner's stream owns (OWNERSHIP.md §2), and a mounted slot's file exists. It also pins the
 * capability registry to the real catalogue, so a family can never name a kind the data layer does
 * not define.
 *
 * It asserts the mount points exist on the trunk — the one serial step that gates every stream's
 * branch (docs/build/BUILD-PROMPT.md, "YOUR BRANCH").
 */

const ROOT = resolve(process.cwd());
const STREAM_IDS: StreamId[] = ['trunk', 'design', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];

/** The directory prefixes OWNERSHIP.md §2 grants each stream for the stream's OWN new screens. */
const OWNED_COMPONENT_DIRS: Record<StreamId, string[]> = {
  trunk: [],
  design: [],
  s1: ['src/components/audit/', 'src/components/admin/'],
  s2: ['src/components/assurance/'],
  s3: ['src/components/sira/', 'src/components/universe/'],
  s4: ['src/components/superadmin/'],
  s5: ['src/components/monitor/'],
  s6: ['src/components/admin/'],
  s7: ['src/components/documents/'],
};

describe('the mount points exist on the trunk (OWNERSHIP.md §4)', () => {
  it('the screen registry, the data barrel and the capability registry are present', () => {
    for (const p of ['src/nav/registry.ts', 'src/data/index.ts', 'src/lib/capabilities/registry.ts']) {
      expect(existsSync(resolve(ROOT, p)), `${p} is missing`).toBe(true);
    }
  });

  it('every screen slot has a unique id and one of the known owners', () => {
    const ids = SCREEN_MOUNTS.map((m) => m.screenId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of SCREEN_MOUNTS) expect(STREAM_IDS).toContain(m.owner);
  });

  it('a mounted slot names a component file that exists', () => {
    for (const m of MOUNTED_SCREENS) {
      expect(existsSync(resolve(ROOT, m.path)), `${m.screenId} points at a missing file: ${m.path}`).toBe(true);
    }
  });

  it('every planned slot (a stream’s own new screen) sits inside a directory its stream owns (§2)', () => {
    const offenders: string[] = [];
    for (const m of PLANNED_SCREENS) {
      const owned = OWNED_COMPONENT_DIRS[m.owner].some((dir) => m.path.startsWith(dir));
      if (!owned) offenders.push(`${m.screenId} (${m.owner}) → ${m.path}`);
    }
    expect(offenders, 'a planned slot points outside its owner stream’s directory').toEqual([]);
  });

  it('every planned slot is not yet mounted, and every planned path is a component file path', () => {
    for (const m of PLANNED_SCREENS) {
      expect(m.status).toBe('planned');
      expect(m.path).toMatch(/^src\/components\/.+\.tsx$/);
    }
  });

  it('the lookup helpers agree with the lists', () => {
    expect(screenMount('AF-16')?.owner).toBe('s1');
    expect(isMounted('AF-16')).toBe(true);
    // A stream's own new screen starts planned and becomes mounted when the stream lands it.
    const planned = PLANNED_SCREENS[0];
    expect(screenMount(planned.screenId)).toEqual({ ...planned });
    expect(isMounted(planned.screenId)).toBe(false);
    // A screen a stream has landed is reported mounted.
    expect(screenMount('OA-34')?.owner).toBe('s2');
    expect(isMounted('OA-34')).toBe(true);
    expect(plannedScreens()).toEqual(PLANNED_SCREENS);
    for (const s of STREAM_IDS) {
      expect(mountsForStream(s).every((m) => m.owner === s)).toBe(true);
    }
  });
});

describe('the capability registry matches the real catalogue (OWNERSHIP.md §4.3)', () => {
  it('names exactly the kinds the data layer defines', () => {
    expect(CAPABILITY_FAMILIES.map((f) => f.kind).sort()).toEqual(CAPABILITY_KINDS.map((k) => k.kind).sort());
  });

  it('owns each family and points at an existing module', () => {
    const owners: CapabilityOwner[] = ['trunk', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];
    for (const f of CAPABILITY_FAMILIES) {
      expect(owners).toContain(f.owner);
      expect(existsSync(resolve(ROOT, f.path)), `family ${f.kind} points at a missing file: ${f.path}`).toBe(true);
    }
  });

  it('the lookup helper agrees with the list', () => {
    expect(capabilityFamily('risk_control')?.path).toBe('src/lib/capabilities/riskControl.ts');
    expect(familiesForStream('trunk').length).toBe(CAPABILITY_FAMILIES.length);
  });
});

describe('the data barrel mounts every stream’s data module (OWNERSHIP.md §4.2)', () => {
  it('re-exports each stream module under its own namespace', async () => {
    const barrel = await import('../data/index');
    for (const ns of ['rulePacks', 'population', 'assurance', 'risk', 'connectors', 'lifecycle']) {
      expect(barrel, `the barrel does not re-export ${ns}`).toHaveProperty(ns);
    }
  });
});
