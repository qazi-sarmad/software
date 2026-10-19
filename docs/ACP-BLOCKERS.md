# ACP blockers

## B-push-token — the GitHub token is invalid, so no commit can be pushed or CI dispatched

- Raised: 2026-10-19, during S6.
- Symptom: every authenticated GitHub call fails.
  - `curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user` → **401 Bad credentials**.
  - `curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/repos/qazi-sarmad/software` → **401**.
  - `GH_TOKEN="$GITHUB_TOKEN" gh api repos/qazi-sarmad/software/pulls/10` → **401 Bad credentials**.
  - `GIT_TERMINAL_PROMPT=0 git push https://x-access-token:${GITHUB_TOKEN}@github.com/qazi-sarmad/software.git`
    → `remote: Invalid username or token. Password authentication is not supported for Git operations.`
- The token is a `ghu_`-prefixed user token of length 40; it is rejected by both the REST API and the
  git transport, so it is expired or revoked, not merely under-scoped.
- What was tried: the token through the REST API (`token` and `Bearer` schemes), through `gh api`, and
  through `git push` with the token in the URL. All four fail. Retried across several commands in case
  the secret refreshed; it did not.
- Effect: S4, S5 and S6 are **green locally only**. No CI run id can be recorded for them, and the
  branch `feature/board-ai-control-plane` exists only in this sandbox. The work is committed locally
  and intact; nothing is lost.
- Owner action: refresh the `GITHUB_TOKEN` secret, then run
  `git push origin feature/board-ai-control-plane` (or re-run this session) so CI can run. The commits
  for S4.d, S5.a-d and S6.a-d are ready to push as they stand.
- Not a code defect: no migration, test or source file is implicated.

