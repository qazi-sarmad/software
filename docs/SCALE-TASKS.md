# SCALE-TASKS — the live task ledger

**This file is the single place that records what is done.** Update it in the same commit as the work.
Anything not marked `DONE` here is not done, regardless of what any other document says.

Status values: `TODO` · `DOING` · `DONE` · `BLOCKED (owner)`.

Last updated: 2026-10-28.

---

## Truth policy

`docs/archive/` holds 63 documents written before the code-verified audit. **None of them may be
cited as evidence that anything works.** They each carry a stale banner. The reliable sources are:

| Document | What it is |
|---|---|
| `docs/SPEC-v10.md` | The specification. Authoritative, unchanged. |
| `docs/FUNCTIONALITY-AUDIT.md` | What is actually built, verified against code. |
| `docs/REMEDIATION-PLAN.md` | The plan being executed. |
| `docs/SCALE-TASKS.md` | This file. Live status. |

Rule for every future session: **verify wiring by grepping the call site. Never trust a doc or a
green test as proof that a feature works.**

---

## Decisions locked by the owner (2026-10-28)

1. Enforce the settings that currently do nothing (do not remove them).
2. Tests must run against the real built app (production build), not the dev server.
3. Test steps / methodology must be client-configurable data, not hardcoded.
4. Replace the old CI with a new one that includes the six anti-theatre gates.
5. No demo today; the owner is handling the explanation personally.

---

## WP0 — Pre-flight & inventory

| # | Task | Status |
|---|---|---|
| 0.1 | Branch `feature/scale-harden-v1` from `f2aaa5b` | DONE |
| 0.2 | Baseline counts recorded | DONE |
| 0.3 | Archive stale docs with banners; write this ledger | DONE |
| 0.4 | Docker-based local SQL harness (real Postgres 17) | DONE |
| 0.5 | Unblock migration replay: `0033` drops `platform_whoami()` before recreating it | DONE |

### Baseline counts (locked at branch point)

| Metric | Baseline |
|---|---|
| Migrations | 99 |
| SQL test files | 103 |
| Vitest files | 202 |
| Playwright specs | 29 |
| Guards | 21 |

### Baseline verified at 21ee32f (2026-10-28)

Every gate run locally on a clean checkout of `feature/scale-harden-v1` @ `21ee32f`. Counts confirmed
against the table above.

| Gate | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | PASS |
| Unit tests | `npx vitest run` | PASS — 202 files / 2378 tests |
| Build | `npx vite build` | PASS |
| Shrink | `node scripts/check-shrink.mjs` | PASS (58 files) |
| Tokens | `node scripts/check-tokens.mjs` | PASS (179 files, 0 violations) |
| UI contract | `node scripts/check-ui-contract.mjs` | PASS (48 screens) |
| Tutorials | `npm run check-tutorials` | PASS (80 GIFs) |
| SQL harness | `bash scripts/local-sql-harness-docker.sh` | PASS — "all SQL tests passed twice" |

**Harness defect found and fixed in this commit.** The Docker harness ran `psql` with the container's
working directory `/`, but every SQL test begins with a relative include
(`\i supabase/tests/00_lib.sql`). Every test therefore failed on the include, not on an assertion —
the first run reported 103/103 "TEST FAILED". Fix: mount the repo read-only at `/repo` and run the
container with `-w /repo`, so psql resolves the include from the repo root. With that, all 103 SQL
test files pass twice.

### Task 0.5 — why "the new tables don't exist" (found 2026-10-28)

The owner reported that the tables the last several commits were supposed to create could not be
found. Root cause, verified end to end:

1. **The app and every local probe read the *local* Supabase stack**, not a cloud project.
   `SUPABASE_URL=http://127.0.0.1:54321` (Kong), database container `supabase_db_provio`. That database
   had applied migrations only through **0099** (`supabase_migrations.schema_migrations` max version
   `0099`; `supabase migration list --local` showed `0100`–`0108` with an empty remote). So
   `workpaper_step_state`, `engagement_stage_transitions`, `approval_steps` and `sample_value_waivers`
   did not exist there, which is exactly what the owner saw.
2. **The hosted test project (CI) is stuck at an even earlier point.** CI step 7 applies
   `supabase/migrations/*.sql` in filename order with `psql -v ON_ERROR_STOP=1`. Every run since
   `5522c5d` failed at `0033_platform_read_apis.sql:13`:
   `ERROR: cannot change return type of existing function` / `DETAIL: Row type defined by OUT
   parameters is different.` The loop aborts there, so 0034–0108 — including all of Phase 1/2/3 —
   never applied. Every push has been red on step 7 for this one reason (`40683799449`, `40683773118`,
   `40681931680`, `40675849876`, …).
