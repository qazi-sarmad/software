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
| 0.6 | Merge the spec branch `feature/systeligon-v1` (`0dc9db2`) to obtain `SYSTELIGON.md`, the register, the gates and `BRANCH-MAP.md` | DONE |
| 0.7 | Fix the tutorial-step generator so it never targets the other portal's testid (the red the merge surfaced) | DONE |
| 0.8 | Re-scope Phase 5 to the full C-series (C1–C7) and strike the E-series (Builder B's) | DONE |

### Task 0.6 — the spec-branch merge, and the one red it surfaced (2026-10-28)

Merged `origin/feature/systeligon-v1` (`0dc9db2`) into this branch with `git merge --no-ff`.
Verified landed: `git merge-base --is-ancestor f387e61 HEAD` → **GUIDANCE LANDED** (the check
`docs/BRANCH-MAP.md` rule 4 prescribes; the obvious `--is-ancestor <pre-split-sha>` test is a false
positive and was not used).

- **One conflict, exactly where the map predicted:** `supabase/migrations/0081_tutorial_steps.sql`,
  a **generated** file. Resolved the way the map requires — not by a text merge, but by regenerating
  from `docs/ACP-UI-CONTRACT.md` with `node scripts/gen-tutorial-steps.mjs`. `src/lib/tutorialKeys.json`
  auto-merged and the key list is the correct union (81 keys; this branch's only-ours key is
  `sa.integrity-anchoring`).
- **The red the merge surfaced.** With the environment inert (see the note below), the full suite ran
  **2439/2439 green except one**: `src/guards/tutorialTargets.test.ts` failed with
  `oa.tutorials -> superadmin-tutorials`. Root cause, proven by experiment: at the merge base the
  **generator itself** produces that target (OA-18's contract section lists `superadmin-tutorials`
  because OA-18 embeds the platform table with `audience="org_admin"`), while the **committed**
  `tutorialKeys.json` had been **hand-corrected** to only `org-tutorials`. So any regeneration
  reintroduced a latent generator defect. Builder B carries the same generator (identical md5) and the
  same hand-fix, so the defect is shared, not this branch's alone.
- **Fix (0.7).** `scripts/gen-tutorial-steps.mjs` now filters a candidate target that belongs to the
  other portal (`foreignPortal(key, t)`: an `oa.*` key never targets `superadmin-*`; an `sa.*` key
  never targets `org-*` / `org_admin-*` / `oa-*`). This is the same rule the guard enforces and the
  note on the OA-18 section states. Regenerated; the guard passes; the generator is idempotent
  (a second run is byte-identical).

### Environment note — the vitest run must have Supabase unset

This sandbox exports `VITE_SUPABASE_URL`, `SUPABASE_URL` and the keys. The data-layer tests assert the
**inert** path ("not configured → empty collections, writes refuse"), so with those variables set they
fail with live-Postgres errors (`permission denied for table universes`) — 42 spurious failures that
have nothing to do with any change. Run the suite inert:

```bash
env -u VITE_SUPABASE_URL -u VITE_SUPABASE_PUBLISHABLE_KEY -u SUPABASE_URL \
    -u SUPABASE_SECRET_KEY -u SUPABASE_PUBLISHABLE_KEY npx vitest run
```

With that, the suite is 2439/2439. Recorded so the next session does not read those 42 as regressions.

### Task 0.8 — migration-number coordination

`docs/BRANCH-MAP.md` reserves `0107`–`0109` for this branch and `0110`+ for Builder B. This branch
had already committed Phase 4 as `0110_phase4_methodology.sql` **before** the map existed, so `0110`
is consumed. Builder B's highest migration today is `0106`, so there is **no live collision**, but the
reservation is off by one. Decision recorded rather than silently renumbering a shipped migration
(renumbering would break `supabase/tests/111_phase4_methodology.sql` and this ledger's own history):
**this branch's Phase 5 migrations start at `0111`**, leaving `0110` as-is. A future reader should
treat `0107`–`0110` as this branch's and `0111`+ as free for whichever builder reaches it first.

**Correction (2026-10-29).** The "no live collision" judgement above was measured too early. Builder B
subsequently advanced into `0110`–`0117` on `feature/systeligon-build-v1` with **different filenames**
from this branch's `0110`–`0117`, so the collision is now real on every number in that range, and a
plain `git merge` would resolve it silently — keeping one side, dropping the other, and staying green.
`docs/BRANCH-MAP.md`'s reservation table is corrected in the same commit as this note: `0110`–`0117`
are recorded as **collided**, and every new migration takes `0118`+. The lesson is the one this ledger
keeps re-learning: a reservation is only as good as the check that it still holds.

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

### Baseline re-verified at `a917f31` (2026-10-28, start of the G-gate work)

Every gate re-run locally at the head the G-gate work begins from (`a917f31`). The counts have grown
with Phases 3–5; this is the number to compare a later run against.

| Gate | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | PASS |
| Unit tests | `npx vitest run` | PASS — 213 files / 2451 tests |
| Build | `npx vite build` | PASS |
| Shrink | `node scripts/check-shrink.mjs` | PASS (58 files) |
| Tokens | `node scripts/check-tokens.mjs` | PASS (188 files, 0 violations) |
| UI contract | `node scripts/check-ui-contract.mjs` | PASS (48 screens) |
| Tutorials | `npm run check-tutorials` | PASS (81 GIFs, 12 stale — pre-existing, regenerate in Phase 6) |
| SQL harness | `bash scripts/local-sql-harness-docker.sh` | PASS — "migrations applied twice / all SQL tests passed twice" (114 migrations, 118 test files) |

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
| 3.6 | `docs/CONFIG-EFFECT-MATRIX.md` — every configurable field with its proving test | DONE |

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

### Phase 3.6 — the last inert config fields enforced, and the matrix written (2026-10-28)

Migration `supabase/migrations/0109_phase3_config_effects.sql` (new) and test
`supabase/tests/110_phase3_config_effects.sql` (new). Migration applies twice cleanly; full SQL
harness green ("all SQL tests passed twice", 113 test files). New document
`docs/CONFIG-EFFECT-MATRIX.md` proves every configurable field's effect by a named test.

- **The defect.** Eight columns across six config tables were stored, versioned and echoed by a
  getter but consulted by no decision. They were classified mechanically (parse every
  `create function` body, attribute each column reference to its owning function, drop the pure echo
  functions), which produced exactly this inert set:
  `entity_approval_settings.required_fields`, `export_retention_settings.activity_retention_days`,
  `export_retention_settings.export_schedule`, `org_lifecycle_settings.report_opinion_required`,
  `org_settings_extra.certificate_auto_issue`, `org_settings_extra.last_board_meeting_date`,
  `pattern_settings.visibility_right`, `tenant_settings.usage_quota`.
- **Two-sources defect closed.** The UI saved `report_opinion_required` to `org_lifecycle_settings`,
  but `sign_conclusion` read only the legacy `config_versions.conclusion.opinion_required` key, so
  the toggle did nothing. `sign_conclusion` now treats the opinion as required when **either** source
  says so. Test 110 §1 proves the toggle blocks and then unblocks the sign-off.
- **`required_fields`.** `submit_entity` now validates every field named in
  `entity_approval_settings.required_fields` against the entity and refuses with `required_field`
  when one is missing. Test 110 §2 requires `["name","kind"]` and proves an entity with no kind is
  refused, then that supplying the kind lets it through.
- **`visibility_right`.** `pattern_findings` gated on the hardcoded `view_insights`; it now gates on
  `pattern_settings.visibility_right`. Test 110 §3 raises it to `manage_team` and proves the CIA is
  refused.
- **`activity_retention_days`.** `archive_activity_period` now **clamps** the archived window to the
  retention cutoff instead of archiving activity that is still inside the live window, and refuses
  when the whole window is still live. Test 110 §4a proves a 300-day-old window is archivable under
  the 365-day default but refused under a 3650-day retention.
- **`export_schedule`.** New pure reader `scheduled_export_due(org)` makes the schedule a decision:
  `manual` is never due; daily/weekly/monthly are due once the interval has elapsed since the last
  export. Test 110 §4b proves manual is never due, daily is due with no export, is not due right
  after one, is due again after two days, and that a monthly schedule is not due after two days.
- **`certificate_auto_issue`.** `seal_engagement` now issues the certificate when the flag is on.
  **Rollback risk fixed:** the flag and the `certificates` entitlement are checked **before** issuing,
  so a `review_and_approve`-only caller can never have a completed seal rolled back because the
  auto-issue sub-call lacked `manage_engagements`. Test 110 §5 proves off issues zero and on issues
  exactly one, with the `certificate_issued` ledger entry.
- **`last_board_meeting_date`.** `board_pack_generate` gained a `since_last_meeting` boundary that
  starts at the configured date; the default `since_last` boundary is unchanged. Test 110 §6 proves
  the new boundary starts on the meeting date and the default does not.
- **`usage_quota`.** New reader `tenant_user_limit(org)` reads `usage_quota->>'users'`;
  `admin_provision_member` refuses a genuinely new member past the limit (an update of an existing
  member is not a new seat). An empty quota means unlimited, so nothing changes by default. Test 110
  §7 proves null-when-unset, refusal at the limit, and success after raising it.
- **Feature-map guard.** The `certificate_auto_issue` decision calls `has_feature(...)`, and
  `src/guards/featureMapCompleteness.test.ts` requires every function that gates on `has_feature(` to
  be mapped in `src/lib/featureMap.ts`. Rather than map the core `seal_engagement` to a sellable
  feature, the decision was extracted into a certificates-owned helper
  `auto_issue_certificate_on_seal(org, engagement)`, which carries the gate and is mapped to
  `certificates`. Sealing stays a core lifecycle action; the helper is the only new mapped RPC.
- **Gate set after the change:** `tsc` PASS; `vitest` PASS (208 files / 2421 tests); `vite build`
  PASS; `check-shrink` PASS (58 files); `check-tokens` PASS (183 files, 0 violations);
  `check-ui-contract` PASS (48 screens); `check-tutorials` PASS (81 GIFs, 76 current / 5 stale —
  all 5 stale keys are pre-existing: `sa.tenant-hub`, `oa.features`, `oa.tutorials`, `oa.connectors`,
  `oa.formats`); SQL harness PASS — "all SQL tests passed twice" (113 test files, 109 migrations).

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

Migration `0110_phase4_methodology.sql`; SQL test `111_phase4_methodology.sql`.

| # | Task | Status |
|---|---|---|
| 4.1 | `procedure_templates`, `test_step_templates` (+ versions), in the config registry | DONE |
| 4.2 | Test steps become data; row-testing panel driven by the template | DONE |
| 4.3 | Methodology library screen (create / edit / publish) | DONE |
| 4.4 | Provisioning seeds a default template | DONE |

**4.1 — DONE.** A procedure is a versioned, org-owned template (`procedure_templates`) with ordered
steps (`test_step_templates`); every change is hash-chained into `procedure_template_versions`
(advisory-locked per org, append-only). Writers `procedure_template_save` (validates the whole step
array before writing — unknown kind, duplicate key, blank label and empty list all refused) and
`procedure_template_publish`; readers `procedure_template_list` / `_get`; all require `edit_config`
except the readers. The version table is registered in `config_areas` (key `procedure_templates`,
history `procedure_template_versions`, notify `both`). Org-scoped RLS with no platform read (L2).

**4.2 — DONE.** `workpaper_step_state` gains the snapshot columns (`template_id`, `label`, `kind`,
`requires_evidence`, `ordinal`). `workpaper_apply_template` copies the current procedure's steps onto a
workpaper (requires `perform_work`, refuses a signed-off workpaper, idempotent — re-applying never
clears a completed tick). `finalize_testing` is replaced with the 0100 body plus a step gate: every
step that came from a template must be complete before fieldwork closes. A manually ticked step (no
template) is a note, not a gate, so existing flows are unaffected. UI: `ProcedureStepsPanel`
(`procedure-steps-panel`) inside `TestingStepsTab`; the legacy seed list shows only when no procedure
has been applied.

**4.3 — DONE.** `MethodologyPanel` (`methodology-panel`) mounted as the Org Admin `Methodology` tab
(`org-control-tab-methodology`): list the current procedures, edit a title/description and its ordered
steps (label, kind from the closed set, evidence-required toggle, reorder, add, remove), save a new
version, publish a version. Data module `src/data/methodology.ts`. Contract section `OA-25`.

**4.4 — DONE.** `procedure_template_seed(org, model, title)` seeds the default three-step procedure
(idempotent); every existing tenant is seeded on upgrade and `platform_create_tenant` seeds a new
tenant, so a client has a working methodology from the first sign-in.

**Gate set after the change:** `tsc` PASS; `vitest` PASS (211 files / 2439 tests); `vite build` PASS;
`check-shrink` PASS; `check-tokens` PASS (187 files, 0 violations); `check-ui-contract` PASS (48
screens); `check-tutorials` PASS (81 GIFs, 0 placeholders, 5 stale — the same 5 pre-existing stale keys,
GIFs regenerate in Phase 6); SQL harness PASS — "migrations applied twice / all SQL tests passed
twice".

## Phase 5 — Monitors & connectors reachable (the C-series)

Re-scoped 2026-10-28 after merging `feature/systeligon-v1` and reading `docs/BRANCH-MAP.md`.
This branch owns the whole **C-series (C1–C7)**, defined in `docs/SYSTELIGON.md` §11.1 and §13.
The old rows (5.1–5.3) covered only C1 and C3; they are replaced below.

The dispatch precedent is the email pipeline in `supabase/migrations/0064` §4:
`cron.schedule` every minute → `net.http_post` to an Edge Function carrying a dispatch token.
C1 follows the same shape — a dispatcher RPC the runner calls — and **adds no trigger**, which is
what preserves SQL test `66` (it calls `rule_engine_process` directly and asserts notification
counts; a trigger would double-fire).

| # | Task | Status |
|---|---|---|
| C1 | Scheduled runner: `pg_cron` `monitor-runner` job (`*/5 * * * *`) calls `monitor_runner_sweep(limit)`, which evaluates every org's released rules (SQL twin of `runMonitors`) and calls the `automation_dispatch_pending(org, limit)` dispatcher RPC (no trigger); persist alerts, emit `watcher.signal` | DONE |
| C2 | Alert enrichment: resolve entity, department, SIRA risk, inherent + residual risk, affected controls onto the alert | DONE |
| C3 | Delivery: Work Queue in-app + email, via `src/lib/liveSync.ts` (realtime, poll fallback) | DONE |
| C4 | Adhoc audit suggestion from an alert, pre-filled with entity/department/control | DONE |
| C5 | Remediation wizard from an alert (finding, CAP, request evidence, escalate, dismiss with reason) | DONE |
| C6 | Alert triage surface with rights gating | DONE |
| C7 | Anomaly to SIRA: a resolved alert proposes an emergent risk carrying the alert id, rule version and affected rows | BLOCKED (S18) |

**C1 evidence (DONE).** Migration `supabase/migrations/0111_phase5_monitor_runner.sql` adds
`monitor_runner_sweep(limit)` (the `pg_cron` `monitor-runner` job, `*/5 * * * *`), which evaluates
every organisation's released rules in SQL and drains the event outbox. The SQL evaluation is the
twin of `evaluateMonitor` in `src/lib/writing/monitors.ts`; both are pinned to the same lineage
hashes. Two tests prove it: `supabase/tests/112_phase5_monitor_runner.sql` (SQL, runs twice in the
Docker harness) and `src/lib/writing/monitorRunnerParity.test.ts` (TypeScript). A real defect was
found and fixed on the way: `monitor_alert_chain` ordered by `created_at desc, id desc`, but every
alert written by one sweep shares the transaction's `now()`, so the chain was ordered by a random
uuid whenever two alerts were written together; 0111 adds a monotonic `seq` and orders by it. Dedup
is on the reference set, not the lineage hash, so a later sweep over unchanged records does not
re-alert (a five-minute job that re-alerted every run would be unusable). The Edge Function
`monitor-runner` is deliberately **not** added: the `pg_cron` SQL job is the runner, the same shape
`deployment-escalation-sweep` already uses, and it is the honest, testable pattern.

**C2 evidence (DONE).** Migration `supabase/migrations/0112_phase5_alert_enrichment.sql` adds
`alert_enrichment(org, refs)` — a pure, deterministic resolver — and stores its answer on
`monitor_alerts` (nine new columns), returns it from `alert_list`, and carries it in the
`watcher.signal` catalogue payload so C3's notification can name the same things. The joins are the
real chain: `staged_records.population_id -> populations.engagement_id -> engagements.entity_id` for
the entity/engagement/universe; `entities.kind` (falling back to the name) for the department; the
entity's highest score in its latest PUBLISHED SIRA cycle for `residual_risk`/`residual_band`
(banded by `sira_band_for`), with `inherent_risk`/`inherent_risk_label` read from that score row's
`sira_scores.factor_values->>'inherent_risk'` factor and labelled from the org's `sira_scales`; and
the resolved engagement's `workpapers` for `control_ids`. Nothing is invented: an alert whose records
are not tied to an engagement keeps nulls (and `control_ids = '{}'`), and every reader tolerates it.
Tests: `supabase/tests/113_phase5_alert_enrichment.sql` (32 assertions, runs twice in the Docker
harness) and `src/data/writing.test.ts` (the `alert_list` -> `AlertRow` mapping, including the
null/empty case). The screen shows the linkage in the alert detail (`ConnectorMonitorPanel`). A real
replay defect was fixed on the way: `alert_list`'s `returns table` row changed, so 0090 now
`drop function if exists public.alert_list(uuid)` before the create — the same trap 0033 records.

**C2 is the highest-value item, not an optional refinement.** `docs/SYSTELIGON.md` §11.1: today
`MonitorAlert` carries only `ruleId`, `ruleVersion`, `kind`, `reason`, `references`, `evaluatedAt` —
no entity, department, SIRA risk or control. A runner that fires unenriched alerts satisfies `C1`
and misses the point of the phase: nobody can act on "a rule fired".

**C3 evidence (DONE).** Migration `supabase/migrations/0113_phase5_delivery.sql` adds
`monitor_alert_notify(org, alert_id)`, called once at the end of `alert_record` — the single write
path for an alert — so no alert can be written undelivered. It resolves the recipients as the members
whose role holds the `review_and_approve` RIGHT (the right `alert_triage_record` already requires; a
role *name* would break the moment a role's rights changed, which is what the rights model exists to
avoid), writes one per-recipient in-app `notifications` row (`user_id` set — the shape
`notifications_list()` returns and `useLiveNotifications` subscribes to over Realtime with the poll
fallback) and queues one `email_queue` row per recipient that has an address through `queue_email`
(0039), which the existing `email-dispatch` pipeline sends. It is idempotent per alert, and
delivery is deliberately best-effort after the insert so a missing address never rolls the alert
back. The defect it closes is exact: the escalation path writes `notifications` with `user_id = null`
and a `role_target`, and `notifications_list()` filters `user_id = auth.uid()`, so a role-targeted
row is visible to no one in the Work Queue — an alert reached the `monitor_alerts` table and stopped
there. It is not an `automation_rules` row for `watcher.signal` (that would notify a role name and
double-deliver on the event the alert trigger already emits) and not a trigger on `monitor_alerts`
(that would run inside `alert_record`'s transaction). A platform `watcher.signal` notification
template is seeded. Tests: `supabase/tests/114_phase5_delivery.sql` (21 assertions, runs twice in the
Docker harness) proves the two `review_and_approve` holders are notified in-app and by email, a
non-triager is not, the recipient sees it through `notifications_list()`, a second notify writes
nothing, an unenriched alert still delivers, org B's alert reaches no org A member, and the function
is service-only. The in-app surface (`wk-notifications` card + header bell, `e2e/s15-notifications.spec.ts`)
already existed and reads the same table, so the gap was the database delivery, not the UI.

**C4/C5/C6 evidence (DONE).** Migration `supabase/migrations/0114_phase5_alert_actions.sql` gives the
triager the things to DO with a delivered alert, each pre-filled from the C2 enrichment so nobody
retypes what the platform already knows. `alert_adhoc_suggestion(org, alert)` is the read-only
pre-fill — entity, department, controls, the newest draft plan for the alert's universe, and a
ready-made title and justification. `alert_adhoc_audit_raise` turns it into a pending ad-hoc plan item
by **delegating to `add_plan_item` (0021)**, so the plan's create right and the ≥10-character ad-hoc
justification rule are enforced exactly as for any other ad-hoc item; this adds no second approval
path. `alert_raise_finding` builds an observation whose four mandatory readability sections (context,
condition, effect, risk) are pre-filled from the alert — so `promote_to_finding` (0030) passes on real
content, not a bypass — and promotes it. `alert_raise_cap` writes a row on the CAP register (0038),
which has a select policy and **no tenant insert path**, so this RPC is the only honest way to add one.
`alert_request_evidence` records a durable, listable `evidence_requests` row (new table, RLS select,
no tenant write) rather than a notification that vanishes. `alert_escalate` records the disposition
through `alert_triage_record` (0090) and creates an observation, storing its id on the triage row so
alert and work are linked. **C6 is rights gating**, and it is per-action, not per-screen: the
work-raising actions check `perform_work` (the right `create_observation`/`update_cap` already check),
and escalation checks `review_and_approve` (the triage right) — so the UI can hide exactly what the
caller cannot do. The UI is `src/components/writing/AlertActionsPanel.tsx`, mounted in the alert
detail pane of `ConnectorMonitorPanel` (the existing `wk-connectors` screen, `OrgControlPanel` tab
`connectors`); every write refreshes the alert list through the panel's `onDone`. Data functions live
in `src/data/writing.ts` (`alertAdhocSuggestion`, `alertAdhocAuditRaise`, `alertRaiseFinding`,
`alertRaiseCap`, `alertRequestEvidence`, `alertEscalate`, plus `listEngagementOptions` and
`listEvidenceRequests`); the id-returning writes use a new `callRpcId` helper because `callRpc` drops
the returned id. Tests: `supabase/tests/115_phase5_alert_actions.sql` (35 assertions, runs twice in the
Docker harness) proves the pre-fill carries entity/department/engagement/controls/plan, the raised item
is `pending_adhoc` with the alert entity, an ad-hoc audit without a plan is refused, the finding's four
sections are pre-filled and `check_readability` passes, the CAP names the finding with the alert
department, the evidence request is open and names the alert, escalation records the disposition and
links the observation, a caller without `perform_work` is refused, org B cannot act on org A's alert,
and the grants/RLS are right; `src/data/writing.test.ts` adds 6 unit tests for the mapping, the
argument shapes and the refusal path. **`C7` stays `BLOCKED (S18)`**: an alert-to-emergent-risk
proposal needs SIRA continuity, which is Builder B's and not built.

**`C7` depends on `S18`** (SIRA continuity), which is Builder B's and not yet built, so `C7` is
recorded `BLOCKED (S18)` rather than left `TODO` — it is not available work for this branch alone.

**The joins already exist — this is a build, not an invention.** Reuse them; do not write a second
engine: `src/lib/findingTarget.ts` (`departmentsOf` / `auditsForDepartment`), the SIRA risk fields in
`src/data/sira.ts`, the existing `pg_cron` schedules, and `src/lib/liveSync.ts` (transport selection
with poll fallback). The runner's schedule pattern is `email-dispatch` (`0064_email_dispatch.sql`:
`pg_cron` → `net.http_post` + dispatch token → Edge Function).

**Two test expectations the runner must respect.** `supabase/tests/70_escalation.sql:49-51` asserts
exactly **three** enabled `platform.escalation.%` rules; if the runner adds a `watcher.signal`
escalation rule, that count becomes **four** and the assertion moves in the same commit. And do
**not** process events from an `after insert` trigger on `automation_events`:
`supabase/tests/66_secrets_email_automation.sql:186` asserts `rule_engine_process(v_event) = 0` on a
second call, so a trigger would process the event at insert and break line 179. Use an explicit
dispatcher RPC.

### Phase 5 — what already exists (verified in the code, not claimed)

- The engine is real and pure: `src/lib/writing/monitors.ts` (six deterministic rule kinds —
  `threshold`, `rate`, `sequence`, `set_membership`, `missing_event`, `reconciliation`), hash-chained
  alerts (`monitor_alert_chain`), triage states, `src/lib/writing/canonical.ts` (WebCrypto SHA-256).
- The DB side is real: `monitor_rule_save` / `_release`, `alert_record`, `alert_triage_record`,
  `alert_list`, `connector_instance_save`, `connector_run_start` / `_finish`, `staged_record_ingest`,
  `connector_egress_allowed`, `rule_engine_process`, `rule_conditions_ok`, `rule_condition_ok`,
  `escalation_recommendation`, `escalation_evaluate`, `admin_require_right`, `admin_log_change`,
  `provio_org_guard`.
- **What is missing is the wiring**: `runMonitors` / `evaluateMonitor` have no non-test caller, no
  alert reaches the UI, and `MonitorAlert` carries no entity / department / SIRA / control linkage.

### Phase 5 — why the runner is an RPC plus an Edge Function, not a trigger

A trigger on `automation_events` would call `rule_engine_process` a second time for every event that
SQL test `66` inserts by hand, so the test's notification counts would double and it would fail.
The dispatcher RPC keeps the engine's invocation explicit and testable: the runner Edge Function
calls `automation_dispatch_pending(org, limit)`, which selects the pending rows, invokes the engine,
and returns what it did. That is the same split the email pipeline already uses.

## Phase 6 — Proof & demo script

| # | Task | Status |
|---|---|---|
| 6.1 | Full system suite against a production build | DONE |
| 6.2 | Multi-org isolation under concurrency | DONE |
| 6.3 | `docs/DEMO-SCRIPT.md` using only tested flows | DONE |

### Task 6.1 — the full suite against a production build (2026-10-28)

Ran the whole Playwright suite against the built bundle, not the dev server:

```
$ npx supabase start                      # local stack: all 116 migrations applied
$ curl -s http://127.0.0.1:54321/rest/v1/ -o /dev/null -w '%{http_code}'   # 200
$ source .env.e2e-local                   # E2E_PROD=1 -> webServer = vite build && vite preview (4173)
$ npx playwright test --project=chromium
  143 passed, 3 skipped (2.9m)
```

**Three spec-side defects the production run surfaced (not product defects), each fixed so the G1 gate
is honest:**

1. `e2e/acp-control-plane.spec.ts` hardcoded `BASE_URL = 'http://localhost:3000'` for the hand-built
   browser context in the Dual Session test. Under `E2E_PROD=1` nothing listens on 3000, so the context
   got `ERR_CONNECTION_REFUSED`. Fixed with a shared `e2e/baseUrl.ts` (`4173` under `E2E_PROD`, else
   `3000`) used by both this spec and the recorder.
2. `e2e/c4-tutorial-record.spec.ts` defaulted `BASE_URL` to 3000; same cause, same helper fix.
3. `e2e/smoke.spec.ts` `/dev/palette` drives a route guarded by `import.meta.env.DEV`
   (`src/App.tsx:470`), so it cannot exist in the production bundle. It now `test.skip`s under
   `E2E_PROD=1` — the dev run is where it has meaning.

One test was also made **web-first**: the "7 tabs in order" assertion called `evaluateAll` (which does
not auto-wait) and could snapshot the nav while the shell was still hydrating (`visibleTabs` empty →
the "restricted" branch). It now waits for the first tab before snapshotting. This is a test-harness
timing bug, but it is also a real transient state the shell shows; recorded for the U2 (functional
states) work.

The 3 skips are honest and expected: two board-pack specs self-skip when no pack exists on the project,
and the dev-only palette spec skips under the production build.

Gate set at this commit (all run locally, all PASS):

| Gate | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | PASS |
| Unit tests | `env -u VITE_SUPABASE_URL … npx vitest run` | PASS — 215 files / 2474 tests |
| Build | `npx vite build` | PASS |
| Shrink | `node scripts/check-shrink.mjs` | PASS (58 files) |
| Tokens | `node scripts/check-tokens.mjs` | PASS (189 files, 0 violations) |
| UI contract | `node scripts/check-ui-contract.mjs` | PASS (48 screens) |
| Tutorials | `npm run check-tutorials` | PASS (69 current, 12 stale — pre-existing) |
| G2 dead code | `node scripts/check-dead-code.mjs` | PASS (533 fns, 39 allow-listed) |
| G3 config effect | `node scripts/check-config-effect.mjs` | PASS (50 rows, 41 ENFORCED) |
| G4 wiring | `node scripts/check-wiring.mjs` | PASS (17 allow-listed, 28 test-only) |
| G5 two sources | `node scripts/check-two-sources.mjs` | PASS (0 allow-listed) |
| G6 RPC parity | `node scripts/check-rpc-parity.mjs` | PASS (116 RPCs, 10 service-only) |
| G1 prod E2E | `E2E_PROD=1 npx playwright test --project=chromium` | PASS — 143 passed, 3 skipped |
| SQL harness | `bash scripts/local-sql-harness-docker.sh` | PASS — "migrations applied twice / all SQL tests passed twice" |

### Task 6.2 — multi-org isolation under concurrency (2026-10-28)

Serial isolation tests (`01_org_isolation.sql`, `123_scale_isolation.sql`) prove a session reads only
its own org **when it runs alone**. They cannot see the class of defect where the tenant boundary
depends on shared per-request state — a pooled backend, a cached claim, a session-level GUC that
survives a `DISCARD`. Only overlapping statements expose that. Phase 6.2 adds two independent
concurrency proofs, one at the database layer and one through the real HTTP/RLS path the app uses.

**1. `supabase/tests/118_phase6_concurrency_isolation.sql`** — real concurrent Postgres sessions via
`dblink` (the same tool `15_ledger_concurrency.sql` uses). Four organisations are created through the
platform path (`platform_seed_org_roles`), each with a universe, entity, engagement and a `cia`
member. Then 4 orgs × 4 sessions = **16 statements are sent with `dblink_send_query` before any
`dblink_get_result`**, so they are genuinely in flight together. Each session, as its own org:

- reads its own universes — asserts exactly 1;
- reads every other org's universes — asserts 0 (RLS);
- attempts to write the *next* org's universe — asserts 0 rows affected (RLS).

Every org is therefore written by a foreign session concurrently. A non-vacuity assertion runs first
(as owner) proving the four foreign universes really exist, so a passing run means the rows were
hidden, not absent. After the race, an owner check confirms no foreign write landed (every fixture
universe keeps its name). The file runs twice against the same database in the harness and is
idempotent.

```
$ bash /tmp/twice-test.sh supabase/tests/118_phase6_concurrency_isolation.sql
migrations ok
pass 1 OK
pass 2 OK
```

**2. `e2e/rls.spec.ts` — `[E2E] concurrent reads from two orgs never cross the tenant boundary`.**
The database test proves the policies; this proves the same boundary through PostgREST, which is what
the app actually calls. Two org tokens (Org A admin, Org B admin) each fire the whole tenant-table
list **three rounds**, all promises in flight via `Promise.all`, and every response is checked for a
row whose `org_id` is not the caller's. Runs against the production build (`E2E_PROD=1`).

```
$ source .env.e2e-local && npx playwright test e2e/rls.spec.ts --project=chromium
  14 passed (5.9s)
  ✓ [E2E] concurrent reads from two orgs never cross the tenant boundary (436ms)
```

Counts after this task: SQL test files 120 → **121**; Playwright `rls.spec.ts` tests 13 → **14**.

### Task 6.3 — `docs/DEMO-SCRIPT.md`, using only tested flows (2026-10-28)

The demo script is written so that **every step names the passing test that proves it and the testid
the presenter clicks**. If a step is not in the file it is not in the demo, so nothing on stage can be
a surprise. The script covers five acts: platform guided provisioning, tenant guided setup, the audit
from universe to sealed report, the credibility act (isolation, share, export, Board Pack, external
portal, public certificate), and config-that-does-something.

Every testid cited in the script was checked against the source and the specs (`grep`), and the
Board Pack ids were corrected from the placeholder `board-pack-*` to the real `wk-boardpack-*` during
that check. The script also carries a **Do not demo** list: C7 (blocked on S18), evidence file
storage (bytes not stored yet, SYSTELIGON §6.0), the 12 stale tutorial GIFs, and everything under
`docs/archive/`. Honesty about what is not ready is part of the deliverable.

### Phase 6, pre-work — the workpaper-creation path the product was missing (2026-10-28)

**This was a real product defect, found by grepping the call site, not by a failing test.** The
`create_workpaper` ACTION exists in the rights model (`src/lib/access.ts`, mapped to `perform_work`),
but no migration ever inserted a workpaper and no RPC created one:

```
$ grep -rn 'insert into workpapers' supabase/migrations/     # nothing
```

The Audit File's testing workspace gates its sampling and row-testing panels on `workpapers[0]`
(`AuditFileModal.tsx`). In production (empty seed) an engagement therefore had **zero** workpapers,
so `SamplingPanel` and `RowTestingPanel` were never mounted — the testing stage was unreachable and
no workpaper could ever exist. The Playwright suite never caught it because it ran against the dev
demo seed, which ships workpapers. This is exactly the "green test, empty screen" class the
remediation plan names, and the reason the G1 production-build gate exists.

What was built (migration `0116_phase6_workpaper_creation.sql`, SQL test
`117_phase6_workpaper_creation.sql`):

- `create_workpaper(p_engagement_id, p_control_id, p_title) returns uuid` — the one write path. It is
  `security definer` (the repo convention for tenant writes), so it repeats the `guard_testing_lock`
  rule explicitly rather than relying on the trigger (which exempts non-`authenticated` callers): a
  testing workpaper needs a signed-off planning section (`planning_signed_off`, §10.1). It refuses a
  caller without `perform_work`, an engagement outside the caller's org, and a sealed engagement. It
  appends a `workpaper_created` ledger entry. A direct table insert by `authenticated` is still
  refused by the trigger, so both paths agree.
- `workpapers.title` (nullable) — the tenant loader hardcoded `'Working paper'`, so a created
  workpaper had no name to show.
- `createWorkpaper` in `src/data/mutations.ts` and as an `AppContext` action (RPC + reload, the
  Phase-1 pattern), with a demo-seed branch that builds a full `WorkingPaper`.
- `WorkpaperCreatePanel` (`src/components/audit/WorkpaperCreatePanel.tsx`) — the in-place,
  non-blocking creation form, wired into the testing workspace above the two panels.
- `SamplingPanel` and `RowTestingPanel` take `workpaperId: string | null` and render a **designed
  empty state** instead of vanishing when the engagement has no workpaper. Before this they were
  gated on `workpapers[0]` and simply did not render.

Verified: `bash scripts/local-sql-harness-docker.sh` → "migrations applied twice / all SQL tests
passed twice"; `npx vitest run` → 215 files / 2474 tests pass, including six new cases in
`src/components/audit/phase4Panels.test.tsx` that render both panels with `workpaperId={null}` and
assert the empty state is present (the panels cannot silently disappear again). Registered in
`docs/ACP-UI-CONTRACT.md` (AF-06b, and the two no-workpaper testids) with `docs/UI-INVENTORY.md`
regenerated.

## Six anti-theatre CI gates (G1–G6 — this branch's)

`docs/BRANCH-MAP.md` records the split: **G1–G6 are this branch's; G7–G10 are Builder B's**
(explain coverage, drilldown, IIA honesty, and B's tenth gate). The earlier plan named nine gates on
one branch; after the split the explain-layer gates travel with the explain layer, which is B's. This
branch builds G1–G6 and does not build G7–G10.

| # | Gate | Status |
|---|---|---|
| G1 | Production-build E2E (`npm run preview`, not `dev`) | DONE (2026-10-29) |
| G2 | No-dead-code (every `public` fn has a production caller or is allow-listed) | DONE |
| G3 | Config-effect (every configurable field has a proving test) | DONE |
| G4 | Wiring (every `src/data/*.ts` export imported by a component or allow-listed) | DONE |
| G5 | Two-sources (no component reads both the seed and the database) | DONE |
| G6 | RPC parity (every RPC the app calls exists in the final schema) | DONE |

### G1 — production-build E2E, DONE and now run by CI (2026-10-29)

The gate exists and passes: `playwright.config.ts` sets the web server to
`npm run build && npm run preview -- --port 4173 --strictPort` and the base URL to `:4173` when
`E2E_PROD=1`, and `e2e/phase1-production-build.spec.ts` runs only under that flag. The ledger's old
`TODO` row simply contradicted the file's own status table several hundred lines above it (the
`G1 prod E2E` row that read *PASS — 143 passed, 3 skipped*). Corrected here; the code was not the fault.

**The row was DONE but the gate had never run in CI.** No job step anywhere set `E2E_PROD=1`, so the
suite CI executed was always the dev-server one. On this repository that is not a trivial omission:
the whole reason G1 exists is the production build once shipped empty screens while the dev suite
stayed green. A gate that is *written* and *passes locally* but is *never executed* is exactly the
"documented, tested, not wired" class this ledger tracks. Fixed in the same session: CI step 8 now
runs the dev suite and then `npm run build` + `E2E_PROD=1 npx playwright test --project=chromium`, so
the row's DONE is enforced by the pipeline rather than by a manual run. Recorded as decision D3.

### G2 — no dead code, DONE (2026-10-28)

`scripts/check-dead-code.mjs` + `scripts/dead-code-allow.json`. It replays every migration into an
in-process Postgres (pglite, installed `--no-save`) and reads the **real** schema, so the answer is
about the database that ships, not about source text. A `public` function is reachable when a caller
is found in any of: another function body (`pg_get_functiondef`), an RLS policy / view / constraint /
column default, a migration-level statement (a seed `DO` block), a trigger (`execute function`), an
RPC target named in `src/data/**` or `supabase/functions/**`, the RPC catalogue in
`docs/UI-INVENTORY.md`, or a Supabase auth hook in `supabase/config.toml`.

- **Result:** `PASS: check-dead-code — all 531 public functions are reachable or allow-listed (39
  allow-listed).` The gate also fails on a **stale** allow-list entry (one that has become reachable),
  so the list cannot silently accumulate.
- **Why a pglite replay, not a grep.** The obvious grep produced three false positives in a row: it
  missed `public.fn(`-qualified calls, it missed `callRpcId(`, and it treated a `grant execute`
  / `comment on` line as a caller. Reading `pg_proc` removes all three classes of error at once.
- **39 allow-listed, each with a reason in `scripts/dead-code-allow.json`.** 30 are **test-only** —
  a SQL test calls them, which per `docs/BRANCH-MAP.md` means "a tested unit the UI has not reached
  yet", not dead code. 2 are platform-operational (`migration_job_advance`, `migration_step_upsert`;
  `service_role` only, driven by the hosting-migration runner outside this repo).
- **7 are genuinely unreferenced** (no caller in the schema, the app, an Edge Function, a migration
  statement **or** any SQL test). They are recorded here, not deleted, because `docs/BRANCH-MAP.md`
  forbids silently deleting another area's code and none of them is this branch's:
  `has_org` (superseded by an inline `jwt_org_id() is not null`), `org_id_from_header` (a documented
  anti-pattern helper, deliberately never called), `seed_severity_levels` (superseded by the inline
  seed in `0030`), `share_covers` (superseded by `has_active_share` in `0095`), `signing_keys_get`
  (no UI lists signing keys), and the two hosting-migration RPCs above. Reported so the owner can
  decide whether to remove or wire them.

### G4 — wiring, DONE (2026-10-28)

`scripts/check-wiring.mjs` + `scripts/wiring-allow.json`. It resolves the real import graph
(alias-aware, namespace-aware, dynamic-import-aware), follows it transitively from the UI entry points
(`src/components/**`, `src/context/**`, `src/hooks/**`, `App.tsx`, `main.tsx`) and reports every
**value** export of a `src/data` module that no screen reaches. A `type` / `interface` is not counted
(a type vanishes at runtime and is not dead code when unused).

- **Result:** `PASS: check-wiring — every src/data value export is reachable from a screen, referenced
  by a test, or allow-listed (17 allow-listed, 28 test-only).` The count is 17 now: 23 when G4 first
  landed, 20 after the WP-F font fix wired three `fontBytes` exports (see below), and 17 after this
  commit closed the three remaining A-own gaps and removed their entries. The gate fails on a stale
  entry, so the list cannot grow stale silently.
- **Why a real graph, not a grep.** A name-based grep is wrong here in both directions: screens import
  with aliases (`populateSuggestions` is the export `populate_planning_suggestions`) and with
  namespaces (`import * as writes from '../data/mutations'`), so a grep both misses wired code and
  flags it. This walks the statements. It also credits a name used by another reachable module
  (intra-module use by a reachable sibling), which is how `buildReportModel` and `loadReportFonts`'
  consumers are legitimately reachable without a direct screen import.
- **A test-only export is not dead** (`docs/BRANCH-MAP.md`). 28 exports have no production caller but
  are referenced by a `.test.ts`; the gate reports them as test-only and does not fail. The gate fails
  only on an export with **no** production caller **and** no test reference.
- **The gate also fails on a stale allow-list entry**, so the list cannot silently accumulate.
- **Findings reported, not silently allow-listed (23).** Per `docs/BRANCH-MAP.md`, the inert set in
  `src/data/**` is **Builder B's** to resolve (its S/T rows name `listIntegrityAlerts`,
  `createSiraCycle`, `publishSiraCycle`, `recordSiraScore`, `submitEmergentRisk`, `decideEmergentRisk`
  explicitly), so this branch records the list in `scripts/wiring-allow.json` with a per-entry reason
  and does **not** build in B's scope (BRANCH-MAP merge rule 5). **Four are this branch's own**, and
  each is a real wiring gap this gate surfaced:
  - `src/data/fontBytes.ts::{fontUrl,loadFontBytes,loadReportFonts}` — the WP-F report-font path.
    **FIXED** (this commit). A format's `fontHeading` / `fontBody` was validated, shown on the canvas
    and stored, but the freeze path (`renderAndStoreReportFiles`) never called `loadReportFonts`, so
    the **frozen PDF embedded the standard font, not the chosen one**. `renderAndStoreReportFiles` now
    loads the format's font bytes and passes them to both PDF renderers (`toPdfModel` gained a `fonts`
    argument; `renderDesignedPdf` gained the same). Closing it exposed a **latent production bug**: the
    self-hosted faces are WOFF2, and fontkit's subsetter throws *lazily* during `pdf.save()` for some
    glyph sets (a heading containing a digit — which every real report has), so the existing
    `try { subset: true } catch { subset: false }` fallback in `embedCustomFont` could not catch it and
    the freeze would fail. Both renderers now choose by container signature: a WOFF2 face is embedded
    whole, a raw TTF/OTF is subset. Proven by `src/data/fontBytes.test.ts`,
    `render.test.ts` ("carries heading and body font bytes …") and `designedPdf.test.ts`
    ("embeds the format font bytes …").
  - `src/data/reportGraph.ts::getReportGraph` — the reader for the committed report graph and claims
    ("the screen's drilldown", Phase 2.6). The writer is wired; the reader had no caller, so the
    committed root was not drilldownable. **FIXED** (this commit). `ReportEditorPanel` now has a
    non-blocking "View claim graph" drilldown (`report-graph-open`): it loads the selected version's
    committed root and claims through `getReportGraph` and renders them in a panel beside the editor
    (`report-graph-panel`, `report-graph-root-*`, `report-graph-claim-*`, with `report-graph-empty`
    when nothing is committed and `report-graph-close` to dismiss). The panel resets on a version
    switch so it never shows a root that does not match the version on screen. Proven by
    `phase6Panels.test.tsx` ("drills into the committed claim graph", "shows the drilldown empty
    state").
  - `src/data/reportFiles.ts::reportFooterPreview` — the on-screen footer line whose own doc comment
    says it exists so the screen and the file agree; no screen called it. **FIXED** (this commit).
    The report editor renders it under the frozen file hashes (`report-footer-preview`), from the
    same `footerLine` the PDF/DOCX use, so the screen and the file agree. Proven by
    `phase6Panels.test.tsx` ("previews the frozen footer line on screen").
  - `src/data/mutations.ts::appendLedgerEntryDb` — a Phase 1.4 leftover; the database writes the
    ledger entry itself on every state change, so the client-side appender had no caller and never
    would. **DELETED** (this commit): a wrapper with no possible caller is dead code, not a wiring
    gap, so it is removed rather than allow-listed. Its wiring-allow entry is removed with it.

### G5 — two sources, DONE (2026-10-28)

`scripts/check-two-sources.mjs` + `scripts/two-sources-allow.json`. It resolves the real import graph
(alias-aware and namespace-aware, the same reason G4 does) and reports any component that reads one
tenant table from **both** the seed and the database. This is the defect the audit named: two lists
for one table that agree in the dev demo and disagree in production, where the seed is empty — so
half the screen is blank and no test notices (the tests run against the seed).

- **Result:** `PASS: check-two-sources — no component reads a table from both the seed and the
  database (0 allow-listed).`
- **The one real violation, found and fixed.** `src/components/universe/AuditUniverseTab.tsx` read
  `entities` from the seed (`scopedEntities` via `useScopedData`) **and** from the database
  (`listEntities()` in `src/data/universe.ts`), rendering two lists: the seeded heatmap cards and a
  separate "Entities awaiting or holding approval" DB list. In production the seed is empty and the DB
  list is the only real one, so the heatmap vanished. **Fixed** by making the screen single-source:
  the cards now come from `scopedEntities` (which `loadTenantSnapshot` hydrates from the database) and
  carry the database approval status. `AuditEntity` gained `approvalStatus` and `rejectionReason`
  (the DB `entities.status` / `entities.rejection_reason`), so the approval chip and the inspector
  dispatch read the real state instead of a hardcoded `status: 'draft'`.
- **Proven by** `src/guards/twoSources.test.ts` (5 tests) which drives the **same** detector the gate
  runs (`scripts/two-sources-core.mjs`): it flags the seed+database clash, flags an aliased import,
  passes a single-source component, ignores a reader name in a comment or string, and pins that the
  real `AuditUniverseTab` is single-source. The gate was also run against the pre-fix file to confirm
  it reports the violation, then against the fix to confirm it clears.
- **Why a real import graph, not a grep.** Same alias/namespace problem as G4; a grep both misses
  aliased reads and flags names mentioned in comments or strings.
- **Wired into** `scripts/pre-pr-gates.sh` (step 6d), `scripts/ci-local.sh` (step 8d), `ci.yml`
  (step 6d) and `package.json` (`npm run check-two-sources`).

### G6 — RPC parity, DONE (2026-10-28)

`scripts/check-rpc-parity.mjs`. It extracts every RPC target the app names (`rpc('name'`,
`callRpc…('name'`, `callRpcId('name'`) from `src/data/**` and `supabase/functions/**`, replays the
migrations into pglite, and asserts every one exists in `public` **and** is callable by the
`authenticated` role (a function that exists but grants no execute to `authenticated` is a
production break the test suite cannot see, because the tests mock the client).

- **Result:** `PASS: check-rpc-parity — every RPC the app calls (115) exists in the final schema and
  is callable by authenticated (10 service-only allow-listed).`
- The 10 service-only allow-listed RPCs are the dispatcher/worker functions the Edge Functions call
  with the service key (`email_dispatch_claim`, `secret_reveal`, `automation_dispatch_pending`, …);
  they are correct to be service-only.
- **Same pglite trap as G2, recorded so the next script does not hit it:** `@electric-sql/pglite`
  ships the `pgcrypto` bundle but not the Supabase-specific `pg_cron` / `vault` / `pgsodium` shims
  some migrations reference, so the replay strips the `create extension` lines pglite does not
  provide. Without that the replay stops early and every later function looks missing.

### G3 — config effect, DONE (2026-10-28)

`scripts/check-config-effect.mjs`. It reads the **real** schema (pglite replay, the same trick as G2
and G6) and checks `docs/CONFIG-EFFECT-MATRIX.md` against it, so the matrix cannot claim an effect the
schema does not implement. It fails when: **A** a row's reader cell names no real function or view (a
claim of enforcement with no call site); **B** a row's proving-test file does not exist; **C** a
configuration-table column in the final schema has no row (or §6 deferred entry) in the matrix;
**D** a row names a `table.column` that is not a real column; **E** an allow-list entry is stale. The
allow-list (`scripts/config-effect-allow.json`) is empty — every row is backed by a real object and a
real test.

