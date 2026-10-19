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


## D-S4-assets-storage — where branding assets live when Storage is absent (S4.a, F9)

- Task: S4.a.
- Point: F9 puts logo and font files in a private Storage bucket `org-branding`; if Storage is not
  configured on provio-test, small assets (<= 512 KB) go in a table as bytea.
- Options: (a) always use Storage and fail when it is missing; (b) a `branding_assets` table with a
  `bytea` column and a 512 KB check, used when Storage is not configured; (c) store a URL only.
- Choice: (b). `branding_assets` holds the bytes as `bytea` with a 524288-byte check constraint and
  a `storage_path` column that is null today and is filled when a bucket is configured. The upload
  RPC refuses a file over the limit with a plain message.
- Reason: the feature must work on provio-test with no Storage; a table keeps every asset inside the
  tenant boundary and keeps the feature configurable without code. Moving to Storage later is a
  data copy, not a schema change.
- Reverse: point `branding_assets.storage_path` at a bucket and drop the `bytea` column.

## D-S4-pptx-theme — extract the theme, not the layouts (S4.b, F9)

- Task: S4.b.
- Point: the owner may upload an organisation's .pptx or .potx; v1 extracts its theme (colours,
  fonts, slide size, logo images) with JSZip and XML parsing and applies it to pptxgenjs masters.
- Options: (a) reuse the file's slide layouts; (b) extract colours, fonts, slide size and media
  parts and apply them to Provio's own masters.
- Choice: (b). `extractPptxTheme` reads `ppt/theme/theme1.xml` (clrScheme, fontScheme) and
  `ppt/presentation.xml` (sldSz) plus `ppt/media/*`; `renderPptx` builds its own slides. The UI says
  "We match your colours, fonts and logos; we do not reuse your slide layouts."
- Reason: the fixed rule says v1 extracts and does not reuse layouts, and it keeps every Provio
  slide a native editable text/table/chart, which the owner can edit.
- Reverse: add a layout-cloning path from the uploaded archive.

## D-S4-fonts — bundled fonts vs an uploaded licensed font (S4.b, F9)

- Task: S4.b.
- Point: F9 lets an org pick bundled fonts or upload a .ttf/.otf/.woff2 with the reminder "only
  upload fonts you are licensed to embed".
- Choice: the OA-03 screen offers the bundled fonts by name and an upload control; an uploaded font
  is stored as a `branding_assets` row of kind `font` and is embedded in the PDF through fontkit
  when its bytes are supplied to `renderPdf`. Until a font's bytes are loaded, the renderer falls
  back to the standard Helvetica, so a missing font never fails a render.
- Reason: keeps the renderer total (never throws for a font) and keeps the licence decision with the
  owner, exactly as F9 states.
- Reverse: remove the `headingFontBytes`/`bodyFontBytes` fields and always use the standard fonts.

## D-S4-branding-entitlements — which feature key gates branding (S4.b, F25)

- Task: S4.b.
- Point: F25 lists `branding_custom_fonts` and `pptx_theme_upload` as separate features. The guard
  featureMapCompleteness requires every RPC that calls `has_feature(` to be mapped.
- Options: (a) gate both branding RPCs on `branding_custom_fonts`; (b) gate `admin_set_branding` on
  `branding_custom_fonts` and `admin_upload_pptx_theme` on `pptx_theme_upload`.
- Choice: (b). Colours, page size, margins and a bundled font need no entitlement beyond the
  branding RPC; the PPTX theme upload is its own add-on.
- Reason: matches the two seeded keys and lets the owner sell theme upload on its own.
- Reverse: change the mapping in `src/lib/featureMap.ts` and the `has_feature` key in 0058.

## D-S4-colour-hex — no hex in a component (S4.c, F19)

- Task: S4.c.
- Point: the token guard `check-tokens` fails on any hex colour under `src/components`, and the
  colour input needs a `#rrggbb` value for a token-named colour.
