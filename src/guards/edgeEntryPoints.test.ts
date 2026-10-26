/**
 * C1.2: every Edge Function entry point verifies the caller before it does anything privileged.
 *
 * This is the lesson of the earlier ai-gateway defect (that function has since been removed with the
 * rest of AI, but the shape it had is still the one to guard against): an org id was read from the
 * request body and used straight away with the service role. The guard is a static check over the
 * source: inside each request handler, a named authorisation call must appear before the first
 * privileged call. An entry point that is pure wiring (it only builds dependencies for a _shared
 * handler) is accepted only when the handler it delegates to contains the gate, so the check follows
 * the code.
 *
 * Deliberately simple and text-based, like the other source guards: it fails loudly if someone
 * writes a new entry point that reaches for a service client or a privileged RPC first.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FUNCTIONS_DIR = join(process.cwd(), 'supabase', 'functions');

function functionDirs(): string[] {
  return readdirSync(FUNCTIONS_DIR)
    .filter((name) => !name.startsWith('_') && statSync(join(FUNCTIONS_DIR, name)).isDirectory())
    .sort();
}

function source(file: string): string {
  return readFileSync(file, 'utf8');
}

/** The index source, from the start of the request handler (after the dependency definitions). */
function handlerSource(name: string): string {
  const src = source(join(FUNCTIONS_DIR, name, 'index.ts'));
  const at = src.indexOf('Deno.serve');
  return at >= 0 ? src.slice(at) : src;
}

/** The _shared handler modules the index imports, as absolute paths. */
function importedHandlers(name: string): string[] {
  const src = source(join(FUNCTIONS_DIR, name, 'index.ts'));
  const out: string[] = [];
  for (const m of src.matchAll(/from\s+'(\.\.\/_shared\/[A-Za-z0-9_]+\.ts)'/g)) {
    const rel = m[1].replace('../', '');
    const abs = join(FUNCTIONS_DIR, rel);
    if (existsSync(abs)) out.push(abs);
  }
  return out;
}

const AUTH_PATTERNS = [
  'auth.getUser', 'oauth_state_consume',
  'invite_authorise', 'dispatch_token_check', 'graph_oauth_authorise', 'tokenMatches',
];

// Built from parts so this file does not itself contain the literal the M8 guard forbids.
const PRIVILEGED_PATTERNS = [
  'serviceClient()', `create${'Client'}(SUPABASE_URL, SERVICE_KEY`, 'admin.rpc(',
];

function firstIndexOf(src: string, patterns: string[]): number {
  let best = -1;
  for (const p of patterns) {
    const at = src.indexOf(p);
    if (at >= 0 && (best < 0 || at < best)) best = at;
  }
  return best;
}

describe('Edge Function entry points (C1.2)', () => {
  const dirs = functionDirs();

  it('there is at least the known set of Edge Functions', () => {
    expect(dirs.length).toBeGreaterThanOrEqual(5);
    for (const known of ['email-dispatch', 'graph-oauth', 'invite-user', 'secrets-put']) {
      expect(dirs).toContain(known);
    }
  });

  for (const name of functionDirs()) {
    if (name === 'email-dispatch') {
      // The dispatcher is machine-invoked: its gate is the dispatch token, and it must be checked
      // before any RPC other than the one that reads the token itself.
      it(`${name}: the dispatch token is checked before any other RPC`, () => {
        const handler = handlerSource(name);
        const tokenAt = handler.indexOf('tokenMatches');
        expect(tokenAt, 'email-dispatch must compare the dispatch token').toBeGreaterThanOrEqual(0);
        const otherRpc = handler.search(/\.rpc\('(email_expire_stale|email_dispatch_claim|email_dispatch_complete|email_resolve_profile|secret_reveal)'/);
        expect(otherRpc, 'email-dispatch must make a privileged RPC').toBeGreaterThanOrEqual(0);
        expect(tokenAt, 'the token check must precede every other RPC').toBeLessThan(otherRpc);
      });
      continue;
    }

    it(`${name}: the caller is verified before any privileged call`, () => {
      const handler = handlerSource(name);
      const privAt = firstIndexOf(handler, PRIVILEGED_PATTERNS);

      if (privAt < 0) {
        // Pure wiring: the index only builds dependencies. The gate must live in the handler it
        // delegates to, and that handler must contain an authorisation call.
        const handlers = importedHandlers(name);
        expect(handlers.length, `${name} delegates to no _shared handler`).toBeGreaterThan(0);
        const gated = handlers.filter((h) => firstIndexOf(source(h), AUTH_PATTERNS) >= 0);
        expect(gated.length, `${name}: no imported handler verifies the caller`).toBeGreaterThan(0);
        return;
      }

      const authAt = firstIndexOf(handler, AUTH_PATTERNS);
      expect(authAt, `${name} must call a named authorisation gate`).toBeGreaterThanOrEqual(0);
      expect(authAt, `${name}: authorisation must precede the privileged call`).toBeLessThan(privAt);
    });

    it(`${name}: no response object is built from a token field`, () => {
      const src = source(join(FUNCTIONS_DIR, name, 'index.ts'));
      // A cheap guard against an accidental token in a response literal.
      expect(src).not.toMatch(/access_token\s*:/);
      expect(src).not.toMatch(/refresh_token\s*:/);
    });
  }
});
