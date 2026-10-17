# Provio Parity Report (against docs/SPEC-v10.md)

> **Phase 3 (branch `phase-3-universe-plan`).** The parity rows below were written at the end of Phase 0 and Phase 1 and were **not** re-scored for Phase 2 or Phase 3. Read them together with the Phase 2 and Phase 3 close-out sections at the foot of this file, which list what each phase changed and the real counts for its branch. Where a row below still says "Missing" for a section a later phase touched (notably 4.1 Roles, 4.2 Audit Teams, 4.3 Visibility and enforcement, 6 Universes and Entities, 7 Deployment Gate, 7.1 Combined approval, 8 SIRA, 9 Audit Plan, 23 Administration, 25 Data/Security/Infrastructure, 26 Logging, 29 Build and Verification), the close-out sections are authoritative.


Last updated: Phase 0 close-out. This file replaces the earlier v1.7 report, whose claims (for example "persona switcher", "Reports", "Red Thread" as present features) described behaviour the spec discards.

Status meanings: **Present** = built to the spec and covered by a test. **Partial** = some of it exists, or it exists only in the front-end prototype with hardcoded seed data. **Missing** = not built.

Basis of the statuses: the repository is a front-end prototype with **no backend, no login and no database**. Anything the spec requires of a database, server, tenant boundary or real authentication is therefore at best Partial. Statuses below come from reading the code and running the tests listed; rows marked "not audited in Phase 0" were not examined and are not claimed.

## Verification at the end of Phase 0

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | 26 files, 205 tests passed. (An earlier version of this file said 188, then 202. The guard tests in `src/guards/` were once ignored by `.gitignore` (`build/`) and missing from the commit; they are tracked now and `.gitignore` is anchored to `/build/`.) |
| `npx vite build` | exit 0 |
| `node scripts/check-tokens.mjs` | passed (53 files, 0 violations) |
| `node scripts/check-shrink.mjs` | passed (60 files, no >10% shrink). HeaderBar, `ledger.ts`, `AnalyticsTab.tsx` and 5 deleted files were re-baselined on purpose in Phase 0; the close-out changes below did not shrink any tracked file. |
| `npx playwright test` | **7 passed** (7 tests in `e2e/smoke.spec.ts`). Ran locally on Chromium 153 and in CI (run 38524739214). |

## Section status

