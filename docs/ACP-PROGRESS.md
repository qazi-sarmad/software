# ACP progress

Branch: `feature/board-ai-control-plane`. Base: `feature/config-control-plane` head `3678c93` (PR #10 open, so this branch stacks on it).

## H0 baselines (recorded 2026-10-19, before any ACP change)

| Metric | Baseline |
|---|---|
| vitest files | 75 |
| vitest tests | 791 |
| SQL test files | 63 |
| SQL assertions (one pass) | 1243 |
| migrations | 49 (next number **0050**) |
| SQL tests | 63 files, next number **64** |
| Playwright spec files | 12 |
| Playwright tests | 49 |
| check-tokens files scanned | 105 |
| check-shrink files verified | 58 |
| base branch CI run | 39203217570 green (all 7 steps) |

Local harness: PostgreSQL 17.11, database `provio_test`, `/tmp/auth_shim.sql` + `/tmp/run_sql_tests.sh`
(migrate x2, test x2). Both passes green at baseline.

## Tasks

| Task | Commit | CI run | Result | Notes |
|---|---|---|---|---|
| S0 housekeeping (xlsx vendoring, no-JSON guard) | 846c236 | 39241755386 | green | D-S0-xlsx, D-S0-scandirs, D-S0-json |
| S1.a db: control plane foundations | 3f1502b | 39244058813 | fixed | rights to 15 keys, config_areas, consultation, entitlements, wizards, tutorials |
| S1.a-FIX | a320de7 | (folded into S1.b run) | fixed | SQL test corrections |
| S1.b lib+data: ACP data modules | f33981a | 39244823463 | green | setup, consultation, tutorials, platformSettings, entitlements, featureMap |
| S1.c app: ACP screens, e2e, history read | (this commit) | pending | pending | OrgControlPanel tabs, SetupWizard, ConsultationBanner, SuperAdmin panels, acp-control-plane.spec.ts |
| S1.d docs: decisions, progress, UI contract | (this commit) | pending | pending | ACP-DECISIONS.md, ACP-PROGRESS.md, ACP-UI-CONTRACT.md |
