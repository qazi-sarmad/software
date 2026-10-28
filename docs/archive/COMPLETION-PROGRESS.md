> ## ⚠️ STALE — ARCHIVED, DO NOT TRUST
>
> This document predates the code-verified audit of 2026-10-27/28 and is kept for history only.
> Its status claims are **not** reliable: the audit found the app was not database-backed in
> production, the engagement lifecycle was never persisted, several documented-as-Present features
> were dead code, and many "all Present" claims were false.
>
> **Current sources of truth:**
> - `docs/SPEC-v10.md` — the specification (unchanged, still authoritative)
> - `docs/FUNCTIONALITY-AUDIT.md` — what is actually built (code-verified)
> - `docs/REMEDIATION-PLAN.md` — the plan being executed
> - `docs/SCALE-TASKS.md` — live task ledger
>
> Do not cite this file as evidence that anything works.

# Completion build progress

One line per task: task, commit, CI run id, result (green / fixed / blocked).

Branch: `feature/board-ai-control-plane`.
Baseline at C0 (last green run 39516753943, head a41d46e): vitest 128 files / 1428 tests;
SQL 80 files / 71 migrations / 1683 assertions; Playwright 113 passed / 2 skipped.

| Task | Commit | CI run id | Result |
|---|---|---|---|
| C0 preflight and docs | (this commit) | n/a (docs only) | green |
| C1.3 RPC authority review | (this commit) | pending | local SQL 82/82 green, twice |
| C2.1 hosting-test edge function | (this commit) | pending | local gates green |
| C2.2 scheduled jobs for CAP events, purges, sweeps and digests | 1134a89 | 39571470047 | local SQL 83/83 green twice, vitest 135 files / 1498 tests green |
| C2.3 event emitters for every catalogue event with a source | 0b91dea | 39586479221 | fixed by 16e4e18 (test 83 asserted pg_cron absent; CI has it, see D-C2.2-1) |
| C2.2-FIX test 83 pg_cron conditional | 16e4e18 | (batched with C2.4) | local SQL 84/84 green twice |
| C2.4 colleague invitation end to end | 9fd9192 | (batched) | local gates green; SQL 84/84 twice |
| C2.9 tenant-granted read-only support session | (this commit) | pending | local SQL 85/85 green twice; vitest 6/6 on the panel |
| C0-LOCALCI local CI script replaces the paused workflow | (this commit) | n/a (GitHub paused) | steps 1-8 PASS, step 9 PASS SQL VERIFIED LOCALLY (PostgreSQL 17, shim, migrations twice, tests twice); step 10 exit 3 (no Supabase credentials) |
| C2.5 verified archival upload and population archival | (this commit) | pending | local SQL 86/86 green twice; vitest 137 files / 1523 tests green; guards green |
| C2.6 document extraction and rule-based review | (this commit) | pending | local SQL 87/87 green twice; vitest green; guards green |
| C2.7 binary exports and report issuance files | 4a2288f | pending | local SQL 88/88 green twice; vitest 140 files / 1604 tests green; tsc, build, tokens, shrink, tutorials green |
| C5.1 one contract section per Appendix A screen, enforced | 36dbf58 | pending | check-ui-contract PASS (52 screens); vitest green |
| C4 tutorials: real steps, real recording, honest gate | (this commit) | pending | local SQL 91/91 green twice; vitest 142 files / 1635 tests green; check-tutorials strict logic verified; tsc, build, tokens, shrink, contract green |
| C2.7-FIX DOCX determinism across a second boundary | 98648ee | pending | vitest 142 files / 1635 tests green; new regression test fails without the pin |
| C3.2-B governance settings and admin surfaces (§10/§12/§14.2/§20/§22/§23) | (this commit) | pending | local SQL 92/92 green twice; vitest 143 files / 1643 tests green; tsc, build, tokens, shrink, contract, tutorials green |
| C3.1 clause-by-clause spec audit (§1–§29, §30–§32) | (this commit) | n/a (docs) | docs/COMPLETION-SPEC-AUDIT.md written from evidence; gaps recorded in COMPLETION-BLOCKERS.md |
| C5.2 PARITY rebuilt as one current table from C3.1 | (this commit) | n/a (docs) | docs/PARITY.md rebuilt; stale Phase 0 table archived |
| C5.3 NOT-DONE rebuilt as one current list | (this commit) | n/a (docs) | resolved/scope items removed; real gaps, owner actions, parked items only |
| C5.4 screenshots in three presets and two themes | fa48a0e | 39674966693 (steps: []), 39675053575 (steps: []) | fixed: CI step 9 starts the dev server before the sweep and uploads artifacts (git-ignored); CI-local steps 1-9 green |
| C5.5 full-flow regression Playwright spec | fa48a0e | 39674966693 (steps: []), 39675053575 (steps: []) | e2e/full-flow.spec.ts (10 tests); every testid verified present in src; tsc green; Playwright needs the hosted project (CI-local exit 3) |
| C4-FIX placeholder GIF for the new oa.governance key | fc68455 | 39674966693 (steps: []), 39675053575 (steps: []) | check-tutorials green (86 GIFs, 0 missing); CI-local steps 1-9 green |
| C6-CI CI workflow re-enabled and dispatched three times | n/a | 39674966693, 39675053575 | blocked: platform refuses to start the job (`steps: []`); see COMPLETION-BLOCKERS.md |
| C2.4-FIX-3 refreshSession re-mints the JWT so a new membership is visible (real defect) | (this commit) | pending | `e2e/c2-member-invite.spec.ts` PASSES locally against a local Supabase stack (was stuck on no-tenant-screen); vitest 144 files / 1648 tests green; tsc, build, tokens, shrink, ui-contract, tutorials green; local SQL harness migrations+all tests twice green |
| S5-AI the L2 vendor-hosted assertion was vacuous; fixture seeds ai_assist + ai_enabled (S5-AI) | (this commit) | pending | `e2e/s5-ai.spec.ts` 3 passed; new guard `src/guards/e2eAssertions.test.ts` 2 passed; vitest 146 files / 1654 tests green; tsc, build, tokens, shrink, ui-contract, deploy-list, tutorials green |
| S2/S6/S9 three more conditional assertions fixed and their fixtures seeded (S5-AI-b) | (this commit) | pending | `e2e/s2-... e2e/s6-... e2e/s9-...` 15 passed; escalation_events fixture added to global-setup (M5: cleared first) |
| C6 final report, draft PR #11, final CI dispatch (C6) | fa84229 | 39748486235, 39748504017 | blocked: platform refuses to start the job (`steps: 0`) on both; head verified locally by the full gate set; PR #11 open as a draft, PR #10 untouched |

