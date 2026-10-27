# Provio Parity Report (against docs/SPEC-v10.md)

Rebuilt for the completion build (C5.2) from `docs/COMPLETION-SPEC-AUDIT.md`, which is the
evidence-first clause audit. The stale Phase 0 table that let "Missing" rows survive for sections the
code now implements has been moved to `docs/archive/PARITY-phase3.md`. This file is the single
current table.

**Status meanings.** **Present** = built to the spec and covered by a test that fails when the
behaviour is removed. **Partial** = some of it exists, or it exists without a behaviour test; the
missing piece is named. **Missing** = not built.

**Counts at this report (branch `feature/scale-harden-v1`, SCALE-1 run 2026-10-26).**

| Object | Count |
|---|---|
| Migrations | 99 |
| SQL test files | 103 |
| SQL assertions (`provio_test.assert_*` calls) | 1824 |
| Playwright spec files / tests | 29 / 133 |
| vitest files / tests | 201 / 2376 |
| Guards (`src/guards/*.test.ts`) | 20 |

Baseline at C0 (last green run 39516753943, head a41d46e): vitest 128 files / 1428 tests; SQL 80
files / 71 migrations / 1683 assertions; Playwright 113 passed / 2 skipped. Every count above is at
or above its baseline.

## Section status

| Spec section | Status | Evidence |
|---|---|---|
| 0 Product Summary | Present | Full product, backend and RLS: `0008_rls.sql`; sql `01`,`02`,`03`; `e2e/phase7.spec.ts` |
| 1 Laws | Present | L1 `0029_analyst_engine.sql`, `0088_claim_graph.sql`,`0089_phrase_library.sql` + guards `sourceGuards.test.ts`,`noAi.test.ts`; L2 sql `06`,`34`, connector egress allow-list `0090`; L4 Realtime + drilldowns + figure lineage panel; L5 sql `09`,`10`,`15`, `0088` issuance hash chain |
| 2 Structure and Tenancy | Present | Hierarchy, single-universe engagement, platform-blind Present (sql `25`,`03`). Cross-universe view-only sharing Present: `0095_scale_harden_sharing_preflight.sql` (`universe_shares`, `share_grant`/`share_revoke`, `shared_universe_read`), `src/data/shares.ts`, `src/components/admin/SharePanel.tsx`, sql `100`,`103`, `e2e/wp6-system.spec.ts`. |
| 3 Hosting and Client Access | Present | Login + RLS isolation + export Present. Phone viewport smoke Present (`e2e/s16-mobile.spec.ts`). Dedicated/self-hosted switch remains an owner action (infrastructure, not code). |
| 4 Roles, Teams and Access | Present | sql `19`,`20`,`21`,`24`,`11`,`12`,`08`,`16`; guards `noRoleStrings`,`sourceGuards` |
| 5 Navigation and Home | Present | `NavStrip.tsx` + test; `CommandPalette.tsx`; `PendingTasksTab.tsx`; `AuditFileModal.tsx` |
| 6 Universes and Entities | Present | `0018`; sql `25` |
| 7 Deployment Gate | Present | `0022`,`0023`,`0060`; sql `29`,`30`,`83` |
| 8 SIRA | Present | `0019`,`0020`; sql `26`,`27` |
| 9 Audit Plan | Present | `0021`,`0047`,`0044`; sql `28`,`61`,`53` |
| 10 Engagement Lifecycle | Present | Three stages, sign-off, lock, reopen, one/two-stage Present (sql `33`,`43`,`12`,`14`,`91`). Configurable grace period before the hard lock Present: `org_lifecycle_settings.testing_grace_hours` + `testing_lock_active` grace window (`0095`), `src/lib/lifecycle.ts`, `src/data/governance.ts`, sql `100`. |
| 11 Testing | Present | Population gate, sampling, row testing, workpapers Present (sql `34`,`35`,`36`). Central §11.4 pre-flight Present: `src/lib/preflight.ts` (eight checks, structured report), `src/data/preflight.ts`, append-only `preflight_acknowledgements` + acknowledge RPC (`0095`), unit + sql `100`. |
| 12 Analyst Engine | Present | `0029` + `analytics.ts` + `analytics.test.ts`; sql `37`; `0082` BI ranges |
| 13 Document Review and AI | Present | `0078` + `doc-extract`; `0059`,`0045`,`0067`; sql `87`,`69`,`76` |
| 14 Findings, Observations and Issues | Present | `0030`,`0082`; sql `39`,`91`; guard `sourceGuards` |
| 15 Conclusion, Report and Drafting | Present | `0036`,`0037`,`0040`,`0058`; sql `45`,`46`,`49`,`68`. **WRITE-1:** Evidence-Bound Claim Graph `0088`,`0089`,`0090`; sql `95`,`96`,`97`,`98`; `src/lib/writing/*` (graph, phrases, models, planner, figures, verify, explain, versioning, lint, issue, connectors, monitors); byte-reproducible PDF/DOCX `src/lib/render/*` |
| 16 CAPs | Present | `0038`; sql `47`; `src/lib/cap.ts` |
| 17 Audit File Window and Document Viewer | Present | Window, pop-out, viewer, FTS Present (`FloatingWindow.tsx`, `0035`,`0078`; sql `44`). Pop-out Realtime sync proven by `e2e/s14-popout-sync.spec.ts` (Realtime path and the documented poll fallback). |
| 18 Export | Present | `0041`,`0079`; sql `50`,`88`; `src/lib/render/*` |
| 19 Import | Present | `0042`,`0044`; sql `51`,`53`; import wizard |
| 20 Evidence and Uploads | Present | `0035`,`0078`,`0082`; sql `44`,`87`,`91` |
| 21 Change Control | Present | `0080`; sql `89` |
| 22 Notifications and Email | Present | Graph OAuth + email queue + role rules Present (`0054`,`0064`,`0072`,`0055`,`0082`; sql `48`,`66`,`81`,`91`). Realtime in-app delivery proven by `e2e/s15-notifications.spec.ts` and the Realtime channel fix (`0098`, `src/lib/liveSync.ts`); sql `104`. |
| 23 Administration (Org Admin Portal) | Present | `0017`,`0032`,`0053`,`0082`; sql `24`,`41`,`65`,`91`; `PeopleAdminPanel.tsx`,`OrgGovernancePanel.tsx` |
| 24 Platform Portal | Present | `0031`,`0033`,`0045`,`0076`,`0097`; sql `40`,`42`,`69`,`85`,`102`; guided provisioning wizard (SA-01). |
| 25 Data, Security and Infrastructure | Present | One client, RLS, archival, population archival, 50k acceptance Present (guards; sql `13`,`43`,`52`,`86`,`38`). Multi-tenant isolation under concurrent orgs proven by sql `103`. Free-tier limit verification remains an owner action (external service). |
| 26 Logging | Present | `0005`,`0006`,`0043`,`0077`; sql `08`,`09`,`10`,`15`,`52`,`86` |
| 27 Design System | Present | `tokens.css`; `check-tokens.mjs` (168 files, 0 violations); guard `noBlockingModal`; `RecordView.tsx` |
| 28 Out of Scope and Discarded | Present | Guards `sourceGuards`,`noBlockingModal`,`noRawJsonEditing`,`noRoleStrings`,`anonGrantAllowList` |
| 29 Build and Verification | Present | `scripts/pre-pr-gates.sh`; CI; `docs/COMPLETION-SPEC-AUDIT.md` |
| 30 Phase 2 decisions D1–D12 | Present | sql `19`,`21`,`22`,`23`,`24`; `rightsMatrix.test.ts` |
| 31 Changes from v9 | Present | reflected throughout |
| 32 Open Items | Present (code) | §25.4 limit verification and Microsoft guidance are pure-owner actions against external services; nothing in the codebase is Partial or Missing. |

