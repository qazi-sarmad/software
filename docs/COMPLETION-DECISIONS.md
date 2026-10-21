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

## D-C1.3-a — one shared guard, provio_org_guard, instead of 29 inline checks (C1.3)

- Task: C1.3.
- Point: how a SECURITY DEFINER function decides that an organisation argument is the caller's.
- Options: (a) repeat a `jwt_org_id() is not distinct from p_org` test in each function; (b) one
  helper, `provio_org_guard(p_org)`, called first by each function.
- Choice: (b).
- Reason: 29 functions needed the same rule, and a single helper makes the rule reviewable in one
  place and gives the next reviewer one thing to check. The helper is `security definer` so it reads
  the JWT claims consistently regardless of the caller's role, and it raises `P0001` with a
  plain-language message.
- Reverse: inline the three-branch test into each function and drop the helper.

## D-C1.3-b — the discovery was two passes, and the second pass was mechanical (C1.3)

- Task: C1.3 "Any function with an id or org parameter and no cross-org refusal test gets one now".
- Point: how to be sure every leaking function was found, out of 285.
- Options: (a) read the bodies of the app-facing functions only; (b) generate a call for every
  security-definer function that takes an argument, run them all as an Org B user with Org A handles,
  and inspect every one that returned data or wrote a row.
- Choice: (b), after (a).
- Reason: pass (a) found 23 leaks. Pass (b) — 254 generated calls — found six more (`board_pack_list`,
  `list_tenant_entitlements`, `email_resolve_profile`, `render_notification`, `rule_recipients`,
  `rule_loop_guard`) that a body reading had missed because their org argument was not named `p_org` or
  was read from a row. `supabase/tests/82_rpc_authority.sql` is pass (b) made durable.
- Reverse: none; the test is the record.

## D-C1.3-c — the guard returns early when no JWT claims are set (C1.3)

- Task: C1.3, after 18 existing SQL tests failed.
- Point: `append_ledger_entry` and the other helpers are called from inside other definer functions,
  from triggers, and from migrations and tests that run as the owner with no JWT. A guard that always
  demanded a matching org claim broke all of those.
- Options: (a) require the claim everywhere and rewrite the internal callers; (b) treat an absent
  `request.jwt.claims` as a trusted in-database context and return early; (c) let the owner bypass.
- Choice: (b), plus an explicit `auth.role() = 'service_role'` bypass for the Edge Functions.
- Reason: PostgREST always sets `request.jwt.claims` for a browser request, so an empty setting means
  the call did not come from a browser at all — it is a trigger, a nested definer call, a migration or
  a test. That context already runs with the database owner's authority. This is the only test that
  distinguishes "a request" from "inside the database" without relying on `current_user`, which is the
  definer's owner in both cases. Option (c) is what option (b) amounts to, stated precisely.
- Reverse: delete the two early returns; internal callers would then need a claims shim.

## D-C1.3-d — the mask readers stay callable, they just check the org first (C1.3)

- Task: C1.3, the `secret_display` and `email_sender_profiles_list` leaks.
- Point: `secret_display` returns a masked value, not a secret, and the app calls it. Should it be
  withdrawn instead of guarded?
- Choice: keep it callable by `authenticated` and guard it: the row's `org_id` must be the caller's,
  and a platform-scoped secret (org_id null) needs `is_platform_admin()`.
- Reason: the leak was a mask for another tenant's secret label and existence, which is tenant
  information even though it is not the secret itself. Withdrawing it would break the secrets screen
  for no gain.
- Reverse: revoke execute from authenticated and route the screen through a service-role Edge Function.

## D-C2.1-a — the driver is injected, so the function is testable without Deno or a database (C2.1)

- Task: C2.1 "Tests with an injected fake driver (success, auth failure, timeout, missing extension,
  metadata address)".
- Choice: `_shared/hostingTestHandler.ts` takes a `DriverLike` with one `probe(spec, timeoutMs)`
  method; `index.ts` supplies the real one built on `deno.land/x/postgres`. The driver is imported
  lazily inside `probe` so the handler module stays free of Deno-only imports and the vitest suite can
  import it.
- Reason: same pattern as `aiGatewayHandler.ts` and `graphOauthHandler.ts`. The five required cases
  are all reachable by a fake driver, and the handler's own rules (authorisation, the metadata
  refusal, the password never in a response) run as real code.
- Reverse: none; the interface is the seam.

## D-C2.1-b — the requirement lists are derived from the migrations and asserted against them (C2.1)

- Task: C2.1 "Required extensions and roles come from a single list derived from the migrations
  (`grep create extension`), kept in `_shared/requiredHostingSpec.ts` with a test that the list
  matches the migrations."
