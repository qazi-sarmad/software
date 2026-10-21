# Completion build blockers

A blocker is recorded here with the exact error text, what was tried, and the commit hash.

## CI infrastructure: two GitHub runs executed zero steps (2026-10-21)

- Runs **39604710289** and **39604815983**, both on head `7a5dbef`, dispatched with
  `gh api -X POST repos/qazi-sarmad/software/actions/workflows/ci.yml/dispatches -f ref=feature/board-ai-control-plane`.
- Both reported `completed / failure` in three to four seconds. The jobs endpoint returns one job,
  `gates`, with `conclusion: failure` and **`steps: []`** — no step ever started:
  `started_at 2026-10-21T13:03:50Z`, `completed_at 2026-10-21T13:03:53Z`.
- Fetching the job log returns an Azure blob error, not a log:
  `<?xml version="1.0" encoding="utf-8"?><Error><Code>BlobNotFound</Code><Message>The specified blob
  does not exist.</Message>...` with `gh: HTTP 404`.
- Diagnosis: a platform-side failure to start the runner. Nothing in the repository is implicated —
  no step ran, so no gate produced a result. The earlier run 39600173573 on `fad1a3c` did start and
  did run all steps.
- What was tried: two separate dispatches, both within 30 seconds of the push; both failed
  identically. Not retried further, because the standing directive pauses the GitHub workflow and
  moves verification to `scripts/ci-local.sh`.
- Consequence: **the C2.4 fix (`fad1a3c`, `7a5dbef`) has never been exercised by the GitHub
  workflow.** Its Playwright spec is verified locally only, and only if the local run has Supabase
  credentials.
- Owner action: re-dispatch CI on `7a5dbef` (or push an empty commit) when the platform is healthy.

