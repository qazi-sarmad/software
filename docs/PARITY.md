# Provio Parity Report (against docs/SPEC-v10.md)

Rebuilt for the completion build (C5.2) from `docs/COMPLETION-SPEC-AUDIT.md`, which is the
evidence-first clause audit. The stale Phase 0 table that let "Missing" rows survive for sections the
code now implements has been moved to `docs/archive/PARITY-phase3.md`. This file is the single
current table.

**Status meanings.** **Present** = built to the spec and covered by a test that fails when the
behaviour is removed. **Partial** = some of it exists, or it exists without a behaviour test; the
missing piece is named. **Missing** = not built.

**Counts at this report (branch `feature/writing-engine`, WRITE-1 run 2026-10-26).**

| Object | Count |
|---|---|
| Migrations | 92 |
| SQL test files | 96 |
| SQL assertions (`provio_test.assert_*` calls) | 1583 |
| Playwright spec files / tests | 25 / 115 |
| vitest files / tests | 164 / 1901 |
| Guards (`src/guards/*.test.ts`) | 19 |

Baseline at C0 (last green run 39516753943, head a41d46e): vitest 128 files / 1428 tests; SQL 80
files / 71 migrations / 1683 assertions; Playwright 113 passed / 2 skipped. Every count above is at
or above its baseline.

## Section status

| Spec section | Status | Evidence |
|---|---|---|
| 0 Product Summary | Present | Full product, backend and RLS: `0008_rls.sql`; sql `01`,`02`,`03`; `e2e/phase7.spec.ts` |
| 1 Laws | Present | L1 `0029_analyst_engine.sql`, `0088_claim_graph.sql`,`0089_phrase_library.sql` + guards `sourceGuards.test.ts`,`noAi.test.ts`; L2 sql `06`,`34`, connector egress allow-list `0090`; L4 Realtime + drilldowns + figure lineage panel; L5 sql `09`,`10`,`15`, `0088` issuance hash chain |
| 2 Structure and Tenancy | Partial | Hierarchy, single-universe engagement, platform-blind all Present (sql `25`,`03`). **Missing:** cross-universe view-only sharing (`COMPLETION-BLOCKERS.md`) |
| 3 Hosting and Client Access | Partial | Login + RLS isolation + export Present. **Partial:** phone viewport test; dedicated/self-hosted switch is an owner action |
| 4 Roles, Teams and Access | Present | sql `19`,`20`,`21`,`24`,`11`,`12`,`08`,`16`; guards `noRoleStrings`,`sourceGuards` |
| 5 Navigation and Home | Present | `NavStrip.tsx` + test; `CommandPalette.tsx`; `PendingTasksTab.tsx`; `AuditFileModal.tsx` |
| 6 Universes and Entities | Present | `0018`; sql `25` |
| 7 Deployment Gate | Present | `0022`,`0023`,`0060`; sql `29`,`30`,`83` |
| 8 SIRA | Present | `0019`,`0020`; sql `26`,`27` |
| 9 Audit Plan | Present | `0021`,`0047`,`0044`; sql `28`,`61`,`53` |
| 10 Engagement Lifecycle | Partial | Three stages, sign-off, lock, reopen, one/two-stage Present (sql `33`,`43`,`12`,`14`,`91`). **Partial:** configurable grace period before the hard lock (§10.1) |
| 11 Testing | Partial | Population gate, sampling, row testing, workpapers Present (sql `34`,`35`,`36`). **Partial:** central §11.4 pre-flight with acknowledge-with-reason |
| 12 Analyst Engine | Present | `0029` + `analytics.ts` + `analytics.test.ts`; sql `37`; `0082` BI ranges |
| 13 Document Review and AI | Present | `0078` + `doc-extract`; `0059`,`0045`,`0067`; sql `87`,`69`,`76` |
| 14 Findings, Observations and Issues | Present | `0030`,`0082`; sql `39`,`91`; guard `sourceGuards` |
| 15 Conclusion, Report and Drafting | Present | `0036`,`0037`,`0040`,`0058`; sql `45`,`46`,`49`,`68`. **WRITE-1:** Evidence-Bound Claim Graph `0088`,`0089`,`0090`; sql `95`,`96`,`97`,`98`; `src/lib/writing/*` (graph, phrases, models, planner, figures, verify, explain, versioning, lint, issue, connectors, monitors); byte-reproducible PDF/DOCX `src/lib/render/*` |
| 16 CAPs | Present | `0038`; sql `47`; `src/lib/cap.ts` |
| 17 Audit File Window and Document Viewer | Partial | Window, pop-out, viewer, FTS Present (`FloatingWindow.tsx`, `0035`,`0078`; sql `44`). **Partial:** pop-out Realtime sync test |
| 18 Export | Present | `0041`,`0079`; sql `50`,`88`; `src/lib/render/*` |
| 19 Import | Present | `0042`,`0044`; sql `51`,`53`; import wizard |
| 20 Evidence and Uploads | Present | `0035`,`0078`,`0082`; sql `44`,`87`,`91` |
| 21 Change Control | Present | `0080`; sql `89` |
| 22 Notifications and Email | Partial | Graph OAuth + email queue + role rules Present (`0054`,`0064`,`0072`,`0055`,`0082`; sql `48`,`66`,`81`,`91`). **Partial:** Realtime in-app delivery test |
| 23 Administration (Org Admin Portal) | Present | `0017`,`0032`,`0053`,`0082`; sql `24`,`41`,`65`,`91`; `PeopleAdminPanel.tsx`,`OrgGovernancePanel.tsx` |
| 24 Platform Portal | Present | `0031`,`0033`,`0045`,`0076`; sql `40`,`42`,`69`,`85` |
| 25 Data, Security and Infrastructure | Partial | One client, RLS, archival, population archival, 50k acceptance Present (guards; sql `13`,`43`,`52`,`86`,`38`). **Partial:** free-tier limit verification (owner action) |
| 26 Logging | Present | `0005`,`0006`,`0043`,`0077`; sql `08`,`09`,`10`,`15`,`52`,`86` |
| 27 Design System | Present | `tokens.css`; `check-tokens.mjs` (168 files, 0 violations); guard `noBlockingModal`; `RecordView.tsx` |
| 28 Out of Scope and Discarded | Present | Guards `sourceGuards`,`noBlockingModal`,`noRawJsonEditing`,`noRoleStrings`,`anonGrantAllowList` |
| 29 Build and Verification | Present | `scripts/pre-pr-gates.sh`; CI; `docs/COMPLETION-SPEC-AUDIT.md` |
| 30 Phase 2 decisions D1–D12 | Present | sql `19`,`21`,`22`,`23`,`24`; `rightsMatrix.test.ts` |
| 31 Changes from v9 | Present | reflected throughout |
| 32 Open Items | Partial | §25.4 limit verification and Microsoft guidance are owner actions |

## Partial and Missing, in one place

Everything below is recorded in `docs/COMPLETION-BLOCKERS.md` with the reason and the owner decision.

1. **§2 cross-universe view-only sharing** — Missing (owner decision: build or amend the spec).
2. **§10.1 configurable grace period before the hard lock** — Partial.
3. **§11.4 central pre-flight with acknowledge-with-reason** — Partial.
4. **§17.1 pop-out Realtime sync test** — Partial (implementation present, test absent).
5. **§22 Realtime in-app notification delivery test** — Partial.
6. **§3/§25.7 mobile viewport smoke** — Partial.
7. **§3 dedicated/self-hosted switch** — Partial (owner action).
8. **§25.4 free-tier limit verification** — Partial (owner action).
