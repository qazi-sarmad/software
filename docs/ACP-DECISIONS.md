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

## D-S7-scope-key — "last pack" is per scope_key, never global (S7.a, F10)

- Task: S7.a.
- Point: which pack is "the last pack" a new pack chains to and diffs against.
- Options: (a) the most recent successful pack for the org; (b) the most recent successful pack with
  the same `scope_key`.
- Choice: (b). `board_pack_snapshot`/`board_pack_generate` select the previous row by
  `(org_id, scope_key, status = 'ready')` and store it in `previous_pack_id`; test 71 asserts two
  different scopes do not collide.
- Reason: F10 states the boundary default is "since the last successful pack with the same scope_key",
  and an organisation-wide pack must not silently bound a single-entity pack. Global selection would
  also make the delta meaningless across scopes.
- Reverse: change the WHERE clause to drop `scope_key` and null `previous_pack_id`.

## D-S7-data-hash — the snapshot hash is computed in the database, file hashes in the browser (S7.a, F10)

- Task: S7.a.
- Point: where `data_hash` and `file_hashes` are computed.
- Options: (a) compute both in the browser and send them; (b) compute `data_hash` in the database and
  `file_hashes` in the browser.
- Choice: (b). `board_pack_generate` computes `data_hash` = SHA-256 of the canonical JSON of the
  snapshot inside Postgres (`encode(digest(canonical, 'sha256'), 'hex')`); the browser fills
  `file_hashes` per format after rendering.
- Reason: F10 says so explicitly, and a database-computed hash cannot be forged by a caller and is the
  same value the ledger entry and the public verification page use. The file bytes only exist in the
  browser, so their hashes must be computed there.
- Reverse: move the digest call into the app; the ledger entry and verification page would then trust
  a client value, which weakens the chain.

## D-S7-figure-refs — a non-zero figure with no refs is a bug, not a warning (S7.a, F10)

- Task: S7.a.
- Point: what to do when a snapshot figure carries no `refs`.
- Options: (a) allow it and render the number; (b) fail the generation and the test.
- Choice: (b). `board_pack_figure_refs(snapshot)` returns the paths of every non-zero figure with an
  empty `refs` array; `board_pack_generate` raises when it is non-empty and test 71 fails on it. A
  zero figure is allowed to have no refs because there is nothing to point at.
- Reason: F10 says "a figure with no refs is a bug; a SQL test fails on it", and L4 requires
  everything to be drillable. A number a user cannot trace is worse than no number.
- Reverse: drop the check; the pack would then show untraceable figures.

## D-S7-zero-figures — a zero figure is excluded from the ref requirement (S7.a, F10)

- Task: S7.a.
- Point: whether a figure with value 0 must still carry refs.
- Options: (a) require refs on every figure regardless of value; (b) require refs only on non-zero
  figures.
- Choice: (b). The check and the app walk (`figuresWithoutRefs`) both skip value 0.
- Reason: a zero count has no underlying records to link to, so requiring a ref would force a
  synthetic pointer, which is exactly the untraceable number the rule exists to prevent.
- Reverse: drop the `value <> 0` condition in both places.

## D-S7-sections-seeded — the eight F10 sections are seeded per org, never deleted (S7.a, F10)

- Task: S7.a.
- Point: how the configurable section list is stored.
- Options: (a) a fixed list in code; (b) a per-org `board_pack_sections` table seeded on first read
  with the eight F10 sections and edited visually.
- Choice: (b). `board_pack_sections_seed(org)` inserts the eight rows idempotently; a section is
  enabled/disabled and reordered, never deleted (product law C1: configuration, not code).
- Reason: F10 makes the section list configurable and reorderable with per-section role visibility,
  and the product law requires it be changed from a screen rather than code.
- Reverse: drop the table and read a constant; the screen would lose its configuration.

## D-S7-boundary-three-kinds — boundary is one of three kinds, stored on the row (S7.a, F10)

- Task: S7.a.
- Point: how the pack boundary is represented.
- Options: (a) a free-text range; (b) a `boundary_kind` of `since_last` | `custom` | `since_meeting`
  with `from_ts`/`to_ts` resolved at generation.
- Choice: (b). The row stores the kind and the resolved timestamps.
- Reason: F10 lists exactly those three options; storing the resolved range as well keeps a pack
  reproducible even after `last_board_meeting_date` changes.
- Reverse: drop the two timestamp columns and re-resolve at read time.

## D-S7-app-base-url-gate — refuse to render a PDF or PPTX until app_base_url is set (S7.a/S7.c, F10)

- Task: S7.a, S7.c.
- Point: what happens when the org has not set `app_base_url`.
- Options: (a) render with relative links; (b) refuse and say why.
- Choice: (b). `board_pack_generate` raises "Set the application web address…" and the panel disables
  the PDF and PPTX buttons and shows an inline error.
- Reason: F10 says "refuse to generate PDF or PPTX until it is set", and a PDF whose links do not
  resolve defeats the mandatory drill-down rule.
- Reverse: allow generation and emit relative links.

## D-S7-settings-rpc — app_base_url and friends are read and written through RPCs (S7.a/S7.c, F10/F11)

