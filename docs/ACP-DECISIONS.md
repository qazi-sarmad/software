# ACP decisions

Numbered, one entry per decision. Each entry records: task, point, options, choice, reason, and how
to reverse it. Classes are FIXED (implemented as written), NEVER IMPROVISE (not decided here), and
IMPROVISE-THEN-DOCUMENT (this file).

## D-S0-xlsx — vendor the xlsx tarball (S0.1)

- Task: S0.1.
- Point: F22 requires replacing the vendor CDN dependency `xlsx` with a vendored tarball.
- Options: (a) leave the CDN URL; (b) vendor the tarball at `vendor/xlsx-0.20.3.tgz` as
  `file:vendor/xlsx-0.20.3.tgz`.
- Choice: (b). Downloaded the tarball, verified its sha512 against the integrity pinned in
  `package-lock.json` (`sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==`)
  — exact match — then repointed `package.json` and reinstalled. `npm install` reports 0
  vulnerabilities and the lock records the same integrity.
- Reason: no CDN at build time; the hash is verifiable and unchanged, so the library is identical.
- Reverse: restore the CDN URL in `package.json`, delete `vendor/`, `npm install`.

## D-S0-scandirs — where new directories sit relative to the gates (S0.2)

- Task: S0.2.
- Point: `supabase/functions/` (Deno) and `tools/` (Node) must not enter the Vite bundle or root
  `tsc`, and must not trip check-tokens/check-shrink.
- Choice: root `tsconfig.json` excludes `supabase`, `tools`, `e2e` (it already excluded `docs`).
  `vitest.config.ts` excludes `tools/**`; it already excludes `e2e`. `check-tokens.mjs` scans only
  `src/components`; `check-shrink.mjs` reads only files listed in `docs/baseline-lines.json` — so
  neither new directory is scanned unless explicitly added. Vite only bundles what `index.html`
  reaches, so neither directory can enter the bundle.
- Reason: smallest change that keeps the two new trees out of every gate. Edge Functions and the
  migration runner are deployed and run outside the SPA.
- Reverse: remove the excludes from `tsconfig.json`/`vitest.config.ts`.

## D-S0-json — the no-JSON-editing guard and the three existing JSON.stringify call sites (S0.3)

- Task: S0.3.
- Point: F1's guard test fails if any non-test file under `src/components` parses user-typed text as
  JSON or renders serialised JSON into an editable field.
- Finding: three call sites existed. Two rendered a JSON blob as text
  (`AnalystEnginePanel.tsx` check params, `ReportEditorPanel.tsx` block content) — a JSON view in
  disguise, and one that a later editor screen could have made editable. The third
  (`CapRadialTracker.tsx`) used `JSON.stringify` as a memoisation key, not as display.
- Choice: banned both `JSON.parse(` and `JSON.stringify(` in components, with an empty allow-list.
  Replaced the two display sites with `formatFieldPairs` (renders `key: value` pairs, never JSON);
  replaced the memoisation key with `stableKey` (a deterministic, order-independent key). Both live
  in the new pure module `src/lib/readable.ts` with unit tests.
- Reason: the guard is strongest with no exceptions, and the replacements make the screens more
  readable rather than less. No test was weakened.
- Reverse: allow-list the two files in the guard and restore the `JSON.stringify` calls.

## D-S1-consult-kind — `support_access_grants.kind` and the two tiers (S1.2, F4)

- Task: S1.2.
- Point: F4 extends `support_access_grants` with `kind text in (content_read, config, full_admin)`,
  default `content_read`.
- Options: (a) a new consultation-grant table; (b) `alter table support_access_grants add column if
  not exists kind ... default 'content_read'` plus a check constraint added only when absent.
- Choice: (b). M1 grep found the table in `0031_platform_control_plane.sql` with no `kind` column,
  so it is extended rather than duplicated. The check constraint is added inside a
  `pg_constraint` existence test, so a second apply is a no-op (M2).
- Reason: the existing 48 h content-read grant keeps its exact behaviour (the default value), and
  the two consultation tiers become the same object with a different `kind`. One table, one story.
- Reverse: `alter table support_access_grants drop column kind;` and drop `sag_kind_check`.

## D-S1-write-mode — one `config_write_mode` decides apply / propose / deny (S1.2, F4)

