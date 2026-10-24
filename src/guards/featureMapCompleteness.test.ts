import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FEATURE_RPC_MAP, featureForRpc, mappedFeatureKeys } from '../lib/featureMap';

/**
 * F25 enforcement rule 5: every feature RPC in the migrations is mapped to a feature key in
 * src/lib/featureMap.ts. A function that gates on has_feature( but has no map entry fails the
 * build, so a new feature RPC cannot be added without declaring which feature it belongs to.
 */
const MIGRATIONS = resolve(process.cwd(), 'supabase/migrations');

interface Fn { name: string; body: string; }

/** Every `create or replace function public.<name>( ... ) ... $$;` block, split on the function head. */
function functionsInSql(rawSql: string): Fn[] {
  // Strip -- comments so a mention of has_feature in prose is not mistaken for a call.
  const sql = rawSql.replace(/--[^\n]*/g, '');
  const out: Fn[] = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  const starts: { name: string; idx: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) starts.push({ name: m[1].toLowerCase(), idx: m.index });
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].idx : sql.length;
    out.push({ name: starts[i].name, body: sql.slice(starts[i].idx, end) });
  }
  return out;
}

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const allFunctions = files.flatMap((f) => functionsInSql(readFileSync(join(MIGRATIONS, f), 'utf-8')));
// has_feature is the gate itself, not a caller of it.
const featureGated = allFunctions.filter(
  (fn) => fn.name !== 'has_feature' && /has_feature\s*\(/.test(fn.body)
);

describe('feature map completeness (F25 rule 5)', () => {
  it('scans the migrations and finds functions', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(allFunctions.length).toBeGreaterThan(200);
  });

  it('every function that gates on has_feature( has a featureMap entry', () => {
    const unmapped = featureGated.filter((fn) => featureForRpc(fn.name) === null).map((fn) => fn.name);
    expect([...new Set(unmapped)]).toEqual([]);
  });

  it('featureForRpc is exact: a prefix or suffix does not match', () => {
    const anyRpc = Object.keys(FEATURE_RPC_MAP)[0];
    expect(featureForRpc(anyRpc)).toBe(FEATURE_RPC_MAP[anyRpc]);
    expect(featureForRpc(`${anyRpc}_extra`)).toBeNull();
    expect(featureForRpc(`x_${anyRpc}`)).toBeNull();
  });

  it('every mapped feature key is a real catalogue key', () => {
    const seed = readFileSync(join(MIGRATIONS, '0051_control_plane_foundations.sql'), 'utf-8');
    const known = mappedFeatureKeys();
    // feature_entitlements is not a sellable catalogue feature; it is the entitlement switch itself.
    const expected = known.filter((k) => k !== 'feature_entitlements');
    for (const key of expected) {
      expect(seed.includes(`'${key}'`), `feature key ${key} is not seeded in the catalogue`).toBe(true);
    }
  });
});