- Task: S7.a, S7.c.
- Point: how the tenant-level F10/F11 settings are exposed.
- Options: (a) read `org_settings_extra` directly from the app; (b) `org_settings_extra_get` and
  `org_settings_extra_save` RPCs behind `config_actor_ok(edit_config)`.
- Choice: (b). The getter returns the five settings; the saver writes them and requires
  `edit_config` (or an active consultation session).
- Reason: the product law requires every setting be changeable from a screen; a direct table read
  would leave the write path undefined, and F4 requires configuration RPCs to use `config_actor_ok`
  so a consultant can reach them.
- Reverse: expose the table; the app would then decide entitlement itself, which F25 forbids.

## D-S7-panel-placement — the Board Pack panel lives on the Dashboard (S7.c, F10)

- Task: S7.c.
- Point: where the Board Pack panel appears.
- Options: (a) a new top-level tab; (b) a panel on the Dashboard, per spec §5.
- Choice: (b). `BoardPackPanel` renders at the foot of `ExecutiveDashboardTab`; the hard ban on a
  Workbench tab and the F10 wording ("a Board Pack panel on the Dashboard") both point here.
- Reason: F10 names the Dashboard explicitly, and adding a tab would risk the banned-surface list.
- Reverse: mount the panel elsewhere; the component is self-contained.

## D-S7-panel-hidden — a role without view_board_pack sees no panel at all (S7.c, F10)

- Task: S7.c.
- Point: what a Preparer (no view_board_pack) sees on the Dashboard.
- Options: (a) the panel with a refusal message; (b) nothing.
- Choice: (b). The component returns null; the database refuses the reads regardless.
- Reason: F25 rule 3 says a feature the tenant lacks is hidden, and F10 gates the pack by the rights
  matrix. Showing an empty shell would advertise a surface the role cannot use.
- Reverse: render the refusal shell.


## D-M2-migration-number — the secret-entry change is migration 0063 (M-2)

- Task: M-2.
- Point: which migration number the secret-entry change takes.
- Options: (a) 0062; (b) 0063.
- Choice: (b) 0063_secret_entry.sql. 0062 was already taken by the certificate migration (S8.a).
- Reason: one migration, one concern; never reuse a number.
- Reverse: rename the file; the body is independent of its number.

## D-M2-secret-store-ref — the database never receives a secret value (M-2, F5)

- Task: M-2.
- Point: how a secret reference enters the database without the value ever reaching SQL.
- Options: (a) keep secret_put and pass the plaintext as an argument; (b) drop secret_put, add
  secret_store_ref that accepts only a mask and, at most, ciphertext.
- Choice: (b). 0054's secret_put took the plaintext, wrote a mask and left the ciphertext column
  null, so every key, SMTP password and Microsoft secret was discarded and the value travelled
  through SQL. secret_store_ref (M1: extends the existing secret_store table) is service_role only
  and accepts p_ciphertext (already AES-GCM output, or null when Vault holds the value) and p_masked.
- Reason: F5 — no secret reaches the browser, a log, the ledger, an email or a screenshot; the
  database must not see the value at all. A plaintext-taking SQL entry point must not exist.
- Reverse: reintroduce secret_put; not advisable.

## D-M2-vault-fallback — AES-256-GCM when Vault is absent (M-2, F5)

- Task: M-2.
- Point: what to do when Supabase Vault is absent on the target.
- Options: (a) refuse and block; (b) AES-256-GCM inside the Edge Function under SECRETS_MASTER_KEY,
  ciphertext in secret_store, vault_id null.
- Choice: (b). secret_vault_store raises when Vault is absent; the Edge Function catches that and
  falls back to AES-GCM. The row keeps the vault id only when Vault stored the value.
- Reason: F5 names this exact fallback. A deployment without Vault still needs a place for
  credentials, and the value still must not reach the database.
- Reverse: require Vault and delete the fallback branch.

## D-M2-mask-parameter — the mask helper takes only a suffix (M-2, F5)

- Task: M-2.
- Point: secret_mask_value's argument.
- Options: (a) keep p_value (the full value); (b) rename to p_last4, so the database receives only a
  suffix.
- Choice: (b). The Edge Function computes the mask; secret_mask_value only formats the suffix. The
  signature change needs a drop of the old function (M4), added in 0063 and above the re-creation in
  0054 (M7).
- Reason: F5 — the full value must never reach SQL, not even to be masked.
- Reverse: restore p_value; not advisable.

## D-M1-extension-anon-grant — extension members are excluded from the anon-surface test (M-1)

- Task: M-1.
- Point: the hosted project grants EXECUTE on extension members (dblink and friends, 20 in public)
  directly to anon through its own default privileges. The migration role does not own them, so
  revoking that grant raises insufficient_privilege (the M-1 red CI) and skipping them leaves the
  grant in place (the test-72 failure after the M-1 fix).
- Options: (a) leave them and fail test 72; (b) skip extension members in the revoke loop and exclude
  them from the test's count, reporting them with a notice.
- Choice: (b). Extension members are platform-owned, not part of Provio's surface, and nothing in
  this repository grants anon on them. 0062 revokes them best-effort (a refusal is swallowed);
  test 72 counts only non-extension functions and raises a notice listing any extension member still
  granted to anon.