## Partial and Missing, in one place

Closed by SCALE-1 (`feature/scale-harden-v1`, WP2). Every former Partial/Missing item below is now
Present with working code and tests; the only items that remain are pure-owner actions against
external services, listed last.

1. **§2 cross-universe view-only sharing** — Present. `universe_shares` table, `share_grant` /
   `share_revoke` RPCs (Level-1/Level-2 Head or Org Admin; revocation by the granting Head, a higher
   Head or an Org Admin), `shared_universe_read` read-only projection, in-app + email notification,
   `src/components/admin/SharePanel.tsx`, sql `100`,`103`, `e2e/wp6-system.spec.ts`.
2. **§10.1 configurable grace period before the hard lock** — Present. `testing_grace_hours` on
   `org_lifecycle_settings`, `testing_lock_active` grace window, `src/lib/lifecycle.ts`,
   `src/data/governance.ts`, sql `100`.
3. **§11.4 central pre-flight with acknowledge-with-reason** — Present. `src/lib/preflight.ts` runs the
   eight checks and returns a structured report; `src/data/preflight.ts` writes the append-only,
   logged `preflight_acknowledgements` row; unit + sql `100`.
4. **§17.1 pop-out Realtime sync test** — Present. `e2e/s14-popout-sync.spec.ts` proves the Realtime
   path and the documented poll fallback.
5. **§22 Realtime in-app notification delivery test** — Present. `e2e/s15-notifications.spec.ts` proves
   delivery into the Work Queue; `0098` fixes the per-subscriber channel; sql `104`.
6. **§3/§25.7 mobile viewport smoke** — Present. `e2e/s16-mobile.spec.ts` at phone viewport covers
   ethics sign-off, a simple approval and report viewing.
7. **§3 dedicated/self-hosted switch** — pure-owner action (infrastructure).
8. **§25.4 free-tier limit verification** — pure-owner action (external service).