3. **Why `0033` fails on replay.** `0033` defines `platform_whoami()` returning
   `(user_id uuid, is_platform_admin boolean)` with `create or replace`. The sibling branch
   `feature/security-harden-v1` (migration `0103_owner_only_console_and_tenant_mfa.sql`) widens the
   same function to four columns. Both branches are replayed against the **same shared hosted test
   project** and both are re-applied on the harness's second pass, so whichever definition lands
   first makes the other `create or replace` fail on the changed row type. The sibling branch already
   carries the fix (`drop function if exists public.platform_whoami();` before the create); this
   branch did not. It was the single content difference between the two branches' shared migrations
   (`0033` is the only same-named migration whose bytes differ; 98 identical, 9 only-ours, 4
   only-theirs, and the only function signature that collides across them is `platform_whoami`).

**Fix (this commit).** `0033_platform_read_apis.sql` now drops `platform_whoami()` before recreating
it, with a comment recording why. Verified two ways:

- `bash scripts/local-sql-harness-docker.sh` → `migrations applied twice` / `all SQL tests passed
  twice`, exit 0 (112 test files). The harness applies every migration twice, which is the same
  replay that CI performs, so it now passes for the same reason CI will.
- Reproduced the CI failure exactly in a throwaway Postgres 17 container: apply the shim + all
  migrations, widen `platform_whoami()` to the sibling's four-column shape, then replay `0033`
  unchanged → `ERROR: cannot change return type of existing function` (exit 3). With the drop line
  the replay succeeds.
- Applied the pending migrations to the local stack the app reads:
  `npx supabase migration up --local` → applied `0100`–`0108`; the four new tables now exist and
  public base tables went 176 → **180**.

**Known remaining gap (tracked, not fixed here):** PostgREST's schema cache on the local stack is
stale for the newly added functions (`report_graph_get`, `anchoring_status`,
`platform_provisioning_status` still answer `PGRST202`), so a *newly added* RPC cannot be exercised
over REST until the stack is restarted or the schema cache reloaded. `NOTIFY pgrst, 'reload schema'`
from `psql` did not refresh it (PostgREST only listens on the channel its own connection opened).
This does not affect CI (a fresh project) and does not affect the functions the app already calls;
it is recorded so the next session does not misread a `PGRST202` on a brand-new RPC as a missing
migration.

---

## Phase 1 — Make the app read its own database

Nothing else is verifiable until this is done. The app currently renders from an in-memory seed that
is empty in production (`src/App.tsx:204`).

| # | Task | Status |
|---|---|---|
| 1.1 | `src/data/tenant.ts` — session-scoped tenant loader (RLS-scoped table reads, never throws) | DONE |
| 1.2 | `TenantDataProvider` replacing the seed as the shell's source (wired in `AuthGate`, `src/App.tsx`) | DONE |
| 1.3 | Keep `EMPTY_SEED` only for genuinely tenant-less routes (`/e/:token`, `/verify`, `/pack`, `/root`) | DONE |
| 1.4 | Kill the parallel in-memory mutations (sign-off, CAP, ledger, test steps) or point them at RPCs | DONE |
| 1.5 | Production-build E2E that proves data loads (`e2e/phase1-production-build.spec.ts`) | DONE |

**Task 1.1–1.3, 1.5 — what was built and how it was verified (2026-10-28).**

- `src/data/tenant.ts` hydrates the shell from the database through RLS-scoped table reads. Before this,
  `AuthGate` (`src/App.tsx`) loaded the dev-only demo seed in development and `EMPTY_SEED` in a
  production build, so every production screen showed its empty state. Now: with a configured Supabase
  project the shell loads `loadTenantSnapshot()`; with no project at all a bare dev checkout still uses
  the flagged demo tenant (dev-only dynamic import, not emitted in a production build). The loader never
  throws — a denied or missing table yields an empty list and a recorded warning, surfaced as
  `data-testid="tenant-load-error"`.
- **Wiring verified by the call site, not by a unit test.** `grep loadTenantSnapshot src/` shows the one
  call site in `src/App.tsx`. The G1 spec (`e2e/phase1-production-build.spec.ts`) runs ONLY against the
  production bundle (`E2E_PROD=1` → `vite build && vite preview`) and asserts a database row renders:
  `global-setup.ts` seeds the engagement "Phase 1 production-build probe (Test)" and scopes the preparer
  to its universe; the title can only appear if the shell hydrated from the database. A second test
  asserts no demo-seed `[CANARY-*]` marker leaks into the build.
- **Result:** `npx playwright test e2e/phase1-production-build.spec.ts --project=chromium` with
  `E2E_PROD=1` → **2 passed**, after first failing with a strict-mode violation that *proved* the row
  was rendered (two matches: the plan card `<h3>` and the selected-engagement `<h2>`).
- `src/data/tenant.test.ts` (4 tests) covers the not-configured path, the row mappers against a fake
  client, and that a failing read is a warning not a throw.
- `playwright.config.ts` gained the `E2E_PROD=1` branch (`npm run build && npm run preview -- --port 4173`).
  The dev-server path is unchanged, so the historical specs keep their fast loop.
