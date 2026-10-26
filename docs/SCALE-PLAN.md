# SCALE-1 plan: writing-engine hardening, gap closure, scale and isolation

Task WP0. Branch `feature/scale-harden-v1`, cut from `feature/writing-engine` at `f2aaa5b`
("docs: cite the green CI run at the final head (W15.3)"), which is the green head. Nothing in this
plan is parked: every item below has a named implementation and a named test. There is no
"owner decision required" entry. The only remaining pure-owner actions are listed at the end of
`docs/SCALE-REPORT.md` and are infrastructure the sandbox cannot reach (deploy Edge Functions, supply
connector credentials, open the PR if the token still lacks `pull_requests:write`).

## Baselines at the branch point (WP0)

Recorded from a local run on this commit, with the commands named. Every count below is compared to
these later, never stated as an absolute expectation.

| Object | Baseline | How measured |
|---|---|---|
| Migrations | 94 (highest `0094_verify_report_root.sql`) | `ls supabase/migrations/*.sql \| wc -l` |
| SQL test files | 97 (highest `99_verify_report_root.sql`) | `ls supabase/tests/*.sql \| wc -l` |
| SQL assertions (`provio_test.assert_*`) | 1603 | `grep -rho 'provio_test.assert_[a-z_]*' supabase/tests/*.sql \| wc -l` |
| vitest files / tests | 164 / 1901 | `npx vitest run` |
| Playwright spec files / tests | 25 / 116 | `ls e2e/*.spec.ts \| wc -l`; `grep -rhE '^\s*(test\|it)\(' e2e/*.spec.ts \| wc -l` |
| Guards (`src/guards/*.test.ts`) | 19 | `ls src/guards/*.test.ts \| wc -l` |
| Guard tests | 78 | `grep -rhE '^\s*(test\|it)\(' src/guards/*.test.ts \| wc -l` |

The branch point is green locally: `npx tsc --noEmit` clean; `npx vitest run` 164 files / 1901 tests
pass; `npx vite build` built; `node scripts/check-tokens.mjs` 165 files / 0 violations;
`node scripts/check-shrink.mjs` 58 files no shrink; `node scripts/check-ui-contract.mjs` 48 Appendix A
screens; `node scripts/check-function-deploy-list.mjs` 7 functions; `bash scripts/local-sql-harness.sh`
applies every migration twice and passes every SQL test twice. CI run **40326076245** on the parent
branch is green on every step (1–16).

## The remaining-gap list (from PARITY.md, NOT-DONE.md, COMPLETION-BLOCKERS.md)

Each entry is the gap exactly as the three documents state it, then the implementation this branch
will build. No entry is deferred.

### G1 — §2 cross-universe view-only sharing — Missing (the one whole clause with no code)

Spec §2: "Sharing outside a Universe is view-only, granted by a Level-1 or Level-2 Head, with in-app
and email notification." Decision `D-P0-2`: sharing is within one org, across universes; the
shareable object is the engagement plus its findings and CAPs, read-only; optional expiry; revocable
by the granting Head, a higher Head, or an Org Admin.

Implementation:

1. **Migration `0095_universe_sharing.sql`.** Table `universe_shares(id, org_id, universe_id,
   grantee_id, granted_by, expires_at, revoked_at, revoke_reason, created_at)`. It is org-scoped
   (`org_id = jwt_org_id()` on every policy): cross-*org* sharing stays deferred per D-P0-2, so the
   law "data never leaves the tenant" is untouched — a share moves data between two *universes of the
   same tenant*, for a grantee who is already a member of that tenant.
2. **Grant / revoke RPCs.** `share_grant(p_universe_id, p_grantee_id, p_expires_at)` requires the
   caller to be a Level-1 or Level-2 Head of the org (`org_members.hierarchy_level in (1,2)`) **or**
   an Org Admin, requires the grantee to be an active member of the same org, and refuses
   self-sharing. `share_revoke(p_share_id, p_reason)` requires the granting Head, a higher Head, or an
   Org Admin. Both are `security definer`, both append a ledger entry and an `activity_log` row.
3. **Read-only projection with a new RLS shape.** The normal tenant read path stays
   `org_id = jwt_org_id()` — unchanged. The share adds a *separate* function
   `shared_universe_read(p_universe_id)` that is `security definer`, checks a live (unrevoked,
   unexpired) share row for `auth.uid()` **and** `jwt_org_id()` equality, and returns the universe's
   entities/engagements read-only. It never weakens any existing policy: it is a second door for a
   grantee who is already inside the org, and it logs every read (`share_read_log`).
4. **In-app + email notification on grant.** Reuse the automation engine: the grant RPC inserts a
   `notifications` row for the grantee and calls `queue_email(...)`.
5. **Screen** `SharePanel.tsx` under Org Admin (OA-25) with testids for grant / list / revoke.
6. **Tests.** SQL `100_universe_sharing.sql` (positive: grant then read; negative: non-Head cannot
   grant, revoked share invisible, expired share invisible, normal tenant data still isolated under
   `jwt_org_id()`). Playwright `s13-sharing.spec.ts`.

### G2 — §10.1 configurable grace period before the Testing hard lock — Partial

The hard lock exists and is tested (`0025_planning.sql` `guard_testing_lock()`; sql
`33_planning.sql`); the configurable overlap does not.

