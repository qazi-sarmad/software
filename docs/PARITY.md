# Provio Parity Report (against docs/SPEC-v10.md)

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
| 2 Structure and Tenancy | Missing | No tenants; one demo tenant constant in `src/lib/tempAuth.ts` (`is_demo: true`). |
| 3 Hosting and Client Access | Missing | No hosting model or client access layer. |
| 4.1 Roles | Partial | Role model in `src/lib/access.ts`, `src/lib/access.test.ts`. |
| 4.2 Audit Teams | Partial | Not audited in Phase 0. |
| 4.3 Visibility and enforcement | Partial | Client-side scoping (`src/hooks/useScopedData.ts`). No RLS, no server enforcement. |
| 4.4 Fixed invariants | Partial | Four-eyes and lock rules in `src/lib/access.ts`, `src/lib/workpaperLock.ts` (`workpaperLock.test.ts`). Client-side only. |
| 4.5 Identity | Partial | Persona switcher, "Simulate Viewpoint" and the default CIA identity are **removed** (`src/App.auth.test.tsx` → "the profile menu has no viewpoint simulation, no account list and no dev link"; `src/guards/sourceGuards.test.ts` → "has no \"Simulate Viewpoint\", persona or impersonation code" and "never uses the word \"viewpoint\" anywhere in production paths"). Identity now comes only from a session (`src/context/AuthContext.tsx`). Real authentication is **Missing**: only the development-only TEMP_AUTH stub (`src/lib/tempAuth.ts`, `src/lib/tempAuth.test.ts`) exists, and a production build cannot sign in. `src/components/dev/DevAccessPage.tsx` is still a role-switching harness, dev-only. |
| 5 Navigation and Home | Partial | Seven tabs, no Reports or Calendar tab (`src/components/common/NavStrip.test.tsx` → "renders exactly the 7 canonical tabs, in order, without Reports, Calendar or Workbench"; `src/App.auth.test.tsx` → "admits a demo-tenant account and shows exactly the 7 tabs, with no Reports tab"). The admin placeholder wording "System Administration Viewpoint" was changed to "Organisation Administration" (`src/components/common/NavStrip.tsx`). Home content not audited. |
| 6 Universes and Entities | Partial | `src/components/universe/AuditUniverseTab.tsx`. Hardcoded seed data. |
| 7 Deployment Gate | Missing | Not found. |
| 7.1 Combined approval | Missing | Not found. |
| 8 SIRA | Partial | `src/components/sira/SiraTab.tsx`. Not audited against §8.2 or §8.3. |
| 9 Audit Plan | Partial | `src/components/plan/AuditPlanTab.tsx`. Errors are now inline, no native dialogs. |
| 10 Engagement Lifecycle | Partial | Sign-off and reopen with justification exist (`src/context/AppContext.tsx`, `src/context/noAlerts.test.tsx`). Whether only three stages exist was not audited. |
| 10.4 Sign-off and locking | Partial | Hash-chained sign-off in memory only; failures return results (`noAlerts.test.tsx`). |
| 11 Testing | Partial | `src/lib/population.ts`, `src/lib/population.test.ts`, `src/components/audit/SamplingTab.tsx`. |
| 12 Analyst Engine | Partial | `src/lib/analytics.ts`, `src/lib/analytics.test.ts`. |
| 13 Document Review and AI | Partial | `src/components/audit/DocumentReviewTab.tsx`. Not audited. |
| 14 Findings, Observations, Issues | Partial | `src/components/issues/`, `src/components/audit/FindingsTab.tsx`. Red Thread trigger removed. |
| 15 Conclusion, Report, Drafting | Missing | The Reports tab and executive-pack modal were deleted in Phase 0. No drafting, issuance or freeze. |
| 16 CAPs | Partial | `src/lib/cap.ts`, `src/lib/cap.test.ts`. |
| 17 Audit File Window and Viewer | Partial | `src/components/audit/AuditFileModal.tsx`, `AuditFileModal.test.tsx`, `src/lib/auditFile.ts`. |
| 18 Export | Missing | Fake exports that called a native dialog were removed from the Reports files. No real export. |
| 19 Import | Missing | Not found. |
| 20 Evidence and Uploads | Partial | `src/components/audit/EvidenceTab.tsx`, `src/lib/glassbox.ts`. Public route uses a zero-scope principal, no server token validation. |
| 21 Change Control | Missing | Not found. |
| 22 Notifications and Email | Missing | Not found. |
| 23 Administration | Missing | The "Admin Console" entry opened the deleted personnel panel and was removed. |
| 24 Platform Portal | Missing | Not found. |
| 25 Data, Security, Infrastructure | Missing | No backend, database, RLS or storage. |
| 26 Logging | Partial | `src/lib/ledger.ts`. In memory only. |
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
| `00`–`17` on the fresh database | **18/18 files pass, 204 assertions** |
| `00`–`17` on a second consecutive run | **18/18 files pass** |

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
| §26 hash chain | `09`, `10`, `15` | genesis, exact hashes, tamper detection, 20 parallel appends stay contiguous |

### Phase 1 decisions (where the spec is silent)

- **`org_id` is the org claim**, set only by `public.custom_access_token_hook`. No policy reads an org
  from a header or body; `org_id_from_header` always returns null and exists to prove it.
- **Platform staff are not tenant members.** `platform_admins` holds a user id and no `org_id`; the
  hook stamps `user_role = 'platform_admin'` with no org.
- **Roles carry a `slug`** (machine name) beside the display `name`; the slug goes in the JWT and in
  policies, so a rename cannot break enforcement.
- **`supabase/config.toml` sets `major_version = 17`** to match local validation.

### NOT DONE (Phase 1)

- No application login: nothing calls Supabase Auth yet, and the front end reads no database
  (no data module). TEMP_AUTH remains the development-only path.
- Not run against a real Supabase project from this machine — the CI step 6 does that. Local
  validation used Postgres 17 with an `auth` schema shim.