- **Result:** `PASS: check-config-effect — 50 matrix rows (41 ENFORCED); every reader is a real object,
  every proving test exists, every config column is documented (0 allow-listed).`
- **The gate found four false rows and one inert setting, and all five were fixed.**
  1. `org_lifecycle_settings.signoff_role_testing` — the reader cell named `sign_testing`, which does
     not exist; the real reader is `sign_off_workpaper` (proven by `108_phase3_workflow_enforcement.sql`
     §4).
  2. `org_settings_extra.time_zone` — the reader cell named `scheduled_jobs`, which is not a function,
     and the proving test `74_scheduled_jobs.sql` does not exist. The real reader is `org_local_date`;
     the real test is `83_scheduled_jobs.sql`.
  3. `workflow_settings.escalation_hours` — the reader cell said "same as above", naming nothing; the
     real readers are `escalate_overdue_deployment_requests` and `deployment_requests_escalate_all`.
  4. `report_templates.{model_id,version,title,is_current,plan}` were undocumented; `default_register`,
     `allowed_registers` and `default_locale` are written by no UI and read by no function, so they are
     recorded in §6 as deferred, not falsely marked ENFORCED.
  5. **`tenant_settings.status` — a stored-but-inert setting the matrix claimed was enforced.** The
     row read: "`suspended` blocks writes across the product | read by ~120 RPCs' status guards |
     ENFORCED". There is no such guard: an exhaustive search found only three reads in function bodies
     (the two platform listing RPCs that echo it, and `guided_provisioning`), no RLS policy and no
     trigger. Owner decision 1 (locked) is **enforce, do not remove**, so it is enforced now — see
     below.
