# Phases 4–8 — decisions

Decision order: (a) `docs/SPEC-v10.md`; (b) the Laws; (c) the simplest option that obeys the Laws;
(d) best for multi-tenant, auditable, configuration-not-code, deterministic. Never an option that
weakens RLS, the population gate, the ledger, the hash chains or a test.

Entry format: number, task, unclear point, options, choice, reason, how to reverse.

---

## D-PLATFORM-RIGHTS (first use: 8A)

The platform portal (Phase 8) is the sole place that may read `user_role` from the JWT (for example
`user_role = 'platform_admin'`). All org-product RPCs and application code continue to use only
`caller_has_right` / `hasRight`. Platform checks must not leak into org RPCs.
Reason: Â§24 requires a platform role with no tenant business access; the tenant boundary is rights,
so the one exception is scoped to platform-only functions and platform-only tables.
Reverse: remove the `platform_admin` branch from the Phase 8 functions; nothing in Phases 4–7 reads it.

## D-H0-USERS

`e2e/global-setup.ts` already creates `ayesha.khan@provio-test.invalid` (Org A `org_admin`) and
`bilal.ahmed@provio-test.invalid` (Org A `preparer`). No new users are created for this build; the
Playwright tests use these two. Reason: they already exist and the setup is idempotent.
Reverse: revert the `e2e/` changes of this build.

## D-H2 — nav labels

Task H2. Unclear point: the code used freeze-spec tab labels that differ from SPEC-v10 Â§5.
Options: keep the old labels; or adopt Â§5.
Choice: Â§5 wins. Mapping applied — Executive Summary â†’ Dashboard; Pending Tasks â†’ Work Queue;
Audit File (tab) â†’ Audit Files; Issues Register â†’ Issues & CAP Register. Audit Universe, Audit Plan
and SIRA are unchanged.
Reason: SPEC-v10 is the authoritative spec (Â§5 "Primary navigation"). Old freeze labels
(Executive Summary, Pending Tasks, Audit File, Issues Register) are superseded.
Files touched beyond `NavStrip.tsx`: `src/components/common/NavStrip.test.tsx` (asserts exact label
text), `e2e/smoke.spec.ts` (SEVEN_TABS + click titles), `src/App.auth.test.tsx` (negative assertion),
`src/components/pending/PendingTasksTab.tsx` and `src/components/issues/IssuesRegisterTab.tsx`
(visible headings using the old wording), `src/components/dashboard/ExecutiveDashboardTab.tsx`
(hint text). Tab `id`s are unchanged, so routing and `data-testid`s are unaffected.
How to reverse: restore the NavStrip strings and the test assertions from the pre-H2 commit `244bb3e`.

## D-H3a — preferences table, RPCs and the no-blocking-modal guard scope

Task H3a. Unclear point: the task predicts the guard offender set as `AuditFileModal.tsx` plus
`ConfirmPanel.tsx`, but the repository has no `ConfirmPanel.tsx`, and the real full-viewport overlays
are `InspectorPanel.tsx`, `CommandPalette.tsx` and `HeaderCalendarPanel.tsx`.
Options: (a) create a `ConfirmPanel.tsx` that is not used; (b) write the guard against the real files
with a justified allow-list.
Choice: (b). `user_preferences` is a new table (grep found none; `config_versions` is org-level
configuration, not per-user state). Guard allow-list: `AuditFileModal.tsx` (Â§17.1 window chrome,
explicitly non-blocking), the global command palette (Â§5, Ctrl/âŒ˜ K — transient, Esc-dismissed),
`HeaderCalendarPanel.tsx` (anchored popover, `role="dialog"` but no scrim, no focus trap; the page
stays usable). `ConfirmPanel.tsx` remains an allowed name for when the hold-to-confirm panel lands
(Â§27.5 names it). `InspectorPanel.tsx` is a genuine blocking modal and is in a TEMPORARY list that
H3c empties when the file is abolished.
Reason: ascribing blocking-modal status to a file that does not exist would hide the real offenders;
the guard must scan actual code while keeping the two surfaces Â§27.5 explicitly permits.
Files touched beyond the task list: `supabase/tests/00_lib.sql` (`user_preferences` added to
`org_tables()`, so tests 1/4 keep covering it). New SQL test `32_user_preferences.sql`.
How to reverse: delete 0024 + test 32, drop `user_preferences` from `org_tables()`, delete
`src/data/preferences.ts` and the guard; restore NavStrip etc. from `8500602`.

## D-H3a-M1 — no collision

Grep for `user_preferences`, `get_user_preference` and `set_user_preference` found no existing
object, so 0024 creates rather than alters. No M1 collision.

## D-H3b — record view wiring, `/view` route, and files touched

