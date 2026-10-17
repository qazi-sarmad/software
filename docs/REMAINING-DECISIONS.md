# Remaining build ŌĆö decisions

Decision order: (a) `docs/SPEC-v10.md`; (b) the Laws; (c) the simplest option that obeys the Laws;
(d) best for multi-tenant, auditable, configuration-not-code, deterministic. Never an option that
weakens RLS, the population gate, the ledger, the hash chains or a test.

Entry format: number, task, unclear point, options, choice, reason, how to reverse.

---

## D-R1-M2 ŌĆö add `drop policy if exists` before every `create policy`

Task R1a. Unclear point: migration `0008_rls.sql` relied on a single `do $$` loop that drops every
policy in `public` before recreating them, so no individual `create policy` had its own preceding
`drop policy if exists`. When two CI runs share the test project, the loop in run B can drop policies
that run A has just created, then run A's `create policy` fails with `already exists`
(the observed red: `policy "platform_trail_select" for table "platform_trail" already exists`).
Options: (1) rely on the drop-all loop; (2) add an explicit `drop policy if exists` before every
`create policy` (M2 form).
Choice: option 2. All 59 `create policy` statements in `0008_rls.sql` now have a preceding
`drop policy if exists` of the same name. The drop-all loop stays as belt-and-braces.
Reason: M2 requires each object to be dropped before it is (re)created; that makes the file
idempotent per-statement and safe under concurrency.
How to reverse: delete the 59 inserted `drop policy if exists ...;` lines; the drop-all loop at the
top of `0008_rls.sql` still makes the file idempotent on a single-run basis.

## D-R1-concurrency ŌĆö serialise CI runs on the shared test project

Task R1b. Unclear point: CI had no `concurrency` block, so a `pull_request` run and a
`workflow_dispatch` run (or two pushes) applied migrations to the same hosted project at the same
time. The observed evidence: `workflow_dispatch` runs 39042335625 and 39051278754 are green, while
`pull_request` runs 39042338419 and 39051278442 on the *same SHAs* are red at step 6.
Options: (1) per-run scratch schema/database; (2) a workflow-level `concurrency` group that
serialises runs and never cancels in progress.
Choice: option 2 ŌĆö `concurrency: { group: provio-test-db, cancel-in-progress: false }`.
Reason: the hosted project is a single shared database the owner controls; a scratch DB per run is
not available (the secret points at one project). `cancel-in-progress: false` avoids killing a run
half-way through migrations, which would leave partial DDL behind.
How to reverse: remove the `concurrency` block from `.github/workflows/ci.yml`.

## D-R3-patch ŌĆö the root `.patch` file was already removed; nothing to `git rm`

Task R3. Unclear point: the task says `git rm` the root file
`0001-Slice-A-org-methodology-config-RCM-key-risk-coverage.patch`, but it is not in the working tree
or in `HEAD`. Options: (1) treat the task as blocked; (2) confirm it was already removed and record
that, removing nothing.
Choice: option 2. `git log` shows the file was added in `9ea4a8b` and deleted in `23d915a`
("ops: remove AI provenance from tracked files (C0b)"), before this run. `git ls-files` and
`git cat-file -e HEAD:<path>` both confirm it is absent. A `git rm` of a non-existent path would fail.
Reason: removing nothing is the correct action when the object is already gone; recreating and
re-removing it would add noise.
How to reverse: none needed. The file is not tracked at any point reachable from this branch.

## D-R3-reference-v1 ŌĆö remove `docs/reference/v1` (no source references)