- **How `tenant_settings.status` is enforced (`0115_tenant_suspension_enforced.sql`).** The broad
  write chokepoint was rejected: 246 write functions exist, 163 guarded by a shared helper and 83
  unguarded, so "block writes" is neither the current design nor a small change. The correct
  chokepoint is the **access-token hook** (`custom_access_token_hook`, `0010`, extended in `0066`),
  which is the only writer of the `org_id` and `user_role` claims — RLS and every org-scoped RPC
  resolve identity from those claims, never from a header or body. A new named reader
  `tenant_is_active(org_id)` returns false when `tenant_settings.status = 'suspended'`; the hook, for a
  suspended org, stamps no `org_id` and no `user_role`, so the member is to RLS a user with no
  membership and reads nothing (spec §4.5, no fallback org). Platform staff carry no `org_members` row
  and are never suspended out, so the platform can always lift a suspension.
- **Proven by** `116_tenant_suspension.sql`: `tenant_is_active` reflects the stored status; a suspended
  member is issued no org claim and no role claim; with no org claim the member reads zero universes
  and zero entities; platform staff keep the `platform_admin` role. **A first attempt at this
  migration dropped the external-auditor branch that `0066` added to the hook, and the SQL harness
  caught it** (`75_external_auditors.sql` §9: the hook no longer stamped `external_auditor`); the
  migration now extends the `0066` body rather than the `0010` one, and the harness is green again.
  This is the point of the one rule: a rewrite of an existing function must build on its latest
  version, and only the SQL harness sees it.
