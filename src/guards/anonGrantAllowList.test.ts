import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * F11: the anonymous surface is exactly three functions. verify_certificate(p_id) and
 * verify_board_pack(p_id) are security definer and return only status, issued_at, the hash and
 * counts. verify_report_root(p_root) (W10.3, migration 0094) is the ONE deliberate addition the
 * brief permits for the writing engine's public report check: it returns only existence, the
 * issuance timestamp and the engine, template and phrase-library versions, and never tenant content.
 * This guard replays every `grant execute ... to anon` and `revoke execute ... from anon` across the
 * migrations in order and fails on any function other than those three, so the anonymous surface
 * cannot be widened by accident.
 *
 * Migration 0062 ends with a sweep that revokes EXECUTE from anon on every function in `public`
 * (named in a `format()`), then re-grants the two verification functions. That sweep clears the
 * earlier helper grants (is_cia, is_org_admin, can_read_all_scopes from 0016), which is why this
 * guard is order-aware rather than a plain union.
 *
 * Widening this allow-list is a deliberate act and must be recorded in docs/ACP-DECISIONS.md with
 * the reason and how to reverse it. The three entries are recorded in docs/WRITE-DECISIONS.md
 * (D-W-PUBLIC-ROOT).
 */
const ANON_CALLABLE = new Set<string>([
  'verify_certificate', 'verify_board_pack', 'verify_report_root',
]);

const MIGRATIONS = resolve(process.cwd(), 'supabase/migrations');

/** The dynamic sweep: `execute format('revoke execute on function public.%I(%s) from anon', ...)`. */
const SWEEP = /revoke\s+execute\s+on\s+function\s+public\.%I\(%s\)\s+from\s+anon/i;
const GRANT = /grant\s+execute\s+on\s+function\s+([\s\S]*?)\s+to\s+([^;]*);/gi;
const REVOKE = /revoke\s+execute\s+on\s+function\s+([\s\S]*?)\s+from\s+([^;]*);/gi;

function namesIn(list: string): string[] {
  return (list.match(/(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi) ?? [])
    .map((raw) => raw.replace(/\s*\($/, '').replace(/^public\./i, '').trim().toLowerCase())
    .filter(Boolean);
}

/** Every anon grant/revoke event in one migration, in source order. */
interface Event { index: number; kind: 'grant' | 'revoke' | 'sweep'; names: string[]; }

function eventsIn(text: string): Event[] {
  const sql = text.replace(/--[^\n]*/g, '');
  const out: Event[] = [];
  let m: RegExpExecArray | null;
  GRANT.lastIndex = 0;
  while ((m = GRANT.exec(sql)) !== null) {
    if (/\banon\b/i.test(m[2])) out.push({ index: m.index, kind: 'grant', names: namesIn(m[1]) });
  }
  REVOKE.lastIndex = 0;
  while ((m = REVOKE.exec(sql)) !== null) {
    if (/\banon\b/i.test(m[2])) out.push({ index: m.index, kind: 'revoke', names: namesIn(m[1]) });
  }
  const sweep = SWEEP.exec(sql);
  if (sweep) out.push({ index: sweep.index, kind: 'sweep', names: [] });
  return out.sort((a, b) => a.index - b.index);
}

/** The net set of functions anon may execute after every migration has been applied in order. */
function netAnonGrants(files: { file: string; text: string }[]): Set<string> {
  const granted = new Set<string>();
  for (const { text } of files) {
    for (const e of eventsIn(text)) {
      // The 0062 sweep revokes anon on every function in public EXCEPT the two verification
      // functions (`proname not in (...)`), so it clears the earlier helper grants and leaves the
      // allow-list untouched.
      if (e.kind === 'sweep') {
        for (const name of [...granted]) if (!ANON_CALLABLE.has(name)) granted.delete(name);
      } else if (e.kind === 'grant') e.names.forEach((n) => granted.add(n));
      else e.names.forEach((n) => granted.delete(n));
    }
  }
  return granted;
}

describe('anonymous surface is exactly three functions (F11, D-W-PUBLIC-ROOT)', () => {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, text: readFileSync(join(MIGRATIONS, f), 'utf-8') }));

  it('scans the migrations', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('after every migration, anon can execute no function outside the allow-list', () => {
    const net = [...netAnonGrants(files)].sort();
    expect(net.filter((n) => !ANON_CALLABLE.has(n))).toEqual([]);
  });

  it('anon can execute all three allow-listed functions', () => {
    const net = netAnonGrants(files);
    for (const name of ANON_CALLABLE) expect(net.has(name), `${name} is not granted to anon`).toBe(true);
  });

  it('has an allow-list of exactly the three verification functions', () => {
    expect([...ANON_CALLABLE].sort()).toEqual(
      ['verify_board_pack', 'verify_certificate', 'verify_report_root']);
  });

  it('the parser detects a multi-function grant, ignores a non-anon grant and a comment', () => {
    expect(namesIn('public.verify_certificate(uuid), public.verify_board_pack(uuid)').sort())
      .toEqual(['verify_board_pack', 'verify_certificate']);
    expect(eventsIn('grant execute on function public.foo(uuid) to authenticated;')).toEqual([]);
    expect(eventsIn('-- grant execute on function public.bar(uuid) to anon;')).toEqual([]);
  });

  it('a sweep clears an earlier grant, and a later grant survives it', () => {
    const text = [
      'grant execute on function public.is_cia() to anon;',
      "execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);",
      'grant execute on function public.verify_certificate(uuid) to anon;',
    ].join('\n');
    const net = netAnonGrants([{ file: 'x.sql', text }]);
    expect([...net]).toEqual(['verify_certificate']);
  });
});