- Options: (a) an allow-list in the guard; (b) resolve the token's value at runtime and keep the
  fallback in the lib.
- Choice: (b). `resolveHexColour` in `src/lib/render/branding.ts` returns a hex value as-is, reads
  the live CSS custom property for a token name, and carries the neutral `#888888` fallback. No
  component holds a hex value; the guard stays at an empty allow-list.
- Reason: F19 requires components to contain no hex values, and reading the token at runtime means
  the swatch shows the real brand colour rather than a stand-in.
- Reverse: inline the fallback in the component and allow-list the file.

## D-S5-ai-featuremap — ai_require_org_actor maps to ai_assist (S5.a, F8, F25)

- Task: S5.a.
- Point: F25 rule 5 requires every feature RPC in the migrations to be mapped in
  `src/lib/featureMap.ts`. `0059_ai.sql` defines one helper, `ai_require_org_actor(p_org, p_feature,
  p_right)`, that calls `has_feature` once and is reused by every AI RPC; the guard test reads a
  function's own body, so the helper itself must be mapped.
- Options: (a) map it to `ai_assist`; (b) leave it unmapped and allow-list the file in the guard;
  (c) inline the `has_feature` call into every AI RPC and drop the helper.
- Choice: (a). The helper is mapped to `ai_assist`, the base AI feature; its callers inherit the
  gate because they pass the feature key through the helper's argument.
- Reason: (b) weakens the guard (the whole point of F25 rule 5 is that no feature RPC is unmapped);
  (c) repeats the same five lines in nine RPCs and loses one place to audit the gate. (a) keeps one
  gate point and keeps the guard total.
- Reverse: delete the map entry and inline `has_feature` into each AI RPC.

## D-S5-deny-seed — the deny-list seed is idempotent by unique pattern (S5.a, F8, M2)

- Task: S5.a.
- Point: `0059_ai.sql` seeds the vendor-hosted deny-list. CI step 6 applies every migration to the
  persistent `provio-test` project on each run (M2), so a plain `insert` would add a duplicate set of
  rows on the second apply.
- Options: (a) a unique index on `pattern` plus `on conflict (pattern) do nothing`; (b) a
  `where not exists` guard per row; (c) leave the duplicates and let the app de-duplicate.
- Choice: (a). `create unique index if not exists ai_endpoint_denylist_pattern_uidx on
  ai_endpoint_denylist (pattern)` then `insert ... on conflict (pattern) do nothing`.
- Reason: the unique index is the one durable statement of intent ("a pattern appears once"), the
  insert stays a plain data statement, and the second apply is a no-op. (b) is more verbose and
  repeats the guard; (c) leaves residue on the shared project (M5).
- Reverse: drop the index and delete the seed block.

## D-S5-testlib-truncate — ai_models is truncated in the test library (S5.a, M5)

- Task: S5.a.
- Point: `ai_models` is a platform-level table with no foreign key to `orgs`, so
  `truncate orgs cascade` in `provio_test.reset()` does not clear it. Rows added by test 69 would
  leak into the next test run (M5).
- Options: (a) `truncate ai_models cascade` in the reset; (b) give `ai_models` an `org_id` and a
  cascade foreign key; (c) delete the rows in test 69's own cleanup.
- Choice: (a). One line in the shared reset, alongside the other platform tables.
- Reason: `ai_models` is genuinely platform-level (no `org_id`), so (b) would model it wrongly; (c)
  puts the burden on every test that touches the table and is easy to forget.
- Reverse: remove the line.

## D-S5-ssrf-dns — a name that resolves to a private address is refused (S5.b, F8, L2)

- Task: S5.b.
- Point: in `server` mode the gateway must refuse an endpoint that is a vendor host, a private
  literal, or a public name that resolves to a private address (DNS rebinding).
- Options: (a) judge the literal host only; (b) accept a `resolvedIp` the caller passes and refuse a
  private answer; (c) resolve DNS inside the pure module.