- Gate set after the change: `tsc` PASS; `vitest` 203 files / 2382 tests PASS; `vite build` PASS;
  `check-shrink` PASS (58 files); `check-tokens` PASS (179 files, 0 violations); `check-ui-contract` PASS
  (48 screens); `check-tutorials` PASS (79 current, 1 stale `sa.tenant-hub` — pre-existing).
- One test fixture updated: `src/App.noTenant.test.tsx` mocks `./data/client` and now must also provide
  `hasSupabaseConfig` (the new export the shell reads).

**Task 1.4 — what was built and how it was verified (2026-10-28).**

Before this task the shell's mutations only changed the in-memory seed: `signOffEngagement`,
`reopenEngagement`, `addEntity`, `setTestStepCompleted`, `registerPopulation`, `finalizeTest`,
`signOffWorkpaper`, `reopenWorkpaper`, `addObservation` and `transitionCap` were all `setState` calls,
so a reload lost the change and no other principal ever saw it. Each now has a real write path, used
when a Supabase project is configured; with no project (a bare dev checkout, which is what the unit
tests exercise) the in-memory demo path is kept unchanged.

- **Reuse first (grep, not guess).** Four operations already had an RPC and were wired to it rather
  than redefined: `reopen_engagement(uuid, text)` (0007), `sign_off_workpaper(uuid)` and
  `reopen_workpaper(uuid, text)` (0028), `create_observation(uuid, uuid, text, jsonb)` (0030), and the
  CAP pair `update_cap` / `close_cap` (0038).
- **Migration `0100_phase1_write_paths.sql`** adds the four that were genuinely missing, each a thin
  right-checked, ledger-writing wrapper in the repo's existing shape (`jwt_org_id` +
  `caller_has_right` + `append_ledger_entry`): `finalize_testing(uuid)`, `submit_population(uuid, text,
  text, int, bigint)`, `add_entity(uuid, text, text)`, `set_test_step_state(uuid, text, boolean)`, plus
  `seal_engagement(uuid)` for the Audit File review surface. It also adds the `workpaper_step_state`
  table (RLS select by org, `pin_org_id` and the workpaper sealed-guard triggers) so a test-step tick
  persists.
- **The wiring, verified by grep.** `src/data/mutations.ts` is the new data module (Phase 1.4 writes);
  `grep -n 'writes\.' src/context/AppContext.tsx` shows the one call site for each. Each mutation is an
  RPC followed by `reload()` (`loadTenantSnapshot`), so the screen shows what the database holds. The
  client-side rights check (`canPerformAction`) still runs first so the UI reason is immediate and
  matches the RPC's refusal.
- **Two defects the audit found in the loader and fixed here:** `tenant.ts` read
  `report_comments(report_id, author_id, body)`, columns that do not exist (the real names are
  `report_version_id`, `commenter_id`, `comment_text`) — every comment read would have errored; and it
  never read `workpaper_step_state`, so a tick was written but never shown. Both fixed.
- **`supabase/tests/101_phase1_write_paths.sql`** (new, 30 assertions) proves each write under a real
  role: the happy path writes and reads back, and a caller without the right is refused. It also pins
  the F11 anonymous surface (`has_function_privilege('anon', ...)` is false for the new functions).
  The test caught two real constraints it had to respect rather than assert around: `workpaper_rows`
  has `exception_flag NOT NULL`, so an unresolved row cannot come from `record_workpaper_row`; and
  `sign_off_workpaper` enforces four-eyes, so the signer must not be the preparer.
- **Gate set after the change:** `tsc` PASS; `vitest` 203 files / **2386** tests PASS; `vite build`
  PASS; `check-shrink` PASS (58 files); `check-tokens` PASS (179 files, 0 violations); `check-ui-contract`
  PASS (48 screens); `check-tutorials` PASS (80 keys, 79 current / 1 stale `sa.tenant-hub`, pre-existing);
  SQL harness PASS — "all SQL tests passed twice" (104 test files).

## Phase 2 — Make the lifecycle real

| # | Task | Status |
|---|---|---|
| 2.1 | `set_engagement_stage` RPC + transition log; wire planning→testing→conclusion in the UI | DONE |
| 2.2 | Enforce `signoff_role_*` in `sign_planning` / `sign_conclusion` | DONE |
| 2.3 | Enforce `testing_mode` (one-stage vs two-stage) | DONE |
| 2.4 | Enforce `approval_chain` when an approval is decided | DONE |
| 2.5 | Wire `runPreflight` into `freeze_report`; gate on `preflight_acks` | DONE |
| 2.6 | Persist the report graph root (`report_graphs` writer) | DONE |
| 2.7 | Seed `workpaper_rows` from `lock_sample`; link sample to tested rows | DONE |
| 2.8 | Method-aware sampling (MUS/PPS, systematic, stratified) + Clopper-Pearson | DONE |
| 2.9 | Value-coverage check (top-value items included or waived with a reason) | DONE |

### Phase 2.7–2.9 — what was built and how it was verified (2026-10-28)

Three migrations, three SQL tests (105, 106, 107), one data module and one screen extended.