- Reason: the anonymous surface Provio controls is exactly verify_certificate and verify_board_pack;
  the extension functions anon can still reach are dblink helpers no tenant can use through the API,
  and no migration can revoke a grant the migration role does not own.
- Reverse: if the owner wants the extension grants closed, drop the dblink extension from public
  (only the SQL tests need it) or run a one-off revoke as the extension owner.

## D-M2-vault-column — the Vault id has its own column (M-2)

- Task: M-2.
- Point: how the Vault id is recorded on a secret row.
- Options: (a) store the Vault id in the existing `ciphertext` column; (b) add `vault_id uuid`.
- Choice: (b). `alter table secret_store add column if not exists vault_id uuid` (M2).
- Reason: the two are different facts — ciphertext is the AES-GCM blob, vault_id is a reference into
  Vault. Overloading one column would make "which store holds this value" ambiguous.
- Reverse: drop the column.



## D-M3-definer-guard - the dispatcher guard compares a session flag, not current_user (M-3)

- Task: M-3.
- Point: 0056's dispatcher guard required `current_user = 'service_role'`, but
  `email_dispatch_claim` / `email_dispatch_complete` are SECURITY DEFINER functions owned by
  `postgres`, so `current_user` inside them is always the owner. The guard could never pass, so no
  row could ever be claimed (a latent bug no earlier test exercised, because test 73 is the first to
  call claim as the service role).
- Options: (a) edit 0056 in place; (b) add an M7 repair section to 0064 that replaces the guard.
- Choice: (b). 0056 may already have run on provio-test, and editing an applied migration does not
  re-run it. 0064 section 5 replaces the guard function so the fix lands on both fresh and existing
  databases.
- Reason: M7 - the repair for a partly-applied or already-applied migration goes above the failing
  statement in the newest migration, never by editing the old one.
- Reverse: drop section 5 of 0064 and restore 0056's guard (only correct if 0056 has not yet run
  anywhere).

## D-M3-FIX-panel-race - the 6H report test waits for both loads (M-3-FIX)

- Task: M-3-FIX.
- Point: CI 39314413666 failed `phase6Panels.test.tsx > issues the report and shows the queued-email
  notice` with "expected vi.fn() to be called with arguments ['v1'] / Number of calls: 0", while the
  same test passed locally eight times in a row.