- **Wired into** `scripts/pre-pr-gates.sh` (step 6d), `scripts/ci-local.sh` (step 8d),
  `.github/workflows/ci.yml` (step 6d) and `package.json` (`npm run check-config-effect`).

## UI / UX

| # | Task | Status |
|---|---|---|
| U1 | Pencil-style guided pointers (hand-drawn feel) on every flow | TODO |
| U2 | Complete every screen's functional states (loading/empty/error/ready/denied) | TODO |
| U3 | Guided first-run: zero → first sealed report with no further code | TODO |
| U4 | Team directory: profile, workload, travel and resourcing (spec §4.2, §5, §9) | DONE |

**U4 — DONE (2026-10-29).** The owner's ask: a written-but-unbuilt "team / profile / travel" concept
(SPEC-v10 §4.2 audit teams, §5 "team workload", §9 "people, time and travel by engagement") is now
built and reachable. A member has a working profile (picture, capacity) and travel preferences (home
base, willingness none/limited/full, preferred regions, blackout dates); a manager sees everyone's,
a member sees only their own (RLS on `team_travel` plus a `manage_team`/`manage_users` re-check in
`team_directory_get`). Trips and assignments are added and removed by stamping (`removed_at`), never
by deleting, so the calendar keeps its history. The resourcing form ranks who should take an
engagement — a pure model (`recommendAssignee`) that excludes a member on a blackout, on another
engagement, unwilling to travel, or without the right, and explains every verdict. An engagement can
be tagged as requiring travel.