Task H3b. Unclear point: the app has no client router; the shell switches tabs by context state.
Options: (a) pull in a router dependency; (b) reuse the existing pathname/popstate approach already
used by `AppRoutes` for `/e/:token`.
Choice: (b). No new dependency (no major bump; Â§28 spirit). `AppRoutes` now recognises
`/view/:recordType/:id` and renders the record behind the auth gate through `RecordPage`, which
reuses the shared `RecordContent`. `RECORD_TYPE_TO_INSPECTOR` maps `engagementâ†’audit_file`,
`workpaperâ†’workbench`, `observationâ†’observation`, `capâ†’cap_inspector`.
Files touched beyond the task list (D-H3b-files): `src/App.tsx` (inspector render switched from the
blocking `InspectorPanel` to `FloatingWindow`; removed the shell scale-down that signalled a modal;
added the `/view` route); new `src/components/common/RecordContent.tsx`,
`src/components/common/FloatingWindow.tsx`, `src/components/common/RecordView.tsx`,
`src/hooks/useRecordViewMode.ts`; `src/guards/noBlockingModal.test.ts` (allow-list widened).
Reason: extracting the content renderer keeps both modes identical and lets the guard scan the real
overlay surfaces.
How to reverse: restore `src/App.tsx` from `ae92f3b` and delete the four new files.

## D-H3c — InspectorPanel abolished; Â§27.5 / Â§17.1 text updated

Task H3c. `src/components/common/InspectorPanel.tsx` is deleted; grep confirms no remaining imports
(only `RecordContent`/`FloatingWindow` remain). `docs/baseline-lines.json` records the deletion under
`removed` with the reason, so `check-shrink` stays meaningful (a deliberate deletion is not an
accidental shrink). SPEC-v10 Â§27.5 and Â§17.1 now describe the two-mode record view; the old wording
("sliding inspector panels", "inspector panels slide in") is superseded.

## D-H3 — two-mode record view (freeze label superseded)

Task H3. The freeze spec's "sliding inspector panel" is superseded by the two-mode record view per
SPEC-v10 Â§27.5. MODE A full page (`/view/:recordType/:id`, breadcrumb, no overlay); MODE B floating
window (Audit File chrome: draggable, minimisable, pop-out, shared origin/session). The mode is the
`record_view_mode` preference (default `full_page`). No blocking modal anywhere: the guard
`noBlockingModal.test.ts` enforces no `aria-modal` / `role="dialog"` / `fixed inset-0` outside the
allow-list of non-blocking surfaces.
How to reverse: restore `InspectorPanel.tsx`, the Â§27.5/Â§17.1 text and `App.tsx` from `8500602`;
remove `FloatingWindow`/`RecordView`/`RecordContent` and the guard entries.

## D-4B-M1 — no collision

Grep for `planning_sections`, `planning_suggestion_decisions`, `planning_reconciliation_acks`,
`populate_planning_suggestions`, `check_planning_reconciliation`, `sign_planning` found no existing
object, so 0025 creates rather than alters. `plans`/`plan_items`/`plan_versions` exist but are the
universe audit plan (a different shape), so they are not extended. No M1 collision.

## D-4B-scope — testing lock is a stage guard, not an edit guard

Task 4B says "Testing is locked until planning_sections for that engagement are signed off". The
existing fixtures (and the sealed-engagement tests) mark a testing workpaper `prepared` while no
planning is signed off, so a blanket guard on any UPDATE of a testing workpaper would break tests 12
and 14. Choice: the guard fires only when a workpaper is created in the testing stage or moved into
it (`tg_op = 'INSERT' or old.stage is distinct from 'testing'`). Editing a workpaper that is already
in testing is governed by 4E (sign-off/reopen). Reason: it enforces the spec's intent (no testing work
starts before Planning sign-off) without weakening the sealed-engagement tests. How to reverse: widen
the trigger condition in `guard_testing_lock` to any UPDATE.

## D-4B-four-eyes — signer must not have prepared every section

The spec requires "review by a role configured for that stage" (Â§10.4) and four-eyes is the house
pattern (D3). Choice: `sign_planning` requires `review_and_approve` and refuses when the signer is the
preparer of *every* section (they must not be the sole author). A signer who prepared some but not all
sections may sign; that mirrors the existing `sign_offs` four-eyes CHECK, which only forbids
`reviewer = preparer`. How to reverse: change the `v_self = v_sections` test to `v_self > 0`.

## D-4B-reconciliation — clean, or acknowledged with a reason

Â§10.1 blocks sign-off on a SIRA/Planning mismatch "until resolved". The task also says a discrepancy
may be "acknowledged with a recorded reason". Choice: `check_planning_reconciliation` returns true
only when every Planning risk is in the latest published SIRA; `sign_planning` proceeds when the gate
is true OR a `planning_reconciliation_acks` row with a >=10-character reason exists. If no SIRA cycle
is published, the Planning RCM risks cannot be reconciled, so the gate is false and an acknowledgement
is required — the strict reading of "the current SIRA". How to reverse: treat a missing cycle as
"nothing to reconcile" in `check_planning_reconciliation`.

## D-4C-M1 - existing objects extended, not duplicated

`populations` (0004) and the gate functions `enforce_population_gate` / `enforce_sample_row_gate`
(0006) already exist, so 0026 ALTERs the table (adding workpaper_id, filename, row_count, verified_at,
verified_by) and CREATE OR REPLACEs the two functions rather than adding parallel objects.

## D-4C-status - the status vocabulary is widened, not replaced

The task lists uploading/verifying/verified/locked/archived. The existing CHECK also allowed
pending/rejected, and `06_unverified_population.sql` writes both, so dropping them would weaken a
passing test. Choice: the CHECK is widened to `pending, uploading, verifying, verified, rejected,
locked, archived`. A `locked` population is still treated as verified by the L3 gate, so locking never
un-satisfies the population requirement.

