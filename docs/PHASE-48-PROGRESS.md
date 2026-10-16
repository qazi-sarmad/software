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
| 4A plan docs | done | 0e5bfee | _see CI_ | docs/PHASE-4-PLAN.md; migrations 0025+, tests 33+ |
| 4B planning DB | done | f772dba | 38895859440 | green — migration 0025, test 33 (D-4B-M1, D-4B-scope, D-4B-four-eyes, D-4B-reconciliation) |
| 4C population gate DB | done | c0ebd01 | _see CI_ | migration 0026, test 34 (D-4C-M1, D-4C-status, D-4C-row-count) |
| 4D sampling engine DB | done | _pending_ | _see CI_ | migration 0027, test 35 (D-4D-M1, D-4D-column-name, D-4D-locked-immutability, D-4D-seed, D-4D-sample-size) |
| 4E row testing DB | todo | | | |
| 4F analyst engine | todo | | | |
| 4G Phase 4 tests | todo | | | |
| 4H Phase 4 data module | todo | | | |
| 4I Phase 4 UI | todo | | | |
| 4J Phase 4 docs | todo | | | |
| 5A findings DB | todo | | | |
| 5B conclusion DB | todo | | | |
| 5C floating window | todo | | | |
| 5D document viewer DB | todo | | | |
| 5E Phase 5 tests | todo | | | |
| 5F Phase 5 data module | todo | | | |
| 5G Phase 5 UI | todo | | | |
| 5H Phase 5 docs | todo | | | |
| 6A report drafting DB | todo | | | |
| 6B management comments DB | todo | | | |
| 6C freeze/issuance DB | todo | | | |
| 6D CAP register DB | todo | | | |
| 6E email queue DB | todo | | | |
| 6F Phase 6 tests | todo | | | |
| 6G Phase 6 data module | todo | | | |
| 6H Phase 6 UI | todo | | | |
| 6I Phase 6 docs | todo | | | |
| 7A exports DB | todo | | | |
| 7B imports DB | todo | | | |
| 7C activity archival DB | todo | | | |
| 7D prior-year import DB | todo | | | |
| 7E Phase 7 tests | todo | | | |
| 7F Phase 7 data module | todo | | | |
| 7G Phase 7 UI | todo | | | |
| 7H Phase 7 docs | todo | | | |
| 8A platform portal DB | todo | | | |
| 8B support access DB | todo | | | |
| 8C AI enablement DB | todo | | | |
| 8D invite-cap control DB | todo | | | |
| 8E Phase 8 tests | todo | | | |
| 8F Phase 8 data module | todo | | | |
| 8G Phase 8 docs | todo | | | |
