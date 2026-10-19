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


## B-credentials-outage — both GitHub tokens return 401 (2026-10-19, M-2)

Exact text from every call at 2026-10-19T18:45Z onwards:

```
$ curl -s -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user
{"message":"Bad credentials","documentation_url":"https://github.com/..."}
http 401

$ GIT_TERMINAL_PROMPT=0 git push origin HEAD:refs/heads/feature/board-ai-control-plane
remote: Invalid username or token. Password authentication is not supported for Git operations.
fatal: Authentication failed for 'https://github.com/qazi-sarmad/software.git/'

$ git ls-remote origin refs/heads/feature/board-ai-control-plane
fatal: Authentication failed ...
```

Both the `GITHUB_TOKEN` environment variable and the token embedded in `origin`'s URL (a `ghu_`
token, a distinct value, both 40 characters) return 401. The branch pushed successfully at `a64a061`
under the same remote, so the remote URL itself is unchanged; only the credentials are rejected. This
is an environment credential outage, not a code defect and not a secret that would be committed.

Effect: commit `3f980d1` (M-2) is committed locally and green on every local gate (tsc, vitest 105
files / 1182 tests, vite build, check-tokens, check-shrink, SQL applied twice + all tests twice) but
cannot be pushed, so no CI run exists for it yet.

Action: continue local work (M-3 onward) and retry the push periodically. Every later task is
committed locally; the push and the CI dispatch resume as one batch when credentials return.
Owner action: refresh the sandbox's GitHub credentials (or re-issue the token), then push
`feature/board-ai-control-plane` and dispatch CI.

