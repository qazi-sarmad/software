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
Reason: §24 requires a platform role with no tenant business access; the tenant boundary is rights,
so the one exception is scoped to platform-only functions and platform-only tables.
Reverse: remove the `platform_admin` branch from the Phase 8 functions; nothing in Phases 4–7 reads it.

## D-H0-USERS

`e2e/global-setup.ts` already creates `ayesha.khan@provio-test.invalid` (Org A `org_admin`) and
`bilal.ahmed@provio-test.invalid` (Org A `preparer`). No new users are created for this build; the
Playwright tests use these two. Reason: they already exist and the setup is idempotent.
Reverse: revert the `e2e/` changes of this build.

## D-H2 — nav labels

Task H2. Unclear point: the code used freeze-spec tab labels that differ from SPEC-v10 §5.
Options: keep the old labels; or adopt §5.
Choice: §5 wins. Mapping applied — Executive Summary → Dashboard; Pending Tasks → Work Queue;
Audit File (tab) → Audit Files; Issues Register → Issues & CAP Register. Audit Universe, Audit Plan
and SIRA are unchanged.
Reason: SPEC-v10 is the authoritative spec (§5 "Primary navigation"). Old freeze labels
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
configuration, not per-user state). Guard allow-list: `AuditFileModal.tsx` (§17.1 window chrome,
explicitly non-blocking), the global command palette (§5, Ctrl/⌘ K — transient, Esc-dismissed),
`HeaderCalendarPanel.tsx` (anchored popover, `role="dialog"` but no scrim, no focus trap; the page
stays usable). `ConfirmPanel.tsx` remains an allowed name for when the hold-to-confirm panel lands
(§27.5 names it). `InspectorPanel.tsx` is a genuine blocking modal and is in a TEMPORARY list that
H3c empties when the file is abolished.
Reason: ascribing blocking-modal status to a file that does not exist would hide the real offenders;
the guard must scan actual code while keeping the two surfaces §27.5 explicitly permits.
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
Choice: (b). No new dependency (no major bump; §28 spirit). `AppRoutes` now recognises
`/view/:recordType/:id` and renders the record behind the auth gate through `RecordPage`, which
reuses the shared `RecordContent`. `RECORD_TYPE_TO_INSPECTOR` maps `engagement→audit_file`,
`workpaper→workbench`, `observation→observation`, `cap→cap_inspector`.
Files touched beyond the task list (D-H3b-files): `src/App.tsx` (inspector render switched from the
blocking `InspectorPanel` to `FloatingWindow`; removed the shell scale-down that signalled a modal;
added the `/view` route); new `src/components/common/RecordContent.tsx`,
`src/components/common/FloatingWindow.tsx`, `src/components/common/RecordView.tsx`,
`src/hooks/useRecordViewMode.ts`; `src/guards/noBlockingModal.test.ts` (allow-list widened).
Reason: extracting the content renderer keeps both modes identical and lets the guard scan the real
overlay surfaces.
How to reverse: restore `src/App.tsx` from `ae92f3b` and delete the four new files.

## D-H3c — InspectorPanel abolished; §27.5 / §17.1 text updated

Task H3c. `src/components/common/InspectorPanel.tsx` is deleted; grep confirms no remaining imports
(only `RecordContent`/`FloatingWindow` remain). `docs/baseline-lines.json` records the deletion under
`removed` with the reason, so `check-shrink` stays meaningful (a deliberate deletion is not an
accidental shrink). SPEC-v10 §27.5 and §17.1 now describe the two-mode record view; the old wording
("sliding inspector panels", "inspector panels slide in") is superseded.

## D-H3 — two-mode record view (freeze label superseded)

Task H3. The freeze spec's "sliding inspector panel" is superseded by the two-mode record view per
SPEC-v10 §27.5. MODE A full page (`/view/:recordType/:id`, breadcrumb, no overlay); MODE B floating
window (Audit File chrome: draggable, minimisable, pop-out, shared origin/session). The mode is the
`record_view_mode` preference (default `full_page`). No blocking modal anywhere: the guard
`noBlockingModal.test.ts` enforces no `aria-modal` / `role="dialog"` / `fixed inset-0` outside the
allow-list of non-blocking surfaces.
How to reverse: restore `InspectorPanel.tsx`, the §27.5/§17.1 text and `App.tsx` from `8500602`;
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

The spec requires "review by a role configured for that stage" (§10.4) and four-eyes is the house
pattern (D3). Choice: `sign_planning` requires `review_and_approve` and refuses when the signer is the
preparer of *every* section (they must not be the sole author). A signer who prepared some but not all
sections may sign; that mirrors the existing `sign_offs` four-eyes CHECK, which only forbids
`reviewer = preparer`. How to reverse: change the `v_self = v_sections` test to `v_self > 0`.

## D-4B-reconciliation — clean, or acknowledged with a reason