- **Schema/RPCs:** `supabase/migrations/0127_team_directory.sql` — tables `team_profiles`,
  `team_travel`, `team_travel_trips`, `team_assignments`; `engagements` gains `requires_travel`,
  `travel_location`, `travel_from`, `travel_to`; RPCs `team_profile_save`, `team_travel_save`,
  `team_trip_add`/`_remove`, `team_assignment_add`/`_remove`, `team_directory_get`,
  `engagement_travel_tag`. Every write requires a team right, checks the target is a member of the
  caller's org (cross-org is refused, not silently ignored), and logs a change. RLS is org-scoped with
  no platform read (L2); travel is additionally personal.
- **Model:** `src/lib/teamDirectory.ts` — `profileWorkload`, `recommendAssignee`, `summariseTeam`,
  `availabilityOn`, `generatedAvatar`, `avatarInitials`; all pure, time as an argument (L4).
- **Data:** `src/data/teamDirectory.ts` — `listTeamDirectory`, `listDirectoryEngagements`,
  `saveTeamProfile`, `saveTeamTravel`, `addTeamTrip`/`removeTeamTrip`,
  `addTeamAssignment`/`removeTeamAssignment`, `tagEngagementTravel`.
- **Screen:** `src/components/admin/TeamDirectoryPanel.tsx` mounted as the Org Admin `Team directory`
  tab (`admin-tab-team`) on the People & Roles panel. Contract section `OA-11`; UI inventory
  regenerated (107 screens, 141 RPCs).