- Options: (a) skip or loosen the assertion; (b) make the test wait for the panel to settle.
- Choice: (b). `ReportEditorPanel` loads twice - once with `activeId` null, then again once it
  selects the first version - so the Issue button can appear, then be unmounted for the loading
  skeleton, between the two loads. On a slower runner the hold landed in that window and the click
  never reached the handler. The test now waits for both loads (`listCaps` is each load's last call)
  and for the button to be enabled before holding.
- Reason: the flake was in the test, not the product: the panel is correct to reload once it has a
  version. Loosening the assertion (a) would have hidden a real regression later.
- Reverse: revert the test change; the flake returns on a slow runner.

## D-M4b-gate-style — a disabled feature raises, except in the two engine hooks (M-4b, F25)
- Point: how a gated RPC behaves when `has_feature` is false.
- Options: (a) always `raise exception 'This feature is not included in your plan.'`; (b) raise for
  user-facing RPCs, but return a neutral value for the two internal hooks.
- Choice: (b). User-facing RPCs (`board_pack_snapshot`, `board_pack_sections_save`,
  `certificate_config_save`, `certificate_revoke`, `ai_call_log`, `automation_rule_save`,
  `automation_rule_test`) raise, matching the wording F25 requires. `escalation_evaluate` returns 0,
  the same as "nothing to do". `verify_certificate` reports `not_found`.
- Reason: `escalation_evaluate` is called in a loop over the event batch by the dispatcher. Raising
  there would abort the batch and starve unrelated events, so a disabled feature must be a no-op.
  `verify_certificate` is the anonymous surface; returning `not_found` for a disabled feature is
  identical to an unknown id, so the public page cannot be used to probe whether a certificate
  exists while `public_verification` is off. Both keep the refusal indistinguishable from the
  feature being absent, which is what F25 asks for ("hidden and refused").
- Reverse: change the two bodies in 0065 to raise the standard exception and re-run test 74.

## D-M4b-verbatim-bodies — the retrofit reproduces each function verbatim (M-4b, F25, M2, M4)
- Point: how to add the gate without changing any other behaviour.
- Options: (a) edit each original migration in place; (b) re-`create or replace` each function in a
  new migration with only the gate added.
- Choice: (b). 0065 carries the nine functions byte-for-byte as they were, each with one added
  `if not public.has_feature(...)` block. The bodies were extracted from the source migrations by
  script and the only edit is the inserted block, so a reviewer can diff and see one change per
  function.
- Reason: M2 and M4 forbid changing an object's shape in place, and editing an already-applied
  migration would not reach the persistent test project. `create or replace` keeps the signature,
  volatility, security and grants, so nothing else moves.
- Reverse: drop 0065 and delete the gate blocks from the copy; the original migrations still hold the
  ungated bodies.

## D-M4b-M1 — all nine names already existed; each is extended, not created (M-4b, M1)
- Point: M1 requires a grep of `supabase/migrations` and `supabase/tests` before naming an object.
- Choice: found and extended, no duplicates created. `board_pack_snapshot`, `board_pack_sections_save`
  (0061); `certificate_config_save`, `certificate_revoke`, `verify_certificate` (0062); `ai_call_log`
  (0059); `automation_rule_save`, `automation_rule_test` (0056); `escalation_evaluate` (0060).
- Reason: every name pre-existed; the retrofit is the extension M1 asks for.
- Reverse: none needed.

## D-S8-engagement-root-hash — the engagement root hash joins the sealing ledger hashes (S8, F11)
- Point: F11 says use the ledger's engagement-level head hash if one exists, else
  `sha256(newline-joined ledger entry hashes of the engagement's sealing entries, in sequence order)`.
- Options: (a) add an engagement-level head hash to the ledger; (b) join the existing per-entry hashes.
- Choice: (b). `engagement_root_hash(p_engagement_id)` selects the ledger entries whose `kind` is a
  sealing kind for that engagement, orders them by sequence, joins their hashes with a newline and
  hashes the result. No new ledger column.
- Reason: the ledger already stores a hash per entry and is append-only, so a head hash would be a
  second source of truth that could drift. Joining in sequence order is deterministic and re-derivable
  by any verifier from the public ledger rows.
- Reverse: change the function body in 0062; existing certificates keep their stored `cert_hash` and
  are unaffected, and a re-issue after the change would supersede them under the normal version rule.

## D-S8-anon-surface-exactly-two — the anonymous surface is two functions, closed by a sweep (S8, F11)
- Point: F11 requires the functions callable by `anon` to be EXACTLY `verify_certificate` and
  `verify_board_pack`. Functions created without an explicit ACL inherit EXECUTE from PUBLIC, so
  `anon` could otherwise reach internal helpers.
- Options: (a) grant the two and trust the default ACLs elsewhere; (b) grant the two, then sweep every
  other function in `public` and revoke its PUBLIC and anon grants.
- Choice: (b). 0062 first re-grants EXECUTE to `authenticated` and `service_role` for each function
  that has it today (so revoking PUBLIC does not remove real access), then revokes PUBLIC and anon,
  skipping the two verification functions. `src/guards/anonGrantAllowList.test.ts` replays every
  anon grant and revoke in migration order and fails if the net set is anything other than the two.
- Reason: the sweep is the only way to close grants that no migration names explicitly. The static
  guard is order-aware because the sweep clears the earlier helper grants (`is_cia`, `is_org_admin`,
  `can_read_all_scopes` from 0016), so a plain union of grants would be wrong.
- Reverse: delete the sweep block from 0062 and the guard's sweep handling; the earlier migrations
  still hold their own grants.

## D-S8-extension-anon-grant — extension members keep their hosted anon grant; reported, not widened (S8, M1)
- Point: the hosted project grants EXECUTE explicitly to `anon` on extension members (`dblink` and
  friends) at creation time, and the migration role may not own those objects.
- Options: (a) attempt to revoke and fail the migration if refused; (b) best-effort revoke inside a
  `begin … exception when insufficient_privilege then null` block and report the residue.
- Choice: (b). The sweep skips extension members (`pg_depend deptype = 'e'`) and test 72 excludes
  them from the count while raising a notice that names any that remain.
- Reason: a refusal to revoke an extension member cannot widen the anonymous surface (the grant
  already existed before this build); failing the migration over it would block the slice on a
  condition it cannot change. Keeping it visible in the test output means it stays on the record.
- Reverse: none needed; if the platform later removes the default grant, the notice simply stops
  firing.

## D-S8-hash-not-recomputed — a certificate hash is written once and never recomputed (S8, F11, L5)
- Point: F16 forbids recomputing hashes during a ledger copy; the same caution applies to certificates.
- Choice: `cert_hash` is computed once, in the database, when the row is inserted, and never updated.
  Reopening an engagement supersedes the row (status change only); revoking sets status and reason.
  A superseding re-issue writes a NEW row with an incremented version.
- Reason: L5 requires the hash chain to be stable. Recomputing on read would let a change to
  `canonical_value` silently change a previously issued certificate's hash.
- Reverse: none; this is the intended invariant.

## D-S9-metadata — the identity/metadata tables exclude the external auditor explicitly (S9, F13)
- Point: F13 requires an external auditor to read ZERO rows from every business table, and requires
  RLS on every table to keep excluding them (they are not `org_members`). But the auditor carries an
  `org_id` claim (the access-token hook stamps it so the ext_ functions can find its grants), and
  several policies written before this slice key only on `org_id = jwt_org_id()`.
- Options: (a) leave the auditor without an `org_id` claim and let the ext_ functions resolve the org
  another way; (b) keep the claim and tighten each affected policy with
  `and not public.is_external_auditor()`.
- Choice: (b). 0066 tightens `roles`, `orgs`, `findings`, `issues`, `cap_items`, `notifications` and
  `severity_levels` in place, adding `and not public.is_external_auditor()` to each select policy.
  `is_external_auditor()` reads only `jwt_user_role()`, so the check costs nothing and cannot be
  forged without a signed claim.
- Reason: (a) would force every ext_ helper to take an explicit `p_org` and re-derive it from the
  grant table, widening the surface. The claim is set by the access-token hook, which strips any
  pre-existing `org_id`/`user_role` first, so it cannot be forged. Test 75 enumerates every table in
  `org_tables()` and fails if the auditor reads a single row.
- Reverse: drop the `and not public.is_external_auditor()` clause from the seven policies; the
  original `org_id = jwt_org_id()` behaviour returns and the auditor would see those rows again.

## D-S9-denial-no-raise — a refused ext_ call logs and returns no rows, it does not raise (S9, F13)
- Point: F13 says "every call is logged". If a refused ext_ call raised an exception, the caller's
  transaction would abort and the `insert into external_access_log` with it — the denial would leave
  no trace, and the requirement would be false.
- Options: (a) `raise exception 'not allowed'` on refusal, as the tenant RPCs do; (b) log
  `outcome = 'denied'` and `return` with no rows.
- Choice: (b) for the read surface. Every ext_ function returns `outcome = 'denied'` and no rows when
  `external_actor_ok` or `external_has_permission` is false; `ext_verify_certificate` returns a
  `not_found` row. The portal calls `ext_me` first to learn whether access is active, so it can show
  the plain "your access is not active" screen instead of an empty list.
- Reason: an audit trail that vanishes exactly when access is refused is worse than useless. The
  refusal is still absolute — no row of tenant data is returned — so nothing is weakened. Test 75
  asserts at least one `denied` log row exists.
- Reverse: replace the `return` with a `raise exception`; the log row would be lost, so the test that
  counts `denied` rows would fail first and make the change visible.

## D-S9-board-pack-scope — a Board Pack is matched to an engagement by scope_key or snapshot ref (S9, F10)
- Point: `ext_latest_board_pack(p_engagement_id)` must return the hash of the pack that covers an
  engagement, but `board_pack_history` (0061) has no `engagement_id` column: a pack is scoped by a
  free-text `scope_key` (organisation, universe, entity or period), per F10.
- Options: (a) add an `engagement_id` column to `board_pack_history`; (b) match the latest successful
  pack whose `scope_key` equals the engagement id, or whose snapshot names the engagement among its
  figure refs.
- Choice: (b). The function selects the newest `status = 'ready'` row where
  `scope_key = p_engagement_id::text` or `snapshot::text like '%' || p_engagement_id || '%'`.
- Reason: F10 fixes the scope model and F2 forbids building a parallel one; adding a column would
  change the pack's meaning. A pack generated with the engagement as its scope, or a snapshot whose
  refs name the engagement, is the pack that covers it. Only the id and hash are returned; the file is
  rendered in the browser, so no tenant content crosses the boundary.
- Reverse: drop the function (it is a read helper) and add the column if the pack model ever gains an
  explicit engagement link.

## D-S9-invite-not-sent — the invitation is queued, and the UI says so (S9, S3, F6)
- Point: the D20 defect was an "Invitation sent" message for an email that was never sent. F6 makes
  the stub provider the default, so nothing leaves the platform until an adapter is configured.
- Choice: `external_auditor_invite` writes a single-use, hashed token and calls the existing
  `queue_email` with the acceptance link; the panel's success message is "Invitation queued. It is
  not sent yet; it goes out when email is set up." The same wording is used for member invitations
  (S3). The Edge Function `invite-user` (action `accept-external`) binds the account through
  `external_auditor_accept`, which is service-role only.
- Reason: honest copy is a product rule (F24), and the queue is the single dispatch path (F6). The
  token is stored only as a sha256 hex digest (test 75 asserts `length(token_hash) = 64`).
- Reverse: none; the copy is required by the D20 fix.

## D-S9-external-principal — the external auditor is a session status, not an org role (S9, F13)
- Point: F13 makes the external auditor a separate principal type; the closed rights list (F3) is
  unaffected. The app shell must decide, for a signed-in account with no org membership, between
  "platform staff", "external auditor" and "not provisioned".
- Options: (a) add an external role to the rights matrix; (b) a new `AuthStatus` value
  `external_auditor`, resolved from the database by `ext_me`, that renders the portal outside the
  tenant shell.
- Choice: (b). `AuthContext` gains the status and asks `isExternalAuditorSession()` (an `ext_me`
  call) only after `loadCurrentUser` and `platformWhoami` have both said no. The portal renders
  outside `AppProvider`, so no tenant seed, scope or right is mounted. `/external` for a tenant
  member shows a plain notice instead of the portal.
- Reason: the rights list is a closed list of fifteen keys (F3) and F13 says it is unaffected; an
  external role would have to appear there. Resolving the principal in the database keeps the
  decision server-side and works for both the initial load and the sign-in path (both were fixed in
  this slice, so signing in as an auditor reaches the portal, not the welcome screen).
- Reverse: remove the `external_auditor` status and the two `isExternalAuditorSession()` calls; the
  account would fall back to the "not provisioned" screen.


## D-R1-org-from-caller — the org is taken from the verified caller, never the request body (R-1, F8)
- Point: the ai-gateway read `org_id` straight from the request body and went to the service client,
  which bypasses RLS. Any signed-in account could name another tenant's org and reach that tenant's
  endpoint configuration and (once set) its bearer token.
- Options: (a) keep reading the body and rely on the service client; (b) verify the caller's session,
  then check membership of the named org in the database before the service client is built.
- Choice: (b). The handler calls `caller.auth.getUser()` first (401 when there is no user), then
  `caller.rpc('ai_gateway_authorise', { p_org })` with the caller's own client (403 when it is not
  true). `org_id` from the body is a candidate only. The service client is constructed only after the
  check returns true, so a refused call reads no endpoint and never calls `secret_reveal`.