## D-4C-row-count - verification demands a positive row count

Spec 11.1 says integrity checks precede VERIFIED. Choice: `verify_population` refuses `status='verified'`
unless `sha256` is non-empty and `row_count > 0`, and stamps `verified_at/by`. The seed fixtures and
test 06 are strengthened to carry a row count (a fixture change, not an assertion change). How to
reverse: drop the `row_count` clause from `verify_population`.

## D-4D-M1 - existing samples table extended

`samples` (0004) already exists with population_id, population_sha256, method, size_floor and a
`locked` boolean, so 0027 ALTERs it (workpaper_id, mode, seed, sample_rows jsonb, locked_at/by)
rather than creating a second samples table. `sample_rows` already exists as a TABLE.

## D-4D-column-name - samples.sample_rows is a jsonb column beside the sample_rows table

The task asks for a `sample_rows jsonb` column on the samples table, but `sample_rows` is already the
name of the per-row table from 0004. Postgres keeps columns and tables in separate namespaces, so both
coexist. The jsonb column stores the computed sample; the table holds the individual row conclusions
(4E extends it). How to reverse: rename the column (a breaking change for the API, so not preferred).

## D-4D-locked-immutability - a locked sample is never mutated

A locked sample is immutable (trigger `guard_locked_sample` refuses any UPDATE for an app role).
`replace_sample` never edits the locked row: it inserts a new sample and writes a ledger entry, exactly
as `replace_locked_population` does in 4C. This avoids the transaction-grant pattern the SIRA publish
needs, because nothing ever has to be edited in place.

## D-4D-seed - deterministic seed

System mode seeds from `sha256(population.sha256 || workpaper_id)` and orders population rows by
`md5(seed || row_ref)`, so the same verified population and workpaper always yield the same sample
(Â§11.2). A row's reported order is derived from the seed, never from `random()`.

## D-4D-sample-size - base size vs percentage

The org sampling table holds a base size and a percentage per (control_type, frequency, band). The
minimum sample size is `least(pop_count, greatest(base_size, ceil(pop_count * pct)))`. Reason: it
honours both a floor and a materiality percentage, and never asks for more rows than exist. How to
reverse: change the expression in `get_sample_size`.

## D-4E-M1 - a dedicated workpaper_rows table, test_rows left intact

The 0004 `test_rows` table is a thinner shape (workpaper_id, sample_row_id, result) and is written by
test 12 (sealed engagement). The task names a richer `workpaper_rows` table (row_ref, result,
rationale, exception_flag, prepared/reviewed). Choice: create `workpaper_rows` as the row-testing table
and leave `test_rows` untouched, because extending `test_rows` to the new shape would need every
existing column redefined and would risk the sealed-engagement test. How to reverse: migrate the
`test_rows` rows into `workpaper_rows` and drop `test_rows` (a later, owner-approved change).

## D-4E-four-eyes - the signer must not have prepared every row

Same pattern as 4B. `sign_off_workpaper` refuses when the signer prepared *every* row, mirroring the
`sign_offs` CHECK (reviewer <> preparer) at the workpaper level.

## D-4E-exception-default - a cross or unverifiable defaults to an exception

`record_workpaper_row` flags `cross`/`unverifiable` as exceptions by default (the caller may override).
Reason: Â§12 findings come from exceptions, and a non-tick result is by definition a departure. The
sign-off gate refuses an un-flagged exception.

## D-4E-status - workpaper status vocabulary

Added `status` with the task's values (open/sampling/locked/prepared/reviewed/signed_off). The 0004
`prepared` boolean is retained and set true on sign-off, so existing code that reads it keeps working.

## D-4D-CI-RACE - the 4D CI run was red because two runs shared the test project

Run 38897205611 (commit d54165e, 4D) failed at test 11 with "new row violates row-level security policy
for table sign_offs". Run 38897513403 (commit e2dc0bf, 4E) started while the 4D run was still going and
ran the SAME persistent test project. Its `provio_test.seed()` truncates `orgs cascade` and re-inserts
the fixtures; the two seeds interleaved, so `wp_a1` was briefly absent when the 4D run's test 11 ran.
The identical 4D code and test 35 pass in run 38897513403 (test 11 ok at 12:03:53). The failure is a
harness race, not a defect. Rule adopted: wait for the in-flight CI run to finish before dispatching the
next one (the test project is shared state). How to reverse: nothing to reverse; this is an operational
note.

## D-4F-M1 - no existing analyst-engine table or function

A grep for `analytics|analyst|check` found only TypeScript (`src/lib/analytics.ts`) and UI call sites.
No `analysis_results` table or `create_observation_stub` existed, so 0029 creates them (no collision).

## D-4F-stub - create_observation_stub is temporary (D-5A-STUB)

The task's dependency rule: until 5A's real `create_observation` exists, 4F calls a stub. The stub is a
SECURITY DEFINER RPC that stores the finding intent in `analysis_results` and validates that every row
reference belongs to a population in the caller's own org (the Â§12 guarantee that a check result
references only rows from the same org). 5A MUST replace it with the real `create_observation` and record
D-5A-STUB. It must not survive 5A.