| Spec section | Status | Evidence / notes |
|---|---|---|
| 0 Product Summary | Partial | Front-end prototype only. |
| 1 Laws | Partial | L1: engines are plain functions (`src/lib/auditEngines.ts`, `src/lib/population.ts`) with tests; no Math.random in production paths (`src/guards/sourceGuards.test.ts`). L2: **Missing**, no tenant boundary exists. L3: client-side gate only (`src/lib/population.ts`, `src/context/populationGate.test.tsx`); **not enforced in a database**. L4: not audited. L5: hash chain exists in memory only (`src/lib/ledger.ts`, `src/lib/ledger.test.ts`); now refuses to seal without crypto.subtle (`src/lib/ledger.nohash.test.ts`). Nothing is persisted. |
| 2 Structure and Tenancy | Partial | Two synthetic test organisations in `provio-test`, both `is_demo=true`, created by `e2e/global-setup.ts`. Tenant isolation under RLS is tested (`e2e/rls.spec.ts`). No platform tenant provisioning yet. |
| 3 Hosting and Client Access | Missing | No hosting model or client access layer. |
| 4.1 Roles | Partial | Role model in `src/lib/access.ts`, `src/lib/access.test.ts`. |
| 4.2 Audit Teams | Partial | Not audited in Phase 0. |
| 4.3 Visibility and enforcement | Partial | Client-side scoping (`src/hooks/useScopedData.ts`). No RLS, no server enforcement. |
| 4.4 Fixed invariants | Partial | Four-eyes and lock rules in `src/lib/access.ts`, `src/lib/workpaperLock.ts` (`workpaperLock.test.ts`). Client-side only. |
| 4.5 Identity | Partial | Persona switcher, "Simulate Viewpoint" and the default CIA identity are **removed** (`src/App.auth.test.tsx` → "the profile menu has no viewpoint simulation, no account list and no dev link"; `src/guards/sourceGuards.test.ts` → "has no \"Simulate Viewpoint\", persona or impersonation code" and "never uses the word \"viewpoint\" anywhere in production paths"). Identity now comes only from a session (`src/context/AuthContext.tsx`). Real authentication is in place: password sign-in through Supabase Auth (`src/data/client.ts`, `src/components/auth/SignInScreen.tsx`). Role and scopes are read from `org_members` and `user_scopes` under RLS (`e2e/smoke.spec.ts`, `e2e/rls.spec.ts`). The development-only TEMP_AUTH stub has been removed (`src/guards/sourceGuards.test.ts` → "TEMP_AUTH is removed: no references anywhere in src"). `src/components/dev/DevAccessPage.tsx` is still a role-switching harness, dev-only. |
| 5 Navigation and Home | Partial | Seven tabs, no Reports or Calendar tab (`src/components/common/NavStrip.test.tsx` → "renders exactly the 7 canonical tabs, in order, without Reports, Calendar or Workbench"; `src/App.auth.test.tsx` → "admits a demo-tenant account and shows exactly the 7 tabs, with no Reports tab"). The admin placeholder wording "System Administration Viewpoint" was changed to "Organisation Administration" (`src/components/common/NavStrip.tsx`). Home content not audited. |
| 6 Universes and Entities | Partial | `src/components/universe/AuditUniverseTab.tsx`. Hardcoded seed data. |
| 7 Deployment Gate | Missing | Not found. |
| 7.1 Combined approval | Missing | Not found. |
| 8 SIRA | Partial | `src/components/sira/SiraTab.tsx`. Not audited against §8.2 or §8.3. |
| 9 Audit Plan | Built | Plan per universe/period with hash-chained versions (`0021`, `0028`). Prior-year material (§9.1) imports per item from the Planning tab and does not count toward sign-off until reconfirmed (`0044_prior_year_import.sql`, `src/components/plan/PriorYearImportPanel.tsx`). |
| 10 Engagement Lifecycle | Built | Three stages with consolidated sign-off. Planning sections are configurable per org (`0025_planning.sql`); SIRA pre-fill suggestions with accept/reject logging; a reconciliation gate blocks Planning sign-off until every planning risk matches the latest SIRA cycle; Testing is locked until Planning is signed off; four-eyes enforced by CHECK. `sign_planning` (4B), `sign_off_workpaper` / `reopen_workpaper` (4E), `sign_conclusion` (5B). UI: `src/components/plan/PlanningPanel.tsx`, `src/components/audit/{PopulationPanel,SamplingPanel,RowTestingPanel,AnalystEnginePanel}.tsx`. |
| 10.4 Sign-off and locking | Built | Every stage sign-off is a security-definer RPC that checks `caller_has_right`, enforces four-eyes (preparer != reviewer via CHECK), and writes a hash-chained ledger entry. Reopen requires the `can_reopen` right and a >=10-char justification. Sealed engagements are read-only (test 12). |
| 11 Testing | Built | Population gate (`0026_population_gate.sql`): a verification trigger sets `verified` only when `sha256` is set and `row_count > 0`; the database refuses any sample/sample row whose population is not verified (L3). Org Sampling Table + `get_sample_size`; `compute_sample` is seeded and deterministic (`sha256(population.sha256 || workpaper_id)`) or verifies pasted rows; floor enforced by CHECK when locked. `workpaper_rows` carry tick/cross/unverifiable with a rationale; `sign_off_workpaper` requires every row complete. `src/components/audit/{PopulationPanel,SamplingPanel,RowTestingPanel}.tsx`. |
| 12 Analyst Engine | Built | `src/lib/analyticsEngine.ts`: pure, deterministic checks - duplicates, near-duplicates, sequence gaps, outliers (z-score and IQR), Benford first-digit (chi-square and MAD), round numbers, weekend/holiday postings, same-user create-and-approve, missing attributes, period variance, GL-to-TB, SIRA-vs-Planning, controls-vs-tests. Each result links to the rows it flagged; "Raise finding" attaches rule id, params and row refs to an observation. Unit-tested per check. |
| 13 Document Review and AI | Partial | `src/components/audit/DocumentReviewTab.tsx`. Not audited. |
| 14 Findings, Observations, Issues | Built | `observations` (sections jsonb keyed by role tag) with a readability gate: `check_readability` requires non-empty context, condition, effect and risk (the four mandatory tags, §14.3); optional tags (criteria, cause, recommendation) checked only if `org_methodology.required_sections` requires them. `promote_to_finding` calls the gate and refuses with the missing tags; `create_observation` links a finding to its controls, sample exceptions and entities. `issues` group findings; `severity_levels` colours are validated against the design-token list, never a hex. `0030_findings_observations.sql`, `39_findings_observations.sql`, `src/components/audit/FindingsPanel.tsx`, `src/data/observations.ts`. |
| 15 Conclusion, Report, Drafting | Built | Conclusion: `pull_exceptions` copies cross/unverifiable rows into the conclusion (requires Testing signed off and `review_and_approve`); `sign_conclusion` is four-eyes, hash-chained and seals the engagement (`0034_conclusion.sql`, `43_conclusion.sql`, `src/components/audit/ConclusionPanel.tsx`). Report: `report_versions` (hash-chained) and `report_blocks`; `compose_report` assembles blocks from structured data with placeholders; `compute_report_summary` counts by severity/control/entity; `report_comments` block a freeze while any comment is open; `freeze_report` checks open comments and CAP reconciliation; `issue_report` requires a frozen report, writes a ledger entry and inserts a pending `email_queue` row (`0036`–`0040`, `45`–`49`, `src/components/audit/ReportEditorPanel.tsx`, `src/data/{reports,email}.ts`). PDF/DOCX generation deferred. |
| 16 CAPs | Built | `caps` register with statuses `open / verified_closed / verified_closed_delay / unverified / overdue_unverified` (D-6D-CAP); `update_cap` moves open -> unverified; `close_cap` (requires `review_and_approve`) sets the verified status; `check_cap_reconciliation` reads from `caps` so every report finding/issue has a CAP row with a matching due date. `0038_cap_register.sql`, `47_cap_register.sql`, `src/components/audit/CapRegisterPanel.tsx`, `src/data/caps.ts`. |
| 17 Audit File Window and Viewer | Built | `FloatingWindowManager` manages an array of non-blocking floating windows: minimise to a dock, drag, and pop out as a browser window on the same origin (`/view/:recordType/:id`). The Audit File chrome migrated onto it; the document viewer is a docked non-blocking panel with a stage-aware list and full-text search (`search_documents`). `src/components/common/FloatingWindowManager.tsx`, `src/components/common/RecordView.tsx`, `src/components/audit/{AuditFileModal,DocumentViewerPanel}.tsx`, `src/data/documents.ts`. |
| 18 Export | Built | Every export runs through `log_export` (writes an `exports_log` row and a ledger entry); the payload is serialised in the browser and its content hash recorded. Per-object export RPCs: `export_workpaper`, `export_engagement_bundle`, `export_sira_results`, `export_audit_plan`, `export_cap_register`, `export_ledger`, `export_activity_log`, `export_full_tenant` (needs `manage_users`). `src/components/admin/ExportPanel.tsx`, `src/data/exports.ts`, `src/lib/exportSerialise.ts`. PDF/DOCX generation deferred (`docs/NOT-DONE.md`). |
| 19 Import | Built | `import_jobs` + `start_import` / `validate_import` / `commit_import` (types, required fields and org scope validated in the database, invalid rows returned with a field-level reason). Three-step wizard: upload, mapping, preview-and-commit. Prior-year material (§9.1) is `prior_year_imports` + `import_prior_year_item` / `confirm_prior_year_item` / `revert_prior_year_item`; populations, samples, results, conclusions and evidence are refused. `src/components/admin/ImportWizardPanel.tsx`, `src/components/plan/PriorYearImportPanel.tsx`, `src/data/imports.ts`. |
| 20 Evidence and Uploads | Partial | `src/components/audit/EvidenceTab.tsx`, `src/lib/glassbox.ts`. Public route uses a zero-scope principal, no server token validation. |
| 21 Change Control | Missing | Not found. |
| 22 Notifications and Email | Missing | Not found. |
| 23 Administration | Missing | The "Admin Console" entry opened the deleted personnel panel and was removed. |
| 24 Platform Portal | Missing | Not found. |
| 25 Data, Security, Infrastructure | Missing | No backend, database, RLS or storage. |
| 26 Logging | Built | Business ledger is hash-chained and append-only (`0005_logging.sql`). Activity log is append-only; archival (`0043_activity_archival.sql`, `archive_activity_period`) writes an `archive_jobs` row, a ledger entry with the content hash, and never deletes without that record. The tenant exports its own history through `export_activity_log` and the Activity Log view. |
| 27.1 Colour | Partial | `node scripts/check-tokens.mjs` passes. |
| 27.2 Typography | Partial | Not audited. |
| 27.3 Iconography | Partial | `src/components/common/Icons.tsx`; `sourceGuards.test.ts` forbids lucide-react. |
| 27.4 Motion | Partial | Not audited (reduced-motion, easing). |
| 27.5 Interaction | Partial | Native alert/prompt/confirm removed and guarded (`sourceGuards.test.ts`). `AccountSettingsModal.tsx` and `PaperWorkbenchModal.tsx` were **not audited** for blocking behaviour. |
| 28 Out of Scope and Discarded | Partial | Removed and guarded by tests: persona login, Simulate Viewpoint, the word "viewpoint", Reports tab, Red Thread, scrub bar, native dialogs, Math.random. `GanttTimeWarp.tsx` was read and is **kept**: it is a Gantt timeline/delivery view (month columns and engagement bars), not the ledger scrub bar; see Decisions. Tenant seed data is not in the production bundle (`src/guards/prodBundle.test.ts`, `src/guards/sourceGuards.test.ts`). A department-name colour map and hardcoded sample text/figures in components were moved out or removed. |
| 29 Build and Verification | Partial | Gates 1-6 pass: `tsc --noEmit` exit 0; `vitest run` 26 files / 205 tests; `vite build` exit 0; `check-tokens` 53 files / 0 violations; `check-shrink` 60 files; `playwright test` 7 passed. Production bundle test: `src/guards/prodBundle.test.ts` (24 cases). Screenshots are **not** captured (owner-deferred). |
| 30 Changes from v9 | n/a | Informational. |
| 31 Open Items | n/a | Informational. |