- Reason: L2 and the multi-tenant boundary. The caller's JWT is the only authority for its org; a body
  field is caller-controlled input. Proving membership through the caller's client keeps the decision
  in the database (the same `org_members` row RLS uses).
- Reverse: none; reading the org from the body is the defect this task fixes.

## D-R1-single-gate — one authorisation RPC answers membership, right and entitlement (R-1, F8, F25)
- Point: the gateway needs three facts before it may spend the service role: is the caller a member of
  this org; does it hold `use_ai_assist`; is `ai_assist` entitled for the org.
- Options: (a) three separate calls (`org_members` read, `caller_has_right`, `has_feature`); (b) one
  SECURITY DEFINER function that answers all three and is granted to `authenticated` only.
- Choice: (b). `public.ai_gateway_authorise(p_org uuid)` (migration 0067) returns true only for a
  member of `p_org` who holds `use_ai_assist` while `has_feature(p_org,'ai_assist')`. `execute` is
  revoked from `public` and `anon` and granted to `authenticated`. Test 76 covers cross-org, no-right,
  feature-off, allowed, platform-admin-refused and anon-refused.
- Reason: one round trip, one place to reason about the gate, and the same shape F25 rule 1 asks for
  ("every new feature RPC calls it before its right check"). The function is mapped to `ai_assist` in
  `src/lib/featureMap.ts` so the completeness guard stays total (D-R1-featuremap).
