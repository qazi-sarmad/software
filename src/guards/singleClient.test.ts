import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/**
 * Rule M8: the browser has exactly ONE Supabase client. src/data/client.ts creates it and exports
 * getClient(); every data module imports that. This guard fails if any other file under src imports
 * @supabase/supabase-js or calls createClient(, so a second client can never creep back in.
 */
describe('single Supabase client (rule M8)', () => {
  const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
  const ALLOWED = 'data/client.ts';
  const SELF = 'guards/singleClient.test.ts';

  it('finds files to scan', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('only src/data/client.ts imports @supabase/supabase-js or calls createClient(', () => {
    const offenders = files
      .filter((f) => {
        const rel = relative(SRC, f).replace(/\\/g, '/');
        return rel !== ALLOWED && rel !== SELF;
      })
      .filter((f) => {
        const body = readFileSync(f, 'utf-8');
        return /@supabase\/supabase-js/.test(body) || /(^|[^.\w])createClient\s*\(/m.test(body);
      })
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('src/data/client.ts is the single place that creates the client', () => {
    const client = readFileSync(join(SRC, ALLOWED), 'utf-8');
    expect(client).toMatch(/export function getClient\(/);
    expect(client).toMatch(/createClient\(/);
  });
});