## Phase 0 notes

- Removed: persona switcher, personnel panel, Reports tab, executive pack, Red Thread, ledger scrub bar, all native `alert()` and `prompt()` calls.
- `docs/baseline-lines.json`: five deleted files removed from the baseline; `HeaderBar.tsx` re-baselined from 328 to 271 lines. The lost lines are the removed persona switcher, Admin Console entry, personnel link and dev link.
- Tenant seed data: all demo data now lives behind a `TenantSeed` passed to `AppProvider` (`src/types/seed.ts`). The only assembler is `src/data/demoSeed.ts`, reached by a development-only dynamic import in `src/App.tsx`. Production bundle contains none of it: `src/guards/prodBundle.test.ts` greps `dist` for demo names, emails, account names, `CANARY` and the old tenant id. Moved into the seed: sample ledger events (out of `ledger.ts`), sample GL/variance/trial-balance rows (out of `AnalyticsTab.tsx`) and the sample policy text (out of `DocumentReviewTab.tsx`). `GlassBoxShareModal` placeholder text was removed.
- Tenant id: the hardcoded `'provio-corp-tenant'` is gone. The tenant id comes from the session's seed (`useApp().tenantId`). The public `/e/:token` route now mounts an **empty** seed, so anonymous visitors have no engagements, entities or workpapers in memory and no token can validate. The public upload flow therefore cannot work until a backend validates tokens.
- `docs/baseline-lines.json`: `ledger.ts` 248 -> 215 and `AnalyticsTab.tsx` 196 -> 168. The lost lines are the demo data moved to `demoSeed.ts`, not behaviour.
- `CapRadialTracker.tsx`: colours were keyed by department names (`Treasury`, `Trading`, ...). They are now assigned by position, so chart colours for departments may differ from before. Not screenshot-checked.
- Dev routes `/dev/access` and `/dev/palette` exist only when `import.meta.env.DEV` is true. The production bundle contains neither (`src/guards/prodBundle.test.ts`).

