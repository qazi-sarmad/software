# Blockers

Date: 2026-10-24
Owner: Qazi Sarmad Ali Mahesar

Each entry records what stopped work, the evidence, and whether it is resolved. An
entry is removed only when its resolution is verified on CI.

## B1. A push to the build branch started no CI run — RESOLVED (CI-1)

- Symptom: every task's rule that "its own CI run is green" could not be satisfied,
  because a push produced no run at all.
- Evidence: `.github/workflows/ci.yml` triggered on `push` to `main` only, plus
  `pull_request` and `workflow_dispatch`. Pull request #11 is merged and no pull request
  is open, so no `pull_request` event fired, and the build branch is not `main`, so no
  `push` event fired.
- Resolution: CI-1 added `feature/board-ai-control-plane` to `push.branches`. Verified:
  the CI-1 push started run `40125698154` (`push`, head `6382125`).
- Reversal path: recorded as D-CI-1 in `docs/DECISIONS.md`.

## B2. Step 9 could never complete — PARTLY RESOLVED (CI-1), root cause fixed in CI-3

- Symptom: the screenshot sweep was cancelled by the job timeout on every run that
  reached it, which reddened the whole run.
- Evidence: step 9 asked for `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and
  `SUPABASE_ANON_KEY`; none are repository secrets, so all three arrived empty,
  `e2e/global-setup.ts` threw, and the sweep hung until the job's 45-minute timeout
  cancelled the run. Step 9 never once completed across past runs.
- CI-1 correction: step 9 now reads the `TEST_SUPABASE_*` secrets. That was necessary
  but not sufficient — run `40125826186` passed steps 1 to 14 and then hung in step 9
  for 19 minutes 21 seconds until the job limit cancelled the run.
- Root cause: the app reads only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
  (`src/data/client.ts`), and step 9 did not set them, so the dev server it starts had no
  Supabase client and every one of the 318 capture visits burned its timeouts.
- CI-3 fix: step 9 sets the `VITE_` variables and carries its own 15-minute limit, so a
  slow sweep fails this step (which is `continue-on-error`) instead of cancelling the run.
- Reversal path: recorded as D-CI-3 in `docs/DECISIONS.md`.

## B3. T6–T12 were already built — RESOLVED (decision recorded)

- Symptom: the earlier plan asked for T6–T12 to be implemented, which would have added
  duplicate migrations to a shared hosted database.
- Evidence: `docs/PARITY.md` marks the corresponding sections Present; the migration set
  contains the schema and RPCs for each. 86 migrations, 93 SQL test files.
- Resolution: closed as already present, recorded as D-T6-T12 in `docs/DECISIONS.md`.
  Future work is limited to real remaining deltas.
- Reversal path: a delta found later is opened as its own task with its own migration
  number and test.

## B4. The plan's T3 collided with the existing PROGRESS.md T3 — RESOLVED (decision)

- Symptom: the existing `docs/PROGRESS.md` row T3 described the screenshot-sweep fix,
  while the earlier plan's T3 described `docs/TUTORIAL-FAILURES.md`. Writing the plan's
  T3 would have silently overwritten a different task's record.
- Evidence: `docs/PROGRESS.md` on the branch had `T3 | committed locally | (this
  commit) | pending | screenshot sweep: real secret names + own timeout`.
- Resolution: the existing T3 row keeps its meaning. The CI tasks are recorded as new
  rows `CI-1` and `CI-2`; T3–T31 stay "not started" until the revised plan re-maps them.
- Reversal path: none needed; the row was not overwritten.

## B5. T5 (full AI purge) collided with §13 — RESOLVED (suspended)

- Symptom: the earlier plan's T5 required removing all AI, but §13 "Document Review and
  AI" is Present and shipped.
- Evidence: `docs/PARITY.md` marks §13 Present; 112 files reference AI terms, including
  `src/data/ai.ts`, `src/components/common/AiAssist.tsx`,
  `src/components/superadmin/SuperAdminAi.tsx`, `src/components/admin/OrgAiPanel.tsx`
  and `supabase/migrations/0059_ai.sql`. No AI guard test exists in `src/guards/`.
- Resolution: the purge is suspended pending an explicit owner decision to override §13,
  recorded as D-AI in `docs/DECISIONS.md`.
- Reversal path: an explicit owner decision, taken as its own task with its own tests.

## B6. The plan referenced a SPEC-v10 §33 that does not exist — RESOLVED (decision)

- Symptom: the earlier plan said "SPEC-v10 §33"; the specification's last section is
  "32. Open Items".
- Evidence: `grep -nE '^## [0-9]+\.' docs/SPEC-v10.md` ends at §32.
- Resolution: recorded as D-SPEC in `docs/DECISIONS.md`. New decisions are appended as
  §33 or as a dated block, without renumbering §§1–32.
- Reversal path: none; numbering is append-only.
