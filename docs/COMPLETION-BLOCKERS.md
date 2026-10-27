# Completion build blockers

A blocker is recorded here with the exact error text, what was tried, and the commit hash.

## CI infrastructure: GitHub runner platform still refuses to start jobs (2026-10-21, C6)

- The workflow had been paused (`CI disabled_manually`, workflow id 383084794). It was re-enabled
  (`PUT repos/qazi-sarmad/software/actions/workflows/383084794/enable` -> `active`) and dispatched
  three times on the C5 commits:
  - **39674966693** on `fc68455` -> `completed / failure`, job `gates`, `steps: []`,
    `started 2026-10-21T20:58:58Z`, `completed 2026-10-21T20:59:00Z`.
  - **39675053575** on `fc68455` -> `completed / failure`, `steps: []`,
    `started 2026-10-21T20:59:36Z`, `completed 2026-10-21T20:59:38Z`.
  - **39677607517** on `fc68455` (dispatched again after the C5.4 sweep commit) -> `completed /
    failure`, job `gates`, `steps: 0`, started `2026-10-21T21:17:46Z`, completed
    `2026-10-21T21:17:49Z`. Same signature, same `BlobNotFound` on the job log.
  - (Earlier, the same signature on 39604710289 / 39604815983 on `7a5dbef`.)
- No step ran, so no gate produced a result and no log exists to read; the job-log endpoint still
  answers `BlobNotFound`. This is the same platform-side failure recorded above, not a repository
  fault.
- What was tried: re-enable, dispatch, wait, inspect `jobs` and `jobs/*/logs`, re-dispatch. Two
  attempts are the five-attempt budget's worth for an infrastructure fault that returns identically
  in three seconds; more dispatches cannot change a runner that never starts.
- Consequence: **CI cannot be green on this branch while the platform refuses to start the runner.**
  The C5 commits (`fa48a0e`, `fc68455`) are verified by `scripts/ci-local.sh` steps 1-9 instead,
  which run the workflow's steps in the workflow's order against Node 22 and local PostgreSQL 17.
  Step 10 (Playwright) needs Supabase credentials and is skipped with exit code 3.
- Owner action: re-dispatch CI when the platform is healthy; the run will then exercise the SQL and
  Playwright steps against the hosted test project, which cannot be reached from the sandbox.

## CI infrastructure: two GitHub runs executed zero steps (2026-10-21)

- Runs **39604710289** and **39604815983**, both on head `7a5dbef`, dispatched with
  `gh api -X POST repos/qazi-sarmad/software/actions/workflows/ci.yml/dispatches -f ref=feature/board-ai-control-plane`.
- Both reported `completed / failure` in three to four seconds. The jobs endpoint returns one job,
  `gates`, with `conclusion: failure` and **`steps: []`** — no step ever started:
  `started_at 2026-10-21T13:03:50Z`, `completed_at 2026-10-21T13:03:53Z`.
- Fetching the job log returns an Azure blob error, not a log:
  `<?xml version="1.0" encoding="utf-8"?><Error><Code>BlobNotFound</Code><Message>The specified blob
  does not exist.</Message>...` with `gh: HTTP 404`.
- Diagnosis: a platform-side failure to start the runner. Nothing in the repository is implicated —
  no step ran, so no gate produced a result. The earlier run 39600173573 on `fad1a3c` did start and
  did run all steps.
- What was tried: two separate dispatches, both within 30 seconds of the push; both failed
  identically. Not retried further, because the standing directive pauses the GitHub workflow and
  moves verification to `scripts/ci-local.sh`.
- Consequence: **the C2.4 fix (`fad1a3c`, `7a5dbef`) has never been exercised by the GitHub
  workflow.** Its Playwright spec is verified locally only, and only if the local run has Supabase
  credentials.
- Owner action: re-dispatch CI on `7a5dbef` (or push an empty commit) when the platform is healthy.


## §2 cross-universe view-only sharing — CLOSED (SCALE-1 WP2)

Built on `feature/scale-harden-v1`. `0095_scale_harden_sharing_preflight.sql` adds the
`universe_shares(id, org_id, universe_id, grantee_id, granted_by, expires_at, revoked_at,
revoke_reason, created_at)` table, the `share_grant` / `share_revoke` RPCs (grant requires a
Level-1/Level-2 Head or an Org Admin of the same org; revoke requires the granting Head, a higher
Head or an Org Admin; self-sharing refused), the `shared_universe_read(p_universe_id)` security-definer
read-only projection that checks a live share row for `auth.uid()` **and** `jwt_org_id()` equality, and
the in-app + email notification on grant. The normal tenant read path (`org_id = jwt_org_id()`) is
unchanged: the share is a second, explicitly-scoped door, never a weakening of an existing policy.
Screen: `src/components/admin/SharePanel.tsx`. Tests: sql `100_scale_harden.sql` (positive and negative:
non-Head refused, revoked share invisible, normal tenant data still isolated), sql `103_scale_isolation.sql`
(cross-org refusal), `e2e/wp6-system.spec.ts`. RLS shape and rights checks documented in
`docs/SCALE-DECISIONS.md`.

