# Remaining build — progress

Base: `feature/config-control-plane`, head `96e7da6`, PR #10 open against `main`.

One line per task: ID, commit hash, CI run ID, result (green / fixed / blocked).
Every line carries the CI run ID, not only "green".

| Task | Commit | CI run | Result | Notes |
|---|---|---|---|---|
| R1 CI step 6 | `5da8245` | 39053761954 (PR) + 39053801768 (dispatch) | green | M2: 59 `drop policy if exists` added to `0008_rls.sql`; CI `concurrency: provio-test-db, cancel-in-progress: false`. Local M6 double-pass = 1099 ok notices. |
| R2 keepalive | (pending) | (pending) | in progress | `/auth/v1/health` + apikey header + HTTP code |