- Reverse: drop `ai_gateway_authorise` and inline the three checks in the Edge Function; the test and
  the featureMap entry go with it.

## D-R1-tdz-crypto — the crypto dependency is injected, not a self-reference (R-1, F8)
- Point: `index.ts` had `const crypto = crypto as unknown as HashCrypto` inside the request handler.
  A `const` is in its own temporal dead zone until initialised, so the initialiser reads itself and
  throws `ReferenceError: Cannot access 'crypto' before initialization` on every non-probe request.
- Options: (a) rename the local (`const webcrypto = crypto`); (b) pass the global `crypto` in as a
  dependency of the handler, so the logic is testable with an injected implementation.
- Choice: (b). `GatewayDeps.crypto` carries it; `index.ts` passes `crypto as unknown as HashCrypto`.
  The `HashCrypto` interface stays, because it is still the parameter type of the shared `aiGateway`
  helpers (`sha256Hex`, `runGatewayCall`), which are not Deno-only.
- Reason: the crash is real and fatal; injecting it also lets `src/lib/aiGatewayHandler.test.ts` run
  the whole path without Deno. Removing the type entirely would mean retyping five signatures in
  `_shared/aiGateway.ts`, which no task asks for.
- Reverse: replace `deps.crypto` with the global in the handler; the crash returns, so there is no
  reason to.

## D-R1-featuremap — ai_gateway_authorise belongs to ai_assist (R-1, F25 rule 5)
- Point: the new RPC calls `has_feature(`, so the featureMapCompleteness guard requires a map entry.
  The first R-1b commit left it out and vitest went red (1 failed of 1307).
- Choice: `ai_gateway_authorise: 'ai_assist'` in `src/lib/featureMap.ts`. It gates on the same feature
  its callers do.
- Reason: F25 rule 5 is explicit; the guard is the mechanism that keeps the mapping total. Committed
  as R-1c.
- Reverse: none; an unmapped feature RPC is a build failure by design.

## D-R1-migration-number — 0067, not 0066 (R-1, M1)
- Point: the task named `0066_ai_gateway_authorise.sql` and test `75`, but S9 had already created
  `0066_external_auditors.sql` and `75_external_auditors.sql`.
- Choice: renumbered to `0067_ai_gateway_authorise.sql` and `76_ai_gateway_authorise.sql`, the highest
  existing + 1 (M1 and the H0 numbering rule). M1 grep found no prior `ai_gateway_authorise`.
- Reason: creating 0066 would have been a duplicate. The migration is `create or replace` (M2), so it
  is a no-op on a second apply.
- Reverse: none; the number follows the repository, not the task text.

## D-R1-s9-fix — the /external test waited for the session, not the click (S9-FIX)
- Point: CI run 39393636028 step 7 failed at e2e/s9-external-auditor.spec.ts:107. The spec called
  `signIn` (which returns as soon as the Sign in button is clicked) then `page.goto('/external')`. The
  reload raced the session write, landed on the sign-in screen, and the wrong-principal notice never
  rendered.
- Choice: the spec uses `signInTenant`, which waits for the navigation strip and so proves the session
  is persisted, before navigating. Test-only change; no production code touched.
- Reason: every other test in the file already used `signInTenant`; this one was the outlier. The
  product behaviour (a tenant member sees a plain notice, never the portal) is correct and unchanged.
