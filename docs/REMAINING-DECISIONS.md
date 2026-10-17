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