## D-4F-engine-scope - checks are pure TypeScript

Every Â§12 check is a pure function in `src/lib/analyticsEngine.ts` with unit tests (no Math.random, no
AI, no I/O). Benford reports chi-square and MAD at the distribution level (rows are digits 1-9, not
population rows) because Benford is a distribution test, not a row test. How to reverse: change the
returned rows in `checkBenfordFirstDigit`.

## D-5A-STUB - the temporary stub is replaced and retired

4F's `create_observation_stub(uuid,uuid,text,jsonb,int[])` is gone. Migration 0030 renames its storage
role to the real RPC `record_analysis_result(...)` (same signature, same org-scope guarantee for row
references), drops `create_observation_stub` outright, and adds `raise_finding_from_result(...)`, which
stores the result and opens an observation carrying the rule id, params and row refs (Â§12). The Phase 4
data module and tests 37/38 now call the real names.
How to reverse: re-create the stub in a new migration (do not — the dependency rule forbids it).

## D-5A-M1 - observations/findings/issues already existed in 0004

A grep found `observations`, `findings` and `issues` created by `0004_testing.sql`. Migration 0030
ALTERs them (adds `workpaper_id`, `sections`, `status`, `severity_level_id`, `linked_*` columns and the
status CHECK) rather than creating new tables, per Migration Safety Rule M1.

## D-5A-status - the observation lifecycle vocabulary

`observations.status` is one of draft | submitted | finding | issue. A row is a draft until
`promote_to_finding` flips it to `finding`; the readability gate is what permits the flip.
`findings.status` defaults to `concluded`. How to reverse: adjust the CHECK and `promote_to_finding`.

## D-5A-tokens - severity colour is a design token, not a hex value

`severity_levels.color_token` is constrained to the design system's accent tokens
(--accent-cinnabar, --accent-brass, --accent-verdigris and their subtle variants). A hex value is refused
at the database (Â§14.4 "shown with its text label, never by colour alone"). How to reverse: edit the
`severity_levels_token_chk` CHECK if the design system gains tokens.

## D-5A-optional-sections - the four mandatory tags are hard-coded, the rest are org config

The four mandatory role tags (context, condition, effect, risk) are hard-coded in `check_readability`
exactly as Â§14.3 states. Optional tags (criteria, cause, recommendation, …) are read from the org's
`config_versions` key `methodology.required_sections` via `org_required_sections()`; when the key is
absent nothing extra is required. How to reverse: change the hard-coded array or the config key name.

## D-5A-files - files touched beyond those the task named

- `supabase/tests/00_lib.sql`: added `severity_levels` to `org_tables()` and seeded A/B severity rows, so
  the cross-org isolation tests (01/03/04) cover the new table.
- `supabase/tests/37_analyst_engine.sql`, `supabase/tests/38_phase4_acceptance.sql`: point at the renamed
  real RPC `record_analysis_result` (D-5A-STUB).
- `src/data/analytics.ts`, `src/data/phase4.test.ts`: same rename.
Reason: retire the temporary stub everywhere in one commit, as the 4F dependency rule requires.

## D-5B-M1 - no conclusion table existed; created rather than extended

Grep for `conclusion` in `supabase/migrations` found no table (only the `conclusion` text column on
`sample_rows` and the `stage` enum value). `conclusion_records` is therefore created in `0034`, not
extended. How to reverse: drop the table in a later migration.

## D-5B-testing-gate - Testing sign-off is derived, not stored

The task says `pull_exceptions` "can only run if Testing is signed off", but the task never defines a
Testing sign-off record. Options: (a) add a `testing_signed_off_at` column to `engagements`; (b) derive
it from the workpapers. Choice: (b) — `testing_signed_off(engagement)` is true when the engagement has
at least one workpaper and every workpaper is `signed_off` (0028 already stores that status). Reason:
one source of truth, no second flag to keep in step, and it matches Â§10.4 (a stage is signed off when
its work is signed off). How to reverse: add an explicit flag and change the function body.

## D-5B-opinion-config - overall opinion required or optional per org

Â§10.3 makes the overall opinion "optional, and configurable as required or optional". Choice: read the
org `config_versions` key `conclusion.opinion_required` (boolean); when absent the opinion is optional.
`sign_conclusion` refuses an empty opinion only when the key is true. How to reverse: change the key
name or the default.

## D-5B-files - files touched beyond those the task named

- `supabase/tests/00_lib.sql`: added `conclusion_records` to `org_tables()` so the cross-org isolation
  tests (01/03/04) cover the new table. Reason: the guard that a new tenant table is invisible to other
  orgs and to the platform role is only as strong as that list.

## D-5B-signoff-config - stage sign-off role is configurable per org AND per engagement

Owner clarification: which team role signs off each stage (Planning, Testing, Conclusion) is
configurable per organisation **and per engagement** (audit deployed) — it is not a universal
per-client setting. The task text for 5B only requires "four-eyes" plus the right. Implementation
keeps the enforcement on the right (`review_and_approve`), which is the only safe gate today, and
records the configuration as a follow-on: a per-engagement `stage_sign_off_roles` config that names
the role allowed to sign each stage, layered on top of the right. How to reverse: no code change is
needed to keep the current behaviour; adding the config narrows who may sign, never widens it.
Status: recorded, not yet built (see PHASE-48-BLOCKERS.md).