- Reverse: none; the previous form was a race.


## D-S10-asof-coverage — the entities history can and cannot reconstruct (S10.a, F14)
- Point: F14 requires an inventory of entities that keep only current state and therefore cannot be
  reconstructed, so the timeline can say "Not recorded before <date>" instead of guessing.
- Inventory. Reconstructable in `engagement_as_of` (0068): workpapers (status, prepared and
  signed-off, replayed from the sign-off and reopen events), findings (id, severity, title, at), seals
  and status changes (from ledger entries and the activity log). NOT reconstructable: populations and
  their row counts (the table keeps the current count only), sampling parameters and drawn samples
  (current state only), and any configuration table that is versioned rather than evented. These
  report as `not_recorded_before` with the earliest recorded date for the engagement.
- Choice: the function returns `status: 'not_recorded_before'`, `earliest_recorded` and
  `earliest_available`; the WK-09 surface renders the honesty note. Activity archived out of the live
  window (0043) sets `earliest_available`, and the timeline states the earliest date it can show.
- Reason: L1 and L4 — the view must replay exactly what was recorded and never invent state.
- Reverse: none; recording more entities would require them to be evented first.

## D-S10-drilldown-type — a finding is opened through the existing record view (S10.c, F15, L4)
- Point: F15 says clicking a node or cell opens the original sealed finding. The app has two record
  modes (window in-app, full page on `/view/:recordType/:id`) driven by `RECORD_TYPE_TO_INSPECTOR`.
  A finding was not a known record type.
- Options: (a) build a bespoke finding panel with its own routing; (b) add `finding` to the inspector
  type union, the title map, the path map and the content switch, so the finding rides the same
  record view every other record uses.
- Choice: (b). `InspectorType` gains `'finding'`; `RECORD_TYPE_TO_INSPECTOR` maps `finding:'finding'`;
  `RecordContent` renders `<FindingDrilldown>` for it; `recordTypeToPath('finding')` falls through to
  `'finding'`, so the drill-down URL is `/view/finding/:id`; `App.tsx` maps that URL to `{ findingId }`.
- Reason: L4 says everything is drillable and both modes must work. Reusing the record view means the
  Patterns drill-down behaves exactly like every other drill-down, and the PDF/PPTX hyperlinks (F10)
  point at a real, already-routed URL. A bespoke panel would duplicate the window/page logic.
- Reverse: remove `'finding'` from the union and the maps; the drill-down would need its own surface.

## D-S10-heatcell-ids — a heat-map cell carries the finding ids it counted (S10.c, F15)
- Point: F15 makes every figure a drill-down, including a heat-map cell. `heatMap()` returned only a
  count per entity-by-bucket, so a cell could not say which findings it counted.
- Choice: `HeatCell` gains `findingIds: string[]`, populated during the same deterministic pass that
  builds the count. The cell is a button whose `onClick` opens the first id; the cluster list and the
  graph node already carry their own ids from the same `pattern_findings` read.
- Reason: the ids come from the same read as the count, so the figure and its refs can never disagree
  (the F10 "a figure with no refs is a bug" rule, applied here for consistency). No new query.
- Reverse: drop the field; the cell would show a count with no drill-down, which F15 forbids.

## D-S10-unavailable-copy — an out-of-scope finding says "Not available", never a guess (S10.c, L4)
- Point: the drill-down can be asked for a finding id the caller cannot read (another org, or outside
  their scope). The read is RLS-scoped and returns null.
- Choice: null renders `finding-drilldown-unavailable` with "Not available. This finding is outside
  your scope, or it is no longer recorded." A thrown error renders `finding-drilldown-error` with the
  server message. The two are distinct surfaces.
- Reason: the same rule the record view already follows for a neutral state — never reveal whether an
  out-of-scope record exists. F15's clusters are built from the caller's own readable findings, so
  this is the edge, not the norm.
- Reverse: none; showing a guess would break L4.

## D-S10-e2e-entitlement-collision — the S1 entitlement spec moved off patterns (S10-FIX)
- Point: CI 39416981015 step 7 failed at acp-control-plane.spec.ts:127. The S1 spec toggled the
  `patterns` entitlement for Synthetic Org A expecting it OFF, but the S10 global-setup fixture
  enables `patterns` for that same org (the Patterns view needs the feature). The Org Admin saw the
  feature already on, so the test never followed an OFF-to-ON transition.
- Options: (a) turn `patterns` off in the S10 fixture and have the spec seed it; (b) leave the S10
  fixture as the true state and move the S1 spec to a feature key no slice enables — `board_pack_pptx`.
- Choice: (b). The S1 spec proves one thing: an entitlement change needs a reason and reaches the Org
  Admin. The feature key is incidental. `board_pack_pptx` is a real catalogue key (F25) that no other
  spec or fixture touches, so it starts OFF and the transition is honest.
- Reason: two specs sharing one org must not fight over one key's starting value. Moving the spec
  keeps both meanings intact and removes the order dependency between the S1 and S10 fixtures.
- Reverse: point the spec back at `patterns` only if the S10 fixture stops enabling it.

