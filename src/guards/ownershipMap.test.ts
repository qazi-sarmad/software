import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SCREEN_MOUNTS, type StreamId } from '../nav/registry';

/**
 * Ownership-map guard (integrator).
 *
 * `docs/build/OWNERSHIP.md` §2 is the rule that makes the concurrent build safe: a file appears once,
 * owned by one stream. The map is prose, so nothing stopped it from claiming a file twice — which
 * happened twice (`src/components/admin/RulePackPanel.tsx` and `src/lib/systeligon/extract/**`) before
 * this guard existed. This guard reads the map and proves, for every screen a build stream owns, that
 * exactly one stream's grant covers its component path, and that the grant names the same stream the
 * screen registry does. A slot granted to no stream, or to two, fails the build.
 *
 * It covers the seven build streams only. A `trunk`-owned screen predates the map (the integrator
 * mounted it before the map existed), so it is not held to it.
 */

const ROOT = resolve(process.cwd());
const STREAM_OWNERS: StreamId[] = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];

/** One §2 table row: a path pattern (or an explicit file), its owner stream, and any exclusions. */
interface Grant {
  owner: StreamId;
  /** Directory globs (`prefix/**`) or exact file paths the row grants. */
  globs: string[];
  /** Exact file names the row excludes from its globs (the "except `X`" clause). */
  excepts: string[];
  raw: string;
}

function ownerOf(cell: string): StreamId | null {
  // The owner cell is like `**S1**`, `**S5** (S1 reads it, never edits)`, `**TRUNK / integrator**`.
  const m = cell.match(/\*\*([^*]+)\*\*/);
  if (!m) return null;
  const token = m[1].trim().toLowerCase();
  if (token.startsWith('trunk')) return 'trunk';
  if (token.startsWith('design')) return 'design';
  const s = token.match(/^s([1-7])\b/);
  return s ? (`s${s[1]}` as StreamId) : null;
}

/** Parse the §2 ownership table into grants. */
function parseGrants(md: string): Grant[] {
  const grants: Grant[] = [];
  for (const line of md.split('\n')) {
    if (!line.startsWith('|') || line.includes('|---')) continue;
    const cells = line.split('|');
    if (cells.length < 4) continue;
    const pathCell = cells[1];
    const owner = ownerOf(cells[cells.length - 2] ?? '');
    if (!owner) continue;

    const tokens = [...pathCell.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
    const globs: string[] = [];
    const excepts: string[] = [];
    // The "except `X`" clause names files the glob does not cover.
    const exceptPart = pathCell.split(/except/i)[1] ?? '';
    for (const t of tokens) {
      if (exceptPart.includes(`\`${t}\``)) excepts.push(t);
      else globs.push(t);
    }
    if (globs.length) grants.push({ owner, globs, excepts, raw: line.trim() });
  }
  return grants;
}

/** Does a row's grant cover this component path? */
function covers(grant: Grant, path: string): boolean {
  const hit = grant.globs.some((g) =>
    g.endsWith('/**') ? path.startsWith(g.slice(0, -2)) : path === g);
  if (!hit) return false;
  return !grant.excepts.some((e) => path === e || path.endsWith(`/${e}`) || path.endsWith(e));
}

const md = readFileSync(resolve(ROOT, 'docs/build/OWNERSHIP.md'), 'utf8');
const grants = parseGrants(md);

describe('the ownership map grants each stream screen to exactly one stream (OWNERSHIP.md §2)', () => {
  it('the map parsed into grants (a broken parse would make the checks vacuous)', () => {
    expect(grants.length).toBeGreaterThan(10);
    expect(grants.map((g) => g.owner)).toContain('s5');
  });

  it('every stream-owned screen slot is covered by exactly one stream, and by its own stream', () => {
    const offenders: string[] = [];
    for (const m of SCREEN_MOUNTS) {
      if (!STREAM_OWNERS.includes(m.owner)) continue;
      const owners = [...new Set(grants.filter((g) => covers(g, m.path)).map((g) => g.owner))];
      if (owners.length !== 1) {
        offenders.push(`${m.screenId} (${m.path}) is covered by ${owners.length || 'no'} stream(s): ${owners.join(', ') || 'none'}`);
      } else if (owners[0] !== m.owner) {
        offenders.push(`${m.screenId} is owned by ${m.owner} in the registry but granted to ${owners[0]} by §2`);
      }
    }
    expect(offenders, 'a screen is unowned, double-owned, or owned by the wrong stream').toEqual([]);
  });
});