## D-6A-M1 - no report table existed; created rather than extended

Grep for `report` in `supabase/migrations` found no table. `report_versions` and `report_blocks` are
created in `0036`. How to reverse: drop the tables in a later migration.

## D-6A-blocks - the default template is a code-side constant, the sections are data

§15.2 names the default sections (Executive Summary · Scope and Objectives · Findings and Issues ·
Overall Opinion · Appendices). Choice: `compose_report` writes one block per default section, pulling
each from structured data (Planning scope, the entity's findings, the Conclusion opinion, the workpaper
index). A missing value becomes `is_placeholder=true` with `{"missing": "<field>"}`. Reason: the spec
requires the placeholder behaviour and computed figures; the per-tenant template table (§15.2
"Templates: each tenant has 1-3 templates") is deferred to 6H/NOT-DONE. How to reverse: read the
section list from a template row instead of the function body.

## D-6A-summary - the summary is computed, never stored

`compute_report_summary` returns counts computed live from `findings`, `issues` and `workpaper_rows`
(§15.2 step 2 "computed from the records, not typed"). Choice: a read function, not a materialised
column. Reason: a stored figure can drift from the records; the spec says compute. How to reverse:
snapshot the JSON onto `report_versions` at freeze time if the frozen report must be immutable.

## D-6B-M1 - no comment table existed; created rather than extended

Grep for `comment` in `supabase/migrations` found no report-comment table. `report_comments` is created
in `0037`. How to reverse: drop the table in a later migration.

## D-6B-resolution - a resolution carries a reason, a resolver and a four-eyes rule

§15.2 step 5 says each comment is "resolved as incorporated or rejected with a reason". Choice: the
CHECK `report_comments_resolution_chk` requires `resolved_at`, `resolved_by` and a non-empty
`resolution_reason` whenever the status is not `open`; `resolve_report_comment` adds four-eyes (the
resolver is not the commenter) and requires `review_and_approve`. Reason: matches the spec and mirrors
the four-eyes pattern used elsewhere. How to reverse: drop the CHECK and the four-eyes branch.

## D-6B-open-count - the freeze gate reads a count function, not a stored flag

§15.2 step 5 "The report cannot be frozen while any comment is unresolved." Choice:
`open_report_comment_count(version)` is a read function; `freeze_report` (6C) calls it. Reason: a stored
open-comment flag can drift; a count cannot. How to reverse: change `freeze_report` to read another
source.

## D-6D-M1 - cap_items exists as a stub; the §16 register is created as `caps`

Grep found `cap_items` (0004): `id, org_id, issue_id, action, due_date, status` — no finding link, no
evidence, no reviewer, no §16.2 status set. Options: (a) extend `cap_items` with the missing columns;
(b) create the §16 register as a new table. Choice: (b) — `caps` (0038). Reason: `cap_items` backs the
legacy demo seed and has a nullable `status` with no CHECK; bolting the §16 vocabulary onto it would
leave the old rows in an invalid state and mix two shapes. `caps` is the register the reconciliation
reads; `cap_items` is untouched legacy data. How to reverse: migrate `cap_items` rows into `caps` and
drop `cap_items`.

## D-6D-CAP - one CAP status vocabulary: the §16.2 database set

The mandatory decision the task requires. Earlier CAP work used Open → In progress → Pending validation
→ Overdue / Closed (src/types/index.ts `CapStatus`, src/lib/cap.ts `transitionCapStatus`). The register
uses the §16.2 set: open, unverified, verified_closed, verified_closed_delay, overdue_unverified.
Choice: option (a) from the task — map the UI states onto the §16.2 set and route every read/write
through one boundary, `capStatusToDb` / `capStatusFromDb` in src/lib/cap.ts (unit-tested).
Mapping:
  Open → open · In progress → open · Pending validation → unverified ·
  Overdue → overdue_unverified · Closed → verified_closed
Reason: the database is authoritative for the register; the UI keeps its familiar labels; one function
pair means no divergent status set. How to reverse: delete the two functions and the `caps` table.

## D-7A-M1 - no exports table or export function existed

Grep for `exports_log`, `log_export` and `export_*` found nothing. 0041 creates `exports_log`, the
`log_export` RPC and the per-object export functions (no collision). All export functions are
`security definer` and org-scoped, so a caller cannot export another tenant's data; `export_full_tenant`
additionally requires the `manage_users` right (§18, §26).

## D-7A-M1b - sign_offs keys on workpaper_id, not object_id

The first draft of `export_workpaper` read `sign_offs.object_id`; the harness refused the migration
(`column s.object_id does not exist`). 0004 defines `sign_offs.workpaper_id`. Fixed in 0041. Recorded
because it is the kind of column-name mismatch that only the SQL harness catches.

## D-7A-M1c - samples links to an engagement through workpaper_id, not engagement_id

`export_engagement_bundle` first read `samples.engagement_id`; the harness refused it. 0004 defines
`samples.population_id` and 0027 adds `samples.workpaper_id`; there is no `engagement_id`. Fixed by
joining `samples -> workpapers` on `workpaper_id`.

