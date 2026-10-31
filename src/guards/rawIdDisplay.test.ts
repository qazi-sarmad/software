import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Raw-id display guard (integrator).
 *
 * A record's internal identifier (a UUID, a `usr-…` / `eng-…` seed key) is not user-facing. The
 * design report found one leak: a Gantt hover preview showed `Lead: <uuid>`. This guard fails when a
 * component renders a `${…Id}` into a *display* prop — a preview subtitle/title/owner/label/hint —
 * which is how that leak reached the screen. The identifier may still be a `key`, a `data-testid`, an
 * `aria-*` value or a lookup argument; only visible prose is checked.
 *
 * A display that genuinely needs to fall back to an id (a member with no name yet) is allowed by
 * naming the fallback explicitly with `||`, so the guard can see it is deliberate.
 */

const ROOT = resolve(process.cwd());
// A property that *is* an identifier: `leadAuditorId`, `reviewer_id`, `user.id`.
const ID_EXPR = '(?:[A-Za-z0-9_]*Id\\b|[A-Za-z0-9_]*_id\\b|\\.id\\b)';
const INTERP = '\\$\\{[^}]*' + ID_EXPR + '[^}]*\\}';
const DISPLAY_PROP = new RegExp(
  '(?:subtitle|title|owner|label|description|hint|sentence|text)\\s*:\\s*(?:' +
    '`[^`]*' + INTERP + '`|' +
    "'[^']*" + INTERP + "'|" +
    '"[^"]*' + INTERP + '")',
  'g',
);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.tsx') && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe('no component shows a raw record id as display prose (design report item 7)', () => {
  const offenders: string[] = [];
  for (const file of walk(join(ROOT, 'src', 'components'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(DISPLAY_PROP)) {
      // A deliberate fallback (`displayName || userId`) is a named decision, not a leak.
      if (/\|\|/.test(m[0])) continue;
      offenders.push(`${m[0]} (${relative(ROOT, file)})`);
    }
  }

  it('renders no `${…Id}` inside a display prop', () => {
    expect(
      offenders.sort(),
      'show the resolved name instead, or drop the field if no name is available',
    ).toEqual([]);
  });
});
