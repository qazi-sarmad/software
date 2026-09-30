# Provio Engineering Handoff & Progress

## Status Summary
- **Current Phase**: Completing Checkpoint 1 & Transitioning to Part 2
- **Blockers**: None

---

## What is DONE (With Evidence)

### Part 1: Fix the Broken Build
1. **Lucide-react removal**:
   - Replaced all imports in `AuditUniverseTab`, `EntitySiraRcmModal`, `CommentHistoryPanel`, `ReviewCommentsDock`, and `ReviewCommentsGlobalDock` with `src/components/common/Icons.tsx`.
   - Verified via `node scripts/check-tokens.mjs` (0 violations across 45 component files).

2. **Test Environment & Dependencies**:
   - Added `@testing-library/dom` to devDependencies.
   - Removed unused packages `@google/genai`, `express`, `dotenv`.
   - Verified via `npx tsc --noEmit` (Exit code 0, no errors) and `npx vitest run` (34 tests passed across 9 test files).

3. **Dynamic Ledger Seed**:
   - AppContext initializes ledger using `generateInitialLedger()`.
   - Added Vitest tests for untouched seed verification and tampering detection in `src/lib/ledger.test.ts`.

4. **Restored Behavior from v1.7**:
   - Public route `/e/:token` restored via `GlassBoxPublicRoute.tsx` with shared icons.
   - Code-splitting with `React.lazy` and `Suspense` in `App.tsx`.

5. **Reference Archive**:
   - Created `docs/reference/v1/` with read-only v1.7 reference files.
   - Excluded `docs/` from `tsconfig.json`, `vitest.config.ts`, and gate scripts.

6. **Shrink Guard**:
   - Created `docs/baseline-lines.json` and updated `scripts/check-shrink.mjs` to work without git.
   - Verified via `node scripts/check-shrink.mjs` (65 files verified, 0 shrunk >10%).

7. **Verification & Parity Documentation**:
   - Updated `docs/PARITY.md` with gate results.

---

## What is NEXT

### Part 2: Roles, Access Data, /dev/access
1. **Lifecycle Stages (Part 2.A)**:
   - Ensure `EngagementStage` is strictly `'planning' | 'testing' | 'conclusion'`.
   - Verify every type, seed, and component is aligned.

2. **Role & Action Matrix (Part 2.B)**:
   - Roles: `cia`, `audit_manager`, `reviewer`, `preparer`, `observer`, `org_admin`, `auditee`.
   - Implement action permission matrix in `src/lib/access.ts` with explicit reason strings.
   - Four-eyes trap: reviewer cannot review sign-off on workpapers they prepared.
   - Reopen requires note of 10+ characters.
   - UI buttons disabled or hidden with tooltip reasons; unauthorized tabs hidden.

3. **Synthetic Seed Data (Part 2.C)**:
   - Universes: `u-gbm` ("Global Banking & Markets"), `u-rdb` ("Retail & Digital Banking").
   - Entities: GBM (`ent-treasury`, `ent-trading`, `ent-compliance`), RDB (`ent-retail`, `ent-cards`, `ent-digital`).
   - Per entity exactly: 2 engagements, 2 workpapers (one per engagement), 2 observations, 1 ISSUED issue, 1 open comment thread.
   - Totals: 6 entities, 12 engagements, 12 workpapers, 12 observations, 6 issues, 6 comments.
   - Spread across all 3 stages: >=1 overdue, >=1 sealed with valid ledger chain, >=1 ad-hoc pending CIA approval, >=2 sharing a calendar day.
   - Four-eyes trap on `ent-treasury` workpaper prepared by reviewer.
   - Canary strings in text fields (`CANARY-TREASURY`, `CANARY-TRADING`, `CANARY-COMPLIANCE`, `CANARY-RETAIL`, `CANARY-CARDS`, `CANARY-DIGITAL`).

4. **Dev Access Page `/dev/access` (Part 2.D)**:
   - Route and component `/dev/access` testing user switcher, role permissions matrix, scoping checks, and canary leakage inspection.

5. **Commit Part 1 and proceed to Part 2**.