## D-7B-M1 - no import table or function existed

Grep for `import_jobs`, `start_import`, `validate_import`, `commit_import` found nothing. 0042 creates
them (no collision). `commit_import` writes entities and RCM risks directly; a users import records the
org membership only when the row carries a user id (invite delivery is out of scope, NOT-DONE
§email-dispatch); a populations import stages rows without creating a population, because the §6 gate
still requires a verified sha256 and row_count.

## D-7C-M1 - no archive table or function existed

Grep for `archive_jobs` and `archive_activity_period` found nothing. 0043 creates them (no collision).

## D-7C-append-only - the archive does not physically delete activity rows (L5 outranks the task step)

The task says `archive_activity_period` "deletes the archived rows from the live activity_log table".
L5 makes `activity_log` append-only: the `activity_log_append_only` trigger (0006_invariants.sql:43)
raises `append_only_violation` on any DELETE for every role, and the Laws outrank a task step (never
weaken an append-only invariant). The function therefore records the period, the row count, the content
hash, the storage path and a hash-chained ledger entry, and leaves the rows in place. The physical purge
is a separate owner-run maintenance step, recorded in NOT-DONE §activity-purge. How to reverse: add an
owner-only maintenance function that drops and recreates the trigger around a scoped delete.

## D-7C-right - archival requires manage_engagements

The task allows `manage_engagements` or a new platform-only right, and asks for the choice to be
recorded. 0043 requires `manage_engagements`. Reason: archiving is an org-scoped housekeeping action on
the org's own log; the platform role has no business deleting tenant rows. How to reverse: introduce a
platform-only right and swap the check in `archive_activity_period`.

## D-7C-storage - the archive upload is a stub

`archive_activity_period` records a `storage_path` and a `content_hash` and sets the job to `done`; the
Storage upload itself is deferred to an edge function (NOT-DONE §archival-storage). The ledger entry is
written now so the hash is accountable before the upload.

## D-6C-6D-order - 6D (CAP register) is built before 6C (freeze/issuance)

The task lists 6C before 6D, but 6C's `freeze_report` calls `check_cap_reconciliation`, and 6D states
that function "reads from caps, not from the report blocks". `caps` does not exist until 6D, so a
forward reference would be needed. Choice: build 6D first (migration 0038), then 6C (migration 0039).
Reason: migrations apply in filename order and a function cannot read a table that does not yet exist;
this is the dependency the task itself names. How to reverse: swap the two migrations if a future
change removes the dependency.

## D-5D-M1 - no evidence-file table existed; created rather than extended

Grep for `evidence`, `file_id` and `document` in `supabase/migrations` found no file table (evidence
was only a UI concept in `src/components/audit/EvidenceTab.tsx`). `evidence_files` is created in `0035`
as the minimal anchor for `document_extractions.file_id`. How to reverse: fold `evidence_files` into a
richer evidence model in a later migration and repoint the FK.

## D-5D-stage-filter - stage awareness is a cumulative set

Â§17.2 says Planning shows Planning documents, Testing shows Planning and Testing, Conclusion shows all.
Choice: `search_documents` maps the stage to a cumulative array (`planning` â†’ {planning}, `testing` â†’
{planning,testing}, `conclusion` â†’ all three) and filters `evidence_files.stage` against it. Reason: it
matches the spec sentence literally and keeps the filter in one place. How to reverse: change the CASE
in `search_documents`.

## D-5D-extraction-stub - extraction is a pending row, not real extraction

The task says "Extraction is async (called by an edge function stub — the stub writes a pending row and
returns; actual extraction is out of scope)". `request_extraction` writes a `pending` row and returns;
it never writes text. Real extraction and the edge function are recorded in NOT-DONE. How to reverse:
have the edge function write `extracted_text` and flip the status to `done`.



## D-7D-M1 - no prior-year import table or function existed

Grep for `prior_year_imports`, `import_prior_year_item`, `confirm_prior_year_item` found nothing. 0044
creates them (no collision). `import_prior_year_item` refuses any `item_type` outside the four allowed
values, so populations, samples, results, conclusions and evidence can never be imported (§19.2).

## D-7D-M1b - sign_planning is overridden to add the §19.2 gate

The task requires "sign_planning checks there are no imported_confirm items without confirmation". The
existing `sign_planning` lives in the landed migration 0025. Rather than edit a landed migration, 0044
re-issues it with `create or replace`, adding the `unconfirmed_prior_year_imports` gate. Reason: landed
migrations stay frozen; the newest migration owns the current definition. How to reverse: drop the 0044
definition and let 0025's version stand.

## D-7D-revert - revert_prior_year_item was added beyond the task text

The task names only `import_prior_year_item` and `confirm_prior_year_item`, but §19.2 UI needs a
"confirm-or-revert action per item". 0044 adds `revert_prior_year_item` (sets status='reverted', logs it)
so the UI has both actions. Recorded per the OVERNIGHT "may add steps" rule.

## D-8C-M1 - platform_enable_ai already existed (0031)