- **2.7 — the drawn sample becomes the tested set.** `lock_sample` (0027) locked a sample and stopped;
  `workpaper_rows` (0028) had no writer but `record_workpaper_row`, and `workpaper_rows.sample_id` had
  no writer at all (`grep -rn 'insert into workpaper_rows' supabase/migrations/` proved it). The
  auditor drew a sample and re-keyed every `row_ref` by hand, with nothing linking the two. Migration
  `0104_phase2_row_seeding.sql` seeds one `workpaper_rows` row per `samples.sample_rows` element when
  the sample locks, sets `sample_id`, and adds `sample_tested_rows` for the drilldown. The
  `on conflict (workpaper_id, row_ref) do update set sample_id` keeps the link and never clobbers a
  result. Wired in `src/data/sampling.ts` (`listSampleTestedRows`) and shown in `SamplingPanel`
  (`sampling-tested-rows`). Test `105_phase2_row_seeding.sql` (12 assertions).
- **2.8 — method-aware sampling and the exact bound.** `compute_sample` (0027) hardcoded
  `method = 'random'` while the schema accepted seven methods and the Org Sampling Table mapped a band
  to one of them. Migration `0105_phase2_sampling_methods.sql` reads the mapped method and applies it
  (random, systematic, high_value, low_value, mus, stratified, haphazard), records `calculation`
  (formula, inputs, result) on the sample, and adds the Clopper-Pearson exact interval (§11.3) as
  `clopper_pearson_upper`/`_lower` plus `sample_precision`. The interval is computed from the
  binomial CDF directly (`binom_cdf`), because Postgres has no `lgamma`; the SQL values match
  independently-computed references exactly (0/20 → 0.168433, 3/20 → 0.378927, 10/50 → 0.337183,
  2/10 at 90% → 0.506901, 5/25 at 99% → 0.469758). A *system* sample always includes the high-value
  items. Test `106_phase2_sampling_methods.sql` (22 assertions).
- **2.9 — high-value coverage.** No coverage check existed: a sample could exclude the population's
  largest items and still lock. Migration `0106_phase2_value_coverage.sql` adds `value_coverage`,
  `assert_value_coverage` (called by `lock_sample`) and `waive_value_coverage` with an append-only
  `sample_value_waivers` table (>=10-character reason, ledger entry). A *system* sample already
  covers the high-value items, so the gate bites on an *auditor paste* that omits them — exactly the
  case §11.3 names. Test `107_phase2_value_coverage.sql` (16 assertions).
- **Two implementations, one answer.** The CP reference values in test 106 were computed outside SQL
  (bisection on the binomial CDF) and pinned in the test, so a drift between the SQL and the textbook
  definition fails the test.
- **Gate set after the change:** `tsc` PASS; `vitest` 205 files / 2401 tests PASS; `vite build` PASS;
  `check-shrink` PASS (58 files); `check-tokens` PASS (179 files, 0 violations); `check-ui-contract`
  PASS (48 screens); `check-tutorials` PASS (79 current / 1 stale `sa.tenant-hub`, pre-existing);
  SQL harness PASS — "migrations applied twice / all SQL tests passed twice" (110 test files).

### Phase 2.6 — what was built and how it was verified (2026-10-28)

Migration `supabase/migrations/0103_phase2_report_graph.sql` (new) and test
`supabase/tests/104_phase2_report_graph.sql` (new, 20 assertions). The migration applies twice cleanly.

- **The defect.** `report_graphs` and `report_claims` (0088) are append-only and `verify_report_root`
  (0094) reads the root to prove tamper-evidence, but no writer existed anywhere:
  `grep -rn 'report_graphs' src/ supabase/functions/` returned nothing. The engine computed roots in
  `src/lib/writing/` and the result was thrown away, so the verification chain had no data.
- **The fix.** `report_graph_commit(...)` writes the graph. The database does not take the caller's
  word for the root: it recomputes every claim hash from the claim's canonical facts and rebuilds the
  Merkle root from those leaf hashes (`report_graph_root_of`, domain prefixes `00`/`01`, odd node
  promoted not duplicated, exactly `buildMerkleTree`), and raises `graph_root_mismatch` /
  `claim_hash_mismatch` when they disagree. The commit is idempotent per
  (version, model, register, locale), writes the claims (whose trigger writes the hash-chained
  `report_claim_versions`) and anchors the root to a ledger entry. Right required is
  `review_and_approve`, matching `compose_report`, which is the same stage.
- **`src/lib/writing/derive.ts` (new)** is the missing middle: it turns an engagement's real records
  (findings, tested items and exceptions, controls, CAPs) into claims with references to those
  records. It is pure — no clock, no random source; time enters as an argument. `src/data/reportGraph.ts`
  loads the records through RLS and calls the writer; `ReportEditorPanel.freeze` calls
  `commitReportGraph` after `freeze_report`, so a frozen report has a committed, verifiable root.
