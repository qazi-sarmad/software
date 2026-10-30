import { test, expect, type APIRequestContext } from '@playwright/test';
import { passwordFor } from './password';

// Fixed synthetic test IDs from e2e/global-setup.ts.
const ORG_A = '02af9314-9781-5bde-b8a7-d46bfee07783';
const ORG_B = 'bb3f7e0e-c6db-5121-a9e0-2e102e1fa2ab';

// Trimmed: a stray newline in a CI secret makes the header invalid.
const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').trim();
const PUBLISHABLE_KEY = (process.env.SUPABASE_PUBLISHABLE_KEY ?? '').trim();
if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
  throw new Error('RLS e2e needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY');
}

// [table, column holding the org id]
const TENANT_TABLES: [string, string][] = [
  ['org_members', 'org_id'],
  ['universes', 'org_id'],
  ['entities', 'org_id'],
  ['roles', 'org_id'],
  ['user_scopes', 'org_id'],
  ['orgs', 'id'],
];

const USERS: { email: string; org: string }[] = [
  { email: 'ayesha.khan@provio-test.invalid', org: ORG_A },
  { email: 'hamza.qureshi@provio-test.invalid', org: ORG_B },
];

async function signIn(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    data: { email, password: passwordFor(email) },
  });
  expect(res.ok(), `sign-in as ${email}`).toBeTruthy();
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

async function readRows(
  request: APIRequestContext,
  token: string | null,
  table: string,
  column: string
): Promise<Record<string, unknown>[] | number> {
  const headers: Record<string, string> = { apikey: PUBLISHABLE_KEY };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?select=${column}`, { headers });
  if (!res.ok()) return res.status();
  return (await res.json()) as Record<string, unknown>[];
}

test.describe('RLS: tenants cannot read each other', () => {
  for (const user of USERS) {
    for (const [table, column] of TENANT_TABLES) {
      test(`[E2E] ${user.email} sees only its own org in ${table}`, async ({ request }) => {
        const token = await signIn(request, user.email);
        const data = await readRows(request, token, table, column);
        expect(Array.isArray(data), `${table} read as ${user.email}`).toBeTruthy();
        const rows = data as Record<string, unknown>[];
        // Non-vacuous: the user must be able to read its own org's rows.
        expect(rows.length, `${table} has rows for own org`).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row[column]).toBe(user.org);
        }
      });
    }
  }

  test('[E2E] with no session, tenant tables return no rows', async ({ request }) => {
    for (const [table, column] of TENANT_TABLES) {
      const data = await readRows(request, null, table, column);
      if (typeof data === 'number') {
        expect([401, 403], `${table} without session`).toContain(data);
      } else {
        expect(data, `${table} without session`).toEqual([]);
      }
    }
  });

  // Phase 6.2: isolation under concurrency. The sequential tests above prove a session reads only its
  // own org when it runs alone; this proves the boundary holds while many sessions of two orgs are in
  // flight at once. A leak that depended on shared per-request state (a pooled backend, a cached
  // claim) would only appear here. Each of the two tokens is used to fire the whole table list
  // simultaneously, then every response is checked for foreign rows.
  test('[E2E] concurrent reads from two orgs never cross the tenant boundary', async ({ request }) => {
    const tokens = await Promise.all(USERS.map(async (u) => ({ ...u, token: await signIn(request, u.email) })));

    const calls: { email: string; org: string; table: string; column: string; p: Promise<Record<string, unknown>[] | number> }[] = [];
    // Three rounds, so the reads from the two orgs interleave rather than arriving in one block.
    for (let round = 0; round < 3; round += 1) {
      for (const { email, org, token } of tokens) {
        for (const [table, column] of TENANT_TABLES) {
          calls.push({ email, org, table, column, p: readRows(request, token, table, column) });
        }
      }
    }

    const settled = await Promise.all(calls.map((c) => c.p));
    settled.forEach((data, i) => {
      const { email, org, table, column } = calls[i];
      expect(typeof data, `${table} read as ${email} (concurrent)`).not.toBe('number');
      const rows = data as Record<string, unknown>[];
      expect(rows.length, `${table} has own-org rows for ${email} (concurrent)`).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row[column], `${table}.${column} row leaked across orgs to ${email} (concurrent)`).toBe(org);
      }
    });
  });
});