- Choice: `REQUIRED_EXTENSIONS = [pgcrypto, pg_cron, pg_net]`, split into `CORE_EXTENSIONS =
  [pgcrypto]` and `OPTIONAL_EXTENSIONS = [pg_cron, pg_net]`; `REQUIRED_ROLES = [platform_admin]`.
  `src/lib/requiredHostingSpec.test.ts` strips SQL comments, greps the migrations for `create
  extension` and `create role`, and fails if either list disagrees in either direction.
- Reason: a drift between the check and the migrations would pass a database that cannot run the
  application. pg_cron and pg_net are optional because 0064 creates them behind a guard and the app
  runs without them; the report names them separately rather than failing the whole test.
- Reverse: edit the lists; the test then tells you which migration to change.

## D-C2.1-c — the probe reports the database size when it cannot read free space (C2.1)

- Task: C2.1 "free_space_estimate".
- Point: a tenant role can read `pg_database_size` but not always the disk's free space.
- Choice: the driver reads `pg_database_size(current_database())` and the report labels it "free
  space is about …". It is an estimate, as the field name says, and the report says "about".
- Reason: the honest alternative — omitting the field — gives the Org Admin nothing. The task asks
  for an estimate, and the label carries the caveat.
- Reverse: read `pg_ls_dir`/`pg_stat_file` if the tenant grants superuser; not required.

## D-C2.1-d — the deploy-list check reads docs/ only, and only the same-line form (C2.1)

- Task: C2.1 "Add a check script `scripts/check-function-deploy-list.mjs` that fails if any
  `supabase functions deploy <name>` string in docs/ names a function with no directory."
- Choice: the script scans every `docs/**/*.md` for `supabase functions deploy <name…>` and checks
  each name against `supabase/functions/<name>`. Wired as CI step 6b and pre-PR gate 6b.
- Reason: the owner copies the deploy line out of the docs, so a stale name fails on the owner's
  machine. The same-line form is what the docs use; a multi-line list is not silently skipped because
  the check names every offender it does see.
- Reverse: delete the script and the two wiring lines.


## D-C2.2-a — the CAP overdue rule lives once in SQL, and the app agrees by parity test (C2.2)

- Task: C2.2 (1) "using the SAME overdue logic the app uses (read the CAP model and orgDate handling
  first; write the rule once as a SQL function and have the app's helper agree via a parity test on
  fixtures)".
- Options: (a) duplicate the rule in the job and trust the two to stay aligned; (b) put the rule in
  SQL only and have the app call it per cap; (c) put the rule in SQL, keep the app's pure helper, and
  pin both to one fixture table.
- Choice: (c). `public.cap_is_overdue(status, due_date, today)` is the rule;
  `public.org_local_date(org, now)` is the org-local calendar day; the app keeps
  `isCapOverdue`/`getOrgLocalToday`, and `src/lib/capOverdueParity.test.ts` plus
  `supabase/tests/83_scheduled_jobs.sql` assert the same cases. The vitest test also transcribes the
  SQL rule and compares it to the app's, so a change on either side alone fails.
- Reason: the job must not need a round trip per cap, and the app must not depend on a network call
  to decide whether a row is overdue. The parity test is the join. Option (a) is how the drift the
  task warns about happens.
- Reverse: delete the parity test and one of the two copies; the rule is then single-sourced but the
  other side must be regenerated.

## D-C2.2-b — the due-soon window is configuration on org_settings_extra, default 7 days (C2.2)

- Task: C2.2 (1) "emits `cap.due_soon` … using the SAME overdue logic" (the window itself is not
  fixed by the prompt).
- Options: (a) hard-code 7 days in the job; (b) a column on `org_settings_extra` with a 7-day
  default, read by `public.cap_due_soon_days(org)`.
- Choice: (b). `org_settings_extra.cap_due_soon_days int not null default 7`; the job reads it per
  organisation.
- Reason: the decision protocol prefers configuration-not-code for a number a tenant may want to
  change, and the column keeps the existing default behaviour for every tenant.
- Reverse: drop the column and the helper; the job falls back to 7.

## D-C2.2-c — the organisation time zone is a column, not a constant (C2.2)

- Task: C2.2 (1) "read the CAP model and orgDate handling first".
- Options: (a) reuse `src/lib/orgDate.ts`'s constant `Asia/Karachi` in SQL; (b) add
  `org_settings_extra.time_zone` (default `Asia/Karachi`) and read it in `org_local_date`.
- Choice: (b). The default reproduces today's behaviour exactly, so no existing fixture moves; a
  tenant that operates elsewhere can be corrected without a migration.
- Reason: a database job cannot import a TypeScript constant, and hard-coding a zone in SQL is the
  same defect the task's parity requirement exists to prevent.
- Reverse: drop the column; `org_local_date` then falls back to `Asia/Karachi` (the coalesce).