Implementation: add `testing_grace_days smallint not null default 0` to `org_lifecycle_settings`
(migration `0096_lifecycle_grace.sql`); thread it through `admin_save_lifecycle_settings` and
`lifecycle_settings_get`; make `guard_testing_lock()` allow a testing workpaper when
`now() < planning_signoff_at + testing_grace_days` even without sign-off. Thread the field through
`LifecycleSettings` in `src/data/governance.ts`. Tests: extend `supabase/tests/91_org_governance_settings.sql`
and `33_planning.sql`; unit tests for the pure grace-window predicate in `src/lib/lifecycle.ts`.

### G3 — §11.4 central pre-flight with acknowledge-with-reason — Partial

Eight checks exist scattered across panels; no single named module, no acknowledge RPC.

Implementation: a pure module `src/lib/preflight.ts` exporting `runPreflight(input)` that returns a
structured report over the eight checks (exceptions without rationale; unresolved flags; missing
evidence; sample below floor; reviewer equals preparer; incomplete findings; unanswered comments; an
eighth completeness check). A new table `preflight_acks` and RPC `acknowledge_preflight(p_scope,
p_scope_id, p_check_key, p_reason)` modelled on `planning_reconciliation_acks` /
`acknowledge_planning_discrepancy` (0025), append-only, logged to ledger + `activity_log`. Unit tests
`src/lib/preflight.test.ts`; SQL `101_preflight.sql`.

### G4 — §17.1 pop-out Realtime sync test — Partial (implementation present, test absent)

The pop-out window and its same-origin URL exist (`FloatingWindow.tsx` `popOutUrl`, wired in
`FloatingWindowManager.tsx:76` to `/view/<recordType>/<recordId>`). The repo's "Realtime" is in fact a
documented poll fallback (`ConsultationBanner.tsx` polls every 5 s; there is no
`supabase.channel(...)` anywhere in `src/`). So the test proves the documented poll-fallback keeps the
pop-out in sync, and proves the `/view/` route renders the same record.

Implementation: Playwright `s14-popout-sync.spec.ts` — open the Audit File window, pop it out, assert
the pop-out renders the same record content, then change the underlying record and assert the pop-out
picks the change up within the poll window. Document the fallback in `docs/UI-INVENTORY.md`.

### G5 — §22 Realtime in-app notification delivery test — Partial

Notifications are delivered into the Work Queue; no delivery test.

Implementation: Playwright `s15-notifications.spec.ts` — create the event that queues a notification
(escalation / grant), then assert the row appears in the Work Queue for the target user within the
poll window. The `notifications` table is read-only for tenants (`0055`), written by the
SECURITY-DEFINER engine, so the test drives the real emitter, not an insert.

### G6 — §3 / §25.7 mobile viewport smoke — Partial

Implementation: Playwright `s16-mobile.spec.ts` at 375×800 covering ethics sign-off, a simple
approval, and report viewing.

### G7 — §3 dedicated/self-hosted switch — Partial (owner action)

The deployment switch is a hosting decision the repository cannot flip. The code path (hosting fit,
migration jobs, deployment kit) is Present; what remains is the owner running it against a real
target. This is recorded as a pure-owner action in `SCALE-REPORT.md`, not as a code gap.

### G8 — §25.4 free-tier limit verification — Partial (owner action)

Cannot be verified from the repository; recorded as a pure-owner action. WP4 documents the hard
limits the tests actually discover (row counts, concurrency) in this file rather than inventing
infrastructure.

### G9 — WRITE-1 blocker B-W-PR-TOKEN — the draft PR could not be opened

`GITHUB_TOKEN` is a GitHub App installation token without `pull_requests:write`. Re-tested in WP8; if
still blocked, the exact PR body is recorded in `SCALE-REPORT.md` and the blocker entry stays.
`docs/WRITE-BLOCKERS.md` is updated if the issue is still present.

## Work-package order and what each proves

- **WP1** writing-engine depth and adversarial suite. Large graph, broken inputs that must never seal,
  all 100 matrix cells under mutated fixtures, concurrent realisation, offline tampering, a documented
  500-claim performance budget.
- **WP2** closes G1–G6 above. Every former Partial/Missing becomes Present in PARITY.md and NOT-DONE.md.
- **WP3** Super Admin guided provisioning: platform RPCs + wizard steps + tests, so a non-technical
  Super Admin stands up client N with no further code.
- **WP4** multi-tenant scale and isolation: ≥3 concurrent orgs, invite-cap and feature-flag isolation,
  support-grant surface, load-oriented tests, documented hard limits.
- **WP5** connectors and monitoring: 22 adapters stay fixture-verified, deterministic monitor rules
  stay pure and versioned, contract tests against local mock servers stay green, no live calls.
- **WP6** end-to-end system suite: SA creates an org → invite → engagement lifecycle → report → CAP →
  export → cross-universe share, with an isolation assertion and a mobile smoke in the same run.
- **WP7** `docs/UI-INVENTORY.md`: the single source of truth for the parallel UI redesign.
- **WP8** close-out: final docs, the full gate set, the branch push.

## Gates run after every code WP

`npx tsc --noEmit`; `npx vitest run`; `npx vite build`; `node scripts/check-tokens.mjs`;
`node scripts/check-shrink.mjs`; `node scripts/check-ui-contract.mjs`;
`node scripts/check-function-deploy-list.mjs`; `bash scripts/local-sql-harness.sh` (migrations twice,
tests twice); and Playwright chromium when the local stack allows. CI is dispatched at the end if it
is healthy; otherwise the local results are the evidence and are recorded verbatim.

## Hard limits discovered (filled in by WP4)

To be completed in WP4 from what the tests actually measure. Nothing here is guessed.

- _(WP4 fills this in.)_
