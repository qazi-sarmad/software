# Remaining build — decisions

Decision order: (a) `docs/SPEC-v10.md`; (b) the Laws; (c) the simplest option that obeys the Laws;
(d) best for multi-tenant, auditable, configuration-not-code, deterministic. Never an option that
weakens RLS, the population gate, the ledger, the hash chains or a test.

Entry format: number, task, unclear point, options, choice, reason, how to reverse.

---

## D-R1-M2 — add `drop policy if exists` before every `create policy`

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

## D-R1-concurrency — serialise CI runs on the shared test project

Task R1b. Unclear point: CI had no `concurrency` block, so a `pull_request` run and a
`workflow_dispatch` run (or two pushes) applied migrations to the same hosted project at the same
time. The observed evidence: `workflow_dispatch` runs 39042335625 and 39051278754 are green, while
`pull_request` runs 39042338419 and 39051278442 on the *same SHAs* are red at step 6.
Options: (1) per-run scratch schema/database; (2) a workflow-level `concurrency` group that
serialises runs and never cancels in progress.
Choice: option 2 — `concurrency: { group: provio-test-db, cancel-in-progress: false }`.
Reason: the hosted project is a single shared database the owner controls; a scratch DB per run is
not available (the secret points at one project). `cancel-in-progress: false` avoids killing a run
half-way through migrations, which would leave partial DDL behind.
How to reverse: remove the `concurrency` block from `.github/workflows/ci.yml`.

## D-R3-patch — the root `.patch` file was already removed; nothing to `git rm`

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

## D-R3-reference-v1 — remove `docs/reference/v1` (no source references)