- Choice: (b). `checkEndpoint(url, mode, denyPatterns, resolvedIp?)` refuses a private `resolvedIp`
  when the caller supplies one; the pure module never resolves DNS itself.
- Reason: the module stays pure and unit-testable (no network in vitest), while the gateway — which
  may resolve — can pass the answer in. (a) leaves a rebinding hole; (c) makes the module impure.
- Reverse: drop the `resolvedIp` parameter; the gateway then relies on the literal host only.

## D-S5-prompt-budget — the sample section fills top-down to a character budget (S5.b, F8)

- Task: S5.b.
- Point: prompt assembly must include the top-k most similar voice samples of the same kind, but a
  long sample could crowd out the record context or the system prompt.
- Options: (a) always include exactly top-k samples; (b) truncate each sample to a fixed length;
  (c) fill the sample section top-down until a character budget is reached, dropping the rest.
- Choice: (c). The system prompt, voice, terms, branding facts, the allowed-numbers line and the
  record context are always included; samples are added in rank order until the budget is reached.
- Reason: (a) can overflow the model's context window; (b) can cut a sample mid-sentence and does
  not adapt to the budget. (c) keeps the essential instructions and is deterministic.
- Reverse: raise the default budget or include every ranked sample.

## D-S5-number-format — an allowed number matches on its normalised value (S5.b, F8)

- Task: S5.b.
- Point: the number guard flags a figure in the model's response that the prompt did not carry. The
  same quantity can be written differently ("1,000" vs "1000", "50%" vs "50").
- Options: (a) exact string comparison; (b) compare on a normalised value (strip separators, a
  trailing percent, a leading plus and trailing decimal zeros); (c) ask the model to echo the numbers.
- Choice: (b). `normaliseNumber` makes "1,234.50", "1234.5" and "50%" comparable to the prompt's
  allow-list.
- Reason: (a) flags a correct figure that differs only in formatting, which trains users to ignore
  the guard; (c) relies on the model and is not deterministic (L1).
- Reverse: compare the raw token strings.

## D-S4-deps — the F22 render dependencies, versions and licences (S4.b, F22)

- Task: S4.b.
- Point: F22 allows these minor additions, each MIT or compatible, and requires name, version and
  licence to be recorded.
- Choice: installed and pinned in `package.json`/`package-lock.json`: `pdf-lib@1.17.1` (MIT),
  `@pdf-lib/fontkit@1.1.1` (MIT), `pptxgenjs@3.12.0` (MIT), `qrcode@1.5.4` (MIT),
  `jszip@3.10.2` (MIT), `mammoth@1.13.0` (BSD-2-Clause), plus `@types/qrcode@1.5.5` (MIT, dev) for
  types. No major version of an existing dependency changed.
- Accepted risk: `npm audit` reports 4 advisories with no published fix — `image-size` (high,
  GHSA-5p2g-fcmc-qvqq / GHSA-w3rx-r6r6-pgpr; the stated fix 2.0.3 was never published) and
  `argparse`→`sprintf-js` (moderate, directory traversal) reached transitively through `pptxgenjs`
  and `mammoth`. Both are build/render-time only and process no untrusted input in Provio: the
  renderers consume data the tenant already owns. Recorded as accepted, to be revisited when the
  upstream packages publish a fix.
- Reverse: remove the packages; nothing else depends on them.

## D-S6-engine — escalation is a rule on the F7 engine, not a parallel subsystem (S6.a, F12)

- Task: S6.a.
- Point: F12 says escalation is "built on the F7 engine" with rule fields (trigger event, conditions,
  outcomes) and outcomes that notify roles and set a deterministic recommendation.
- Options: (a) a separate `escalation_rules` table with its own evaluator; (b) reuse `automation_rules`
  with a new action type `escalate`, read by both `rule_engine_process` and `escalation_evaluate`.