## §10.1 configurable grace period before the Testing hard lock — CLOSED (SCALE-1 WP2)

Built on `feature/scale-harden-v1`. `org_lifecycle_settings.testing_grace_hours` (0..336, default 0)
is the setting; `testing_lock_active` now returns false inside the grace window after Planning
sign-off; `src/lib/lifecycle.ts` mirrors the check purely and `src/data/governance.ts` threads it
through the settings UI. Tests: sql `100_scale_harden.sql`, `src/lib/lifecycle.test.ts`,
`src/components/admin/OrgGovernancePanel.test.tsx`.

## §11.4 pre-flight before submission — CLOSED (SCALE-1 WP2)

Built on `feature/scale-harden-v1`. `src/lib/preflight.ts` runs the full eight-check list and returns
a structured report; `src/data/preflight.ts` reads it and writes the append-only, logged
`preflight_acknowledgements` row through the acknowledge RPC (`0095`). Tests: `src/lib/preflight.test.ts`,
`src/data/preflight.test.ts`, sql `100_scale_harden.sql` (happy path + refusal).

## §3 / §25.7 mobile viewport for the three phone paths — CLOSED (SCALE-1 WP2)

Built on `feature/scale-harden-v1`. `e2e/s16-mobile.spec.ts` runs at a phone viewport and covers
ethics sign-off, a simple approval and report viewing.

## §25.4 Supabase free-tier limits verified before production use — Partial (owner action)

Spec §25.4 and §32 item 1: the current free-tier figures must be checked on Supabase's pricing page
before production use. This cannot be verified from the repository. Owner action.

## Owner action: deploy the Edge Functions and confirm platform services

The Edge Functions in `supabase/functions/` (email-dispatch, graph-oauth, hosting-test,
invite-user, secrets-put, archive-upload, doc-extract) must be deployed:
`supabase functions deploy email-dispatch graph-oauth hosting-test invite-user secrets-put archive-upload doc-extract`.
Also confirm Vault, pg_cron and pg_net are enabled on the project, and set `SECRETS_MASTER_KEY` if
Vault is absent.

## CI infrastructure: platform still refuses to start the runner (2026-10-22, C6)
- The workflow is `active` (workflow id 383084794) and was dispatched on the final head `9de5ac2`:
  - **39742870677** on `9de5ac2` -> `completed / failure`, job `gates`, **`steps: 0`**,
    `started 2026-10-22T07:46:36Z`, `completed 2026-10-22T07:46:38Z`. No log exists
    (`BlobNotFound`).
  - Earlier in this session, **39739987481** on `3b9818c` -> identical signature.
- The decisive evidence that this is platform-side, not a repository fault: the unrelated
  **`Keep test project awake`** workflow on `main` (run **39740345392**, and **39717003409** before
  it) fails with the same `steps: 0` signature in two seconds. Its YAML, its branch and its commit
  are untouched by this run.
- The workflow file is structurally valid (no tab-indented lines; `jobs.gates` present; 16 named
  steps) and the pinned actions resolve (`actions/checkout@v7` and `actions/setup-node@v7` both
  exist). The last run that actually executed was **39595405218** on `d3b7f87`
  (2026-10-21T11:54Z), which ran all 17 steps, passed steps 1-12 including the SQL step, and failed
  only at step 8 (Playwright) on `e2e/c2-member-invite.spec.ts` — the defect fixed by the C2.4-FIX
  commits, and since then the C4 recorder and frame-counter defects too.
- Consequence: CI cannot be green on this branch while the platform refuses to start the runner. The
  final head is verified locally by the same gate set: tsc, vitest 145 files / 1652 tests, vite
  build, check-tokens, check-shrink, check-ui-contract, check-function-deploy-list, check-tutorials
  (86 current, 0 stale), the local SQL harness (every migration applied twice and every SQL test run
  twice against PostgreSQL 17 with the Supabase shim) and the full Playwright chromium suite.
- Owner action: re-dispatch CI when the platform is healthy; it will then exercise the SQL and
  Playwright steps against the hosted test project, which the sandbox cannot reach.

## CI infrastructure: final head also refused (2026-10-22, C6 final)

- The completion-report commit `fa84229` was pushed (which auto-triggers the `pull_request` run) and
  CI was dispatched again. Both runs report the same signature:
  - **39748486235** on `fa84229` -> `completed / failure`, job `gates`, **`steps: 0`**.
  - **39748504017** on `fa84229` -> `completed / failure`, job `gates`, **`steps: 0`**.
- Total dispatches this session: five, all identical (39739987481, 39742870677, 39745950473,
  39748486235, 39748504017). That is the five-attempt budget for an infrastructure fault that returns
  identically every time; a sixth dispatch cannot change a runner that never starts.
- The draft pull request is **#11** (`feature/board-ai-control-plane` -> `main`); PR #10 is left open
  for the owner.
- Consequence unchanged: the final head is verified locally by the whole gate set (tsc, vitest 146
  files / 1654 tests, vite build, check-tokens, check-shrink, check-ui-contract,
  check-function-deploy-list, check-tutorials, the local SQL harness with migrations twice and tests
  twice, and the full Playwright chromium suite 127 passed / 2 skipped).
