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
| R5 guards | (pending) | (pending) | in progress | role guard extended (`platform_admin`, `teamRole`, `role_slug`/`slug`); allow-list = ROLE-CHECKS DISPLAY/SCOPE files; singleClient confirmed green (3 tests) |