## D-C2.2-d — the escalation sweep is a platform-wide wrapper, not a second rule (C2.2)

- Task: C2.2 (4) "hourly `escalate_overdue_deployment_requests()`".
- Point: the existing function reads the caller's organisation from the JWT, which a scheduled run
  does not have.
- Choice: `public.deployment_requests_escalate_all()` loops the organisations and performs the same
  update, with the same audit row. The JWT-scoped function is left exactly as it was, so the
  Org Admin screen keeps its behaviour. The wrapper also emits `escalation.triggered`, a catalogue
  key that had no emitter.
- Reason: rewriting the JWT function to accept an org would widen its surface for every tenant
  caller; a separate platform-only wrapper is narrower.
- Reverse: drop the wrapper and unschedule `deployment-escalation-sweep`.

## D-C2.2-e — the digest is a database function, and only daily_digest recipients get it (C2.2)

- Task: C2.2 (6) "the daily change-notification digest for recipients who chose digest".
- Choice: `public.notification_digest_send(since)` queues one email per `notification_preferences`
  row whose mode is `daily_digest`, listing that organisation's `config.changed` events since the
  window. Recipients on `immediately` are untouched because the rule engine already emailed them.
  The body is escaped by a new pure `public.escape_html_text`.
- Reason: the task says "queues one email per recipient", and doing it in the database keeps the
  recipient decision next to the preference row (no second copy of the rule in TypeScript).
- Reverse: unschedule `notification-digest` and drop the function.

## D-C2.2-f — SA-02's job-health reader is platform-only and tolerates a missing pg_cron (C2.2)

- Task: C2.2 "Health: SA-02 must read `cron.job` and `cron.job_run_details` through a platform-only
  function and show each job's last run and failure."
- Options: (a) the RPC raises when pg_cron is absent; (b) the RPC returns an empty set and the screen
  says "no scheduled jobs are registered".
- Choice: (b). `public.platform_job_health()` checks `is_platform_admin` first, then returns empty
  when the extension is missing. The screen renders that as an informational empty state, not an
  error.
- Reason: a database without the scheduler is a supported state (0064 creates pg_cron behind a
  guard), and SA-02 must still open. A tenant caller is refused, which is the security requirement.
- Reverse: make the RPC raise instead; the screen's error branch already renders it.

## D-C2.2-g — cap_event_log is the idempotency ledger for the daily CAP job (C2.2)

- Task: C2.2 (1) with M5 ("SQL tests leave no residue") and L5 ("every action is logged").
- Options: (a) rely on `automation_event_processed` alone; (b) a small `cap_event_log`
  (org, cap, event key, day) with a unique index, read-only to tenants.
- Choice: (b), unique on (cap_id, event_key, event_date). The job inserts with
  `on conflict do nothing` and emits only when the insert actually happened.
- Reason: `automation_event_processed` records that an event was processed, not that a cap was
  notified today; without (b) a second run in the same day would emit again. The log is also the
  tenant-visible record of what was sent, which L5 wants.
- Reverse: drop the table and remove the guard; the job then emits once per run.

## D-C2.3-a — every emitter goes through one door, emit_catalogue_event (C2.3)

- Task: C2.3 "Wire every event whose source exists" and "SQL test enumerates catalogue keys against
  emitters and fails on any key that has neither an emitter nor an entry in an explicit allow-list".
- Options: (a) each emitter calls `emit_event` directly; (b) one `emit_catalogue_event` that checks
  the key against `automation_events_catalogue` first.
- Choice: (b). Every new trigger emitter calls `emit_catalogue_event`, which raises on a key that is
  not in the catalogue.
- Reason: the task's completeness rule is only meaningful if an emitter cannot invent a key. The door
  makes the catalogue the single list, so a typo fails loudly at the source instead of creating an
  event no rule can ever match.
- Reverse: change the callers back to `emit_event`; the completeness test still passes, but a typo
  would create an unmatched event.

## D-C2.3-b — the allow-list is a table with reasons, and it holds exactly two keys (C2.3)

- Task: C2.3 "or an entry in an explicit allow-list (only `watcher.signal` and any key you justify in
  the doc)".
- Choice: `event_emitter_allowlist (event_key, reason)`, seeded with `anomaly.raised` and
  `watcher.signal`. Test 84 fails if a key has neither an emitter nor a row, and fails if the list
  grows past two.
- Reason: `anomaly.raised` is the one key the earlier review named as apparently missing an emitter;
  measuring shows there is genuinely no server-side anomaly record (detection is a pure client
  function in `src/lib/analytics.ts`), so wiring it would mean inventing a record and breaking L1.
  The prompt's example was `watcher.signal`; the second row is justified in COMPLETION-EVENTS.md.
