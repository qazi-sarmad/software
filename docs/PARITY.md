# Provio Parity Report (against docs/SPEC-v10.md)

Last updated: Phase 0 clean-up. This file replaces the earlier v1.7 report, whose claims (for example "persona switcher", "Reports", "Red Thread" as present features) described behaviour the spec discards.

Status meanings: **Present** = built to the spec and covered by a test. **Partial** = some of it exists, or it exists only in the front-end prototype with hardcoded seed data. **Missing** = not built.

Basis of the statuses: the repository is a front-end prototype with **no backend, no login and no database**. Anything the spec requires of a database, server, tenant boundary or real authentication is therefore at best Partial. Statuses below come from reading the code and running the tests listed; rows marked "not audited in Phase 0" were not examined and are not claimed.

## Verification at the end of Phase 0

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | 26 files, 188 tests passed |
| `npx vite build` | exit 0 |
| `node scripts/check-tokens.mjs` | passed (53 files, 0 violations) |
| `node scripts/check-shrink.mjs` | passed (60 files). HeaderBar and 5 deleted files were re-baselined on purpose, see Phase 0 notes. |
| `npx playwright test` | **Not run.** No browser can be installed in the build sandbox. The 5 `[E2E]` tests in `e2e/smoke.spec.ts` are written and listed (`playwright test --list`: 7 tests) but unexecuted. |

## Section status

| Spec section | Status | Evidence / notes |
|---|---|---|
| 0 Product Summary | Partial | Front-end prototype only. |
| 1 Laws | Partial | L1: engines are plain functions (`src/lib/auditEngines.ts`, `src/lib/population.ts`) with tests; no Math.random in production paths (`src/build/sourceGuards.test.ts`). L2: **Missing**, no tenant boundary exists. L3: client-side gate only (`src/lib/population.ts`, `src/context/populationGate.test.tsx`); **not enforced in a database**. L4: not audited. L5: hash chain exists in memory only (`src/lib/ledger.ts`, `src/lib/ledger.test.ts`); now refuses to seal without crypto.subtle (`src/lib/ledger.nohash.test.ts`). Nothing is persisted. |
| 2 Structure and Tenancy | Missing | No tenants; one demo tenant constant in `src/lib/tempAuth.ts` (`is_demo: true`). |
| 3 Hosting and Client Access | Missing | No hosting model or client access layer. |
| 4.1 Roles | Partial | Role model in `src/lib/access.ts`, `src/lib/access.test.ts`. |
| 4.2 Audit Teams | Partial | Not audited in Phase 0. |
| 4.3 Visibility and enforcement | Partial | Client-side scoping (`src/hooks/useScopedData.ts`). No RLS, no server enforcement. |
| 4.4 Fixed invariants | Partial | Four-eyes and lock rules in `src/lib/access.ts`, `src/lib/workpaperLock.ts` (`workpaperLock.test.ts`). Client-side only. |
| 4.5 Identity | Partial | Persona switcher, "Simulate Viewpoint" and the default CIA identity are **removed** (`src/App.auth.test.tsx`, `src/build/sourceGuards.test.ts`). Identity now comes only from a session (`src/context/AuthContext.tsx`). Real authentication is **Missing**: only the development-only TEMP_AUTH stub (`src/lib/tempAuth.ts`, `tempAuth.test.ts`) exists, and a production build cannot sign in. `src/components/dev/DevAccessPage.tsx` is still a role-switching harness, dev-only. |
| 5 Navigation and Home | Partial | Seven tabs, no Reports or Calendar tab (`src/components/common/NavStrip.test.tsx`, `src/App.auth.test.tsx`). Home content not audited. |
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
| 28 Out of Scope and Discarded | Partial | Removed and guarded by tests: persona login, Simulate Viewpoint, Reports tab, Red Thread, scrub bar, native dialogs, Math.random. Not removed or not audited: `src/components/dashboard/GanttTimeWarp.tsx` (may be scrub-like), `src/data/initialData.ts` seed data is still bundled in production. |
| 29 Build and Verification | Partial | Gates 1-5 pass; gate 6 not run (see above). Production bundle test: `src/build/prodBundle.test.ts`. |
| 30 Changes from v9 | n/a | Informational. |
| 31 Open Items | n/a | Informational. |

## Phase 0 notes

- Removed: persona switcher, personnel panel, Reports tab, executive pack, Red Thread, ledger scrub bar, all native `alert()` and `prompt()` calls.
- `docs/baseline-lines.json`: five deleted files removed from the baseline; `HeaderBar.tsx` re-baselined from 328 to 271 lines. The lost lines are the removed persona switcher, Admin Console entry, personnel link and dev link.
- Dev routes `/dev/access` and `/dev/palette` exist only when `import.meta.env.DEV` is true. The production bundle contains neither (`src/build/prodBundle.test.ts`).