## Phase 0 close-out

### Commits on `phase-0-cleanup` (PR #5 into `main`)

| Commit | Message |
|---|---|
| `6e73c7c` | PHASE-0 (fix): track src/guards tests (build/ was gitignored), move tenant seed out of production bundle, remove hardcoded tenant id, correct PARITY counts |
| `44d1472` | PHASE-0: anchor gitignore build/ to /build/ so src/build can never be ignored |
| `e502878` | PHASE-0: remove the two viewpoint wording leftovers and guard against them |
| _(this close-out commit)_ | PHASE-0: close-out — parity rows, adversarial QA suite, vitest exclude for tests/adversarial |

### Real gate counts (run by hand on this head, in order)

| Gate | Command | Result |
|---|---|---|
| 1 | `npx tsc --noEmit` | exit 0 |
| 2 | `npx vitest run` | 26 test files, **205 tests passed** (0 failed, 0 skipped) |
| 3 | `npx vite build` | exit 0, 1048 modules transformed |
| 4 | `node scripts/check-tokens.mjs` | PASS — 53 files, 0 violations |
| 5 | `node scripts/check-shrink.mjs` | PASS — 60 files, no >10% shrink |
| 6 | `npx playwright test` | **7 passed** (7 tests, `e2e/smoke.spec.ts`, Chromium 153) |

Dist scan after `vite build` (all must be 0): `Simulate Viewpoint` 0, `Viewpoint` 0, `viewpoint` 0, `/dev/access` 0, `/dev/palette` 0, `DevAccessPage` 0, `DevPalettePage` 0, `Global Banking` 0, `Marcus Vance` 0, `Treasury` 0, `provio.internal` 0, `CANARY` 0, `provio-corp-tenant` 0, `TEMP_AUTH` 0, `Red Thread` 0, `LedgerScrubBar` 0.

### CI on PR #5

- Run **38528804324** on head `f69ae93` — conclusion **success**. Steps: type check success, unit tests success (26 files / 205 tests), build success, token check success, shrink check success, SQL tests skipped (no `supabase/migrations/**`), **Playwright success (7 tests passed, 14.9s)**.
- Previous green run 38524739214 on `6e73c7c` — same shape.