Grep found `platform_enable_ai(uuid, boolean, text)` in `0031_platform_control_plane.sql`, which already
sets `tenant_settings.ai_enabled` and `ai_model_endpoint` and writes `platform_trail`. It is extended with
`create or replace` in 0045 rather than created again (no duplicate function; M1 honoured).

## D-8C-ledger - the AI enablement also writes the org ledger

Task 8C requires "writes to platform_trail; writes to the org's ledger". 0031 wrote only the trail. 0045
extends the function to also call `append_ledger_entry(p_org, 'ai_enablement_changed', ...)`, which
bypasses RLS by design and runs as the owner. Reason: a tenant must be able to see, in its own
hash-chained ledger, that advisory features were switched on for it. How to reverse: drop 0045 and let
0031's definition stand (the platform trail entry remains either way).

## D-8E-coverage - Phase 8 DB was already present; 8E adds the acceptance suite

8A-8D were implemented earlier as migrations 0031/0033 with tests 40-42 and `src/data/platform.ts`. This
build verified the objects against the task text and added only what was missing (the 8C ledger write,
D-8C-ledger). Test 57 (8E) is the consolidated Phase 8 acceptance suite. No platform UI is built (8F is
data-only; the /superadmin UI is Phase 8.1, owner-designed - NOT-DONE).

## D-5C-manager - FloatingWindowManager generalises the Audit File window chrome

The Audit File window chrome is `common/FloatingWindow.tsx`. 5C wraps it in
`common/FloatingWindowManager.tsx`, which owns the array of open windows, per-window minimise state and
the bottom dock. `RecordView` (H3) and the App shell's inspector both render through the manager, so the
Audit File window and every other record use one chrome and one code path. A `renderWindow` override lets
`RecordView` supply its own children while the chrome stays identical. How to reverse: point `RecordView`
and `App.tsx` back at `FloatingWindow` directly and delete the manager.

## D-5C-allowlist - the noBlockingModal allow-list gains the manager

`FloatingWindowManager.tsx` contains no `aria-modal`, no `role="dialog"` and no `fixed inset-0` itself;
it renders `FloatingWindow`, which is already allow-listed. It was added to the allow-list pre-emptively
so a future dock badge that uses a fixed position does not false-fail the guard. How to reverse: remove
the entry if the manager never gains a fixed-position surface.

## D-4I-workspace - the Phase 4 workspace is a second view inside the Audit File

The Audit File window already carried a seed-backed Overview (Planning / Execution / Review). 4I adds a
"Testing workspace" view inside the same window (data-testid `audit-file-view-workspace`) that mounts the
database-backed Phase 4 panels: PlanningPanel (plan/), PopulationPanel, SamplingPanel, RowTestingPanel and
AnalystEnginePanel (audit/). This keeps the engagement card as the single entry point and does not add a
tab to the navigation strip (SPEC 5 locks seven tabs). How to reverse: delete the view switch and the five
panel mounts from AuditFileModal.tsx; the panels and their data modules remain.

## D-4I-M1 - the workspace reuses existing tables, no new migration

grep found populations (0004/0026), samples (0004/0027), workpaper_rows (0028), analysis_results and
planning_sections/planning_suggestion_decisions (0025/0029/0030) all already exist with RLS. 4I is UI only;
no migration is added and no object is duplicated (M1). Every write goes through the 4B-4F RPCs, except
population registration (below).

## D-4I-population-write - population registration inserts through the data module

No register_population RPC exists; 0026 creates populations through a direct insert and the RLS policy
`populations_write` allows an authenticated org member to insert. `registerPopulation` in
src/data/population.ts performs that insert with the browser-computed SHA-256 and row count, which the
`verify_population` trigger accepts only when both are present. Components never import the Supabase client
(M8). How to reverse: add a `register_population` RPC in 0026 and call it from the data module.

## D-5G-workspace - Phase 5 screens are further views inside the Audit File

5G adds three more views to the Audit File window alongside 4I's testing workspace: "Findings & Issues"
(FindingsPanel), "Conclusion" (ConclusionPanel) and "Documents" (DocumentViewerPanel). No new navigation
tab is added (SPEC 5 locks seven tabs); the engagement card remains the single entry point. The document
viewer is a right-side non-blocking panel with a toggleable list, not a modal (SPEC 17.2). How to reverse:
delete the three view branches and their imports from AuditFileModal.tsx.

## D-5G-M1 - no new objects; the panels call the existing 5A-5D RPCs

grep found every object the Phase 5 screens need already exists: observations/findings/issues/severity_levels
(0030), conclusion_records and pull_exceptions/sign_conclusion (0034), evidence_files/document_extractions
and search_documents (0035). 5G is UI only: no migration is added and nothing is duplicated (M1). Every
write goes through a right-checked RPC (promote_to_finding, create_issue, pull_exceptions, sign_conclusion,
request_extraction) and every read through the RLS-scoped tables via src/data (5F).

## D-5G-opinion - the conclusion opinion is set through the existing table, not a new RPC

sign_conclusion reads overall_opinion from conclusion_records but no setter RPC exists (0034 exposes only
pull_exceptions, remove_conclusion_exception and sign_conclusion). 5G does not add one: the opinion is
optional unless the org config requires it, and the required value is written by the SQL path the tests use.
A dedicated set_overall_opinion RPC is recorded as future work rather than invented here, so the UI keeps
the sign button gated on the same preconditions the database enforces. How to reverse: add the RPC and a
text field to ConclusionPanel.