- Task: S1.2.
- Point: F4 requires `config_actor_ok(p_org, p_right)` to be true for a tenant member holding the
  right OR a platform admin with an active session of sufficient kind; and tier-2 changes to be
  proposals only.
- Options: (a) two separate helpers (`config_actor_ok` and a proposal check); (b) one function that
  returns the mode `apply | propose | deny`, with `config_actor_ok` defined as `mode <> 'deny'`.
- Choice: (b). A platform admin has no `org_id` claim, so `config_write_mode` matches the right
  against the session kind: tier 1 gives `apply` for `edit_config`; tier 2 gives `apply` for
  `edit_config` and `propose` for `manage_users` / `manage_roles`. Everything else is `deny`.
- Reason: the rule "tier 2 is only proposed" lives in one place instead of being re-checked by every
  RPC. A platform admin with no session, an expired session, or a session for another org is denied
  by the same branch.
- Reverse: split into two helpers and give each RPC its own tier-2 branch.

## D-S1-history-read — one read over the registered history tables (S1.4, OA-17)

- Task: S1.4 (OA-17 "history shows consultant actions").
- Point: the Org Admin must see the organisation's configuration history in one story, including the
  changes a QSCorp consultant made during a Dual Session (L5, F4).
- Options: (a) a screen per history table; (b) one read function that unions the registered tables
  and flags the platform actor; (c) reuse `config_versions`.
- Choice: (b), `config_history_list(p_limit)` in `0053_config_history.sql`. It unions
  `role_config_log`, `ai_model_versions`, `tenant_entitlement_versions` and `config_versions`, joins
  `config_areas` for the human label, and sets `actor_is_platform` when the actor is in
  `platform_admins`. A tenant member needs `edit_config`; a platform admin sees it only while an
  active consultation session exists (never otherwise). The limit is bounded 1..500.
- Reason: (a) contradicts "configuration history stays ONE story". (c) cannot see role or
  entitlement changes, which are the changes a consultant is most likely to make. The flag is what
  makes a consultant's change visible to the client, which is the point of the tier-2 model.
- Reverse: drop the function; the underlying tables are unchanged and still append-only.

## D-S1-e2e-contexts — one browser context per Dual Session party (S1.c)

- Task: S1.c.
- Point: the Dual Session E2E must show the platform side and the Org Admin side at the same time.
- Options: (a) two sign-ins on one page; (b) a second `browser.newContext()` for the Org Admin.
- Choice: (b). The Supabase session lives in `localStorage` per origin, so a second sign-in on the
  same page replaces the first and the platform session is lost. Each party gets its own context.
- Reason: the spec has to observe both sides live, and the sign-in state is per browser context, not
  per test. This is also how a real dual session looks (two machines).
- Reverse: sign in once and assert only the tenant side.

## D-S1-e2e-serial — the ACP spec runs serially (S1.c)

- Task: S1.c.
- Point: `playwright.config.ts` sets `fullyParallel: true`, and the ACP tests share one tenant's
  consultation session and one feature entitlement.
- Options: (a) give each test its own tenant; (b) `test.describe.configure({ mode: 'serial' })`.
- Choice: (b). The suite has exactly two synthetic tenants and the residue cleanup in
  `global-setup.ts` is per run, not per test, so a parallel entitlement toggle and a parallel
  session would race on the same rows.
- Reason: smallest change that removes the race without inventing fixtures. The tests are fast.
- Reverse: remove the serial directive once each test has its own tenant.

## D-S1-step-status — `StepStatus` gains `pending` and a separate `StepState` (S1.b)

- Task: S1.b.
- Point: `src/data/setup.ts` declared `StepStatus = 'not_started' | 'in_progress' | 'done' |
  'skipped'`, but `setup_save_step` accepts exactly `pending | done | skipped`, and a step with no
  row reads as `not_started` (a value that is never written).
- Options: (a) widen the database check to accept `not_started`/`in_progress`; (b) keep the database
  vocabulary and split the read-only state out in TypeScript.
- Choice: (b). `StepStatus` is now `pending | done | skipped` (what the database accepts) and
  `StepState` is `StepStatus | 'not_started'` (what a step reads as before it is saved).
