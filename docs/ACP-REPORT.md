# ACP report — Assurance and Control Plane

Branch: `feature/board-ai-control-plane`. Base: `feature/config-control-plane` head `3678c93`
(PR #10 open, so this branch stacks on it). Run dates: 2026-10-19 / 2026-10-20.

This report is current as of the S12 commit `85fe744` (CI run **39510252877**, green on all eight
gates). Slice S13 (the final UI-contract sweep and the final gate run) is NOT DONE and is listed
below.

## Pull request

None open for this branch. Per section 8 of the brief the PR is opened at the end of S13, which is
not started. The branch is pushed; the last commit `85fe744` is green. Owner merges.

## Tasks

| Task | Commit | CI run | Result |
|---|---|---|---|
| S0 housekeeping (xlsx vendoring, no-JSON guard) | (see ACP-PROGRESS) | (see ACP-PROGRESS) | green |
| S1 control plane foundations (a-d) | (see ACP-PROGRESS) | (see ACP-PROGRESS) | green |
| S2 secrets, email, automation engine (a-d) | (see ACP-PROGRESS) | (see ACP-PROGRESS) | green |
| S3 real invitations (a-d) | 234847f / 435a8ee / e74d78e | 39267810047 | green |
| S4 branding, report format, renderers (a-d) | edde814 / b0b502d / f4f44c1 / f479439 | 39276190620 | green |
| S5 AI (a-d) | 5504084 / da477f2 / aded51f / a09981f | (folded) | green |
| S6 escalation rules (a-d) | 563d57b / fb1e613 / fb612b2 / c0b5212 | (folded) | green |
| S7 Board Pack (a-d) + S7-FIX | fa520c0 / 7306601 / 3454417 / 9428061 / d32ef00 | 39292142326 / 39368904522 | green |
| M-0..M-4 mid-job corrections (secrets, dispatcher, AI gateway) | a64a061 / 3f980d1 / 5fd9c6d / 13f7161 / 629d721 | 39298253900 / 39314413666 | green |
| S8 certificate and public verification (a-d) | e5c9504 / 1346282 / cf4ab52 | 39379614007 | green |
| S9 external auditor portal (a-d) + S9-FIX | 69532f5 / 5491e56 / 4ac6cd7 / 30982c0 / 2b0a770 | 39386066582 / 39397989353 | green |
| R-1 AI gateway authorisation (a-d) | a7fb323 / 9686fbb / 59b8762 / 4f4ba08 | 39397989353 / 39400695720 | green |
| S10 Time-Travel and Patterns (a-d) + fixes | b7e2798 / 1d3d73a / 1de3a55 / 008f322 / 7c8d8a4 | 39411022404 / 39416981015 / 39428654015 / 39465462476 | green |
| S11 hosting fit and mobility (a-d) + S11-FIX | 9432deb / 557b571 / 833028d | 39431010424 | green |
| S12 tutorials — db (a) | 5fbc905 | 39510252877 (with d) | green |
| S12 tutorials — lib (b) | e17ef72 | 39510252877 (with d) | green |
| S12 tutorials — app (c) | e730d83 | 39502753545 (steps 1-7) | green |
| S12 tutorials — ops (d) | 723a33d | 39502753545 (step 8 red, fixed) | fixed |
| S12 tutorials — docs (d) | c4e2c74, 85fe744 | 39510252877 | green |
| S12-FIX tutorial dialog assertion | a63acb9 | 39506774584 | green |
| S13 contract, parity, final gates | — | — | NOT DONE |

Full per-task detail, decisions and CI ids are in `docs/ACP-PROGRESS.md`.

## S12 in detail (the slice completed in this session)

F18 requires a recorded GIF for every setup step and every configuration screen. S12 delivered:

- **One key registry.** `src/lib/tutorialKeys.json` freezes the 85 Appendix A keys (key, audience,
  screen id, title). `src/lib/tutorialKeys.ts` re-exports them typed for the app;
  `scripts/record-tutorials.mjs` and `scripts/check-tutorials.mjs` read the same JSON. One list, so
  the app, the recorder, the checker and the migration cannot drift.
- **The registry seeded in the database.** `0071_tutorial_registry_seed.sql` inserts one `tutorials`
  row per key with `on conflict (key) do nothing` (M2-safe on the persistent project). SQL test
  `80_tutorial_registry.sql` proves every seeded row is complete, both audiences can read it, and a
  re-apply changes nothing.
- **The recorder.** `scripts/record-tutorials.mjs` drives the real UI with Playwright, bound only to
  the data-testids in `docs/ACP-UI-CONTRACT.md`, and encodes GIFs with pure-JS gifenc + pngjs (no
  system ffmpeg; 960 px, 8-15 frames, 64-colour palette, max 400 KB). Without `TUTORIALS_BASE_URL` it
  writes clearly-marked placeholder GIFs so the build gate and the SA-13 library are never empty.
- **The build gate.** `scripts/check-tutorials.mjs` fails when any Appendix A key has no GIF and
  warns on staleness. It runs in CI (step 6) and in `scripts/pre-pr-gates.sh` (step 6).
- **The UI.** `TutorialButton` ("Show me how", testid `<screenId>-tutorial`) is on every config
  screen; it opens the non-blocking `TutorialDrawer` (role `complementary`, never a modal) and
  autoplays once on a first visit (`localStorage acp.tutorial.seen.<key>`). The suite-wide Playwright
  storage state seeds autoplay off so other specs stay deterministic; `e2e/s12-tutorials.spec.ts`
  clears the key to exercise autoplay itself.

## Blockers

No blocker is open. The full record is in `docs/ACP-BLOCKERS.md`; headings:

- B-push-token — RESOLVED (stale `GITHUB_TOKEN` env var; the token in `origin`'s URL is valid).
- M-1 error — an intermittent `truncate orgs cascade` deadlock on the shared test project; fixed by a
  session advisory lock plus a one-shot retry. Verbatim text is in the file.
- B-credentials-outage — RESOLVED (both GitHub tokens returned 401 for a window; ended on its own).
- R-1 defect (TDZ) — the AI gateway threw on every request and verified nothing; fixed in R-1b so the
  gateway authorises the caller and the org.
- S9-FIX — the `/external` spec raced its own sign-in; fixed (test-only).
- S12-FIX — the tutorial spec failed on an over-broad `[role="dialog"]` assertion; the Org Control
  panel legitimately opens in a non-blocking `FloatingWindow` (allow-listed `role="dialog"`, no
  `aria-modal`). Fixed (test-only) to assert `role="complementary"` and zero `[aria-modal="true"]`.

The only non-blocking, by-design item is that the committed tutorial GIFs are placeholders until the
owner re-runs the recorder against a live deployment (F23).

## Decisions

One line each; the full text (point, options, choice, reason, reverse) is in `docs/ACP-DECISIONS.md`
(98 entries). The S12 additions:

- **D-S12-key-registry** — the tutorial key list lives in one `src/lib/tutorialKeys.json` read by the
  app, the recorder and the checker, so they cannot drift.
- **D-S12-placeholder-gifs** — the recorder emits clearly-marked placeholder GIFs when no
  `TUTORIALS_BASE_URL` is set, so the build gate and the SA-13 library are never empty and no
  hand-drawn asset is committed.
- **D-S12-registry-seed** — `0071` seeds one `tutorials` row per key with `on conflict do nothing`
  (M2-safe); configuration lives in the database, not the browser.

## Real counts against the H0 baselines

| Metric | Baseline (H0) | Now (CI 39510252877) |
|---|---|---|
| vitest files | 75 | 128 |
| vitest tests | 791 | 1428 |
| SQL test files | 63 | 80 |
| SQL assertions (one pass) | 1243 | 1683 |
| migrations | 49 | 71 |
| Playwright spec files | 12 | 22 |
| Playwright tests | 49 | 113 passed / 2 skipped |
| check-tokens files scanned | 105 | 160 (0 violations) |
| check-shrink files verified | 58 | 58 |

The SQL harness applies every migration twice and runs every test twice (M6). Playwright run
39510252877 passed 112 on the first attempt and 113 after one retry of `e2e/phase4.spec.ts` (a known
sign-in race unrelated to S12; the retry is Playwright's configured `retries: 1` in CI).

## NOT DONE

- **S13** (contract, parity, final gates) is not started: the final `docs/ACP-UI-CONTRACT.md` sweep
  for every Appendix A screen, the closing PARITY and NOT-DONE review, screenshots of changed screens
  per spec 29, and the final consolidated gate run.
- **Real tutorial GIFs.** The 85 committed GIFs are the recorder's placeholder output; the owner runs
  `npm run tutorials:record` with `TUTORIALS_BASE_URL` against a live deployment to replace them.
- **Continuous-auditing watchers** are PARKED by F12 and were not built (the F7 event interface stays
  generic for a future `watcher.signal`).
- **Migration runner against two live databases** — unit-tested with a fake driver; the end-to-end run
  is left to the owner's runner machine (CI has no second reachable Postgres).
- Other honest limits are listed in `docs/NOT-DONE.md`.

## Owner actions still open (F23)

- Run `supabase functions deploy` for `email-dispatch`, `ai-gateway`, `graph-oauth`, `invite-user`,
  `hosting-test`.
- Confirm Vault and pg_cron exist on the project (S2.1 verified Vault; the platform wizard SA-01 also
  checks these).
- Create a Resend account and key, or use per-client Microsoft Graph or SMTP.
- Create a free Microsoft Entra app registration; register ONE multi-tenant app for the platform and
  enter its client id and secret in the Super Admin wizard (stored in Vault).
- Enable Supabase Auth signups if the external auditor portal is wanted.
- Re-record the tutorial GIFs (see NOT DONE).
- Add a sending domain later.
- The Super Admin platform-owner secret key ("Mr. QS's ID") is configured by the owner once the whole
  build is complete (F1).

## Commands to regenerate tutorials and deploy Edge Functions

Regenerate every tutorial GIF against a running deployment (owner):

    TUTORIALS_BASE_URL=http://localhost:3000 npm run tutorials:record

Write placeholders only (what CI ships):

    npm run tutorials:record -- --placeholder

Fail the build if any Appendix A key has no GIF:

    npm run check-tutorials

Deploy the Edge Functions (owner; not done by CI):

    supabase functions deploy email-dispatch
    supabase functions deploy ai-gateway
    supabase functions deploy graph-oauth
    supabase functions deploy invite-user
    supabase functions deploy hosting-test

