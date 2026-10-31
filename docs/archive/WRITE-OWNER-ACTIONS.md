> ## ⚠️ STALE — ARCHIVED, DO NOT TRUST
>
> This document predates the code-verified audit of 2026-10-27/28 and is kept for history only.
> Its status claims are **not** reliable: the audit found the app was not database-backed in
> production, the engagement lifecycle was never persisted, several documented-as-Present features
> were dead code, and many "all Present" claims were false.
>
> **Current sources of truth:**
> - `docs/SPEC-v10.md` — the specification (unchanged, still authoritative)
> - `docs/FUNCTIONALITY-AUDIT.md` — what is actually built (code-verified)
> - `docs/REMEDIATION-PLAN.md` — the plan being executed
> - `docs/SCALE-TASKS.md` — live task ledger
>
> Do not cite this file as evidence that anything works.

# Owner actions (WRITE-1)

Actions only the owner can take. The engine is built and green; these are the things the build
cannot do for you.

1. **Make the repository private now.** `gh api repos/qazi-sarmad/software --jq .private` returns
   `false`. The repository is public, so every commit is a public disclosure of the engine. Making it
   private is the first step to protect the invention. Do this before publishing any further engine
   detail.
2. **Engage a patent attorney before any further public disclosure.** The patent record (invention
   disclosure, draft claim families, prior-art map, embodiments, development log, public-disclosure
   review) is in the scratchpad directory `/workspace/project/patent-record/`. It was deliberately
   not committed, because the repository is public. Move it out of the sandbox and give it to
   counsel.
3. **Have a qualified internal auditor review and release the first-wave phrases, monitor rules and
   tests.** No phrase or monitor rule is released by this build. Use the review workbook export (one
   row per phrase variant with a rendered sample) to read the whole matrix, then release.
4. **Supply sandbox credentials for each connector you want live-verified.** Enter them in the
   platform wizard's connector setup, never in chat and never in the repository. Every adapter is
   marked "live-verified: NO" until then. See `docs/CONNECTORS.md`.
5. **Open (or review and merge) the draft pull request.** The build could not open it: the supplied
   `GITHUB_TOKEN` is a GitHub App token without the `pull_requests: write` permission, so
   `POST /repos/qazi-sarmad/software/pulls` returns HTTP 403 (see `docs/WRITE-BLOCKERS.md`,
   `B-W-PR-TOKEN`). Open the draft pull request from `feature/writing-engine` into `main`, or grant the
   permission and re-run the command in the blocker entry. Do not merge without reading it.
6. **Deploy and set credentials as described in `docs/DEPLOY-RUNBOOK.md`**, where that document
   exists.