### Decisions (where the spec is silent)

- **`GanttTimeWarp.tsx` is kept.** It is read, not guessed: it renders six month columns (Jul–Dec 2026) and one horizontal bar per engagement with a percentage, clicking through to the engagement. That is a Gantt timeline/delivery view, not the ledger scrub bar (no ledger state, no time-travel over the hash chain). Spec §28 forbids the "4D scrub bar" and the `LedgerScrubBar` symbol; neither is present. Recorded here so the keep is deliberate.
- **The word "viewpoint" is removed from production paths, not only the two reported lines.** A third occurrence lived in a `HeaderBar.tsx` comment ("no account or viewpoint switching") and a fourth in `App.auth.test.tsx`/`sourceGuards.test.ts` assertions. The comment was reworded and a source guard now fails on `/viewpoint/i` anywhere under `src/` outside test files, so the wording cannot return.
- **Stale `src/build/…` path references were corrected** in `App.tsx` and `tempAuth.ts` to `src/guards/…`. They pointed at a directory that does not exist and that `.gitignore` used to swallow.
- **The adversarial QA suite lives in `tests/adversarial/`**, run with `npx playwright test --config playwright.adversarial.config.ts`. It is kept out of the builder gate so `e2e/` remains exactly the 7 smoke tests the task requires. `vitest.config.ts` excludes `tests/adversarial/**` so the 205-test count is unaffected.

### Adversarial QA result (reviewer-run, not part of the gate)

- `tests/adversarial/phase0.spec.ts` — 6 attacks, all pass on the fixed head. Two findings were found and are now fixed:
  - **High** — the capitalised string `Viewpoint` was shipped in `dist/assets/index-*.js` and `dist/assets/ExecutiveDashboardTab-*.js` ("System Administration Viewpoint", "Scoped Viewpoint"). Fixed by the `e502878` commit; the dist scan is now 0 and `prodBundle.test.ts` guards it.
  - **Medium** — `src/build/prodBundle.test.ts` was referenced from `App.tsx` and `tempAuth.ts` but does not exist. Fixed in `e502878`.
- Verified clean: no tenant data without a session (production build: DOM, localStorage, sessionStorage, IndexedDB, network all clean); dev routes absent from production; `/superadmin`, `/dev/access`, `/dev/palette`, `/api/*` render only the sign-in screen in production; no third-party scripts beyond the declared Google Fonts; sealing refuses with an inline error and writes nothing when `crypto.subtle` is disabled; no native dialogs fire in the Work Queue or Audit Files screens.

### NOT DONE (explicit)

- **Screenshots: deferred by owner decision.** No screen was captured in the three presets, light and dark (§29).
- Items 2, 4 and 6 of the Phase 0 task list were already complete at `6e73c7c` and were re-verified, not re-done.
- No Phase 1 work started: no database, no login, no backend. The `/e/:token` public route still cannot validate tokens without a backend.


## Phase 1 — Supabase backend

Status: SQL layer complete and pre-validated. The application still has no live login and reads no
database (no data module yet); that is the next Phase 1 slice.

### What exists

- `supabase/migrations/0001`–`0010`: schema, invariants, functions, RLS, JWT pinning and the
  access-token hook. Idempotent (re-application is clean).
- `supabase/tests/00`–`17`: 18 SQL test files. `00_lib.sql` seeds two orgs and switches identity
  through `set role` + `request.jwt.claims`.
- `supabase/README.md`: migration table, hook wiring and the decisions taken where the spec is silent.

### Real SQL counts (run by hand on this head, local Postgres 17)

| Step | Result |
|---|---|
| apply `0001`–`0010` to a fresh database | exit 0, 0 errors |
| apply `0001`–`0010` a second time (idempotency) | exit 0, 0 errors |
| `00`–`17` on the fresh database | **18/18 files pass, 205 assertions** |
| `00`–`17` on a second consecutive run | **18/18 files pass** |
| `00`–`17` on the real **provio-test** Supabase project (CI step 6, run 38551957604) | **18/18 files pass, 205 assertions, 0 errors; test 15 reports 50 concurrent appends** |

### Spec rows now backed by a database test