- Choice: (b). An escalation rule is an ordinary row in `automation_rules` carrying an action of type
  `escalate`; `escalation_evaluate(p_event_id)` is the F12 hook that reads the same store the F7
  engine reads, so the tenant-overrides-platform rule and the loop guard apply unchanged.
- Reason: (a) would duplicate the condition evaluator, the loop guard and the recipient resolution,
  and would drift from F7. F12 explicitly says the engine's event interface stays generic so a future
  `watcher.signal` event can plug in; one rule store keeps that promise.
- Reverse: move the `escalate` action rows to a separate table and give them their own evaluator.

## D-S6-rec — the recommendation is a rule-defined template, never AI (S6.a, L1)

- Task: S6.a.
- Point: F12 requires "Audit required: Yes / No / Needs review" with a reason "filled from the event
  fields by a rule-defined template (never AI-decided)".
- Options: (a) store the recommendation as free text per escalation; (b) store an ordered template of
  branches (field, value, recommendation, reason) with a final default branch.
- Choice: (b). `escalation_recommendation(p_payload, p_template)` walks the branches in order, returns
  the first match, and falls back to the last branch's `default_recommend` / `default_reason`. An
  empty template answers `Needs review` rather than raising. The same walk is mirrored in
  `src/lib/escalation.ts` so the editor's preview equals the stored value.
- Reason: (a) lets the outcome depend on whoever wrote it and cannot be previewed; (b) is
  deterministic, previewable and testable, and keeps the AI note (F8 "Explain anomaly") strictly
  beside the recommendation, never inside it.
- Reverse: replace the template with a single stored string.

## D-S6-targets — a proposal is visible to its targeted roles, not to the whole tenant (S6.a, F12)

- Task: S6.a.
- Point: F12 says escalation events are "visible in the Work Queue to targeted roles".
- Options: (a) visible to every member of the org; (b) visible when the caller holds `view_all_scopes`
  or one of the proposal's `target_roles` matches a role the caller holds.
- Choice: (b). `work_queue_proposal_list` returns a row when the caller is a CIA (`view_all_scopes`) or
  holds any slug in `target_roles`; `escalation_event_list` is the same rule on the escalation.
- Reason: (a) leaks the escalation to roles the rule did not name, which contradicts F12 and weakens
  the "targeted roles" promise. (b) matches the seeded template rules, which name CIA or a specific
  role.
- Reverse: broaden the predicate to `jwt_org_id() = org_id`.

## D-S6-idempotent — escalation_evaluate fires once per (event, rule) (S6.a, M2)

- Task: S6.a.
- Point: CI step 6 re-applies migrations and the engine can be invoked more than once for the same
  event (a retry, or a manual re-run from the console).
- Options: (a) rely on the caller to invoke once; (b) record `source_event_id` and `rule_id` on the
  escalation row and skip a rule that already escalated that event.
- Choice: (b). `escalation_evaluate` returns 0 when a row already exists for the same
  `(source_event_id, rule_id)`, and test 70 asserts the second call returns 0.
- Reason: (a) would double-notify the targeted roles on any retry; a duplicate notification is a real
  defect for a person on the receiving end. (b) is deterministic and cheap.
- Reverse: drop the guard; accept duplicate escalations on retry.

## D-S6-status-vocab — AI model status uses the migration's vocabulary (S6.c, F8)

- Task: S6.c.
- Point: `SuperAdminAi.tsx` toggled a model between `active` and `disabled`, but `ai_models.status`
  is `live` / `parked` (0059) and `update_ai_model` refuses anything else.
- Options: (a) change the migration to accept `active` / `disabled`; (b) align the component with the
  migration.
- Choice: (b). The screen now parks a live model and enables a parked one, and the copy reads
  "Park" / "Enable".
- Reason: the fixed rule (F8's model registry, already migrated and tested) wins; where a fixed rule
  and existing code disagree, the code changes.
- Reverse: none needed; the migration is the source of truth.