## D-5G-residue - global-setup clears the Phase 5 tables

The Playwright run writes findings, observations, issues, conclusion_records, evidence_files and
document_extractions; global-setup now deletes them per org (M5), children before parents, so a run does
not change what the next run observes.

## D-6H-hold - HoldToConfirm is a new shared non-blocking control

§27.5 allows hold-to-confirm as the alternative to a blocking modal but no such component existed
(grep found none). 6H adds src/components/common/HoldToConfirm.tsx: an in-place button with a progress
fill, no scrim and no dialog attribute. It is not added to the noBlockingModal allow-list because it
contains none of the banned strings. How to reverse: delete the component and its uses.

## D-6H-workspace - the report and CAP register are further Audit File views

6H adds two more views to the Audit File window: "Report" (ReportEditorPanel) and "CAP register"
(CapRegisterPanel), alongside the 4I/5G views. No new navigation tab (SPEC §5 locks seven). How to
reverse: delete the two view branches and their imports from AuditFileModal.tsx.

## D-6H-M1 - no new DB objects; the panels call the existing 6A-6E RPCs

grep found every object the Phase 6 screens need already exists: report_versions/report_blocks and
compose_report/compute_report_summary (0036), report_comments and the add/resolve RPCs (0037), caps and
update_cap/close_cap/check_cap_reconciliation (0038), email_queue (0039), freeze_report/issue_report
(0040). 6H is UI only: no migration, nothing duplicated (M1).

## D-6H-preflight - the freeze pre-flight mirrors the database gate, it does not replace it

The panel computes `canFreeze = openComments === 0 && capOk === true` and disables the hold-to-confirm
button, but freeze_report still enforces both gates in the database. The UI is a courtesy check; the
authority stays in SQL. How to reverse: delete the pre-flight block; the database would still refuse.

## D-6H-residue - global-setup clears the Phase 6 tables

The Playwright run composes reports and writes comments, blocks and CAP rows; global-setup now deletes
report_comments, report_blocks, report_versions, caps and email_queue per org (M5), children before
parents.

## D-E2E-SCOPE - the audit-side Playwright users are unscoped, so the tenant seed is reachable

Root cause of the red CI on 811b2f1 (4I), 389a1e1 (5G) and bc08485 (6H): `useScopedData` filters the
tenant seed through `src/lib/access.ts`, and `canAccessUniverse` returns false when the session's
`universeIds` are non-empty and do not contain the seed universe id. The harness gave bilal.ahmed a
`user_scopes` row pointing at the synthetic universe `A_U1` (`f011bd6c-…`), but the tenant seed's
universes are `u-gbm` / `u-rdb`. Every seeded engagement was therefore filtered out, `AuditFileTab`
rendered no `audit-card-*`, and each phase4/5/6 spec failed at `expect(card).toBeVisible()`.

Decision: leave the audit-side users (bilal.ahmed, sana.iqbal, fatima.rehman) with **no** `user_scopes`
row. An empty `universeIds` list is the documented "all universes in the organisation" path in
`access.ts`, so the seed is reachable. ayesha.khan and hamza.qureshi keep a scope row so `rls.spec.ts`
still observes non-empty `user_scopes` for its own org (that test asserts `rows.length > 0`).

Options considered: (a) re-point `user_scopes` at the seed universe ids `u-gbm`/`u-rdb` - rejected,
those ids are not valid uuids, the column is `uuid`, and the seed is app-side only; (b) leave the scope
rows and seed real universes into the test project - rejected, outside a harness fix and it would change
the product's seed contract. Chosen (c) unscoped audit users: smallest change, no product behaviour
touched.

How to reverse: restore `universes: [A_U1]` / `[B_U1, B_U2]` / `[B_U1]` in the `USERS` table of
`e2e/global-setup.ts` and delete the `.filter((u) => u.universes.length > 0)` guard on the scope insert.

## D-E2E-PRINCIPAL - the Phase 5 and 6 specs use an audit-rights principal, not the org admin

`phase5.spec.ts` and `phase6.spec.ts` signed in as `ayesha.khan` (org_admin) and then opened the Audit
Files tab. An org_admin holds no audit right, so `NavStrip` shows it zero audit tabs by design - asserted
by `smoke.spec.ts` ("org admin sees no audit tabs"). Those specs could never pass. Decision: both specs
now sign in as `bilal.ahmed` (preparer, holds `perform_work`), the same principal the other audit-side
specs use.

How to reverse: restore the `ORG_ADMIN_EMAIL` / `APPROVER_EMAIL` constants in the two specs.

## D-E2E-PLACEHOLDER - the 4I/5G/6H progress rows carried `_this_`/`_CI_`

The three UI tasks were committed with placeholder values in `docs/PHASE-48-PROGRESS.md` and their CI
was in fact red, so "done" was never true for them. This commit corrects the rows to real commit hashes
and CI run IDs (4I `811b2f1`, 5G `389a1e1`, 6H `bc08485`) and marks them `fixed` with run
`39023767418` (all 7 gate steps green, Playwright included). How to reverse: n/a (documentation
correction).
