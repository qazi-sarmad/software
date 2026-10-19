# ACP blockers

## B-push-token — RESOLVED 2026-10-19: the branch is pushed and CI runs again

- Resolution: the `GITHUB_TOKEN` environment variable is stale (401 on every call), but the token
  embedded in `origin`'s URL is **valid** (`200` from `/user`). Pushing through `origin` therefore
  works: `git push origin HEAD:refs/heads/feature/board-ai-control-plane`.
- Practical rule for the rest of this run: get the working token with
  `TOK=$(git remote get-url origin | sed -E 's#.*x-access-token:([^@]*)@.*#\1#')` and pass it as
  `GH_TOKEN="$TOK" gh ...`. Do not use the bare `$GITHUB_TOKEN`; it is the stale one.
- Original symptom (kept for the trail): `curl -H "Authorization: token $GITHUB_TOKEN" .../user`
  → 401; `GIT_TERMINAL_PROMPT=0 git push https://x-access-token:${GITHUB_TOKEN}@github.com/...`
  → `remote: Invalid username or token.`
- No code defect was involved; no commit was lost.

## M-1 error (exact text, run 39292142326 on commit 3454417)

Quoted verbatim from the job log (job 118195605743), step "6. Migrations and SQL tests (test project only)":

```
psql:supabase/tests/14_reopen.sql:5: ERROR:  deadlock detected
DETAIL:  Process 713818 waits for AccessExclusiveLock on relation 17687 of database 5; blocked by process 714663.
Process 714663 waits for AccessShareLock on relation 17614 of database 5; blocked by process 713818.
HINT:  See server log for query details.
CONTEXT:  SQL statement "truncate orgs cascade"
PL/pgSQL function provio_test.seed() line 6 at SQL statement
##[error]Process completed with exit code 3.
```

Diagnosis: `truncate orgs cascade` takes AccessExclusiveLock on every table that references orgs. A
concurrent session (process 714663, AccessShareLock on relation 17614) held a read lock. The run
before it (39290788312) was cancelled mid-step; a Supavisor-pooled backend can survive a cancelled
run for a while and keep a lock. The deadlock is therefore intermittent: the same commit passed step
6 on the earlier run 39290788312. Fix in M-1-FIX: take a session advisory lock around the truncate so
it never races another session, and retry once on a deadlock.

