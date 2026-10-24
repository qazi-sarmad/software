# Completion build report

Branch: `feature/board-ai-control-plane`. Base for the pull request: `main`.
The branch already contains every commit of PR #10's history, so this pull request supersedes it
(PR #10 is left open for the owner to decide).

This report covers the whole run: the security defects found in review (C1), the missing server
pieces (C2), the specification gap closure (C3), tutorial honesty (C4), the contract, parity and
screenshot work (C5), and the final verification (C6). Evidence lives in
`docs/COMPLETION-PROGRESS.md` (one line per task), `docs/COMPLETION-DECISIONS.md` (one record per
decision), `docs/COMPLETION-BLOCKERS.md` (full text of each blocker),
`docs/COMPLETION-SPEC-AUDIT.md` (clause by clause), `docs/COMPLETION-RPC-REVIEW.md` and
`docs/COMPLETION-EVENTS.md`.

## What was built

### C1 - security defects found in review (blocking, done first)

- **C1.1 `graph-oauth` let any signed-in user take another tenant's mailbox token.** The function
  only called `auth.getUser()`, never checked a right, an org or a feature, and its HTTP `refresh`
  action returned a live Microsoft access token for any `profileId` with the service role. It was
  moved into `supabase/functions/_shared/graphOauthHandler.ts` with injected dependencies; the
  `refresh` action is deleted; `start` returns a consent URL carrying an HMAC-signed, single-use,
  ten-minute `state`; `exchange` verifies the caller, the org (`config_write_mode` not `deny` and
  `has_feature('email_graph')`, or `is_platform_admin` for the platform flow), rejects forged,
  expired, replayed and mismatched-user state, stores the refresh token through the same path as
  `secrets-put`, and returns only `{ok, secretId, masked}`. The flow is wired through
  `src/data/emailOauth.ts` and the `/oauth/graph` callback, used by OA-11, SA-04 and the setup
  wizard. Commit `b87c46e`.
- **C1.2 every Edge Function entry point audited.** Handler-level tests and a static guard
  (`src/guards/edgeEntryPoints.test.ts`) prove the caller is verified before any service-role client
  is created and that no response carries a secret. Commit `8aa742f`.
- **C1.3 RPC authority review.** `docs/COMPLETION-RPC-REVIEW.md` lists every authenticated-executable
  security-definer function with how it derives the org, the right or feature it checks and the test
  that proves a cross-org refusal. A shared `provio_org_guard` replaced 29 inline checks, and a
  data-driven cross-org test was added. Commit `de24a82`.

### C2 - missing server pieces

- **C2.1 `hosting-test` Edge Function** - verifies the caller, checks `edit_config` and
  `has_feature('hosting_migration')`, reads the connection through a service-only wrapper, rejects
  metadata and link-local addresses, and returns a plain-language reachability report that never
  contains the password. The required extensions and roles are derived from the migrations in
  `_shared/requiredHostingSpec.ts`, with a test that the list matches them. New check
  `scripts/check-function-deploy-list.mjs`. Commit `f8f3c58`.
- **C2.2 scheduled jobs** - one migration schedules, behind pg_cron/pg_net existence checks: the
  daily CAP due-soon/overdue job (the overdue rule is written once in SQL and the app agrees by a
  parity test), `ai_purge_expired()`, `consultation_sweep()`,
  `escalate_overdue_deployment_requests()`, the expired-grant sweep, and the daily change-notification
  digest. SA-02 reads job health through a platform-only function. Commits `1134a89`, `16e4e18`.
- **C2.3 event emitters** - `docs/COMPLETION-EVENTS.md` lists every catalogue key against its
  emitter or an explicit "no source" reason; every event with a source is wired through one door
  (`emit_catalogue_event`), with a SQL test that fails on any key with neither an emitter nor a
  documented allow-list entry (only `watcher.signal` is allow-listed). Commit `0b91dea`.
- **C2.4 colleague invitation end to end** - one invitation path (the RPC), a public member
  acceptance route that creates the account and re-mints the JWT so the new membership is visible,
  and a Playwright test proving the whole path. Commits `9fd9192`, `fad1a3c`, `7a5dbef`, `3e4d3b2`.
- **C2.5 verified archival upload and population archival** - `archive-upload` uploads to private
  Storage, verifies the stored SHA-256 against the ledgered `content_hash`, and live rows are deleted
  only after the upload is `done`; population archival keeps the original file compressed, re-checks
  the hash on each download and raises an integrity alert on mismatch. Commit `7798e3e`.
- **C2.6 document extraction and rule-based review** - `doc-extract` handles DOCX, XLSX/CSV, text PDF
  and plain text, sets `extracted_text`, `page_count` and `extraction_status`, and stores legacy
  formats without extraction; the deterministic review checks are pure functions with fixtures.
  Commit `62aed5f`.
- **C2.7 binary exports and report issuance files** - real PDF, XLSX, DOCX, PNG/SVG and ZIP bundle
  with a manifest and per-file SHA-256; the report editor renders both formats from one block model;
  the frozen PDF carries the hash and freeze date; `log_export`'s hash covers the delivered bytes.
  Commits `4a2288f`, `98648ee`.
- **C2.8 DOCX import and import-path audit** - DOCX table parsing, and each import path (RCM,
  entities, users, populations, prior year) has a parser, mapping, preview, validation and log.
  Commit `528f05f`.
- **C2.9 tenant-granted read-only support session** - a platform admin may read only while an
  unexpired, unrevoked `content_read` grant exists; every read is written to a tenant-visible trail;
  there is no write path, and the default stays zero reads. Commit `d3b7f87`.

### C3 - specification gap closure

- **C3.1 clause audit** - `docs/COMPLETION-SPEC-AUDIT.md` has one row per numbered clause of §1-§29
  and §33, each with the code, SQL object and test that implements it, or Partial/Missing with the
  exact missing behaviour. Commit `607b6ef`.
- **C3.2 built from the audit** - §21 change control (routine vs material, configurable approvers,
  four-eyes, hash-chained approved changes) in `b71e05a`; §10 one-stage vs two-stage testing and
  per-stage sign-off roles, §11.3 Org Sampling Table admin, §12 BI parameter admin, §14.2
  finding-structure admin, §23 methodology and notification/retention settings, §20 file validation
  and the per-org size cap, §22 recipients by role in `d6303f3`. What remains is in
  `docs/COMPLETION-BLOCKERS.md` and `docs/NOT-DONE.md`, never silently dropped.

### C4 - tutorial honesty

All 85 GIFs were byte-identical placeholders that passed the gate. The ordered plain-language steps
and their target testids now live in `src/lib/tutorialKeys.json` and are rendered by the drawer; the
recorder drives each key by testid, draws a highlight and encodes 8-15 frames; `check-tutorials`
gained `--strict` (placeholder, frame count and empty `generated_at` all fail) and staleness is
`ui_hash`, not file mtime; a Playwright smoke records five keys and proves the output differs from
the placeholder. Commits `1cc2f5a`, `3b9818c`, `9de5ac2`, `fc68455`.

### C5 - contract, parity, screenshots

One contract section per Appendix A screen, enforced by `scripts/check-ui-contract.mjs`; PARITY and
NOT-DONE rebuilt as one current table/list each from the C3.1 evidence; a screenshot sweep in the
three presets and two themes, uploaded as a CI artifact; and a full-flow regression spec that walks
the whole product. Commits `36dbf58`, `1d78c08`, `963d266`, `fa48a0e`, `0f11b1b`.

### S5-AI - the last defect, fixed in this session

The `e2e/s5-ai.spec.ts` L2 test (tenant data never reaches a vendor-hosted model) was not flaky: it
guarded its only assertion with `if (await result.count())`, and the fixture never seeded the
`ai_assist` entitlement or `tenant_settings.ai_enabled`, so the plan refusal fired before the
vendor-hosted deny-list branch and the L2 rule had no test behind it. The fixture now seeds both,
the assertion is unconditional, and `src/guards/e2eAssertions.test.ts` fails on any spec that wraps
an assertion in a locator count/visibility check. That guard found the same shape in three more
specs (S2, S6, S9); each now asserts its fixture-guaranteed state, with an `escalation_events`
fixture added for S6. Commit `7b1ca92`.

## Real counts against the C0 baselines

Baselines are from the last green CI run (39516753943, head `a41d46e`).

| Measure | Baseline (C0) | Now |
|---|---|---|
| vitest files | 128 | 146 |
| vitest tests | 1428 | 1654 |
| SQL test files | 80 | 91 |
| migrations | 71 | 82 |
| SQL assertions (`provio_test.assert_*` call sites) | 1683 (baseline run) | 1499 static call sites (loops expand at run time; the harness reports all tests passed twice) |
| Playwright tests | 113 passed / 2 skipped | 122 collected; 127 passed / 2 skipped locally |

Local verification on the final head `7b1ca92`:
`npx tsc --noEmit` clean; `npx vitest run` 146 files / 1654 tests passed; `npx vite build` succeeded;
`node scripts/check-tokens.mjs` passed (168 files, 0 violations); `node scripts/check-shrink.mjs`
passed (58 files); `node scripts/check-ui-contract.mjs` passed (52 screens);
`node scripts/check-function-deploy-list.mjs` passed (8 functions, 16 references);
`TUTORIALS_ALLOW_PLACEHOLDER=1 npm run check-tutorials` passed (86 current, 0 stale);
`scripts/local-sql-harness.sh` applied every migration twice and ran every SQL test twice - green;
the full Playwright chromium suite passed 127 with 2 skipped.

CI on the final head cannot be green: the GitHub runner platform refuses to start the job (see
blockers). Run `39745950473` on `7b1ca92` reported `completed / failure`, job `gates`, `steps: 0`,
in about five seconds, with no log - the same signature the untouched `Keep test project awake`
workflow shows on `main`, so it is platform-side.

## Security defects found and fixed

1. `graph-oauth` cross-tenant token disclosure, missing authorisation, missing state, tokens returned
   to the browser - commit `b87c46e`.
2. `ai-gateway` TDZ self-reference and absent caller check - fixed before this run.
3. The vacuous L2 security assertion (an L2 rule with no test behind it) and three more skippable
   assertions - commit `7b1ca92`.

## Decisions

One line each; the full record (point, options, choice, reason, reversal) is in
`docs/COMPLETION-DECISIONS.md`.

1. D-C0-1 baseline counts come from the last green CI run, not a local run.
2. D-C0-2 the four completion docs are created in C0 and committed alone.
3. D-C1.1-1 the OAuth state key derives from `SECRETS_MASTER_KEY`, not Vault.
4. D-C1.1-2 the single-use nonce lives in a small service-role-only table.
5. D-C1.1-3 the HTTP `refresh` action is deleted, not gated.
6. D-C1.1-4 the client id is not treated as a secret.
7. D-C1.1-5 the callback route is outside the tenant shell, at `/oauth/graph`.
8. D-C1.1-6 the Playwright smoke stubs the Edge Function at the network boundary.
9. D-C1.2-1 the entry-point guard is a static check over each `index.ts`.
10. D-C1.3-a one shared `provio_org_guard` instead of 29 inline checks.
11. D-C1.3-b the discovery was two passes; the second was mechanical.
12. D-C1.3-c the guard returns early when no JWT claims are set.
13. D-C1.3-d the mask readers stay callable, they check the org first.
14. D-C2.1-a the driver is injected, so the function is testable without Deno or a database.
15. D-C2.1-b the requirement lists are derived from the migrations and asserted against them.
16. D-C2.1-c the probe reports the database size when it cannot read free space.
17. D-C2.1-d the deploy-list check reads `docs/` only, and only the same-line form.
18. D-C2.2-a the CAP overdue rule lives once in SQL; the app agrees by parity test.
19. D-C2.2-b the due-soon window is configuration, default 7 days.
20. D-C2.2-c the organisation time zone is a column, not a constant.
21. D-C2.2-d the escalation sweep is a platform-wide wrapper, not a second rule.
22. D-C2.2-e the digest is a database function; only `daily_digest` recipients get it.
23. D-C2.2-f SA-02's job-health reader is platform-only and tolerates a missing pg_cron.
24. D-C2.2-g `cap_event_log` is the idempotency ledger for the daily CAP job.
25. D-C2.3-a every emitter goes through one door, `emit_catalogue_event`.
26. D-C2.3-b the allow-list is a table with reasons, holding exactly two keys.
27. D-C2.3-c emitters are triggers on the source table, not calls inside the writing RPC.
28. D-C2.3-d `finding.sealed` fires when the engagement seals.
29. D-C2.2-1 the pg_cron assertions in test 83 are conditional on the extension.
30. D-C2.4-1 one invitation path: the RPC, not the Edge Function action.
31. D-C2.4-2 the member acceptance route is public and creates the account.
32. D-C2.9-1 the support session is a grant-gated read path, not a role.
33. D-C2.9-2 `support_access_log` carries the blanket SELECT for anon and platform_admin.
34. D-C2.5-order deletion happens only after a verified upload.
35. D-C2.5-space the archive reports through RPCs, never the client.
36. D-C2.6-M1 `document_extractions` is extended, not redefined.
37. D-C2.6-pdf a PDF with no text layer is `unsupported`, not `failed`.
38. D-C3.2-A1 change control is a table pair plus two RPCs, not a client-side rule.
39. D-C3.2-A2 four-eyes on a material change: the requester never approves it.
40. D-C3.2-A3 routine classes are configurable per organisation.
41. D-C5.1-1 every Appendix A screen gets its own contract section.
42. D-C5.1-2 OA-18 is a scoped view of the one tutorial library, not a second component.
43. D-C5.1-3 the contract checker fails on a missing section or a testid absent from `src`.
44. D-C4-1 tutorial steps are derived from the contract, not hand-written.
45. D-C4-2 a step never targets a state element.
46. D-C4-3 staleness is `ui_hash`, not file mtime.
47. D-C4-4 the placeholder is a first-class, detectable state.
48. D-C2.7-FIX DOCX bytes are pinned per ZIP entry.
49. D-C3.2-B governance settings surfaces (§10, §12, §14.2, §20, §22, §23).
50. D-C3.1 the spec audit is evidence-first.
51. D-C5.2 PARITY and NOT-DONE are rebuilt, not appended.
52. D-C5.4 screenshots are a sweep tool, not a gate.
53. D-C5.5 the full-flow spec asserts designed states, not one privileged data path.
54. D-C5.4b the sweep covers every Appendix A id, and a guard holds the coverage.
55. D-C2.4c `refreshSession` must re-mint the JWT, not just re-read the session.
56. D-C5.5b the full-flow spec asserted four things that are not the designed behaviour.
57. D-C4b the recorder reused one browser context and captured at the wrong size.
58. D-C4c the tutorial frame counter was a byte scan, not a GIF reader.
59. D-S5-AI a security assertion must not be skippable (S5, L2).
60. D-S5-AI-b the guard found the same defect shape in three more specs (S2, S6, S9).

## Blockers

The full text of every blocker is in `docs/COMPLETION-BLOCKERS.md`. The one that governs the final
state:

**CI infrastructure: the GitHub runner platform refuses to start jobs.** The workflow is `active`
(id 383084794) and was dispatched on the final head `7b1ca92`: run **39745950473** reported
`completed / failure`, job `gates`, **`steps: 0`**, in about five seconds, with no log
(`BlobNotFound`). Earlier in the session runs 39742870677 (`9de5ac2`) and 39739987481 (`3b9818c`)
showed the identical signature. The decisive evidence that this is platform-side, not a repository
fault, is that the unrelated **`Keep test project awake`** workflow on `main` (run 39740345392, and
39717003409 before it) fails with the same `steps: 0` signature in two seconds, on a file this run
never touched. The last run that actually executed was 39595405218 on `d3b7f87`, which ran all 17
steps and failed only at step 8 (Playwright) on `e2e/c2-member-invite.spec.ts` - the defect fixed
since. **Consequence: CI cannot be green on this branch while the platform refuses to start the
runner; the final head is verified locally by the same gate set.** Owner action: re-dispatch CI when
the platform is healthy; it will then exercise the SQL and Playwright steps against the hosted test
project, which the sandbox cannot reach.

## NOT DONE

The one current list is `docs/NOT-DONE.md`. Real gaps with an owner decision requested: §2
cross-universe view-only sharing (Missing - the one whole clause with no implementation); §10.1
configurable grace period before the Testing hard lock (Partial); §11.4 central pre-flight (Partial);
§17.1 pop-out Realtime sync test (Partial); §22 Realtime in-app notification delivery test (Partial);
§3/§25.7 mobile viewport smoke (Partial). Parked by an earlier decision: continuous-auditing watchers
(`watcher.signal` is the only catalogue key with no emitter, by design) and the migration runner
against two live databases. Known limitations are stated plainly in that file.

## Owner actions

- Deploy the Edge Functions:
  `supabase functions deploy ai-gateway email-dispatch graph-oauth hosting-test invite-user secrets-put archive-upload doc-extract`
  (hosting-test, archive-upload and doc-extract are new in this build).
- Confirm Vault, pg_cron and pg_net on the project; set `SECRETS_MASTER_KEY` if Vault is absent.
- Enter the Resend and Microsoft app credentials in the platform wizard, never in chat; **revoke the
  Resend key that was pasted on 2026-10-19.**
- Re-run `npm run tutorials:record` against the live app after the UI is final (the committed GIFs
  are placeholders); `check-tutorials --strict` then passes on real recordings.
- Set `TEST_SUPABASE_DB_URL` without the trailing newline.
- Re-dispatch CI when the GitHub runner platform is healthy.
- The `/superadmin` screen layout (Phase 8.1) is the owner's to finalise; the Phase 8 database and
  logic are in place.

Authored by: Qazi Sarmad Ali Mahesar