- **Two implementations proven equal.** `supabase/tests/104` pins three canonical claim texts and
  their root produced by the TypeScript engine (`graphHashes`), and asserts `report_graph_root_of`
  reproduces `fae44ed0…956` exactly, so a drift between SQL and TS fails the test.
- **Gate set after the change:** `tsc` PASS; `vitest` 205 files / 2401 tests PASS; `vite build` PASS;
  `check-shrink` PASS (58 files); `check-tokens` PASS (179 files, 0 violations); `check-ui-contract`
  PASS (48 screens); `check-tutorials` PASS (79 current / 1 stale `sa.tenant-hub`, pre-existing);
  SQL harness PASS — "all SQL tests passed twice" (107 test files).

### Phase 2.5 — what was built and how it was verified (2026-10-28)

Migration `supabase/migrations/0102_phase2_preflight_gate.sql` (new) and test
`supabase/tests/103_phase2_preflight_gate.sql` (new, 11 assertions). The migration applies twice
cleanly and the full SQL harness is green ("all SQL tests passed twice", 106 test files).

- **The defect.** The §11.4 pre-flight engine (`src/lib/preflight.ts`, eight checks) had no caller but
  its own unit test, and `freeze_report` (0040) gated on exactly two inline checks (open comments, CAP
  reconciliation) and never consulted `preflight_acks`. A report could therefore be frozen and issued
  with the pre-flight never executed. `grep -n 'runPreflight' src/` showed the only reference outside
  the module was the test file.
- **The fix.** The database is now the authority. `preflight_items(engagement_id)` computes every open
  item from real tables (`conclusion_records.exceptions`, `workpaper_rows`, `samples`, `populations`,
  `evidence_files`, `findings`, `report_comments`), one query per check key, and returns
  `{check_key, item_id, detail}`. `preflight_blocking(engagement_id)` returns the items with no live
  acknowledgement. `assert_preflight_clear(engagement_id)` raises `preflight_blocked` while any remain.
  `freeze_report` is extended in place to call it after the existing two gates, so their specific
  refusals are unchanged.
- **`preflight_acks` is now genuinely append-only.** 0095 said so in prose but shipped no guard; 0102
  adds a `before update or delete` trigger, so an edit or delete raises. The latest row per
  (check, item) with a >=10-character reason is the live acknowledgement; history is kept.
- **Wired, verified by grep.** `listPreflightItems` / `listPreflightBlocking` in
  `src/data/preflight.ts`; `grep -n 'listPreflightBlocking' src/components/` shows the one component
  caller, `ReportEditorPanel.tsx`, which renders the live list (`report-preflight-item-list`), colours
  each item acknowledged/unacknowledged, lets a click fill the waive form, and blocks the freeze
  button (`canFreeze`) until `preflightBlocking.length === 0`. The database gate is the enforcement;
  the screen is the explanation.
- **Gate set after the change:** `tsc` PASS; `vitest` PASS; `vite build` PASS; `check-shrink` PASS;
  `check-tokens` PASS; `check-ui-contract` PASS; `check-tutorials` PASS; SQL harness PASS — "all SQL
  tests passed twice" (106 test files).

### Phase 2.1–2.4 — what was built and how it was verified (2026-10-28)

Migration `supabase/migrations/0101_phase2_lifecycle.sql` (new) and test
`supabase/tests/102_phase2_lifecycle.sql` (new, 26 assertions). The migration applies twice cleanly
and the full SQL harness is green ("all SQL tests passed twice").

