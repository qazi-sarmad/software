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


## §2 cross-universe view-only sharing — Missing (C3.1)

Spec §2: "Sharing outside a Universe is view-only, granted by a Level-1 or Level-2 Head, with in-app
and email notification." No share table, RPC, projection, notification or screen exists (`grep -rn
'sharing\|grant_share\|share_universe' supabase/migrations` → none; the only hits are the phrase
"shared helpers" and a SIRA comment). An Org Admin scope grant (`admin_grant_scope`, 0017) scopes a
membership and is not cross-universe sharing.

Why it was not built in this run: it needs a new table (grant, grantee, universe, granted_by, expiry,
revoked_at), a grant/revoke RPC that checks a L1/L2 Head attribute (the org-hierarchy level is on
`org_members.hierarchy_level`, so the check is a level test), a read-only projection of the shared
universe's entities/engagements into the grantee's session (a new RLS shape, the first read path not
keyed on `jwt_org_id()` equality), an in-app + email notification on grant, a screen, and both a SQL
cross-share test and a Playwright path. That is a full slice, and a Law-sensitive one (a second read
path could weaken §4.3 RLS if done carelessly), so it is recorded rather than rushed. Owner decision
requested: build it, or amend §2 to defer it.

## §10.1 configurable grace period before the Testing hard lock — Partial (C3.1)

Spec §10.1: "Testing is locked until Planning sign-off. The organisation can allow limited overlap
with a configurable grace period before the hard lock." The hard lock is implemented and tested
(`0025_planning.sql`; sql `33_planning.sql`). The configurable overlap/grace period is not: no
`grace` setting column or RPC exists. Owner decision: add the setting (a small addition to 0082's
lifecycle settings plus a lock check), or amend the text.

## §11.4 pre-flight before submission — Partial (C3.1)

Spec §11.4 lists eight pre-flight checks and an acknowledge-with-a-logged-reason path. Individual
checks exist in the testing panels and `src/lib/`, but there is no single named pre-flight function
that runs the whole list and no SQL path that records an acknowledgement with a reason. Owner
decision: centralise into one pure module with unit tests plus a `acknowledge_preflight` RPC, or
accept the per-panel checks as sufficient.

## §3 / §25.7 mobile viewport for the three phone paths — Partial (C3.1)

Spec §3 and §25.7: phone access covers ethics sign-off, simple approvals and report viewing. The app
is responsive, but no mobile-viewport Playwright test exercises those three paths. Missing: a
viewphone-viewport smoke. Low risk; recorded for completeness.

## §25.4 Supabase free-tier limits verified before production use — Partial (owner action)

Spec §25.4 and §32 item 1: the current free-tier figures must be checked on Supabase's pricing page
before production use. This cannot be verified from the repository. Owner action.

## Owner action: deploy the Edge Functions and confirm platform services

The Edge Functions in `supabase/functions/` (ai-gateway, email-dispatch, graph-oauth, hosting-test,
invite-user, secrets-put, archive-upload, doc-extract) must be deployed:
`supabase functions deploy ai-gateway email-dispatch graph-oauth hosting-test invite-user secrets-put archive-upload doc-extract`.
Also confirm Vault, pg_cron and pg_net are enabled on the project, and set `SECRETS_MASTER_KEY` if
Vault is absent.
