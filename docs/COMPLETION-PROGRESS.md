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