## D-S10-graph-node-hit — the graph node is a real, keyboard-reachable target (S10-FIX)
- Point: CI 39416981015 step 7 failed at s10-time-travel-patterns.spec.ts:62 with `locator.click:
  Test timeout`. `wk-patterns-node-<id>` is an SVG `<g>` whose bounding box spans the circle AND the
  text label; Playwright clicks the box centre, which sat between the two shapes, hit nothing, waited.
- Choice: keep the `<g>` testid but add a transparent `r=16` hit circle centred on the node, and make
  the group `role="button"`, focusable, with Enter and Space handlers.
- Reason: the click now lands on the node from any point in the group's box, and F15's drill-down is
  reachable by keyboard, an accessibility gain and not only a test fix. Pointer events stay on the node.
- Reverse: none; the transparent circle is the standard SVG hit-area fix.

## D-S11-password-secret-path — the database password never passes through SQL (S11)
- Point: F16 OA-15 needs a database password. F5 forbids plaintext through SQL or the ledger.
- Options: (a) `hosting_connection_save(p_password)` calling `store_secret` in SQL; (b) the browser
  stores the password through the existing `secrets-put` Edge Function, then links the returned id.
- Choice: (b). `hosting_connection_save` takes no password; `hosting_connection_set_secret` links a
  `secret_store` id and a mask. The vault path is `secret_vault_store` (service_role only), built 0063.
- Reason: F5 says a plaintext-taking SQL entry point must not exist; 0063 already dropped `secret_put`
  for exactly this reason. Reusing `secrets-put` keeps one secret path for the whole product.
- Reverse: none; a plaintext SQL parameter would reintroduce the defect 0063 removed.

## D-S11-platform-rule-trail — platform-level edits go to platform_trail, not the tenant ledger
- Point: `hosting_fit_rule_save` edits a platform catalogue with no tenant. The first version called
  `append_ledger_entry(jwt_org_id(), …)`, which failed with a NOT NULL org_id.
- Choice: platform settings log to `platform_trail` via `platform_log` (actor, action, object). The
  tenant business ledger is only for tenant actions (F20/L5).
- Reason: F20 enumerates the ledger kinds; none is a platform rule change. The platform trail is the
  existing home for Super Admin actions.
- Reverse: none.

## D-S11-job-history — a migration job's start is configuration history, not the ledger (S11)
- Point: F20 names `hosting_migration_cutover` and `hosting_migration_retired` as ledger kinds; it
  does not name a "started" kind. F7 lists `hosting.migration.started` as an event.
- Choice: `migration_job_create` writes a `config_versions` row (key `hosting_migration:job`) and
  emits `hosting.migration.started`; the cutover and retire transitions write the two F20 ledger kinds.
- Reason: one story for configuration (L5, F2) and exactly the ledger kinds F20 fixed.
- Reverse: none.

## D-S11-fk-cascade — migration tables carry an org foreign key for the test reset (S11)
- Point: M5 requires SQL tests to leave no residue; the shared reset is `truncate orgs cascade`.
  `hosting_connections`, `migration_jobs` and `migration_steps` were created without an org FK, so
  test 78's rows survived between runs and its "expected 1, got 2" assertion failed.
- Choice: add guarded `org_id -> orgs(id) on delete cascade` (and `migration_jobs.connection_id ->
  hosting_connections(id)`) constraints, each guarded by a `pg_constraint` existence check (M2).
- Reason: existing S1 tables already follow this pattern; it is the only reset path the suite uses.
- Reverse: none.

## D-S11-ledger-copy-guard — the bypass is inlined in the chain trigger (S11)
- Point: F16 allows a migration runner to preserve sequence, timestamps and hashes, bypassing the
  chain trigger, only as `provio_migrator` with `provio.migration_mode` on.
- Choice: put the guard directly in `chain_ledger_entry()` (0006) as `if current_user =
  'provio_migrator' and current_setting('provio.migration_mode', true) = 'on' then return new`.
  `ledger_copy_mode_ok()` mirrors it for callers.
- Reason: 0006 sorts eleventh, before every later migration; a function defined later could not be
  called from it. `current_user` cannot be spoofed by a session variable, so an ordinary role setting
  the GUC changes nothing (SQL test 78 proves it).
- Reverse: none; the guard is inert unless the runner role exists.

## D-S11-migration-runner-standalone — the runner is a separate Node package (S11)
- Point: F16 requires a runner outside the Vite bundle. Where does it sit relative to tsc/vite/vitest?
- Choice: `tools/migration-runner/` with its own `package.json` and `node --test`; already under
  tsconfig `exclude` and vitest `exclude`, and no import from `src/`. The step logic is driver-injected
  and tested against `fakeDriver.mjs`.
- Reason: F16 says heavy work cannot run in Edge Functions and must not enter the browser bundle; the
  pure step logic is unit-testable without two live databases, which CI cannot provide.
- Reverse: none.

## D-S11-rule-seed-conflict — hosting rule seed keeps administrator edits (S11)
- Point: the seed ran on every apply with `on conflict do update`, which would overwrite a Super
  Admin's edited rule on the second (CI step 6) apply.
- Choice: seed with `on conflict (rule_key) do nothing`, called once from the migration.
- Reason: M2 requires a migration to be safe on top of its own result; overwriting live configuration
  is also a config-not-code violation (C1).
- Reverse: none.