- Reason: the database is the source of truth for what may be written, and `not_started` is a
  derived read value, not a stored one. Changing the database to accept a value the UI only ever
  displays would have widened the write surface for no gain.
- Reverse: merge the two types and widen the `setup_save_step` check constraint.

## D-S2-vault-fallback — Vault is used when present, a local secret table always (S2.a)

- Task: S2.a (F5).
- Point: F5 says secrets go to Supabase Vault (`vault.create_secret`), and S2.1 verifies Vault on
  `provio-test`. Vault is not installed on a plain Postgres, and the migration must apply twice to
  both.
- Options: (a) call `vault.create_secret` unconditionally and let the migration fail where Vault is
  absent; (b) branch at run time on the presence of the `vault` schema.
- Choice: (b). `secret_put` writes a row in `secret_store` and calls `vault.create_secret` only when
  the schema exists; `vault_available()` reports which store is in use so the wizard can say so.
- Reason: the migration must be safe on the hosted project and on a plain Postgres (M2, M6), and the
  laws do not change either way: the value is written by a SECURITY DEFINER function, is read only
  through a service-role-only wrapper, and only its id and a masked display ever reach a table or a
  screen.
- Reverse: delete the run-time branch and require Vault, once every target has it.

## D-S2-notifications-policy — the notifications read policy stays tenant-only (S2.a)

- Task: S2.a (F7, test 57 and test 60).
- Point: the platform recipients (SA-05) receive platform alerts, and it would be convenient for the
  platform console to read the notification rows it caused.
- Options: (a) add `or public.is_platform_admin()` to the `notifications` select policy; (b) keep the
  policy tenant-only and deliver platform alerts by email.
- Choice: (b). Caught by the local harness before CI: test 57 and test 60 both assert that the
  platform admin reads no rows from `notifications`, and (a) broke both.
- Reason: the platform principal is data-blind (Product Law, F4 "neither tier grants audit content").
  An in-app row for a platform recipient would also have no org to sit in.
- Reverse: none. Delivering platform alerts by email is the designed behaviour.

## D-S2-digest-schema — `extensions.digest`, not `digest` (S2.a)

- Task: S2.a (F5, F6, F7).
- Point: `pgcrypto` is installed into the `extensions` schema (migration 0001), and the ledger
  functions call `extensions.digest(...)`. The first drafts of 0055/0056 called `digest(...)`.
- Options: (a) add `extensions` to the `search_path` of each function; (b) qualify every call.
- Choice: (b), matching 0006 and 0027.
- Reason: a `search_path` that includes `extensions` widens what an unqualified name can resolve to
  inside a SECURITY DEFINER function; the existing code qualifies, so this does too.
- Reverse: none needed; the qualified form is the house style.

## D-S2-uuid-cast — `coalesce(p_org::text, '')` (S2.a)

- Task: S2.a.
- Point: the hash-chain writer built its input with `coalesce(p_org, '')::text` for a nullable uuid,
  which Postgres resolves as `coalesce(uuid, uuid)` and then fails to parse `''` as a uuid.
- Options: (a) `coalesce(p_org::text, '')`; (b) `coalesce(p_org, null)::text`.
- Choice: (a).
- Reason: it makes the cast happen before the coalesce, so the empty string is a text default. Caught
  by test 66 on the platform-scope path (a null org id).
- Reverse: none.

## D-S2-seed-cleanup — the test seed clears the S2 tables (S2.a, M5)

- Task: S2.a.
- Point: `provio_test.seed()` truncates `orgs cascade`, but `secret_store`,
  `email_sender_profiles`, the version tables, `notification_preferences` and the webhook outbox
  have no foreign key to `orgs`, so a second run of test 66 saw the first run's rows (a secret
  counted twice, a tenant sender resolving when it should not).
- Options: (a) give every S2 table an org foreign key; (b) truncate them in `seed()`.
- Choice: (b). Platform rows (rules and templates with `org_id is null`) are kept; only tenant rows
  and per-run logs are cleared.
- Reason: M5 requires a test to leave no residue, and a foreign key on a platform-level table would
  be wrong anyway (F2: platform tables are marked).
- Reverse: none.

## D-S2-platform-recipients-action — platform recipients are an explicit action target (S2.a)

- Task: S2.a (F7).
- Point: the seeded `platform.config.changed` and `platform.ai_model.changed` rules must reach the
  SA-05 list. The first draft passed `to_addresses: []`, which resolves to nobody.