Task R3. Unclear point: whether the read-only v1.7 reference tree is safe to delete. Grepped `src`,
`e2e`, `scripts`, `supabase`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`,
`playwright*.config.ts`, `package.json` and the CI workflows for `docs/reference` — the only
reference anywhere was a prose mention in `docs/HANDOFF.md` (no import, no path in any config or
script). Options: (1) keep the tree; (2) `git rm -r` it and update the prose.
Choice: option 2. Removed the 60 tracked files under `docs/reference/v1/` and updated the HANDOFF
"Reference Archive" note to say it was removed and why.
Reason: it is dead weight (648K, 60 files) with zero code references; the v1.7 behaviour it mirrored
already lives in `src/`. The build brief explicitly names it for removal.
How to reverse: `git revert` this commit, or `git checkout <pre-R3-commit> -- docs/reference/v1`.

## D-R3-HANDOFF — the prose reference is edited, not deleted

Task R3. Unclear point: `docs/HANDOFF.md` still described the reference tree as present.
Options: (1) leave the stale sentence; (2) update it.
Choice: option 2 — the sentence now states the tree was removed in R3 and that `docs/` stays excluded
from `tsconfig`/`vitest`/gate scripts.
Reason: a handoff doc that points at a deleted path is worse than no sentence.
How to reverse: `git checkout <pre-R3-commit> -- docs/HANDOFF.md`.

## D-R4-palette — command palette becomes a non-blocking dropdown

Task R4a. Unclear point: how to keep Ctrl/⌘+K and the existing search behaviour while removing the
blocking scrim. Options: (1) keep the centred overlay with a scrim but drop `aria-modal`;
(2) render the palette as a dropdown anchored under the header, no scrim.
Choice: option 2. The palette is now `fixed top-14 left-0 right-0` with `pointer-events-none` on the
wrapper and `pointer-events-auto` on the panel; the page behind stays reachable. Escape still closes
(the existing keydown handler) and an outside click now also closes (a new `pointerdown` listener
that ignores clicks inside the panel). Ctrl/⌘+K is unchanged.
Reason: §27.5 bans blocking modals; an anchored dropdown is the documented non-blocking pattern and
keeps the command palette usable while the user reads the page behind it.
How to reverse: restore the previous render block (centred `fixed inset-0` wrapper + scrim
`motion.div` with `onClick={onClose}`) and delete the outside-click effect. No test asserted the
scrim, so no test change is required to reverse.
No tests were updated: grep found no test that asserted the palette backdrop (the only `backdrop`
assertion in the repo is `FloatingWindow.test.tsx`, which is unrelated). A new
`CommandPalette.test.tsx` asserts the non-blocking contract.

## D-R4-calendar — calendar panel keeps a popover, loses the modal role

Task R4b. Unclear point: `HeaderCalendarPanel` used `role="dialog"` but rendered no scrim and no
focus trap, so it never blocked the page. Options: (1) keep `role="dialog"` and allow-list it;
(2) change the role to a non-modal one.
Choice: option 2 — `role="region"` with the same `aria-label="Audit Calendar Panel"`. The panel
already used `position: fixed` (not `fixed inset-0`), so it was never full-viewport and never had a
backdrop.
Reason: the task says to make it non-blocking if a dialog role or backdrop blocks the page, and to
record why if it is kept. It does not block, so keeping a modal role would be a false claim in the
accessibility tree. `region` is accurate for an anchored popover. It is therefore no longer in the
allow-list, which now holds exactly the four non-blocking chrome files the task names.
How to reverse: set `role="dialog"` again and re-add `calendar/HeaderCalendarPanel.tsx` to ALLOWED in
`src/guards/noBlockingModal.test.ts`.

## D-R4-guard — allow-list is exactly the four non-blocking chrome files

Task R4c. Unclear point: the guard previously allow-listed `CommandPalette.tsx` and
`HeaderCalendarPanel.tsx` (plus `AuditFileModal.tsx`). Options: (1) leave the wide list; (2) shrink it
to the files that are non-blocking by construction.
Choice: option 2 — ALLOWED is exactly `FloatingWindow.tsx`, `FloatingWindowManager.tsx`,
`RecordView.tsx`, `ConfirmPanel.tsx` (the last may not exist yet; a Set entry for a missing file is
harmless). `CommandPalette.tsx`, `HeaderCalendarPanel.tsx` and `AuditFileModal.tsx` are removed
because none of them contains a banned token any more, so allow-listing them would be dead entries
that hide a future regression.
Reason: a guard whose allow-list is wider than necessary stops being a guard.
How to reverse: re-add any file to ALLOWED if a legitimate non-blocking surface reintroduces a
banned token.

## D-R5a-role-guard — widen the role guard, keep the same allow-list

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

## D-R5a-allowlist — DATA_FILES is the DISPLAY/SCOPE list from ROLE-CHECKS.md

Task R5a. Unclear point: which files may legitimately contain role-name literals. Options: (1) list
them loosely; (2) name exactly the DISPLAY/SCOPE files in `docs/ROLE-CHECKS.md`.
Choice: option 2 — `types/index.ts`, `lib/rights.ts`, `data/client.ts`, `data/demoSeed.ts`,
`data/initialData.ts`, `context/AppContext.tsx`, `App.tsx`,
`components/glassbox/GlassBoxPublicRoute.tsx`, `test/testUsers.ts`. The last four were added to the
previous four-file list because they carry role slugs as seed/label data (`initialData`, `demoSeed`,
`AppContext` demo user, `App`, GlassBox `actorRole`) with no comparison.
Reason: the task asks for the allowed files to be listed in the test, and ROLE-CHECKS.md already
classifies them. An entry only exempts a file from the comparison scan; it does not permit a
comparison to be added there unnoticed, because these files hold literals, not comparisons.
How to reverse: remove the added entries and re-run; the guard will list any file that then fails.

## D-R5b-singleClient — guard confirmed present and green, no change

Task R5b. Unclear point: none. Ran `npx vitest run src/guards/singleClient.test.ts` on the head; it
passes (3 tests). No edit made.
Reason: the task says "confirm", not "create".
How to reverse: n/a.

## D-R6c-passwords — one random password per synthetic user per run

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