- **Tests:** `src/lib/teamDirectory.test.ts` (7), `src/components/admin/TeamDirectoryPanel.test.tsx`
  (6), `supabase/tests/100_team_directory.sql` (35 assertions — profile/travel save + read, trip and
  assignment stamping, personal-travel visibility, travel tagging, cross-org refusal, no-anon). Full
  vitest green; `tsc --noEmit` clean; guards green (`uiContractDrift`, `uiInventory`, `sourceGuards`,
  `tutorialTargets`); `check-wiring`/`check-ui-contract`/`check-feature-register`/`check-tokens`/
  `check-shrink` PASS.
- **Not done, recorded:** no tutorial GIF for `oa.team` yet (the key is declared; GIFs regenerate in
  Phase 6). `engagement_travel_tag` has no caller outside the team panel — it is reachable from the
  panel's tag control, which is wired.

**Overlap to resolve with Builder B before starting U1.** `docs/BRANCH-MAP.md` gives this branch `U1`
(pencil-style guided pointers) and gives Builder B `E8` (`PencilGuide` + guidance data under
`src/lib/guidance/`) — the same surface. B's ledger currently marks `E8` **DEFERRED (design
language)**, so nothing of it is built yet. Per `BRANCH-MAP.md` rule 5, this branch will not build a
second guidance implementation; the plan is to take `U1`/`U3` (the guided first-run flow and the
per-screen "show me" mode) as this branch's own, and to reuse one shared `src/lib/guidance/` data
module rather than write a parallel one. Recorded here so the collision is visible, not silent.

---

## Explain layer (popouts, drilldown, access-filtered detail, IIA standards)

**MOVED TO BUILDER B — see `docs/BRANCH-MAP.md`.** The E-series (E1–E10) is not this branch's work.
`feature/systeligon-v1` was merged into this branch on 2026-10-28, and `docs/BRANCH-MAP.md` records
that the split assigned the whole explain layer to Builder B, whose ledger is
`docs/SYSTELIGON-TASKS.md`. Builder B has built it: `src/lib/explain/` (catalogue, iia, types,
entries.*), `src/components/explain/` (ExplainPopout, ExplainDetail, DrilldownPanel, StandardsView,
StandardsAffordance) and its gates. B's rows E1–E7, E9 and E10 read **DONE**; E8 (`PencilGuide`,
guidance data) is **DEFERRED (design language)** on B's branch, and the pencil guidance is B's to
build. This branch does not re-implement any of it.

The rows below are struck, not marked DONE (this branch did not do the work) and not left TODO (it is
not outstanding work here). They are kept as a pointer so a reader of this ledger is not misled.

| # | Task | Status |
|---|---|---|
| E1 | `src/lib/explain/catalogue.ts` — schema, `explainFor(user, id, context)`, redaction, L2 guard test | MOVED (Builder B) |
| E2 | `ExplainPopout` + `useExplain` on `HoverPreview`; non-blocking, a11y (tooltip + complementary) | MOVED (Builder B) |
| E3 | `src/lib/explain/iia.ts` — standards as data, paraphrased, mapped to real screens/RPCs | MOVED (Builder B) |
| E4 | Hover cards + detail panels wired across sampling methods, fields, statuses, terms | MOVED (Builder B) |
| E5 | Drilldown from every aggregate; deep-linkable; no blocking modal (walk test) | MOVED (Builder B) |
| E6 | Standards affordance on screens, lifecycle steps and report sections | MOVED (Builder B) |
| E7 | Standards view (catalogue → implementation → evidence) | MOVED (Builder B) |
| E8 | `PencilGuide` + guidance data for guided first-run and per-screen "show me" | MOVED (Builder B; B DEFERRED it) |
| E9 | Gates G7 (explain coverage), G8 (drilldown), G9 (IIA honesty) + tests | MOVED (Builder B) |
| E10 | Extend `UI-INVENTORY.md` with explain ids, standards and drilldown targets per screen | MOVED (Builder B) |

The access rule that makes this safe: the popout renders static catalogue content (safe for any
signed-in user) plus contextual values the **host screen** has already filtered through
`src/lib/access.ts`. The popout never queries and never decides access to tenant data; it re-checks
the caller's rights and redacts. This keeps Law L2 intact.

### Continuous assurance (C1-C6) — spec SYSTELIGON.md §11.1
Scheduled runner, alert enrichment (entity/department/SIRA/inherent+residual risk/controls),
Work Queue + email delivery via liveSync, adhoc audit suggestion, remediation wizard, triage surface.

### Trust and attestation (T1-T5) — spec SYSTELIGON.md §11.3
Tamper alarm, ledger continuity check, portable attestation package, third-party verifier,
attestation screen. NOTE: the cryptographic spine (signing_keys/signatures/timestamp authorities,
migration 0096) is ALREADY BUILT; only the user-facing and third-party-verification halves are new.