Task R3. Unclear point: whether the read-only v1.7 reference tree is safe to delete. Grepped `src`,
`e2e`, `scripts`, `supabase`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`,
`playwright*.config.ts`, `package.json` and the CI workflows for `docs/reference` ŌĆö the only
reference anywhere was a prose mention in `docs/HANDOFF.md` (no import, no path in any config or
script). Options: (1) keep the tree; (2) `git rm -r` it and update the prose.
Choice: option 2. Removed the 60 tracked files under `docs/reference/v1/` and updated the HANDOFF
"Reference Archive" note to say it was removed and why.
Reason: it is dead weight (648K, 60 files) with zero code references; the v1.7 behaviour it mirrored
already lives in `src/`. The build brief explicitly names it for removal.
How to reverse: `git revert` this commit, or `git checkout <pre-R3-commit> -- docs/reference/v1`.

## D-R3-HANDOFF ŌĆö the prose reference is edited, not deleted

Task R3. Unclear point: `docs/HANDOFF.md` still described the reference tree as present.
Options: (1) leave the stale sentence; (2) update it.
Choice: option 2 ŌĆö the sentence now states the tree was removed in R3 and that `docs/` stays excluded
from `tsconfig`/`vitest`/gate scripts.
Reason: a handoff doc that points at a deleted path is worse than no sentence.
How to reverse: `git checkout <pre-R3-commit> -- docs/HANDOFF.md`.

## D-R4-palette ŌĆö command palette becomes a non-blocking dropdown

Task R4a. Unclear point: how to keep Ctrl/Ōīś+K and the existing search behaviour while removing the
blocking scrim. Options: (1) keep the centred overlay with a scrim but drop `aria-modal`;
(2) render the palette as a dropdown anchored under the header, no scrim.
Choice: option 2. The palette is now `fixed top-14 left-0 right-0` with `pointer-events-none` on the
wrapper and `pointer-events-auto` on the panel; the page behind stays reachable. Escape still closes
(the existing keydown handler) and an outside click now also closes (a new `pointerdown` listener
that ignores clicks inside the panel). Ctrl/Ōīś+K is unchanged.
Reason: ┬¦27.5 bans blocking modals; an anchored dropdown is the documented non-blocking pattern and
keeps the command palette usable while the user reads the page behind it.
How to reverse: restore the previous render block (centred `fixed inset-0` wrapper + scrim
`motion.div` with `onClick={onClose}`) and delete the outside-click effect. No test asserted the
scrim, so no test change is required to reverse.
No tests were updated: grep found no test that asserted the palette backdrop (the only `backdrop`
assertion in the repo is `FloatingWindow.test.tsx`, which is unrelated). A new
`CommandPalette.test.tsx` asserts the non-blocking contract.

## D-R4-calendar ŌĆö calendar panel keeps a popover, loses the modal role

Task R4b. Unclear point: `HeaderCalendarPanel` used `role="dialog"` but rendered no scrim and no
focus trap, so it never blocked the page. Options: (1) keep `role="dialog"` and allow-list it;
(2) change the role to a non-modal one.
Choice: option 2 ŌĆö `role="region"` with the same `aria-label="Audit Calendar Panel"`. The panel
already used `position: fixed` (not `fixed inset-0`), so it was never full-viewport and never had a
backdrop.
Reason: the task says to make it non-blocking if a dialog role or backdrop blocks the page, and to
record why if it is kept. It does not block, so keeping a modal role would be a false claim in the
accessibility tree. `region` is accurate for an anchored popover. It is therefore no longer in the
allow-list, which now holds exactly the four non-blocking chrome files the task names.
How to reverse: set `role="dialog"` again and re-add `calendar/HeaderCalendarPanel.tsx` to ALLOWED in
`src/guards/noBlockingModal.test.ts`.

## D-R4-guard ŌĆö allow-list is exactly the four non-blocking chrome files

Task R4c. Unclear point: the guard previously allow-listed `CommandPalette.tsx` and
`HeaderCalendarPanel.tsx` (plus `AuditFileModal.tsx`). Options: (1) leave the wide list; (2) shrink it
to the files that are non-blocking by construction.
Choice: option 2 ŌĆö ALLOWED is exactly `FloatingWindow.tsx`, `FloatingWindowManager.tsx`,
`RecordView.tsx`, `ConfirmPanel.tsx` (the last may not exist yet; a Set entry for a missing file is
harmless). `CommandPalette.tsx`, `HeaderCalendarPanel.tsx` and `AuditFileModal.tsx` are removed
because none of them contains a banned token any more, so allow-listing them would be dead entries
that hide a future regression.
Reason: a guard whose allow-list is wider than necessary stops being a guard.
How to reverse: re-add any file to ALLOWED if a legitimate non-blocking surface reintroduces a
banned token.

## D-R5a-role-guard ŌĆö widen the role guard, keep the same allow-list

Task R5a. Unclear point: the task says "extend the role guard: comparisons such as `role === 'cia'`
fail" and to list the DISPLAY/SCOPE files in the test. The existing guard already caught
`role === '<slug>'` for the seven org roles. Options: (1) report it already complete and change
nothing; (2) widen the pattern and add the platform and team-role cases, then verify empirically that
no production file regresses.
Choice: option 2. Added `platform_admin` to the role-name alternation, added a `teamRole` comparison
pattern (`lead`, `preparer`, `reviewer`, `observer`), and widened the field matcher to
`role|user_role|role_slug|slug`. Added a `team-role` self-check and a `platform_admin` self-check.
Verified with a standalone grep over `src/**` that the broadened patterns return **zero** offenders,
so the extension changes no behaviour and only ratchets future code.
Reason: the guard is a prohibition, and the platform/team roles were genuine gaps. Widening a
prohibition is always allowed; the task explicitly asks for it.
How to reverse: `git checkout <pre-R5-commit> -- src/guards/noRoleStrings.test.ts`.

## D-R5a-allowlist ŌĆö DATA_FILES is the DISPLAY/SCOPE list from ROLE-CHECKS.md

Task R5a. Unclear point: which files may legitimately contain role-name literals. Options: (1) list
them loosely; (2) name exactly the DISPLAY/SCOPE files in `docs/ROLE-CHECKS.md`.
Choice: option 2 ŌĆö `types/index.ts`, `lib/rights.ts`, `data/client.ts`, `data/demoSeed.ts`,
`data/initialData.ts`, `context/AppContext.tsx`, `App.tsx`,
`components/glassbox/GlassBoxPublicRoute.tsx`, `test/testUsers.ts`. The last four were added to the
previous four-file list because they carry role slugs as seed/label data (`initialData`, `demoSeed`,
`AppContext` demo user, `App`, GlassBox `actorRole`) with no comparison.
Reason: the task asks for the allowed files to be listed in the test, and ROLE-CHECKS.md already
classifies them. An entry only exempts a file from the comparison scan; it does not permit a
comparison to be added there unnoticed, because these files hold literals, not comparisons.
How to reverse: remove the added entries and re-run; the guard will list any file that then fails.

## D-R5b-singleClient ŌĆö guard confirmed present and green, no change

Task R5b. Unclear point: none. Ran `npx vitest run src/guards/singleClient.test.ts` on the head; it
passes (3 tests). No edit made.
Reason: the task says "confirm", not "create".
How to reverse: n/a.

## D-R6c-passwords ŌĆö one random password per synthetic user per run

Task R6c (NOT-DONE #3). Unclear point: `global-setup.ts` generated **one** random password per run
and set it on all five users; specs read it from `process.env.E2E_PASSWORD`. Options: (1) keep one
shared password; (2) give each user its own random password and hand each spec the one it needs.
Choice: option 2. `global-setup.ts` now builds a `passwords` map (`passwordFor(email)` memoises a
fresh `generatePassword()` per address) and writes it to `e2e/.auth/passwords.json`, which is
git-ignored (`e2e/.auth/` added to `.gitignore`). A new `e2e/password.ts` exports
`passwordFor(email)`, which reads that file; every spec's `signIn` and the `rls.spec.ts` API sign-in
now call `passwordFor(email)` instead of `process.env.E2E_PASSWORD`. `E2E_PASSWORD` and `E2E_EMAIL`
are gone; `smoke.spec.ts`'s default email is now the literal org-admin address.
Reason: the task requires one password per user per run so one leaked value opens only one account.
A file is the only channel from `globalSetup` (its own process) to the workers; it is git-ignored so
no secret is committed. The values are ephemeral (regenerated every run) and set on synthetic users
only.
How to reverse: delete `e2e/password.ts` and `e2e/.auth/` from `.gitignore`, restore the single
`const password = generatePassword(); process.env.E2E_PASSWORD = password;`, and restore
`process.env.E2E_PASSWORD` in each spec.

## D-R6d-browsers — Firefox and WebKit run on dispatch only; normal CI stays Chromium

Task R6d (NOT-DONE #4, #9). Unclear point: adding Firefox and WebKit to `projects` would make the
normal CI step 7 run all three engines on every push, tripling the slowest step. Options: (1) add the
projects and leave `npx playwright test` to run all three; (2) add the projects but pin normal CI to
`--project=chromium`, and add a separate `workflow_dispatch` workflow that runs the other engines.
Choice: option 2. `playwright.config.ts` declares `chromium`, `firefox` and `webkit`. CI step 7 now
runs `npx playwright test --project=chromium`, so its behaviour is byte-for-byte the same as before.
A new `.github/workflows/browsers.yml` (dispatch only, `browser` input `firefox`/`webkit`/`all`)
installs those engines and runs the matching project(s). It shares the `provio-test-db` concurrency
group so it cannot race the main CI against the shared test database.
Reason: the task says to run the browsers "in a new .github/workflows/browsers.yml on
workflow_dispatch only". Pinning the main CI keeps it fast and deterministic; the cross-browser run
is opt-in.
How to reverse: delete `browsers.yml`, remove the two projects from `playwright.config.ts`, and drop
`--project=chromium` from CI step 7.

## D-R6d-nolocalrun — cross-browser results not yet observed

Task R6d. Unclear point: the task says "Record results". Firefox and WebKit are not installed in this
sandbox (only Chromium), and installing them plus running the full suite is a long download; the
workflow is dispatch-only and this run is time-boxed. Options: (1) install the engines locally and
run; (2) record that the workflow exists and is dispatch-only, and that no browser-specific result is
claimed.
Choice: option 2 for this commit. The workflow is the deliverable; the first dispatched run records
the result. No browser-specific failure is claimed or hidden, and no test was weakened.
Reason: the brief forbids reporting a check that was not run. The honest record is "workflow added,
not yet dispatched".
How to reverse: dispatch `browsers.yml` with `browser=all` and record the run ID here.

## D-R6e-cleanup — e2e residue cleanup already covers the named tables

Task R6e (M5). Unclear point: the task asks to remove `invite_cap_events` and any population or
sample rows the e2e created. Options: (1) add new deletes; (2) confirm the existing setup-time cleanup
already does it.
Choice: option 2. `e2e/global-setup.ts` already deletes, scoped to the two synthetic orgs:
`invite_cap_events`, `workpaper_rows`, `sample_rows`, `samples`, `population_rows`, `populations`,
`analysis_results`, `planning_sections`, `planning_suggestion_decisions`, plus the Phase 5–7 tables.
The cleanup runs at the start of each run, so the database is left clean between runs (M5).
Reason: no new delete is needed; adding duplicates would be noise.
How to reverse: n/a.

## D-R6a-users — which account drives the R6a Playwright tests

Task R6a. Unclear point: the task names `ayesha.khan`, but the SIRA and Audit Plan screens are gated
by `hasAnyAuditRight`, and the `org_admin` account (`ayesha.khan`) holds no audit right, so it sees
no audit tabs and cannot reach either screen. Options: (1) grant the org_admin an audit right (a
rights change, out of scope); (2) drive the flows with the preparer account (`bilal.ahmed`), which
holds `perform_work` and so sees the seven audit tabs.
Choice: option 2. The R6a e2e tests sign in as `bilal.ahmed@provio-test.invalid`. This matches the
Phase 3 e2e precedent (3J uses the preparer for the audit tabs).
Reason: rights, never role names. Widening a role's rights to satisfy a test would weaken the rights
model; the test should use the account that actually holds the right.
How to reverse: change `PREPARER_EMAIL` in `e2e/r6.spec.ts` back to the org_admin and grant that role
the relevant audit right in `src/lib/rights.ts` / the DB.

## D-R6a-gate-source — where gate outcomes are read from

Task R6a. Unclear point: "gate outcomes" could mean a dedicated table or the recorded activity. There
is no `gate_outcomes` table; `deploy_engagement` writes an `engagement_deployed` row into
`activity_log` carrying `{universe_id, entity_id, plan_id}`. Options: (1) add a new table; (2) read
the existing activity rows.
Choice: option 2. `listGateOutcomes(universeId)` in `src/data/deployment.ts` reads `activity_log`
filtered by `action = 'engagement_deployed'` and `detail->>universe_id`, mapped to
`{engagementId, entityId, planId, detail, ts}`. RLS on `activity_log` keeps the read org-scoped.
Reason: configuration-not-code and no duplicate source of truth; the activity log is already the
auditable record of a gate firing.
How to reverse: add a `gate_outcomes` table and repoint `listGateOutcomes`; the UI shape is unchanged.

## D-R6b-xlsx — how XLSX parsing enters the import wizard

Task R6b. Unclear point: the task says "add XLSX parsing (SheetJS)". Options: (1) static-import
SheetJS into the wizard; (2) dynamically import it in a small parser module so it stays out of the
main bundle; (3) use another parser.
Choice: option 2. `src/lib/xlsx.ts` exposes `isSpreadsheet(filename)` and `parseSpreadsheet(buf)`; the
wizard routes `.xlsx/.xls/.xlsm` files to it and everything else to the inline CSV parser. SheetJS CE
`xlsx@0.18.5` is the dependency.
Reason: SheetJS is ~420 kB; a dynamic import keeps the main bundle flat and loads it only when the
operator actually uploads a spreadsheet. Both parsers return the same `{headers, rows}` shape, so the
rest of the wizard (mapping, validation, commit) is unchanged.
How to reverse: move `parseSpreadsheet` to a static import in `ImportWizardPanel.tsx`, or replace
`src/lib/xlsx.ts` with another parser that returns the same shape.

## D-R6b-sheetjs-advisory — accepting SheetJS's unfixed advisory

Task R6b. Unclear point: `xlsx@0.18.5` (the last npm release) carries a high-severity advisory with no
npm fix. Options: (1) do not add SheetJS; (2) add it and record the residual risk; (3) install from
the SheetJS CDN tarball.
Choice: option 2. `npm audit --audit-level=critical` still exits 0 (the advisory is high, not
critical), so the gate is unaffected. The parser runs only on a file the operator picked in their own
browser; it is never given data the tenant did not already hold, and it makes no network calls.
Reason: the task explicitly names SheetJS; the risk is bounded and recorded. Switching to the CDN
tarball is an owner decision (it changes the dependency source).
How to reverse: install `https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz` or swap the parser, then
remove the advisory note from NOT-DONE item 12.