- **2.1 `set_engagement_stage(p_engagement_id, p_to_stage, p_expected_stage)`.** The one write path
  for `engagements.stage`, which had none: the audit found the stage only ever changed in React state
  (`AppContext.signOffEngagement`), so the transition was lost on reload. The RPC checks
  `manage_engagements`, refuses a stale `p_expected_stage` (optimistic concurrency), refuses a
  backward or no-op move, and refuses a move to `testing` while `testing_lock_active()` is true
  (honouring the org's grace period). Every transition writes an append-only
  `engagement_stage_transitions` row (guarded against UPDATE/DELETE), a hash-chained ledger entry and
  an `activity_log` row.
- **Wired, verified by grep.** `grep -n 'setEngagementStage' src/` shows the one data-module caller
  (`src/data/mutations.ts`), reached from `AppContext.advanceEngagementStage`, called by the "Move to
  …" control in `AuditFileModal.tsx`. `src/context/stageAdvance.test.tsx` (4 tests) proves the command
  is exposed, refuses a caller without `manage_engagements`, and moves the rendered engagement.
- **2.2 `signoff_role_*`.** `sign_planning` and `sign_conclusion` are extended in place to require the
  configured team role (`caller_meets_signoff_role`). A caller must hold the role's rights; and when
  the engagement has a member in that role, the caller must be that member, so assigning a reviewer
  genuinely narrows who may sign. Default role is `reviewer`, so existing flows are unchanged.
- **2.3 `testing_mode`.** New `assert_conclusion_ready()` is shared by the `conclusion` stage
  transition **and** `seal_engagement` (extended in place), so the two paths cannot disagree. Two-stage
  needs a signed-off design (DEA) workpaper and a signed-off operating (OET) workpaper; one-stage needs
  only the operating one. A new `workpapers.test_phase` column (`dea`/`oet`, default `oet`) carries the
  distinction.
- **2.4 `approval_chain`.** `workflow_settings.approval_chain` was stored and never consulted.
  `approve_plan` is extended in place: every step of the chain must be recorded, in order, by a caller
  holding that role (`approval_step_decide`), before the plan can be approved. With the default empty
  chain the gate is inactive, so nothing changes for an org that has not configured one.
- **Two fixture updates the enforcement forced:** `101_phase1_write_paths.sql` now inserts a signed-off
  DEA workpaper before the seal (default mode is two-stage); no existing test needed weakening.
- **Gate set after the change:** `tsc` PASS; `vitest` 203 files / 2386 tests PASS; `vite build` PASS;
  `check-shrink` PASS (58 files); `check-tokens` PASS (179 files, 0 violations); `check-ui-contract`
  PASS (48 screens); `check-tutorials` PASS (79 current / 1 stale `sa.tenant-hub`, pre-existing);
  SQL harness PASS — "all SQL tests passed twice" (105 test files).

## Phase 3 — Make the configuration honest

| # | Task | Status |
|---|---|---|
| 3.1 | `approval_chain` enforced (or hidden) | DONE |
| 3.2 | `signoff_role_*` enforced | DONE |
| 3.3 | `testing_mode` enforced | DONE |
| 3.4 | `report_templates` enforced (or hidden) | DONE |
| 3.5 | `anchoring_settings` setters wired (`admin_save_trust_anchor`, `admin_save_timestamp_authority`) | DONE |
| 3.6 | `docs/CONFIG-EFFECT-MATRIX.md` — every configurable field with its proving test | TODO |

### Phase 3.5 — the anchoring setters wired (2026-10-28)

No migration: `0096_integrity_anchoring.sql` already defines the three platform-only writers and the
two readers. The defect was the UI: `admin_save_timestamp_authority`, `admin_save_trust_anchor` and
`admin_set_anchoring_min` had **no caller anywhere in `src/`**, so the timestamp-authority catalogue,
the trust anchors and every tenant's `min_authorities` could only be set by hand in SQL.

- **Enforcement was already real; only the setters were dead.** `anchoring_settings.min_authorities`
  (int, default 2, check 1–3) is read by `anchoring_status()` and the timestamp flow, so a sealed
  report's root is anchored against the configured count of independent authorities. What was missing
  was any way to populate the catalogue or change the count from the product.
- **What was built.** `src/data/integrityAnchoring.ts` wraps the five RPCs
  (`listTimestampAuthorities`, `listTrustAnchors`, `saveTimestampAuthority`, `saveTrustAnchor`,
  `setAnchoringMin`) on `src/data/db.ts`. `src/components/superadmin/IntegrityAnchoringPanel.tsx` is
  the screen: it lists the authorities and anchors, adds an authority or an anchor, and sets the
  per-tenant minimum (1–3). `SuperAdminPortal.tsx` gained the `integrity` tab, its content branch and
  its `TAB_TUTORIAL` entry (`sa.integrity-anchoring`).
- **Wiring verified by grep, not by a test.** `grep -n 'IntegrityAnchoringPanel' src/` shows the
  import and the one JSX call site in `SuperAdminPortal.tsx`; `grep -n 'TAB_TUTORIAL\[tab\]'` shows the
  dereference that would throw for a tab with no entry, and the entry exists. The RPC names and their
  argument shapes were read from `0096` and match the module (`p_id, p_name, p_url, p_enabled,
  p_sort_order, p_notes` / `p_id, p_name, p_certificate_der, p_enabled` / `p_org, p_min`).
- **Tests.** `src/data/integrityAnchoring.test.ts` (2) proves the inert path: with no Supabase env the
  reads are empty and each write reports "The integrity module is not configured."
  `src/components/superadmin/IntegrityAnchoringPanel.test.tsx` (5) renders the empty catalogues, lists
  what the database holds, saves an authority through the writer, sets a tenant minimum, and surfaces a
  database refusal in `sa-anchoring-save-error` instead of pretending success.
- **Tutorial.** New key `sa.integrity-anchoring` (SA-18): added to `src/lib/tutorialKeys.json`, the
  `0071` registry seed and the `0081` steps migration, and **live-recorded** against the local stack
  (`public/tutorials/sa.integrity-anchoring.gif`, 960×540, 12 frames, 298 KB — a real capture, not a
  placeholder). `scripts/tutorialCapture.mjs` gained its navigation entry.
- **Contract.** New section `SA-18` in `docs/ACP-UI-CONTRACT.md`; `docs/UI-INVENTORY.md` regenerated
  (95 screens).
- **Gate set after the change:** `tsc` PASS; `vitest` 208 files / 2421 tests PASS; `vite build` PASS;
  `check-shrink` PASS (58 files); `check-tokens` PASS (183 files, 0 violations); `check-ui-contract`
  PASS (48 Appendix A screens); `check-tutorials` PASS (81 GIFs, 0 placeholders, 76 current / 5 stale —
  the 5 stale keys are pre-existing, `sa.tenant-hub` plus the 4 the Phase 3.4 note already records);
  SQL harness PASS — "all SQL tests passed twice".

### Phase 3.5 — environment note (recorded, not a defect)

The live tutorial recorder and any browser probe must run against a dev server started with the local
Supabase env (`source .env.e2e-local`); without it the sign-in screen reports "Sign-in is not
configured" and every super-admin screen fails to render. Equally, the unit-test run must have those
variables **absent** — with them present 18 files fail on `permission denied for table …` because the
data modules stop being inert. Two separate shells' worth of state; keep them apart.

### Phase 3.1–3.3 — what was built and how it was verified (2026-10-28)

Migration `supabase/migrations/0107_phase3_workflow_enforcement.sql` (new) and test
`supabase/tests/108_phase3_workflow_enforcement.sql` (new, 10 assertions). The migration applies
twice cleanly and the full SQL harness is green ("all SQL tests passed twice", 109 test files).

- **The defect.** `approval_chain`, `signoff_role_planning`, `signoff_role_conclusion` and
  `testing_mode` were already enforced by `0101` (Phase 2). But three fields the Org Admin screen
  saves and displays were read by no function: `workflow_settings.sla_hours`,
  `workflow_settings.escalation_hours` and `workflow_settings.escalation_role`. And
  `org_lifecycle_settings.signoff_role_testing` was stored and rendered but never consulted — only
  the planning and conclusion roles were enforced, so the testing sign-off role did nothing.
- **3.1 `sla_hours`.** `request_combined_deployment` now computes `sla_due_at` from
  `workflow_settings.sla_hours` when the org has configured one, falling back to
  `engagement_gate_settings.sla_hours` (the pre-0107 source) and then 48 hours. Test 108 §1 sets the
  workflow SLA to 5 hours and asserts the due time lands within the 5-hour window.
- **3.2 `escalation_hours`.** `escalate_overdue_deployment_requests` and
  `deployment_requests_escalate_all` escalate a pending request once it is older than
  `workflow_settings.escalation_hours` when configured, otherwise they keep the pre-0107 rule (past
  `sla_due_at`). The schema requires `escalation_hours >= sla_hours`, so the window is a grace period
  measured from creation; test 108 §2 proves a request past its SLA but inside the window is **not**
  escalated, and one past the window is.
- **3.3 `escalation_role`.** Both sweeps notify the configured `escalation_role` (an in-app
  notification with that `role_target`); test 108 §3 asserts the notification carries the role.
- **3.2 `signoff_role_testing`.** `sign_off_workpaper` now requires the caller to meet the configured
  testing sign-off role, using the same `caller_meets_signoff_role` helper the planning and
  conclusion stages already use. Test 108 §4 sets the role to `lead` and proves a manager without it
  is refused, then to `reviewer` and proves the same manager signs.
- **Gate set after the change:** `tsc` PASS; `vitest` PASS; `vite build` PASS; `check-shrink` PASS;
  `check-tokens` PASS; `check-ui-contract` PASS; `check-tutorials` PASS; SQL harness PASS — "all SQL
  tests passed twice" (111 test files).

### Phase 3.4 — `report_templates` (2026-10-28)

Migration `supabase/migrations/0108_phase3_report_templates.sql` (new) and test
`supabase/tests/109_phase3_report_templates.sql` (new, 13 assertions). Migration applies twice
cleanly; full SQL harness green ("all SQL tests passed twice", 112 test files).

- **The defect.** `report_templates` (0088) was fully inert: no writer RPC, no reader, no screen
  reference — rows existed only in a test seed. `compose_report` hardcoded the five report sections.
- **The fix.** Added the missing writer `report_template_save(model_id, title, sections)` (requires
  `edit_config`, validates each section id against the closed five, versions + logs the change; the
  0088 trigger writes the hash-chained `report_template_versions` row) and the reader
  `report_template_list()`. `compose_report` now reads the org's current M1 template and creates
  exactly those sections in that order; with no template it produces the pre-0108 five-section
  default unchanged.
- **UI.** New `src/components/admin/ReportTemplatePanel.tsx` (tab `Report template`,
  `org-control-tab-templates`): reorder / remove / add sections, save, with the live current version
  shown. Test `ReportTemplatePanel.test.tsx` (5 cases) covers the default plan, a saved plan, the
  reorder-and-save RPC call, a database refusal, and the no-right state. Contract section `OA-22b`
  added to `docs/ACP-UI-CONTRACT.md`.
- **Gate set after the change:** `tsc` PASS; `vitest` PASS (206 files / 2410 tests); `vite build`
  PASS; `check-shrink` PASS; `check-tokens` PASS; `check-ui-contract` PASS (48 screens); 
  `check-tutorials` PASS (75 current / 5 stale — the 4 new stale keys are `oa.features`,
  `oa.tutorials`, `oa.connectors`, `oa.formats`, whose declaring file `OrgControlPanel.tsx` changed;
  GIFs regenerate in Phase 6 when the UI is final); SQL harness PASS — "all SQL tests passed twice".

## Phase 4 — Methodology & test steps as data

| # | Task | Status |
|---|---|---|
| 4.1 | `procedure_templates`, `test_step_templates` (+ versions), in the config registry | TODO |
| 4.2 | Test steps become data; row-testing panel driven by the template | TODO |
| 4.3 | Methodology library screen (create / edit / publish) | TODO |
| 4.4 | Provisioning seeds a default template | TODO |

## Phase 5 — Monitors & connectors reachable

| # | Task | Status |
|---|---|---|
| 5.1 | Runner wiring `rule_engine_process`, `staged_record_ingest`, `connector_run_start/finish`, `alert_record` | TODO |
| 5.2 | Fired alerts land in the Work Queue | TODO |
| 5.3 | 22 adapters either wired or clearly labelled "catalogue only, not live" | TODO |

## Phase 6 — Proof & demo script

| # | Task | Status |
|---|---|---|
| 6.1 | Full system suite against a production build | TODO |
| 6.2 | Multi-org isolation under concurrency | TODO |
| 6.3 | `docs/DEMO-SCRIPT.md` using only tested flows | TODO |

## Six anti-theatre CI gates

| # | Gate | Status |
|---|---|---|
| G1 | Production-build E2E (`npm run preview`, not `dev`) | TODO |
| G2 | No-dead-code (every `public` fn has a production caller or is allow-listed) | TODO |
| G3 | Config-effect (every configurable field has a proving test) | TODO |
| G4 | Wiring (every `src/data/*.ts` export imported by a component or allow-listed) | TODO |
| G5 | Two-sources (no component reads both the seed and the database) | TODO |
| G6 | RPC parity (every RPC the app calls exists in the final schema) | TODO |

## UI / UX

| # | Task | Status |
|---|---|---|
| U1 | Pencil-style guided pointers (hand-drawn feel) on every flow | TODO |
| U2 | Complete every screen's functional states (loading/empty/error/ready/denied) | TODO |
| U3 | Guided first-run: zero → first sealed report with no further code | TODO |

---

## Explain layer (popouts, drilldown, access-filtered detail, IIA standards)

Full specification: `docs/EXPLAIN-LAYER.md`. Verified IIA numbering: `docs/iia-standards-reference.md`.
Owner requirement: every method, field, status and term gets a small popout saying what it is and what
it will do; everything is drilldownable; hovering any text shows a detail popout **filtered on view
access**; IIA standards are woven into the same information workflow.

| # | Task | Status |
|---|---|---|
| E1 | `src/lib/explain/catalogue.ts` — schema, `explainFor(user, id, context)`, redaction, L2 guard test | TODO |
| E2 | `ExplainPopout` + `useExplain` on `HoverPreview`; non-blocking, a11y (tooltip + complementary) | TODO |
| E3 | `src/lib/explain/iia.ts` — standards as data, paraphrased, mapped to real screens/RPCs | TODO |
| E4 | Hover cards + detail panels wired across sampling methods, fields, statuses, terms | TODO |
| E5 | Drilldown from every aggregate; deep-linkable; no blocking modal (walk test) | TODO |
| E6 | Standards affordance on screens, lifecycle steps and report sections | TODO |
| E7 | Standards view (catalogue → implementation → evidence) | TODO |
| E8 | `PencilGuide` + guidance data for guided first-run and per-screen "show me" | TODO |
| E9 | Gates G7 (explain coverage), G8 (drilldown), G9 (IIA honesty) + tests | TODO |
| E10 | Extend `UI-INVENTORY.md` with explain ids, standards and drilldown targets per screen | TODO |

The access rule that makes this safe: the popout renders static catalogue content (safe for any
signed-in user) plus contextual values the **host screen** has already filtered through
`src/lib/access.ts`. The popout never queries and never decides access to tenant data; it re-checks
the caller's rights and redacts. This keeps Law L2 intact.

## Environment facts (for the next session)

- The sandbox has **no host Postgres** and **no Docker socket for the user**, but
  `sudo -n docker` works. `scripts/local-sql-harness-docker.sh` runs a real Postgres 17 in Docker
  and applies the shim, migrations twice, tests twice.
- **Container readiness gotcha:** the official Postgres entrypoint runs a *temporary socket-only*
  server during initdb. A socket `pg_isready` probe succeeds against it and then it shuts down,
  causing a false "ready". The harness probes over **TCP** (`-h 127.0.0.1`) to avoid this.
- `@electric-sql/pglite` is installed `--no-save` and can apply all migrations in-process for schema
  introspection (used by the audit). It is not the gate; Docker Postgres is.
- Playwright's `webServer` is `npm run dev` — this is the reason the suite never saw the production
  defect, and changing it is gate G1.