### Deterministic capability library (D1-D4) — spec SYSTELIGON.md §11.1a
D1 risk/control intelligence; D2 population/evidence intelligence; D3 process/governance
intelligence; D4 assurance operations. Each is a pure function under src/lib/ with unit tests.

### Document recognition and SIRA continuity (S17-S18) — spec SYSTELIGON.md §5a, §11.1b
S17 magic-byte sniffing, archive unpacking with zip-bomb/path-traversal limits, office-inside-zip
detection, metadata/title extraction, recursion, inventory-before-import. NOTE: jszip/mammoth/xlsx/
pdf-lib already present; routing today is by EXTENSION only. No .rar library exists (licence decision).
S18 SIRA continuity: carry-forward pack on publish, seed next cycle, anomalies and findings proposed
as emergent risk. NOTE: SIRA is already cyclic and emergent risk already has accept/reject with a
reason; `populate_planning_suggestions` and `decide_planning_suggestion` exist but have ZERO non-test
callers. Prior-year import IS built and wired (PriorYearImportPanel in PlanningPanel).

### Tamper response (T6-T7) — spec SYSTELIGON.md §11.3a
T6 guided integrity incident wizard (what changed/who/what it affects, then restore, re-derive, freeze
or escalate, each with a reason, append-only, verify afterwards).
T7 wire the existing alarm. NOTE: integrity_alerts table, raise_integrity_alert() (writes the alert AND
appends a ledger entry) and the archive check functions ALL EXIST. But listIntegrityAlerts() has zero
callers and no migration emits a notification -> detection is complete, THE ALARM IS MISSING.

### CRITICAL — evidence is not stored anywhere (spec SYSTELIGON.md §6.0)
`EvidenceTab.tsx` has a working upload control that computes a SHA-256 and calls
`attachEvidenceToWorkpaper`, which writes to React state ONLY (AppContext.tsx:730, ZERO storage calls).
The bytes are discarded on reload. `evidence_files` (0035) has NO storage_path column. NO storage
bucket is created anywhere (not `reports`, `archives` or `org-branding`). Only `reportFiles.ts`
uploads anything (the rendered report PDF/DOCX). Mode A / Mode B evidence verification therefore
verifies a hash of bytes nobody kept. Fix = S20. This is the most serious gap found; the product's
central claim is evidence verification.

### Two-key SIRA acceptance (S19) — spec SYSTELIGON.md §11.1b
Owner correction: the accept/reject/override control stays with the SIRA finaliser, but their decision
is an ENDORSEMENT, not a closure - the auditors themselves must accept. Publish is blocked while
proposals are outstanding; reminders until resolved; silence is a finding.

### Review comment popout (S21) — spec SYSTELIGON.md §11.3b
Exists and reachable (CommentHistoryPanel via RecordContent 'comment_history', dispatched from
ReviewCommentsGlobalDock, mounted in App.tsx) but is the thinnest surface: ONE testid (bubble-mine/
bubble-other), no screenId prefix, no documented states, not in the inventory, no drilldown.
`ReviewCommentsDock.tsx` is DEAD (mounted nowhere) - delete it.

### Interface quality (U1-U8) — spec SYSTELIGON.md §11.1c
U1 drilldown from every number; U2 command palette; U3 work queue front door; U4 live activity spine;
U5 motion with meaning; U6 guided empty states; U7 density toggle; U8 keyboard-first.

### FEATURE-REGISTER + gate (R0) — 2026-10-28
docs/FEATURE-REGISTER.md is now the live inventory: 125 features, three statuses only (Wired/Inert/
Absent - "Partial" is banned because it is the word that let the old docs claim completion). Counts:
38 Wired, 42 Inert, 45 Absent. `scripts/check-feature-register.mjs` keeps it honest and is wired into
pre-pr-gates.sh, ci-local.sh (step 8c) and package.json. It fails when a status is outside the three,
ids are non-contiguous, the printed counts disagree with the rows, a Wired row names a symbol that
does not exist, a Wired row names a pure-layer export no screen calls, or a row asserting deadness
names something that IS called.
**The gate caught 15 errors in the register as first written** - including a real finding: the entire
SIRA WRITE path is inert (createSiraCycle / publishSiraCycle / recordSiraScore / submitEmergentRisk /
decideEmergentRisk all have ZERO callers; only the reads are wired from SiraTab.tsx). Also inert:
extractDocument (the doc-extract edge function is deployed but unreachable from the UI).
Work packages: R1-R7 (the missing middle, in dependency order), S13-S21, T3-T7, C1-C7, U9-U16, D1-D9.

### S2 — population header detection, confirm-before-count (2026-10-29)

**DONE.** Spec §2.1: *"today it assumes row 1 is the header. The engine must instead detect, propose,
and confirm."* `src/lib/population.ts` had `const [header, ...body] = table;` — the assumption.

What changed:

- `detectHeader(table)` (new, pure): scores each of the first `HEADER_SCAN_LIMIT` (8) rows by how many
  of the ref/date/amount column families its labels recognise, returns the best candidate and whether
  the choice was **confident** (`true` only when exactly one row scores best *and* it is row 1).
- `checkPopulationCsv(text, controlTotal, { headerRow })` now detects the header and, when the choice is
  not confident, **refuses to count** and returns a message naming the detected header and the competing
  rows, with `headerConfirmed: false`. The auditor confirms a row index (or the detected row by default)
  and the count is re-run.
- **Rows above the header are preamble, not data.** `body` is `table.slice(headerIndex + 1)`, so a title
  line or a note above the header is never counted and never reported as a bad row. Issue line numbers
  stay true to the file.
- The reachable surface is `TestingStepsTab.tsx` — the panel the Audit File window actually mounts (the
  register row F126 says `TestingStepsTab` deliberately, because `PopulationPanel.tsx` is the 4H draft
  panel and remains unwired; see the wiring audit). It holds the file bytes, shows the propose prompt
  (`header-confirm`, `header-confirm-0`), and re-runs the check on confirmation.

**Tests:** `population.test.ts` 5 + 6 new (detection confidence, non-first-row detection, tie, no-labels;
ask-before-count, confirmed count, preamble ignored, line-number truth, no double-report). Full suite
215 files / 2,482 tests green. All gates green. Register row F126 added (`Wired`), counts 55/27/44.
Contract testids `header-confirm`, `header-confirm-0` documented; `UI-INVENTORY.md` regenerated.

**Not in this item, so not claimed:** S1 (the `src/lib/systeligon/` shell the rest of the S-series needs)
and the pricing/sampling consumers of a confirmed header. S2 is the header behaviour alone.

### S1 — the Systeligon rule engine shell (2026-10-29)

**DONE (shell).** Queue item 9. Spec §4: rules live under `src/lib/systeligon/rules/`, pure and
versioned; every rule declares `id`, `version`, `kind`, `params`, `appliesTo` and the IIA standards it
supports; a rule pack is a named, versioned bundle per audit type.

Built:

- `src/lib/systeligon/types.ts` — the vocabulary: `SysteligonRule`, `RuleKind` (the §3.1/§3.2/§3.3
  families), `RuleTarget`, `RuleStatus`, `RuleFinding`, `RuleRunResult`, `RulePack`, and the document
  structure (`ParsedDocument`, `DocumentElement`) the §3.2/§3.3 rules match on.
- `src/lib/systeligon/runner.ts` — `runRules(rules, input, { evaluatedAt, includeDrafts?, target? })`.
  Pure and total: runs released rules (drafts only on request), re-stamps every finding's provenance
  from the rule so a rule cannot misreport its own id or version, turns a throwing rule into a finding
  against its own identity (silence about a rule that did not run is the same lie as an unparsed clause
  reported clean), collapses a rule shipped twice, and sorts findings deterministically.
- `src/lib/systeligon/versioning.ts` — `RuleRegistry`, append-only: a re-registered `id@version` with a
  changed fingerprint throws (bump the version), and an older version cannot be registered after a
  newer one. `ruleFingerprint` covers behaviour (kind/target/severity/params/evaluator) but not status,
  so release is a lifecycle change, not a behavioural one.
- `src/lib/systeligon/packs.ts` — `definePack` (validates target and duplicate `id@version`),
  `releasedRules`, `packRules` (merges packs, collapsing duplicates).
- `src/lib/systeligon/rules/structural.ts` — the first demonstrable rules: `doc.minutes_required_elements`
  (§3.2, quorum + action-item owner/due date) and `doc.policy_clause_coverage` (§3.3, every policy
  clause is cited by a procedure, matched on shared cross-references). These are new surface; they do
  **not** duplicate `analyticsEngine.ts`, which stays the numeric library until S6 ports it into this
  shape.

**Status honestly `Inert`.** No screen calls the engine yet — S6 ports the numeric forensics into rule
shape, S8/S9 add document/pattern rules, S10/S11 build packs and signed OTA distribution, and a
consumer wires a run to a screen. Register rows F127 (schema + runner) and F128 (versioning + packs)
record this. `check-wiring` accepts test-only; the register row is `Inert` because it is not yet
reachable from a screen.

**Tests:** `systeligon.test.ts` 16 tests (runner, provenance re-stamping, order-independence, draft
skip, dedup, throwing rule, target filter; validation; append-only versioning, latest/history,
fingerprint; packs; the two structural rules). Full suite 216 files / 2,510 tests green. All gates green.

### S7 — document extraction tiers 1–3 (2026-10-29)

**DONE (tier 1 wired; tiers 2–3 built as pure seams).** Queue item 11. Spec §5 and §20.

- **Tier 1 wired.** `DocumentViewerPanel.tsx` now calls `extractDocument` (`src/data/documents.ts`),
  which invokes the `doc-extract` Edge Function — the function re-checks the caller's right and org,
  reads the file itself and returns the outcome. Before this the panel called the 0035 `requestExtraction`
  stub, which wrote a pending row nobody filled. Register F43 moves `Inert` → `Wired`.
- **Tier 3** `src/lib/systeligon/extract/structured.ts` — parses extracted text into the `ParsedDocument`
  structure the §3.2/§3.3 rules consume: declared field parsers (vendor/date/amount/reference/period),
  numbered clauses with cross-references, action items with owner/due, signature blocks. It reports its
  own coverage (lines / parsed / uninterpreted) so a clause it could not read is counted, never dropped.
