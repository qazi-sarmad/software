# WRITE-1 blockers

Full text of each blocker: the error, the attempts, the commit hash. Empty when nothing is blocked.

## B-W-PR-TOKEN — the draft pull request cannot be opened with the supplied token (2026-10-26)

Not a code defect, and not under the break protocol's revert rule: the build is green and the branch
is pushed. The pull request is the only step that fails, and it fails for a permission reason.

- **What was attempted.** Create one draft pull request, `feature/writing-engine` into `main`, title
  "Provio: deterministic writing engine (Evidence-Bound Claim Graph)", body from `docs/WRITE-REPORT.md`,
  last line "Authored by: Qazi Sarmad Ali Mahesar".
- **Attempt 1.** `gh api --method POST repos/qazi-sarmad/software/pulls --input /tmp/pr.json`
  (REST, JSON body with `"draft": true`). Response, verbatim:
  `{"message":"Resource not accessible by integration","documentation_url":"https://docs.github.com/rest/pulls/pulls#create-a-pull-request","status":"403"}`,
  exit 1. `gh` stderr: `gh: Resource not accessible by integration (HTTP 403)`.
- **Attempt 2.** The `create_pr` tool, same repository and branches. Error:
  `Error creating pull request: Unknown error: Client error '403 Forbidden' for url
  'https://api.github.com/repos/qazi-sarmad/software/pulls'`.
- **Diagnosis.** `GITHUB_TOKEN` is a GitHub App installation token, not a user token. The REST
  response "Resource not accessible by integration" is the standard reply when the App lacks the
  `pull_requests: write` permission. Read access works (`gh api repos/qazi-sarmad/software` returns
  the repository, `.private` is `false`), and pushes work, so the gap is exactly PR creation.
- **Commits.** No commit was reverted: nothing in the repository caused this. Head at the time of the
  attempts: `afb8219` (branch `feature/writing-engine`), after `b50b156` (W10.3) and `9914369`
  (report counts).
- **State left behind.** Branch pushed and green. CI run `40314836257` at `b50b156` is success on
  every step; the two follow-up commits only change `docs/WRITE-REPORT.md`.
- **What the owner must do.** Open the draft pull request from the branch, or grant the token/App the
  `pull_requests: write` permission and re-run
  `gh api --method POST repos/qazi-sarmad/software/pulls --input /tmp/pr.json`. The body to use is
  `docs/WRITE-REPORT.md` on the branch.
