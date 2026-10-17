# Phases 4–8 — progress

Branch `phase-4-onwards`, base `origin/main` (Phase 3 PR #9 merged, merge commit `c7e9e7b`).

Updated after every task and committed with it. Every line carries the CI run ID, not only "green".

## Numbering LOCK (H0)

- Migrations: last used in Phase 3 is `0023`. **Next free is `0024`.** Phases 4–8 use `0024` upward.
- SQL tests: last used in Phase 3 is `31`. **Next free is `32`.** Phases 4–8 use `32` upward.
- No parallel task may take a number without updating this line first.

## Gate baseline (start of this build, main `c7e9e7b`)

- tsc exit 0; vitest 41 files / 371 tests; build exit 0; tokens PASS (64 files); shrink PASS (59 files).
- SQL: 31 test files (`00`–`31`) green, migrations and tests each applied/run twice.
- Playwright: 30 passed.

## Tasks

| Task | Status | Commit | CI run | Notes |
|---|---|---|---|---|
| H0 preflight + docs | done | 48a329a | (no CI: docs only, pushed with H1) | branch created from main; numbering locked |
| H1 Grok housekeeping | done | 244bb3e | 38891659906 | green — PR #9 desc retargeted to main; singleClient guard green (3 tests) |
| H2 nav labels | done | 8500602 | 38892526322 | green — labels aligned to SPEC-v10 §5 (D-H2) |
| H3a preferences + guard skeleton | done | ae92f3b | 38894103600 | green — migration 0024, src/data/preferences.ts, guards; SQL test 32 (D-H3a) |
| H3b RecordView + routing | done | 97b1c3e | 38895012166 | green — FloatingWindow/RecordView/RecordContent + /view route (D-H3b) |
| H3c abolish InspectorPanel | done | 22f2d15 | 38895012166 | green — panel deleted; spec §27.5/§17.1 updated (D-H3/D-H3c) |
| 4A plan docs | done | 0e5bfee | 38975709496 (cumulative) | docs/PHASE-4-PLAN.md; migrations 0025+, tests 33+ |
| 4B planning DB | done | f772dba | 38895859440 | green — migration 0025, test 33 (D-4B-M1, D-4B-scope, D-4B-four-eyes, D-4B-reconciliation) |
| 4C population gate DB | done | c0ebd01 | 38896760916 | migration 0026, test 34 (D-4C-M1, D-4C-status, D-4C-row-count) |
| 4D sampling engine DB | fixed | d54165e | 38897513403 | migration 0027, test 35 (D-4D-M1, D-4D-column-name, D-4D-locked-immutability, D-4D-seed, D-4D-sample-size). 38897205611 was a cross-run race on the shared test project (D-4D-CI-RACE); the same code is green in the 4E run. |
| 4E row testing DB | done | e2dc0bf | 38897513403 | migration 0028, test 36 (D-4E-M1, D-4E-four-eyes, D-4E-exception-default, D-4E-status) |
| 4F analyst engine | done | 81dadff | 38898749540 | green — migration 0029, test 37, src/lib/analyticsEngine.ts + test (D-4F-M1, D-4F-stub, D-4F-engine-scope) |
| 4G Phase 4 tests | done | d1ed656 | 38899789331 | test 38 acceptance (cross-org, anon, no-right, L3, floor, four-eyes, chain, lock) + 4F unit tests |
| 4H Phase 4 data module | done | 29d473b | 38900814033 | src/data/{planning,population,sampling,rowTesting,analytics}.ts + phase4.test.ts (14 tests). First run red on a 0009 deadlock (shared test-project race, D-4D-CI-RACE class); rerun of the same commit green. |
| 4I Phase 4 UI | todo | | | |
| 4J Phase 4 docs | todo | | | |
| 5A findings DB | done | b8a7dd3 | 38975709496 (cumulative) | migration 0030, test 39 (D-5A-STUB resolved, D-5A-M1, D-5A-status, D-5A-tokens, D-5A-optional-sections) |
| 5B conclusion DB | done | ec4e96a | 38975709496 (cumulative) | migration 0034, test 43 (D-5B-M1, D-5B-testing-gate, D-5B-opinion-config, D-5B-files) |
| 5C floating window | todo | | | |
| 5D document viewer DB | fixed | 135ebd2 | 38954437967 -> 38956498574 | migrations 0035 (evidence_files, document_extractions, FTS, search_documents), test 44 (D-5D-M1, D-5D-stage-filter, D-5D-extraction-stub) |
| 5E Phase 5 tests | done | 882eb69 | 38975709496 | test 54 phase-5 acceptance (cross-org, anon, no-right, readability gate, testing gate, four-eyes, seal, stage-aware search) |
| 5F Phase 5 data module | done | 13b8ce2 | 38975709496 (cumulative) | src/data/{observations,conclusion,documents}.ts + phase5.test.ts |
| 5G Phase 5 UI | todo | | | |
| 5H Phase 5 docs | todo | | | |
| 6A report drafting DB | done | 46ee36c | 38954769628 | migration 0036 (report_versions, report_blocks, compose_report, compute_report_summary), test 45 (D-6A-M1, D-6A-blocks, D-6A-summary) |
| 6B management comments DB | done | a25cab4 | 38956498574 | migration 0037 (report_comments, add/resolve RPCs, open_report_comment_count), test 46 (D-6B-M1, D-6B-resolution, D-6B-open-count) |
| 6C freeze/issuance DB | done | 3c55c7b | 38956498574 | migration 0040 (freeze_report, issue_report), test 49 (open-comment gate, CAP gate, ledger, queued email) |
| 6D CAP register DB | done | 646c722 | 38956498574 | migration 0038 (caps, update_cap, close_cap, check_cap_reconciliation), test 47 (D-6D-M1, D-6D-CAP) |
| 6E email queue DB | done | 838f935 | 38956498574 | migration 0039 (email_queue, queue_email), test 48 (org sees sent/failed only; provider_config hidden) |
| 6F Phase 6 tests | done | cc18f65 | 38975709496 | test 55 phase-6 acceptance (cross-org, anon, no-right, queue visibility, platform L2) |
| 6G Phase 6 data module | done | dd05ad3 | 38975709496 (cumulative) | src/data/{reports,caps,email}.ts + phase6.test.ts |
| 6H Phase 6 UI | todo | | | |
| 6I Phase 6 docs | todo | | | |
| 7A exports DB | done | 4f16408 | 38975709496 (cumulative) | migration 0041 (exports_log, log_export, export_*), test 50 (D-7A-M1/M1b/M1c) |
| 7B imports DB | done | efc4073 | 38975709496 (cumulative) | migration 0042 (import_jobs, start/validate/commit_import), test 51 (D-7B-M1) |
| 7C activity archival DB | done | fc08a1e | 38975709496 (cumulative) | migration 0043 (archive_jobs, archive_activity_period), test 52 (D-7C-M1, D-7C-append-only, D-7C-right, D-7C-storage) |
| 7D prior-year import DB | done | 2c2b78b | 38975709496 (cumulative) | migration 0044 (prior_year_imports, import/confirm/revert, sign_planning gate), test 53 (D-7D-M1/M1b/revert) |
| 7E Phase 7 tests | done | 502e838 | 38975709496 | test 56 phase-7 acceptance (cross-org, anon, no-right, export ledger, prior-year sign-off gate, import org scope) |
| 7F Phase 7 data module | done | 18beb52 | 38975709496 (cumulative) | src/data/{exports,imports,archival}.ts + phase7.test.ts |
| 7G Phase 7 UI | todo | | | |
| 7H Phase 7 docs | todo | | | |
| 8A platform portal DB | done | (0031, earlier) | 38956498574 | tenant_settings, platform_trail, platform_* RPCs; test 40 (D-PLATFORM-RIGHTS) |
| 8B support access DB | done | (0031, earlier) | 38956498574 | support_access_grants, grant/revoke RPCs; test 40 |
| 8C AI enablement DB | done | 92ba68f | 38975709496 | 0045 extends platform_enable_ai to write the org ledger (D-8C-M1, D-8C-ledger) |
| 8D invite-cap control DB | done | (0031, earlier) | 38956498574 | platform_set_invite_cap; test 40 |
| 8E Phase 8 tests | done | 92ba68f | 38975709496 | test 57 phase-8 acceptance |
| 8F Phase 8 data module | done | (src/data/platform.ts, earlier) | 38956498574 | src/data/platform.ts + platform.test.ts |
| 8G Phase 8 docs | todo | | | |
