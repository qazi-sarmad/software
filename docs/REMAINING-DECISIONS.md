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