## AI-removal, hardening, edge, sharing, report-engine run (2026-10-25)

Branch: `feature/board-ai-control-plane`. Preconditions recorded before any change:

- Head at start: `8ba805c` (matches the owner's verified head). Last three commits:
  `8ba805c ci: give step 9 the VITE_ vars and its own limit (CI-3)`,
  `5c0c196 docs: decisions, blockers and tutorial skeletons after CI enablement (CI-2)`,
  `6382125 ci: enable branch pushes + fix step-9 secrets (CI-1)`.
- Latest CI on this branch (query returned 5): `40134258676` Tutorial GIFs failure (8ba805c);
  `40131307073` CI success (8ba805c); `40125826186` CI cancelled (5c0c196); `40125698154` CI
  cancelled (6382125); `40115550142` CI cancelled (fce7cc8). Last green CI: `40131307073`.
- Baselines from the last green run `40131307073` (head 8ba805c): vitest **148 files / 1665 tests**;
  Playwright **127 passed**; check-tokens 168 files 0 violations; check-shrink 58 files; tutorials
  85 keys; function deploy list 8 functions / 24 references. SQL at 8ba805c: **93 test files /
  86 migrations** (counted on disk; CI ran them twice).
- Open item carried forward: PR #12 (`fix/tutorial-recorder-fixtures` -> this branch) is still
  `open`, not merged. Not a blocker for this run, which works only on this branch.

| Task | Commit | CI run id | Result |
|---|---|---|---|
| P-0 owner decisions | (this commit) | pending | decisions and preconditions recorded |
| AI-REMOVAL remove the AI feature (0087) and close the tutorial registry gap | ab79306 | 40236534345 (step 7 red), 40239022295 | migration 0087 drops every AI table, column, function, trigger, cron job, registry row, feature key and right; test 94 proves it; oa.governance row added to 0071/0081 so all four key sets agree at 77; vitest, SQL harness and ci-local steps 1-9 green locally |
| T2 recorder map: oa.governance was absent from ORG_TAB and would have recorded the Features tab | 551bd6d | 40236534345 | scripts/tutorialCapture.mjs maps oa.governance to the governance tab (OA-22); src/guards/tutorialCaptureMap.test.ts pins that every org/super-admin key is named in the map and that each named tab is one the portal declares |
| A1-A3 step 7 SQL failure: test 83 still expected the removed ai-purge-expired cron job | c6d7552 | 40239022295 | the pg_cron block is skipped locally, so only the hosted project failed ("the job ai-purge-expired exists in cron.job"); test 83 now lists five jobs; src/guards/cronJobRegistry.test.ts replays cron.schedule/unschedule and fails when the removed name is restored |
| A1-A3 verify: CI green on the fix | c6d7552 | 40239022295 | all 9 steps success; step 7 (migrations and SQL tests) success, step 8 Playwright 124 passed, step 9 screenshot sweep success |
| B1-B4 tutorials: record every GIF from the real UI | 3613ed6 (written by the workflow) | 40242187619 | all 11 steps success; 78 files changed, 77 GIFs recorded from the live UI (0 placeholders, real frame blocks: oa.governance 9 frames, sa.templates 11, ex.accept 12); `npm run check-tutorials` without TUTORIALS_ALLOW_PLACEHOLDER: 77 present, 0 missing, 0 placeholders, 0 stale |
| C1-C3 CI on the branch | c0d93cc | 40242173262 | all 9 steps success; 124 Playwright tests passed; step 9 sweep success |
| D local gate before any CI | 3613ed6 | n/a (local) | ci-local steps 1-9 PASS (tsc, 1573 unit tests, build, tokens, shrink, tutorials 77/0 placeholders, deploy list, UI contract, SQL twice); step 10 not run, no Supabase credentials in the sandbox |