- Options: (a) resolve an empty address list to the platform recipients; (b) add an explicit
  `to_platform_recipients: true` flag to the action.
- Choice: (b).
- Reason: (a) would silently change the meaning of every rule that has no fixed addresses and would
  make a tenant rule with no recipients suddenly mail QSCorp. An explicit flag keeps the rule data
  readable and keeps the platform list opt-in.
- Reverse: change the seeded rule actions back to fixed addresses once SA-05 is mandatory.

## D-S2c-empty-uuid — an empty organisation id becomes null before the RPC (S2.c-FIX)

- Task: S2.c-FIX.
- Point: the Super Admin screens called the list RPCs with `p_org: ''` while no tenant was chosen.
  `p_org` is a `uuid`, so Postgres raised `invalid input syntax for type uuid: ""`; the screen caught
  the error and showed the error state, so the e2e test could not find `superadmin-email`. CI run
  39260101456 failed on exactly this (Playwright, 1 failed / 70 passed).
- Options: (a) make each screen skip the call while no tenant is chosen; (b) normalise the empty
  string to null in the data module, so the RPC's own `p_org is null` branch returns the platform
  rows.
- Choice: (b). `listSenderProfiles`, `listRules`, `listTemplates` and `saveRule` now send
  `orgId || null`, and their parameter type is `string | null`.
- Reason: the RPCs are already written to treat a null org as "platform scope" (`where org_id =
  p_org or org_id is null`), so null is the meaning the screen intends; (a) would have made each
  screen duplicate a rule the database already states, and would have left the same trap for the
  next caller.
- Reverse: revert the four signatures and have each screen pass a real tenant id before loading.

## D-S3-invites-table — `auth_invites` is a new table, not an extension (S3.a, M1)

- Task: S3.a (F6, F13, D20).
- Point: M1 requires a grep before naming. `invite_cap_events` (0015) already records an
  invitation, but it records an *event* (who invited whom, for the cap), with no token, expiry,
  single-use flag or acceptance state. The defect D20 is precisely that no acceptance path existed.
- Options: (a) add token/expiry/acceptance columns to `invite_cap_events`; (b) a new `auth_invites`
  table with `invite_cap_events.invite_id` pointing at it.
- Choice: (b). Grep found no `auth_invites` anywhere in `supabase/migrations` or `supabase/tests`.
  `invite_cap_events` keeps its meaning (the cap ledger) and gains one nullable `invite_id`.
- Reason: a cap event and a live invitation have different lifetimes: a cap event is permanent
  history, an invitation is single-use and expires. Splitting them keeps the cap query unchanged and
  keeps the token out of the cap ledger.
- Reverse: fold the columns back into `invite_cap_events` and drop `auth_invites`.

## D-S3-token-hash — only a sha256 hash of the token is stored (S3.a, F5)

- Task: S3.a (F5).
- Point: the acceptance link carries a bearer token; the database must be able to look it up, but a
  leaked table dump must not yield working tokens.
- Options: (a) store the token in the clear; (b) store `sha256(token)` and compare by hash.
- Choice: (b), using `extensions.digest(token, 'sha256')` exactly as the ledger does.
- Reason: F5 forbids a secret reaching a table, a log or a screenshot; the token is a credential.
  The plaintext exists only in the queued email body, which the dispatcher deletes on success. A hash
  is enough to look the invitation up because the token is 24 random bytes.
- Reverse: none. Storing the clear token would break F5.

## D-S3-accept-grant — `admin_accept_invite` is service_role-only, not right-checked in the body (S3.a, F4)

- Task: S3.a.
- Point: the acceptance path runs for a user who is not yet a member and holds no rights, so a
  `caller_has_right` check is impossible. The caller is the invite-user Edge Function after it has
  verified the invitee's JWT.
- Options: (a) check `current_user` inside the function; (b) make the grant the boundary, as
  `secret_reveal` (0054) does.
- Choice: (b). The function is revoked from `public`, `anon` and `authenticated` and granted only to
  `service_role`.
- Reason: a `SECURITY DEFINER` function runs as the owner, so `current_user` inside the body is the
  owner and never `service_role`; a body check would be wrong. The grant is the only place the
  distinction survives, and test 67 asserts an Org Admin gets `permission denied`.