| Spec | Test | What it proves |
|---|---|---|
| §4.4 four-eyes | `11` | a sign-off with preparer = reviewer is refused by a CHECK constraint |
| §4.4 sealed = read-only | `12` | every child of a sealed engagement rejects UPDATE/DELETE |
| §4.4 append-only ledger | `08` | no app role holds UPDATE/DELETE, and the trigger refuses the owner |
| §4.4, §10.4 reopen | `14` | requires the `can_reopen` right and a ≥10-char justification; writes activity + ledger |
| §4.5 no default role | `16` | a user with no membership gets no `org_id` claim and no `user_role` |
| §11.1 population gate | `06`, `07` | a sample or sample row without a verified matching population is refused |
| §24, §25.2 platform blind | `03` | the platform role reads 0 rows from every tenant business table |
| §25.1 no `USING (true)` | `13` | RLS on all 33 tables; no policy expression is literally `true` |
| §25.2 org from JWT only | `05`, `16` | header/body org is ignored; a forged claim is stripped by the hook |
| §25.2 tenant isolation | `01`, `02` | cross-org across tables is 0; a write into another org is refused |
| §26 hash chain | `09`, `10`, `15` | genesis, exact hashes, tamper detection, **50** concurrent appends stay contiguous and every `prev_hash` links to the preceding row |

### Phase 1 decisions (where the spec is silent)

- **`org_id` is the org claim**, set only by `public.custom_access_token_hook`. No policy reads an org
  from a header or body; `org_id_from_header` always returns null and exists to prove it.
- **Platform staff are not tenant members.** `platform_admins` holds a user id and no `org_id`; the
  hook stamps `user_role = 'platform_admin'` with no org.
- **Roles carry a `slug`** (machine name) beside the display `name`; the slug goes in the JWT and in
  policies, so a rename cannot break enforcement.
- **`supabase/config.toml` sets `major_version = 17`** to match local validation.

### NOT DONE (Phase 1)

- Phase 1 sign-in is implemented and CI-verified (Supabase Auth, data module, RLS end-to-end test).
  Not done: roles as data and `has_right()` in the database (Phase 2); outstanding dependency advisories (see `docs/NOT-DONE.md`).
- The SQL layer now runs green against the real **provio-test** Supabase project (CI step 6,
  run 38551957604). Local validation used Postgres 17 with an `auth` schema shim; the real-project
  run is the CI step, not a hand-run from this machine.
- `TEST_SUPABASE_DB_URL` still carries a trailing newline. CI run 38551590080 proved it by failing
  test 15 with `FATAL: database "postgres\n" does not exist`. CI step 6 and test 15 strip whitespace
  until the secret is re-set without the newline, after which both strips can be removed.
- Concurrent appends in one tenant produce unique, contiguous seq values and a valid hash chain. This test uses 50 rows, batched over 10 dblink connections (one multi-row INSERT each)
  because Supabase's session pooler caps concurrent clients at 15. The assertion covers all 50 rows.


---

# Phase 2 — access, rights and the administration portal

Branch `phase-2-access`. Base `main` at the Phase 1 merge (`f374215`). Every commit below has a
green CI run; the run id is the one for that commit's head.