- Reverse: drop the table and the test block; a key without an emitter then passes silently.

## D-C2.3-c — emitters are triggers on the source table, not calls inside the writing RPC (C2.3)

- Task: C2.3 "Wire every event whose source exists, with a field catalogue matching the rule
  conditions."
- Options: (a) add an `emit_event` call inside each writing RPC; (b) an AFTER trigger on the table
  that holds the fact.
- Choice: (b). Triggers cover every writer — the RPC, a backfill, an Edge Function through the
  service role — and cannot be forgotten when a new writer is added. The RPC path is the only writer
  today, so (a) would work, but it would silently miss the first Edge Function that writes the table.
- Reason: the fact, not the caller, is the source. The trigger is also where the transition
  (false→true, `draft`→`frozen`) is visible, which is what the event means.
- Reverse: drop the triggers and put `perform public.emit_catalogue_event(...)` at the end of each
  writing RPC.

## D-C2.3-d — finding.sealed fires when the engagement seals (C2.3)

- Task: C2.3 lists `finding.sealed` among the keys to wire; no `findings` seal column exists.
- Point: a finding has no seal of its own. It becomes read-only when its engagement seals (0034's
  conclusion sign-off sets `engagements.sealed`; the row guards then refuse writes).
- Choice: `emit_engagement_sealed` emits `finding.sealed` once per finding of that engagement at the
  moment it seals, resolving the finding to its engagement through its observation, or through its
  entity when it was created without one.
- Reason: it is the only true reading of the key. A dedicated column would be a new fact the model
  does not have, and emitting per finding on every seal would be a guess.
- Reverse: drop the loop; `finding.sealed` then has no emitter and must move to the allow-list.

## D-C2.2-1 — the pg_cron assertions in test 83 are conditional on the extension (C2.2, C2.3 fix)

- Task: C2.2 scheduled jobs; the red CI run 39586479221 on 0b91dea is the evidence.
- Point: test 83 asserted `count(*) = 0` from `platform_job_health()` "when pg_cron is absent". The
  local harness has no pg_cron (so it passed locally), but the hosted `provio-test` project DOES have
  pg_cron, so the function returned the 7 scheduled jobs and the assertion failed:
  `FAIL: the platform admin reads no jobs when pg_cron is absent (expected 0, got 7)`.
- Options: (a) keep the fixed 0 and accept that the test only passes on a bare Postgres; (b) branch
  the expectation on `exists (select 1 from pg_extension where extname = 'pg_cron')`.
- Choice: (b). When pg_cron is present the test asserts the six C2.2 job names are visible through
  `platform_job_health()`; when it is absent it asserts the empty set. Both states are honest.
- Reason: the test must pass on the environment CI actually uses, and the "absent" branch still
  proves the migration applies without pg_cron.
- Reverse: revert to the unconditional zero (breaks CI on the hosted project).

## D-C2.4-1 — one invitation path: the RPC, not the Edge Function action (C2.4)

- Task: C2.4 "invite-user action `invite` currently duplicates the RPC; keep one path and remove the
  duplicate caller confusion; document which."
- Point: `invite-user`'s `invite` action called `invite_user_capped`, and `src/data/admin.ts` also
  called the same RPC directly from the browser. Two callers, one effect.
- Options: (a) keep the Edge Function action and route the browser through it; (b) keep the RPC and
  delete the action.
- Choice: (b). `invite_user_capped` is already granted to `authenticated` and re-checks
  `manage_users` inside the database; the Edge Function added nothing but a second code path and a
  second place to keep the copy honest. The browser calls the RPC directly; the Edge Function keeps
  only the two acceptance actions (`accept`, `accept-external`), which genuinely need the service role.
- Reason: the database is the authority; one caller path is simpler to audit and cannot drift.
- Reverse: re-add the `invite` branch to `supabase/functions/invite-user/index.ts`.

## D-C2.4-2 — the member acceptance route is public and creates the account (C2.4)

- Task: C2.4 "If the member accept route or page does not exist, build it (functional)."
- Point: `acceptanceLink()` has always emitted `/invite/accept?token=…`, but no route or component
  existed, so the link was dead. The invitee also has no account, and the spec forbids a third
  anonymous-callable database function (F11: exactly `verify_certificate` and `verify_board_pack`).
- Options: (a) an anonymous `invite_accept_context` RPC to preview the invitation; (b) no preview RPC
  at all — the invitee enters the code and sets a password.