- Reverse: none.

## D-S3-copy-honesty — the invitation says "queued", never "sent" (S3.a, S3.c)

- Task: S3.a, S3.c (D20 defect).
- Point: the old copy claimed an invitation "has been sent", which is false while the row is still
  `pending` in `email_queue` and while no account exists.
- Options: (a) keep "sent" and accept the inaccuracy; (b) say "queued" and read the real status.
- Choice: (b). The email body says "You have been invited to join Provio" and describes what the
  link does; the Org Admin screen says "Invitation queued for <email>"; the queue row keeps
  `status = 'pending'` until the dispatcher accepts it.
- Reason: F6 says the UI never says "delivered" for accepted mail; the same honesty applies one step
  earlier, and D20 is exactly this defect. `invite_status` returns the queue's own status so the
  screen never guesses.
- Reverse: none.

## D-S3-out-params — `admin_accept_invite` returns `out_*` names (S3.a)

- Task: S3.a.
- Point: a `returns table (org_id uuid, ...)` shadows the `org_id` column of every table the body
  touches, so `insert into org_members (org_id, ...) ... on conflict (org_id, user_id)` failed with
  `column reference "org_id" is ambiguous` (PL/pgSQL variable vs column).
- Options: (a) qualify every column reference in the body; (b) name the OUT parameters `out_*`.
- Choice: (b), matching how other RPCs in this build avoid the clash.
- Reason: a smaller change than qualifying a dozen references, and the returned names are for the
  Edge Function, which reads them positionally.
- Reverse: rename the OUT parameters and qualify the body instead.

## D-S3-invites-rls — `auth_invites` has a select policy and no write policy (S3.a, M2)

- Task: S3.a.
- Point: `auth_invites` holds an org's pending invitations; an Org Admin should see them, and a
  second org must see none.
- Options: (a) `using (org_id = jwt_org_id())`; (b) `using (org_id = jwt_org_id() or is_platform_admin())`.
- Choice: (b), and no insert/update/delete policy at all.
- Reason: the platform principal administers invitations (SA-03 tenant hub) but is otherwise
  data-blind; rows enter only through `invite_user_capped` and change only through
  `admin_accept_invite`, both SECURITY DEFINER, so a write policy would be dead weight and would
  widen the surface. Test 13 (RLS enabled on every table) stays green.
- Reverse: none.

## D-S3-migration-order — 0048 drops both `invite_user_capped` signatures (S3.a, M4)

- Task: S3.a.
- Point: 0057 redefines `invite_user_capped(text, text)` from `returns void` (0048) to
  `returns uuid`. On a repeated apply, CI step 6 replays 0048 first: `create or replace` then fails
  with "cannot change return type of existing function".
- Options: (a) drop the uuid form inside 0057 only; (b) drop both signatures at the top of 0048 as
  well.
- Choice: (b). 0048 now drops `invite_user_capped(text, text)` and `invite_user_capped(text)` before
  recreating the void form; 0057 drops both before creating the uuid form.
- Reason: M2/M4 require every file to be safe to re-apply in order on the persistent project. The
  drop must live in the earlier file because that is the file that runs first.
- Reverse: none.

## D-S3-test-schema-grant — the SQL test schema grants usage to `service_role` (S3.a)

- Task: S3.a.
- Point: test 67 runs `admin_accept_invite` (service_role-only) and reads `auth_invites`. The
  `provio_test` helper schema granted `usage`/`execute` only to `anon` and `authenticated`, so a
  `service_role` session could not call the test helpers at all.
- Options: (a) run the acceptance section as the owner and assert the grant separately; (b) add
  `service_role` to the two grants in `00_lib.sql`.
- Choice: (b) for the helper schema, and (a) for the acceptance call itself: the section runs as the
  database owner, and section 2 asserts that an Org Admin is refused with `permission denied`, which
  is the property the grant exists to produce.
- Reason: `provio_test` is test-only scaffolding, so granting it to `service_role` widens nothing in
  the product. Asserting the refusal for a real role is a stronger check of the boundary than
  invoking the function as the role that is allowed to.
- Reverse: remove `service_role` from the two grants and run the acceptance section through a
  `set role service_role` wrapper.