## Verification at the end of Phase 2 (branch `phase-2-access`, head `e75d524`)

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p .` | exit 0 |
| `npx vitest run` | **30 files, 289 tests passed** (0 failed, 0 skipped) |
| `npm run build` (`vite build`) | exit 0 |
| `node scripts/check-tokens.mjs` | PASS — 52 files under `src/components`, 0 violations |
| `node scripts/check-shrink.mjs` | PASS — 59 files, no >10% shrink |
| SQL migrations applied twice (M6) | exit 0, 0 errors, both passes |
| SQL tests, 25 files, two consecutive passes (M5) | **25/25 green both passes**, ~181 assertions in tests 01–24 |
| `npx playwright test` | **24 passed** (`e2e/smoke.spec.ts`, `e2e/rls.spec.ts`, `e2e/admin.spec.ts`) |

CI run **38818009464** on head `e75d524` — conclusion **success**, all 7 gate steps green
(type check, unit tests, build, token check, shrink check, migrations + SQL tests on the real
`provio-test` project, Playwright).

## Tasks, commits and CI runs

| Task | Commit | CI run | Result |
|---|---|---|---|
| 2A vitest upgrade (clear critical advisories) | `f73d86b` | 38696591808 | green |
| 2B closed rights list and org role matrix | `49ef509` then fix `4bd4224` | 38701584190 | fixed, green |
| 2C engagement team roles and assignment | `f347d5f` | 38719391185 | green |
| 2D role config log and deletion guard | `7b4c04d`, fix `5a86a4b`, clean `f58cc8f` | 38726990574 | fixed, green |
| 2E invitation cap per user and per org | `dd44220` | 38727701485 | green |
| 2G Phase-2 adversarial coverage + full seed matrix | `34952b0` | 38737171258 | green |
| 2F-1 remove `/dev/access` and `DevAccessPage` | `3fb44e0`, fix `4c01830` | 38756193478 | fixed, green |
| 2F-2a role-name check inventory (docs) | `059733b` | 38743915833 | green |
| 2F-2b replace role-name checks with rights | `55dd745` | 38810372842 | green |
| 2H-DB administration RPCs | `c9b7204` | 38811861805 | green |
| 2H-UI People & Roles panel | `005d8bb` | 38814194245 | red (Playwright), superseded by the fix |
| 2H-UI-FIX align the seed rights matrix to SPEC 4.1 | `3ccf283` | 38816475214 | fixed, green |
| 2J Phase 2 decisions in the specification | `e75d524` | 38818009464 | green |

Run 38817847723 was a duplicate dispatch for head `3ccf283` and failed on an expired-token push
race; the authoritative run for that head is 38816475214 (success).

## What Phase 2 added, by spec section

| Spec section | Before Phase 2 | After Phase 2 | Evidence |
|---|---|---|---|
| 4.1 Roles | role names compared in code | a role is a bag of eleven rights; every decision is a rights test | `supabase/migrations/0012_rights_closed.sql`, `0016_rights_rls.sql`, `src/lib/rights.ts`, `supabase/tests/19_rights_closed.sql`, `23_rights_rls.sql`, `src/lib/rightsMatrix.test.ts`, `src/guards/noRoleStrings.test.ts` |
| 4.2 Audit Teams | not built | team roles are data; a team role maps to rights; assignment needs a right | `0013_engagement_team.sql`, `supabase/tests/20_engagement_team.sql` |
| 4.3 Visibility and enforcement | client-side only | RLS is the enforcement; a rights check backs every policy | `0016_rights_rls.sql`, `23_rights_rls.sql`, `01`–`03` isolation tests |
| 4.5 Identity | sign-in existed | unchanged; the rights of the session come from `roles.rights` | `src/data/client.ts` |
| 23 Administration | missing | People & Roles portal: members, roles, rights, scopes, reporting lines, invite cap | `0017_admin_rpcs.sql`, `24_admin_rpcs.sql`, `src/data/admin.ts`, `src/components/admin/PeopleAdminPanel.tsx`, `e2e/admin.spec.ts` |
| 25.2 Tenancy and isolation | partial | unchanged model; new tables carry `org_id` and a select policy | `13_rls_enabled.sql`, `0016`, `0017` |
| 26 Logging | ledger in memory only | the database ledger is hash-chained; role changes are versioned and logged | `0014_roles_config.sql`, `21_roles_config.sql`, `09`–`15` |
| 29 Build and Verification | partial | SQL tests, vitest and Playwright all run in CI; a drift test guards the rights matrix | CI run 38818009464 |

## Phase 2 decisions

See `docs/SPEC-v10.md` §30 (D1–D12). In short: rights not role names; the seed matrix implements
§4.1 and is mirrored in `src/lib/rights.ts` with a drift test; identity is token-derived and
permission is a rights lookup; every business table carries `org_id` and a select policy; team
roles are data; a role change is guarded and versioned; the invite cap is data plus events; the
administration portal is a rights-gated sliding inspector; test data is synthetic and carries the
real matrix.

## NOT DONE (Phase 2)

- The hosted `TEST_SUPABASE_DB_URL` secret still carries a trailing newline; CI step 6 and test 15
  strip whitespace until the secret is re-set. Owner action.
- The `/e/:token` public route cannot validate tokens without a backend; unchanged from Phase 1.
- The administration portal covers the People and Roles parts of §23. Organisation settings,
  structure, controls, methodology, the risk model, workflow, SLA, finding structure, notifications,
  BI parameters, templates and branding, export and retention, and AI remain not built; see
  `docs/NOT-DONE.md`.
- No screenshots were captured (owner-deferred, §29).

## Verification at the end of Phase 3 (branch `phase-3-universe-plan`, head `725b8fc`)

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p .` | exit 0 |
| `npx vitest run` | **41 files, 371 tests passed** (0 failed, 0 skipped) |
| `npm run build` (`vite build`) | exit 0 |
| `node scripts/check-tokens.mjs` | PASS — 64 files under `src/components`, 0 violations |
| `node scripts/check-shrink.mjs` | PASS — 59 files, no >10% shrink |
| SQL migrations applied twice (M6) | exit 0, 0 errors, both passes |
| SQL tests, 31 files, two consecutive passes (M5) | **31/31 green both passes**, 535 `ok` notices |
| `npx playwright test` | **30 passed** (`e2e/smoke.spec.ts`, `e2e/rls.spec.ts`, `e2e/admin.spec.ts`, `e2e/phase3.spec.ts`) |

CI run **38856439388** on head `725b8fc` — conclusion **success**, all 7 gate steps green
(type check, unit tests, build, token check, shrink check, migrations + SQL tests on the real
`provio-test` project, Playwright).

