# Completion build decisions

Numbered, one entry per decision: number, task, point, options, choice, reason, how to reverse.
Classes: FIXED (implemented as written in the task), NEVER IMPROVISE (not decided here),
IMPROVISE-THEN-DOCUMENT (this file).

## D-C0-1 — baseline counts come from the last green CI run, not from a local run (C0)

- Task: C0.
- Point: which numbers later counts are compared against.
- Options: (a) the counts printed by a local run; (b) the counts the task supplies from the last
  green CI run 39516753943 at head `a41d46e`.
- Choice: (b). A local run at the same commit reproduced vitest 128 files / 1428 tests exactly, so
  the two agree; the task's numbers stay authoritative.
- Reason: CI is the recorded truth; the local run is a cross-check.
- Reverse: none needed; the numbers are historical facts.

## D-C0-2 — the four completion docs are created in C0 and committed alone (C0)

- Task: C0.
- Point: the task says "no commit except the empty docs files".
- Choice: one commit `docs: completion run start (C0)` containing only
  `docs/COMPLETION-PROGRESS.md`, `docs/COMPLETION-DECISIONS.md`, `docs/COMPLETION-BLOCKERS.md` and
  `docs/COMPLETION-REPORT.md`.
- Reason: the instruction is explicit; the docs are the running record the rest of the run appends to.
- Reverse: delete the four files.

## D-C1.1-1 — the OAuth state key is derived from SECRETS_MASTER_KEY, not read from Vault (C1.1)

- Task: C1.1(c)/(d).
- Point: which server secret signs the OAuth `state`.
- Options: (a) a Vault secret; (b) a key derived from the Edge secret `SECRETS_MASTER_KEY` with a
  domain-separation label (`graph-oauth-state-v1`, then SHA-256).
- Choice: (b).
- Reason: Vault holds tenant secrets; the state key is a platform-level signing key. Deriving it keeps
  one piece of key material out of two algorithms, needs no extra owner step, and is deterministic
  across Edge Function instances so `start` and `exchange` agree without shared state. The task names
  this as the fallback and asks which was used.
- Reverse: set a Vault secret and read it in `deriveStateKey`'s caller; the format is unchanged.

## D-C1.1-2 — the single-use nonce lives in a small table, service-role only (C1.1(d))

- Task: C1.1(d): "store used nonces briefly in a small table or Vault-free table with RLS and no
  direct write".
- Choice: `oauth_state_nonces` (migration 0072), RLS enabled with NO policy, written and read only
  through `oauth_state_consume`, a SECURITY DEFINER function granted to `service_role` alone. It
  prunes rows older than a day on each call, so no scheduled job is needed.
- Reason: it is queryable for the SQL test, needs no Vault, and the empty policy set proves no session
  role can reach it (F11).
- Reverse: drop the table and the function; the Edge Function would then refuse every replay check.

## D-C1.1-3 — the HTTP `refresh` action is deleted, not gated (C1.1(b))

- Task: C1.1(b) is FIXED: "Delete the HTTP `refresh` action."
- Choice: `graph-oauth` routes only `start` and `exchange`; anything else, `refresh` included, gets
  `400 unknown action`. Token refresh happens only inside the dispatcher path through the shared
  module with the service role.
- Reason: the action returned a live access token for any tenant's mailbox; removing it is the only
  fix that cannot be re-enabled by a missing check.
- Reverse: not reversible by design; a new action would need its own review.

## D-C1.1-4 — the client id is not treated as a secret (C1.1(g))

- Task: C1.1(g) fixture check "response bodies contain no token".
- Point: whether the consent URL's `client_id` counts as a leak.
- Choice: it does not. The Microsoft application (client) id is a public identifier that appears in
  every consent URL; only the client SECRET and any token are secrets.
- Reason: asserting the client id away would force an unusable design; the secret, the access token
  and the refresh token are all asserted absent.
- Reverse: none; this is a definition.

## D-C1.1-5 — the callback route is outside the tenant shell, at `/oauth/graph` (C1.1(f))

- Task: C1.1(f) "a functional callback route (testid prefix oa-11-/sa-04-)".
- Choice: `/oauth/graph`, rendered by `GraphOauthCallback` with `screenId="oa-11"`, in the same
  position as `/external/accept` (outside the tenant shell). The Edge Function verifies the session
  from the bearer token, so an anonymous visit stores nothing and the screen shows its error state.
- Reason: one route serves both the tenant (OA-11) and platform (SA-04) flows; the org is carried in
  the signed state, so the route never needs to know it.
- Reverse: move the branch inside `AuthGate`; the testids are unchanged.

## D-C1.1-6 — the Playwright smoke stubs the Edge Function at the network boundary (C1.1(g))

- Task: C1.1(g) "Add a Playwright smoke that the start action returns a URL containing state= and no
  secret."
- Point: the function is not deployed to the test project, and Microsoft cannot be reached from CI.
- Choice: `e2e/c1-graph-oauth.spec.ts` stubs `**/functions/v1/graph-oauth` with `page.route` and
  proves the client wiring and the screen behaviour. The authorisation, the state signing and the
  refusals are proven by the unit tests and the SQL test, which run the real code.
- Reason: a stub stands in for an external provider, not for our own logic; every rule in the task is
  still asserted against real code somewhere.
- Reverse: delete the stub once the owner deploys the function and configures the app registration.

## D-C1.2-1 — the entry-point guard is a static check over each index.ts (C1.2)

- Task: C1.2 "add guard src/guards/edgeEntryPoints.test.ts".
- Choice: for each `supabase/functions/<name>/index.ts`, the request handler must call a named
  authorisation gate (`auth.getUser`, `ai_gateway_authorise`, `oauth_state_consume`, `tokenMatches`,
  ...) before the first privileged call (`serviceClient()`, a service-role `createClient`, or
  `admin.rpc(`). A pure-wiring index is accepted only when an imported `_shared` handler contains the
  gate.
- Reason: the earlier gateway defect was an entry point that used a service client before any check;
  a source-level guard catches the next one at review time, and the code path it protects is covered
  by the handler unit tests.
- Reverse: relax or delete the guard; the handler tests remain.