- **Tier 2 seam** `src/lib/systeligon/extract/ocr.ts` — `needsOcr` OCRs only a scan with no text layer;
  `runOcr` takes a **local** engine as a dependency (lazy-loaded) and **refuses a remote engine**, so
  nothing leaves the tenant (L2). With no engine the scan is stored and reported `unsupported`. The
  bundled model is a packaging task with a clear seam (D6, register F131).

**Tests:** `extract.test.ts` 8 tests. Full suite 217 files / 2,529 tests green; all gates and build green.
Register F130/F131 added; F43 flipped to `Wired`; counts 56/31/44.

### S3/S4/S5/S12 — the flows and verification (2026-10-29)

**DONE (pure flow logic; screen wiring is later).** Queue item 12. `src/lib/systeligon/flows.ts`.

- **S3 accepted flow (§2.2)** — `requiredRowsFromFindings` takes the rows a rule run requires evidence
  for (order-preserving, de-duplicated); `buildAcceptedTestingSet` then adds `autoAdd` untested rows,
  marked `autoAdded` so the UI can tell them from required ones. A required row is never dropped.
- **S4 declined flow (§2.3)** — `applyFloor` treats the floor as a **minimum, never a ceiling**: rows
  tested earlier count toward it and are always kept; untested rows are added until the tested count
  reaches the floor. `parsePastedBlock` splits a pasted block and, when the first line matches the
  target's column headers, maps it onto them — deterministic clipboard parsing.
- **S5 verification (§6)** — `verifyCompleteness` (Mode A: a closed decision and a remark) and
  `verifyEvidence` (Mode B: reachable, declared type, recorded hash, period/entity/amount, internal
  consistency). Both **fail closed**: a missing record or an unset value is a reason, never a silent
  pass. `verifyRows` dispatches to the org-configured mode.
- **S12 override (§2.2), carried forward** — `carriedOverrides` lists the rows closed despite a failed
  verification, **only with a remark** (a closure without a remark is an invalid close, not an
  override), with every reason, so the reviewer is shown them rather than having to find them.

**Tests:** `flows.test.ts` 15 tests. Full suite 218 files / 2,546 tests green; all gates and build
green. Register F132 added; counts 56/32/44.

### S8/S9/S14/S15 — document review, patterns, minutes, policy comparison (2026-10-29)

**DONE (pure; screen wiring later).** Queue item 13. Spec §3.2/§3.3.

- **S8** `rules/documents.ts` — a contract carries a signature, an approval a date, no document date is
  after the report date (`reportDate` is an argument), and an open action item has a later record.
- **S9** `rules/patterns.ts` — hardcoded credentials, `SELECT *`, an external call with no error
  handling, an unbounded loop, a disabled check, a hardcoded environment value, over `sourceFiles` text.
- **S14** `minutes.ts` + `rules/sequential.ts` — the action-item register across a minutes series:
  carried forward, vanished, closed with no evidence, reopened, closed before raised, closed by a
  non-owner, owner/due changed, due passed. The history refs are the evidence.
- **S15** `policydiff.ts` + `rules/sequential.ts` — policy-no-procedure, procedure-no-policy,
  regulation-uncovered, stated-differently, control-no-procedure. Matched on shared references, defined
  terms and cross-references, and **reports its own coverage** (parsed / matched / could not interpret).
  An unparsed clause is emitted as an info finding, never dropped.

**Tests:** `rules/documents.test.ts` 7 tests. Full suite 219 files / 2,563 tests green; gates + build
green. Register F133–F136 added; counts 56/36/44.

### S10/S11 — rule packs and signed OTA distribution (2026-10-29)

**DONE.** Queue item 14. Spec §4/§8. The client half was `src/lib/systeligon/ota.ts` (item 13); this
closes the authoritative half and the caller.

- `supabase/migrations/0117_systeligon_rule_packs.sql` — `rule_packs` (append-only by trigger: a
  shipped `(name, version)` is immutable but for the release flag) and `rule_pack_refusals` (the
  refusal log §8 requires). `rule_pack_save` re-checks the feature (`systeligon_rule_packs`), the
  `edit_config` right, and that the key is registered and not retired. `rule_pack_list` returns the
  newest version per name. RLS own-org only; no direct table write from a tenant.
- **The defect the SQL harness found, and the fix.** The first draft raised on a refusal *after*
  inserting the refusal row. A `raise` rolls back the same transaction that wrote the row, so the
  refusal vanished — the log, the whole point of §8, was never there. `rule_pack_save` now **logs and
  returns** `{ok:false, reason}` instead of raising; the caller reads the reason and stops, and the
  refusal survives. Test 119 asserts exactly that (the duplicate refusal is present after the failed
  save).
- **Caller:** `src/data/rulePacks.ts` (`listRulePacks`, `saveSignedRulePack`) — signs with
  `signPack`, passes the content hash and signature to the RPC, never reads a clock or a key.
  `rule_pack_save` mapped in `src/lib/featureMap.ts` (F25 rule 5).
- **Tests:** `supabase/tests/119_systeligon_rule_packs.sql` (RLS, no direct write, immutability,
  duplicate logged, unknown key logged, no-right refused, isolation) + `ota.test.ts` (7) +
  `rulePacks.test.ts` (2, inert). SQL harness green twice.   Register F137 added (Inert — no screen
  calls it yet); counts 56/37/44.

### S13 — findings-to-report provenance, F39 (2026-10-29)

**DONE.** Queue item 16. Spec §9.4. The report must cite every rule finding with its provenance
intact, and the committed claim graph must re-verify it.

- `src/lib/systeligon/provenance.ts` — `findingsToClaims(RuleFinding[]) → Claim[]`. Each claim copies
  the finding's `ruleId`/`ruleVersion` onto the claim (never invented), phrase `findings.rule_finding`,
  section `findings`, and carries the flagged references. Pure; 7 tests.
- `src/lib/writing/seedPhrases.ts` — the "Findings-with-provenance" phrase family that renders a
  claim naming its rule id and version.
- **The writer, so the reader is not the defect the audit found.** `supabase/migrations/0118_systeligon_findings.sql`
  — `systeligon_finding_record(p_engagement_id, p_evaluated_at, p_findings)` appends one `rule_finding`
  ledger entry per finding, idempotently per (engagement, instant, rule, version); feature
  `systeligon_findings`; `perform_work` or `review_and_approve`; the evaluation instant is required
  (the engine never reads a clock). `src/data/systeligon.ts` calls it; mapped in `featureMap.ts`.
- **The reader.** `loadSysteligonFindings` (`src/data/reportGraph.ts`) reads those ledger entries;
  `commitReportGraph` appends the finding claims to the plan-built claims, re-roots via `graphHashes`,
  and calls `report_graph_commit`, which re-derives every claim hash and the root (0103). So the
  findings' evidence is inside the tamper-evident root, not beside it.
- **Tests:** `supabase/tests/120_systeligon_findings.sql` (records, idempotent, instant required, rule
  provenance required, org isolation) + `provenance.test.ts` (7) + `systeligon.test.ts` (2, inert).
  SQL harness green twice. Register F39 `Absent → Wired`; counts **57/37/43**.
- **Open wiring gap (recorded, not hidden):** `recordSysteligonFindings` has no screen caller yet — the
  rule-run screen that would call it is not built. It is in `scripts/wiring-allow.json` as
  `a-own-unwired` with a real reason; `loadSysteligonFindings` is reached through `commitReportGraph`
  (called from `ReportEditorPanel.tsx:177`).

### S16 — the name in ONE constants module (2026-10-29)

**DONE.** Queue item 17. Spec §13: the product and engine names must be held in one place so a rename
is one commit, not a grep-and-pray across the tree.

- `src/lib/product.ts` (new) — the single source: `PRODUCT_NAME`, `PRODUCT_TAGLINE`, the derived
  `PRODUCT_TITLE`, and `ENGINE_NAME`.
- **Every live literal reads it.** `render/pdf.ts`, `render/designedPdf.ts`, `render/docx.ts` (export
  metadata), `notifications.ts` (subject fallback), `wizardSteps.ts`, and the screens `SignInScreen`,
  `NoTenantScreen`, `GraphOauthCallback`, `HeaderBar`, `PublicVerifyRoute`, `GlassBoxPublicRoute`,
  `SuperAdminProvisioning`, `OrgEmailPanel`, `OrgHostingPanel` now render `PRODUCT_NAME`.
- **The two files a browser build cannot import.** `scripts/sync-product-name.mjs` (`npm run gen:name`)
  rewrites the `<title>`/OpenGraph title in `index.html` and the `name` in `metadata.json` from the
  constant. Committed output is byte-identical to running the tool.
- **The Edge runtime mirror.** `supabase/functions/_shared/productName.ts` holds the same literal for
  the Deno function (which cannot import from `src/`), exactly as `requiredHostingSpec.ts` mirrors the
  migration lists; the hosting-test handler reads it.
- **The guard.** `src/guards/productName.test.ts` fails the build when (1) a raw `Provio`/`Systeligon`
  token reappears in live `src/`/`supabase/functions` code outside the constants modules and the sync
  script, (2) the Edge mirror drifts from the app constant, or (3) the committed `index.html`/
  `metadata.json` no longer match what `gen:name` would write. It also proves it can catch a
  reintroduced literal, so it cannot go blind.
- **Tests:** `productName.test.ts` (4). The pre-existing tests that asserted the literal
  (`notifications.test.ts`, `App.noTenant.test.tsx`, `hostingTestHandler.test.ts`) now assert against the
  constant, and the render/link fixtures use neutral labels — so a rename genuinely is one commit.
- Register row **F138** added (`Wired`); counts **58/37/43**. `check-feature-register` and
  `check-wiring` green; `tsc --noEmit` clean.

**Scope note:** this is the name constant. The product's *display* name in docs, marketing and the
patent filing is an owner decision, not the builder's; S16 only makes the code name one edit.

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