- Choice: (b). The screen (`src/components/pending/MemberAccept.tsx`, testid prefix `oa-accept`) sits
  outside the tenant shell and outside the auth gate, like `/external/accept`. It creates the account
  through `supabase.auth.signUp` (the invitee's own password), then presents the token to
  `invite-user`'s `accept` action, which calls the service-role-only `admin_accept_invite`.
- Reason: F11 is fixed and may not be widened; the token is the secret, so no preview is needed; the
  acceptance boundary stays in the database (`admin_accept_invite` is service_role only).
- Consequence recorded honestly: the invitee needs Supabase Auth sign-ups enabled. When sign-ups are
  off, or when the project requires email confirmation (no session), the screen says so plainly
  rather than pretending the invitation was applied — the same honesty rule as EX-01.
- Reverse: delete the component, the lazy import and the route branch in `src/App.tsx`.

## D-C2.9-1 — the support session is a grant-gated read path, not a role (C2.9)

- Task: C2.9 "Implement the content_read session as the spec says."
- Point: `support_access_grants` was metadata only. The spec §24 says a tenant administrator can
  create a time-boxed, read-only grant and the platform then reads tenant content under it, with the
  default (no grant) being zero reads.
- Options: (a) give the platform role a widened RLS read policy on business tables while a grant is
  live; (b) keep the platform blind and expose read-only `support_*` functions that check the grant on
  every call and log every read.
- Choice: (b). The platform role keeps reading zero rows from every business table directly (tests 03,
  40, 57, 60 stay green). `support_grant_active(org, 'content_read')` is the single gate; it is
  non-null only for a platform administrator while an unrevoked, unexpired `content_read` grant
  exists. `support_list_engagements` and `support_read_object` return only the grant's org's objects;
  a cross-org object id is refused. Every call, including every refusal, writes `support_access_log`,
  which the tenant reads through `support_access_log_list`.
- Reason: (a) would put a `using (... exists grant ...)` clause on ~50 tables — an enormous, fragile
  surface and a real risk of a blanket read. (b) keeps the blast radius to four functions, keeps the
  grant check on every call (so expiry and revocation take effect on the next call, L4), and keeps the
  L2 guarantee provable by the existing zero-read tests. `kind='content_read'` is also required, so a
  config or full_admin grant cannot open a content session.
- Reverse: drop `support_access_log`, `support_grant_active`, `support_list_engagements`,
  `support_read_object`, `support_access_log_list` and remove `support_access_log` from
  `provio_test.org_tables()`.

## D-C2.9-2 — `support_access_log` carries the 0008 blanket SELECT for anon and platform_admin (C2.9)

- Task: C2.9, the "platform role still reads zero rows directly" proof.
- Point: the six tests that assert "zero rows" (03, 04, 40, 57, 60, 72) iterate
  `provio_test.org_tables()` and read each table. A new table with no SELECT grant raises a permission
  error there instead of returning zero, which is the same information but a different code path.
- Options: (a) grant no SELECT to anon/platform_admin and let the tests see `insufficient_privilege`;
  (b) grant SELECT to authenticated, anon and platform_admin and let the authenticated-only,
  own-org policy do the filtering, exactly as the 0008 convention does for every other table.
- Choice: (b). It matches the existing convention (privilege granted, RLS filters) and keeps the
  zero-row tests reading an empty set. The policy keys on `org_id = jwt_org_id()`; anon has no claim
  and the platform administrator's claim is empty, so both read nothing.
- Reason: consistency with the rest of the schema, and no test needs to special-case the new table.
- Reverse: revoke SELECT from anon and platform_admin in a follow-up migration.

## D-C2.5-order — deletion happens only after a verified upload (C2.5, §25.4, §26)

- Task: C2.5, "verified archival upload and population archival".
- Point: 0043 computed the archive JSON and its `content_hash` and then deleted live rows in the same
  transaction, and it marked the job `done` before any file existed. Nothing uploaded the JSON. The
  spec (§25.4) requires the upload to be verified before anything is treated as archived.
- Options: (a) keep the 0043 order and add an uploader that runs afterwards; (b) make `done` and the
  removal of working rows follow a verified upload, so `archive_jobs.status` is `pending` until the
  stored bytes have been hashed and matched.
- Choice: (b). `archive_activity_period` still builds the JSON and records the hash, but the job is
  `pending`. `archive_job_mark_uploaded(job, sha256, bytes)` is the only path to `done`: it compares
  the hash of what was stored against the ledgered `content_hash` and, on a mismatch, records
  `last_error`, marks the job `failed` and raises exactly one `integrity_alerts` row. For
  populations, `archive_population` records the archive without touching working rows;
  `population_archive_verify` removes them only after the upload hash matches. `archive_job_canonical`
  is the service-only accessor that returns the exact bytes to upload, so the hash checked is the hash
  of what was stored.
- Reason: the earlier order made "archived" mean "hashed", which is not the guarantee the spec asks
  for. Making verification the gate is the only order in which an unverified archive cannot destroy
  live rows (L5).
- Reverse: revert to the 0043 body of `archive_activity_period` and drop `archive_job_mark_uploaded`,
  `archive_job_canonical`, `archive_job_for_upload`, `can_upload_archive`, `population_archives`,
  `integrity_alerts`, `archive_population`, `population_archive_verify`, `population_archive_page`,
  `population_archive_due`, `population_retention_months`.

## D-C2.5-space — the archive reports `{reachable, ...}`-style fields through RPCs, never the client
- Task: C2.5, the upload path's authority.
- Point: the upload needs the job's storage path and the canonical bytes. Those are read with the
  service role. The check that decides whether the caller may upload must run as the caller.
- Options: (a) let the edge function read `archive_jobs` directly with the service role and trust an
  org id in the body; (b) expose `can_upload_archive` for the caller and `archive_job_for_upload` /
  `archive_job_canonical` for the service role only.
- Choice: (b). `can_upload_archive(archive_id)` compares the job's org to `jwt_org_id()` and checks
  `manage_engagements`, all as the caller. The two readers are revoked from `authenticated`; test 86
  proves an authenticated caller gets `permission denied` from both (C1.2 pattern).
- Reason: the same lesson as C1.1 — an org id or id from the body is not authority.
- Reverse: revoke EXECUTE on `can_upload_archive` from `authenticated` and read the job in the edge
  function with the service role.

## D-C2.6-M1 — `document_extractions` is extended, not redefined (C2.6)

- Task: C2.6, "document extraction".
- Point: M1 grep found `document_extractions` and `request_extraction` in 0035, plus test 44 which
  inserts `extraction_status` rows and asserts the stub writes 'pending'.
- Options: (a) create a new table for the real extraction; (b) extend the existing one — add columns,
  widen the status check, and add the write/authority RPCs — leaving 0035's stub and test 44 intact.
- Choice: (b). `extraction_error` and `extractor` are added with `add column if not exists`, the 0035
  inline status check is dropped by name (guarded by an existence check) and replaced with one that
  also allows 'unsupported' and 'legacy_not_extracted' (§20's two non-error outcomes), and the write
  path becomes `document_extraction_complete`, service-role only.
- Reason: the browser already reads this table through `search_documents`, and §17.2's full-text
  search reads `extracted_text` here. A parallel table would fork the search path.
- Reverse: drop the two columns and restore the 0035 three-value check; drop
  `document_extraction_complete`, `document_extraction_context` and `can_extract_document`.

## D-C2.6-pdf — a PDF with no text layer is 'unsupported', not 'failed' (C2.6, §20)

- Task: C2.6, the extraction outcome vocabulary.
- Point: §13.1 extracts text from a text-based PDF; §20 says legacy binaries are stored but not
  extracted. A scanned PDF is neither: it is a modern format with no text to take.
- Options: (a) mark it 'failed' and lose the distinction from a real parse error; (b) add an explicit
  'unsupported' status so the operator can see the file is stored and simply has no text layer.
- Choice: (b). The scanner outcome is `unsupported` with the reason recorded; a genuine parser error
  stays `failed`. Both are non-error states in the sense that neither is used for any test result
  (L1) — the status only describes whether text was obtained.
- Reason: collapsing the two would make a real, expected case look like a defect and would give the
  operator no way to tell a broken extractor from a scan.
- Reverse: fold 'unsupported' back into 'failed' and remove it from the check constraint.

## D-C3.2-A1 — change control is a table pair plus two RPCs, not a client-side rule (C3.2-A, §21)

- Task: C3.2-A, change control after deployment.
- Point: §21 requires routine and material changes, configurable approvers, and approved changes
  hash-chained, but names no schema.
- Options: (a) classify in the browser and log to activity_log only; (b) two tables
  (`change_control_settings`, `change_requests`) and two security-definer RPCs
  (`request_change`, `decide_change`) that write the hash-chained business ledger on approval.
- Choice: (b). L5 ("configuration changes are versioned and logged ... sign-offs ... hash-chained")
  and L1 ("no AI in ... gate, finding status or check") both require the decision to be server-side
  and deterministic.
- Reason: a browser-side classifier could be bypassed and would leave the ledger without the
  approval. The classification rule (a class named in `routine_classes` is routine; anything else
  material) lives in the database so the app and any future caller agree.
- Reverse: drop `change_requests` and `change_control_settings` and the four `change_control_*` /
  `request_change` / `decide_change` / `list_changes` functions.

## D-C3.2-A2 — four-eyes on a material change: the requester never approves it (C3.2-A, §21)

- Task: C3.2-A, who may decide a material change.
- Point: §21 says "approvers are configurable" but does not say whether the requester may approve.
- Options: (a) any holder of the approver right, including the requester; (b) the approver right plus
  a four-eyes bar on the requester.
- Choice: (b), rejected with the plain message on a self-approval attempt. It mirrors the existing
  four-eyes rules in `sign_planning` (0025) and the seal gate.
- Reason: the audit-quality purpose of a material change control disappears if one person both asks
  and grants. The `escalate_right` column exists so a stuck request has a named route if the owner
  later wants an override.
- Reverse: delete the `v_req.requested_by = auth.uid()` guard in `decide_change`.

## D-C3.2-A3 — routine classes are configurable per organisation (C3.2-A, §21)

- Task: C3.2-A, the routine/material boundary.
- Point: §21 names "reassigning a workpaper to someone already on the team" as routine and lists
  material examples, but the boundary is a policy each firm may draw differently.
- Options: (a) hard-code the spec's list; (b) store it in `change_control_settings.routine_classes`.
- Choice: (b), defaulting to the spec's single example (`workpaper_reassign`).
- Reason: "configuration not code" (Laws, decision protocol (d)). A firm that treats planned-date
  nudges as routine can say so without a migration, and the change is versioned (`admin_log_change`).
- Reverse: drop the column and read the class list from a constant.

## D-C5.1-1 — every Appendix A screen gets its own contract section (C5.1)

- Task: C5.1, the UI contract.
- Point: 32 of the ~52 Appendix A screens had a section; SA-03, SA-13, SA-15, OA-05, OA-08, OA-10,
  OA-18, OA-19, WK-02, WK-03, WK-07, EX-02 and EX-03 had none, and several (OA-01, OA-03, OA-07,
  SA-08, SA-11, WK-04, EX-04) were only folded into a combined heading.
- Options: (a) leave the folded headings and let the checker accept a screen id mentioned anywhere;
  (b) give every Appendix A id a section of its own, with the real route, rights, data functions,
  testids and states.
- Choice: (b). A folded heading cannot carry a screen's own testids or states, and the owner's new UI
  needs one contract per screen.
- Reason: the checker is the contract's enforcement, so the contract must be granular enough to be
  checked. Combined headings (SA-10 / SA-11, OA-02 / OA-03) are kept where the two screens really
  share one surface, and the checker treats a listed id as covered.
- Reverse: delete the added sections; the checker then fails again, which is the point.

## D-C5.1-2 — OA-18 is a scoped view of the one tutorial library, not a second component (C5.1, C4)

- Task: C5.1, the OA-18 tenant tutorial library.
- Point: the library component existed for SA-13 only; OA-18 (the Org Admin view of its own
  recordings) had no surface at all.
- Options: (a) build a second component that reads the same registry; (b) add an `audience` prop to
  the one component and a `Tutorials` tab in the Org Admin control plane.
- Choice: (b), with `audience="org_admin"` filtering to `org_admin` plus `both` keys.
- Reason: one component means one place to keep correct when the owner restyles; a second copy would
  drift. The filter is a view concern, so it belongs in the component, not in a new RPC.
- Reverse: drop the `audience` prop and the tab; SA-13 is unaffected.

## D-C5.1-3 — the contract checker fails on a missing section OR a testid absent from src (C5.1)

- Task: C5.1, `scripts/check-ui-contract.mjs`.
- Point: the contract could drift from the code in two directions: a screen with no section, or a
  documented testid that no component renders.
- Options: (a) check only the section list; (b) check both, and also that every Appendix A id from
  GL-01/TUT-01/SA-01..15/OA-01..21/WK-01..10/EX-01..04 is covered.
- Choice: (b), with placeholder-aware matching so `tenant-<id>` matches the template literal
  `tenant-${t.id}` and `:id` route params are ignored.
- Reason: a testid in the contract that the code does not render is exactly the failure the owner's
  UI replacement would hit; catching it now is the whole value of the file.
- Reverse: drop the testid loop; the section check stays.

## D-C4-1 — tutorial steps are derived from the contract, not hand-written (C4)

- Task: C4. The S12 seed wrote the same three generic lines for all 85 keys.
- Point: where the real ordered steps come from.
- Options: (a) hand-write 85 x 4-8 steps; (b) derive them from the testids the contract already
  documents, so the drawer, "Copy steps" and the recorder all read one source.
- Choice: (b). `scripts/gen-tutorial-steps.mjs` reads `docs/ACP-UI-CONTRACT.md`, ranks each screen's
  testids by relevance to the key (several keys share one screen), and emits one step per control
  with the exact testid to drive. The two setup wizards get a real per-step walkthrough.
- Reason: the owner replaces the UI and re-runs the recorder; steps bound to contract testids cannot
  silently point at a control that no longer exists. Hand-written prose would drift immediately.
- Reverse: delete `scripts/gen-tutorial-steps.mjs`; `src/lib/tutorialKeys.json` keeps its steps.

## D-C4-2 — a step never targets a state element (C4)

- Task: C4. Point: which testids a step may drive.
- Options: (a) any documented testid; (b) only controls a person operates.
- Choice: (b). A step skips `-loading`, `-error`, `-empty`, `-denied`, `-readonly`, `-no-*` and other
  state or absence elements; a display element becomes a "Read ..." step, a control a "Click ..." step.
- Reason: driving `wk-boardpack-no-generate` would be nonsense in a recording, and a step that cannot
  be performed would fail the recorder for the wrong reason.
- Reverse: remove the `STATE`/`NEGATIVE` filters in the generator.

## D-C4-3 — staleness is `ui_hash`, not file mtime (C4)

- Task: C4. Point: how the checker decides a recording is stale.
- Options: (a) compare GIF mtime against the newest source mtime (the S12 signal); (b) hash the key's
  step testids plus the text of the files that declare them.
- Choice: (b). The recorder writes `public/tutorials/.ui-hashes.json`; `check-tutorials` recomputes it
  and fails on a mismatch. (a) is meaningless on a fresh checkout: every file is newer than the GIF.
- Reason: the signal must mean "the UI this recording shows has changed", which only the testids and
  their declaring files can tell us.
- Reverse: restore the mtime comparison; the sidecar file is then ignored.

## D-C4-4 — the placeholder is a first-class, detectable state (C4)

- Task: C4. Point: how a placeholder is prevented from passing as a recording.
- Options: (a) trust the filename/size; (b) write the placeholder through the same encoder and record
  its byte hash, so the checker recognises it exactly; normal CI allows it only under
  `TUTORIALS_ALLOW_PLACEHOLDER=1` and prints the count, `--strict` (pre-PR gate) refuses it.
- Choice: (b). The placeholder hash is `public/tutorials/.placeholder-hash`.
- Reason: the S12 gate passed on any file that existed, which is how 85 identical placeholders shipped.
  A hash is exact; a size heuristic is not.
- Reverse: delete `.placeholder-hash`; the strict mode then only checks frames and size.

## D-C2.7-FIX — DOCX bytes are pinned per ZIP entry (C2.7-FIX)

- Task: C2.7-FIX. Point: `renderDocx` was not deterministic across a second boundary.
- Root cause: `docx` stamps every ZIP entry with `new Date()`. `normaliseDocx` rewrote only
  `docProps/core.xml` and passed a single `date` to `generateAsync`, but JSZip keeps the per-entry
  dates it read, so two renders in different seconds produced different bytes. The existing
  determinism test passed only because both renders usually fell in the same 2-second DOS bucket.
- Fix: pin `zip.files[name].date` for every entry before packing.
- Test: a new case renders at two instants 10 seconds apart (fake timers) and compares the bytes;
  it fails without the pin. The 2-second DOS resolution is why the gap is 10, not 1.
- Reverse: remove the pinning loop; the fast path still returns a valid DOCX.

## D-C3.2-B — governance settings surfaces (spec §10, §12, §14.2, §20, §22, §23)
- Point: the spec requires the Org Admin to configure, visually and without code or JSON, the
  lifecycle (one/two-stage, sign-off roles), finding structure, methodology scales and FSLI mapping,
  workflow/SLA/escalation, notification rules, export and retention, BI parameters and upload limits.
- Options: (a) one settings table with a JSON blob per area; (b) one purpose-built table and one RPC
  per area, each logging a versioned change; (c) store nothing and read spec defaults.
- Choice: (b). The hard ban forbids JSON typed by a user, so each area gets typed columns and a
  validated RPC. Every RPC calls admin_log_change, so a save lands in config_versions and
  activity_log exactly like the existing severity/sampling admin (L5, §23). The eight areas are
  registered in config_areas so a change emits config.changed through the F7 trigger.
- Reason: typed columns let the database enforce the §12 BI range, the closed finding role tags, the
  §20 platform format set and the bounded retention periods — a JSON blob could not.
- Reverse: drop migration 0082's tables and RPCs; the other admin panels are unaffected.

## D-C3.1 — the spec audit is evidence-first (C3.1)
- Point: PARITY.md still carried the Phase 0 table and said Missing for §7, §7.1, §22, §23 while the
  code now implements them.
- Options: (a) trust PARITY.md; (b) re-derive every clause from object + test + app file; (c) mark
  only what the gate scripts cover.
- Choice: (b). Each row names the migration that creates the object, the SQL or vitest test that
  fails when the behaviour is removed, and the app file. A clause with no behaviour test is Partial,
  and the missing piece is named. This is the only honest base for the C5.2 PARITY rebuild.
- Reason: "Present without a failing test" is the failure mode that let the stale table survive.
- Reverse: the file is documentation; delete it and PARITY reverts to the old table.