§10.1 blocks sign-off on a SIRA/Planning mismatch "until resolved". The task also says a discrepancy
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
(§11.2). A row's reported order is derived from the seed, never from `random()`.

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
Reason: §12 findings come from exceptions, and a non-tick result is by definition a departure. The
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
reference belongs to a population in the caller's own org (the §12 guarantee that a check result
references only rows from the same org). 5A MUST replace it with the real `create_observation` and record
D-5A-STUB. It must not survive 5A.

## D-4F-engine-scope - checks are pure TypeScript

Every §12 check is a pure function in `src/lib/analyticsEngine.ts` with unit tests (no Math.random, no
AI, no I/O). Benford reports chi-square and MAD at the distribution level (rows are digits 1-9, not
population rows) because Benford is a distribution test, not a row test. How to reverse: change the
returned rows in `checkBenfordFirstDigit`.

## D-5A-STUB - the temporary stub is replaced and retired

4F's `create_observation_stub(uuid,uuid,text,jsonb,int[])` is gone. Migration 0030 renames its storage
role to the real RPC `record_analysis_result(...)` (same signature, same org-scope guarantee for row
references), drops `create_observation_stub` outright, and adds `raise_finding_from_result(...)`, which
stores the result and opens an observation carrying the rule id, params and row refs (§12). The Phase 4
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
at the database (§14.4 "shown with its text label, never by colour alone"). How to reverse: edit the
`severity_levels_token_chk` CHECK if the design system gains tokens.

## D-5A-optional-sections - the four mandatory tags are hard-coded, the rest are org config

The four mandatory role tags (context, condition, effect, risk) are hard-coded in `check_readability`
exactly as §14.3 states. Optional tags (criteria, cause, recommendation, …) are read from the org's
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
one source of truth, no second flag to keep in step, and it matches §10.4 (a stage is signed off when
its work is signed off). How to reverse: add an explicit flag and change the function body.

## D-5B-opinion-config - overall opinion required or optional per org

§10.3 makes the overall opinion "optional, and configurable as required or optional". Choice: read the
org `config_versions` key `conclusion.opinion_required` (boolean); when absent the opinion is optional.
`sign_conclusion` refuses an empty opinion only when the key is true. How to reverse: change the key
name or the default.

## D-5B-files - files touched beyond those the task named

- `supabase/tests/00_lib.sql`: added `conclusion_records` to `org_tables()` so the cross-org isolation
  tests (01/03/04) cover the new table. Reason: the guard that a new tenant table is invisible to other
  orgs and to the platform role is only as strong as that list.

## D-5B-signoff-config - stage sign-off role is configurable per org AND per engagement

Owner clarification: which team role signs off each stage (Planning, Testing, Conclusion) is
configurable per organisation **and per engagement** (audit deployed) � it is not a universal
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

�15.2 names the default sections (Executive Summary � Scope and Objectives � Findings and Issues �
Overall Opinion � Appendices). Choice: `compose_report` writes one block per default section, pulling
each from structured data (Planning scope, the entity's findings, the Conclusion opinion, the workpaper
index). A missing value becomes `is_placeholder=true` with `{"missing": "<field>"}`. Reason: the spec
requires the placeholder behaviour and computed figures; the per-tenant template table (�15.2
"Templates: each tenant has 1-3 templates") is deferred to 6H/NOT-DONE. How to reverse: read the
section list from a template row instead of the function body.

## D-6A-summary - the summary is computed, never stored

`compute_report_summary` returns counts computed live from `findings`, `issues` and `workpaper_rows`
(�15.2 step 2 "computed from the records, not typed"). Choice: a read function, not a materialised
column. Reason: a stored figure can drift from the records; the spec says compute. How to reverse:
snapshot the JSON onto `report_versions` at freeze time if the frozen report must be immutable.

## D-5D-M1 - no evidence-file table existed; created rather than extended

Grep for `evidence`, `file_id` and `document` in `supabase/migrations` found no file table (evidence
was only a UI concept in `src/components/audit/EvidenceTab.tsx`). `evidence_files` is created in `0035`
as the minimal anchor for `document_extractions.file_id`. How to reverse: fold `evidence_files` into a
richer evidence model in a later migration and repoint the FK.

## D-5D-stage-filter - stage awareness is a cumulative set

§17.2 says Planning shows Planning documents, Testing shows Planning and Testing, Conclusion shows all.
Choice: `search_documents` maps the stage to a cumulative array (`planning` → {planning}, `testing` →
{planning,testing}, `conclusion` → all three) and filters `evidence_files.stage` against it. Reason: it
matches the spec sentence literally and keeps the filter in one place. How to reverse: change the CASE
in `search_documents`.

## D-5D-extraction-stub - extraction is a pending row, not real extraction

The task says "Extraction is async (called by an edge function stub — the stub writes a pending row and
returns; actual extraction is out of scope)". `request_extraction` writes a `pending` row and returns;
it never writes text. Real extraction and the edge function are recorded in NOT-DONE. How to reverse:
have the edge function write `extracted_text` and flip the status to `done`.

