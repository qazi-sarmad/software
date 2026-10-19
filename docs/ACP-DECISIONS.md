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