## What Phase 3 added, by spec section

| Spec section | Before Phase 3 | After Phase 3 | Evidence |
|---|---|---|---|
| 6 Universes and Entities | hardcoded seed, no approval | entities carry an approval status; `submit_entity` / `decide_entity`; history; scope RLS | `0018_universes_entities.sql`, `25_universes_entities.sql`, `src/data/universe.ts` |
| 7 Deployment Gate | missing | `deploy_engagement` returns the structured §7 steps 1–5; ethics acknowledgements; testing locked until all ack | `0022_deployment_gate.sql`, `29_deployment_gate.sql`, `src/data/deployment.ts`, `src/components/audit/{DeploymentGatePanel,EthicsPanel}.tsx` |
| 7.1 Combined approval | missing | one atomic function for plan change + deployment; revalidation; SLA; escalation | `0023_combined_approval.sql`, `30_combined_approval.sql`, `src/components/plan/CombinedApprovalPanel.tsx` |
| 8 SIRA | partial, not audited | per-org risk model (factors/scales/weights/bands/aggregation), versioned history, deterministic `sira_compute`, cycles + publish freeze + emergent-risk queue | `0019_sira_model.sql`, `0020_sira_cycles.sql`, `26_sira_model.sql`, `27_sira_cycles.sql`, `src/lib/siraEngine.ts`, `src/components/sira/` |
| 9 Audit Plan | partial | plan per universe/period, hash-chained versions, plan items with ad-hoc justification ≥10 chars | `0021_audit_plan.sql`, `0028_audit_plan.sql`, `src/components/plan/PlanItemsPanel.tsx` |
| 29 Build and Verification | SQL + vitest + Playwright in CI | unchanged; adversarial SQL for 3B–3G added | `31_adversarial_phase3.sql` |

## NOT DONE (Phase 3)

- `escalate_overdue_requests` exists as a function, but no scheduler calls it on a timer; the
  scheduler is out of scope for this environment.
- The `/e/:token` public route still cannot validate tokens without a backend.
- No screenshots were captured (owner-deferred, §29).
- The hosted `TEST_SUPABASE_DB_URL` secret still carries a trailing newline; CI step 6 and test 15
  strip whitespace until the owner re-sets the secret.
- The administration portal still covers only the People and Roles parts of §23; the rest is later
  work.

## Verification at the end of Phase 7 (branch `feature/config-control-plane`, head `1a2f70b`)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | **61 files, 561 tests passed** |
| `npm run build` (`vite build`) | exit 0 |
| `node scripts/check-tokens.mjs` | PASS — 97 files under `src/components`, 0 violations |
| `node scripts/check-shrink.mjs` | PASS — 58 files, no >10% shrink |
| SQL migrations applied twice (M6) | exit 0, 0 errors, both passes (45 migration files) |
| SQL tests, 58 files, two consecutive passes (M5) | **58/58 green both passes**, 1099 `ok` notices |
| `npx playwright test` | **51 passed** (adds `e2e/phase7.spec.ts`, 5 tests) |

CI run **39026062113** on head `1a2f70b` — conclusion **success**, all 7 gate steps green.

## What Phase 7 added, by spec section

| Spec section | Before Phase 7 | After Phase 7 | Evidence |
|---|---|---|---|
| 9.1 Prior-year material | not built | per-item import from the Planning tab; `Imported - confirm` items do not count toward sign-off until confirmed; populations, samples, results, conclusions and evidence are refused | `0044_prior_year_import.sql`, `53_prior_year_import.sql`, `src/components/plan/PriorYearImportPanel.tsx` |
| 18 Export | missing | `log_export` records every export in `exports_log` and the ledger with a content hash; eight per-object export RPCs; browser-side serialisation and download; export history view | `0041_exports.sql`, `50_exports.sql`, `src/data/exports.ts`, `src/lib/exportSerialise.ts`, `src/components/admin/ExportPanel.tsx` |
| 19 Import | missing | `import_jobs` with a three-step wizard (upload, mapping, preview-and-commit); database validation returns invalid rows with a field-level reason; every import logged | `0042_imports.sql`, `51_imports.sql`, `src/data/imports.ts`, `src/components/admin/ImportWizardPanel.tsx` |
| 26 Logging | ledger in memory only | activity log is append-only; archival writes an `archive_jobs` row and a ledger entry with the content hash before any delete; the tenant views and exports its own history | `0043_activity_archival.sql`, `52_activity_archival.sql`, `src/components/admin/ActivityLogPanel.tsx` |
| 56 Phase 7 acceptance | n/a | cross-org, anon, no-right, export-ledger, prior-year sign-off gate and import org-scope all covered | `56_phase7_acceptance.sql` |

