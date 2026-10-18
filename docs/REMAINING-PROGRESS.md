# Remaining build — progress

Base: `feature/config-control-plane`, head `96e7da6`, PR #10 open against `main`.

One line per task: ID, commit hash, CI run ID, result (green / fixed / blocked).
Every line carries the CI run ID, not only "green".

| Task | Commit | CI run | Result | Notes |
|---|---|---|---|---|
| R1 CI step 6 | `5da8245` | 39053761954 (PR) + 39053801768 (dispatch) | green | M2: 59 `drop policy if exists` added to `0008_rls.sql`; CI `concurrency: provio-test-db, cancel-in-progress: false`. Local M6 double-pass = 1099 ok notices. |
| R2 keepalive | `ae344db` | 39055872082 | green | `/auth/v1/health` + apikey header, HTTP 200. Root cause: secrets carry a trailing newline → curl exit 3 (malformed URL); previous scheduled runs (38998676131, 38845588310) failed the same way. Fixed by stripping whitespace in the workflow. |
| R3 hygiene | `0cc1a4e` | 39056079271 | green | `.patch` already gone (C0b `23d915a`); `git rm -r docs/reference/v1` (60 files), HANDOFF note updated |
| R4 non-blocking overlays | `c5d5780` | (pending) | pushed | palette → dropdown under header; calendar `role="dialog"` → `role="region"`; allow-list narrowed to the 4 chrome files; new `CommandPalette.test.tsx` |
| R5 guards | `a75f595` | (pending) | green | role guard extended (`platform_admin`, `teamRole`, `role_slug`/`slug`); allow-list = ROLE-CHECKS DISPLAY/SCOPE files; singleClient confirmed green (3 tests) |
| R6c passwords | `063d4cd` | (pending) | green | one random password per synthetic user per run; map in git-ignored `e2e/.auth/passwords.json`; specs use `passwordFor(email)` |
| R6d browsers | `e6fe7f1` | (pending) | green | `chromium`/`firefox`/`webkit` projects; CI step 7 pins `--project=chromium`; `browsers.yml` dispatch-only |
| R6a persisted records | `ab85434` + fix | (pending) | fixed | SIRA + Audit Plan read persisted model/cycles/plan/versions/gate outcomes via `src/data`; `latestPlanForUniverse`, `listGateOutcomes`; `e2e/r6a.spec.ts` (preparer); unit tests `src/data/r6a.test.ts` |
| R6b XLSX import | `f5cdb56` | (pending) | green (unit) | `src/lib/xlsx.ts` (dynamic SheetJS) + `xlsx@0.18.5`; wizard routes `.xlsx/.xls/.xlsm`; `e2e/r6b.spec.ts` (audit_manager) + `e2e/fixtures/rcm-sample.xlsx`; unit tests `src/lib/xlsx.test.ts` |
