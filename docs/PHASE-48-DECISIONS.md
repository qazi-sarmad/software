# Phases 4–8 — decisions

Decision order: (a) `docs/SPEC-v10.md`; (b) the Laws; (c) the simplest option that obeys the Laws;
(d) best for multi-tenant, auditable, configuration-not-code, deterministic. Never an option that
weakens RLS, the population gate, the ledger, the hash chains or a test.

Entry format: number, task, unclear point, options, choice, reason, how to reverse.

---

## D-PLATFORM-RIGHTS (first use: 8A)

The platform portal (Phase 8) is the sole place that may read `user_role` from the JWT (for example
`user_role = 'platform_admin'`). All org-product RPCs and application code continue to use only
`caller_has_right` / `hasRight`. Platform checks must not leak into org RPCs.
Reason: §24 requires a platform role with no tenant business access; the tenant boundary is rights,
so the one exception is scoped to platform-only functions and platform-only tables.
Reverse: remove the `platform_admin` branch from the Phase 8 functions; nothing in Phases 4–7 reads it.

## D-H0-USERS

`e2e/global-setup.ts` already creates `ayesha.khan@provio-test.invalid` (Org A `org_admin`) and
`bilal.ahmed@provio-test.invalid` (Org A `preparer`). No new users are created for this build; the
Playwright tests use these two. Reason: they already exist and the setup is idempotent.
Reverse: revert the `e2e/` changes of this build.

## D-H2 — nav labels

Task H2. Unclear point: the code used freeze-spec tab labels that differ from SPEC-v10 §5.
Options: keep the old labels; or adopt §5.
Choice: §5 wins. Mapping applied — Executive Summary → Dashboard; Pending Tasks → Work Queue;
Audit File (tab) → Audit Files; Issues Register → Issues & CAP Register. Audit Universe, Audit Plan
and SIRA are unchanged.
Reason: SPEC-v10 is the authoritative spec (§5 "Primary navigation"). Old freeze labels
(Executive Summary, Pending Tasks, Audit File, Issues Register) are superseded.
Files touched beyond `NavStrip.tsx`: `src/components/common/NavStrip.test.tsx` (asserts exact label
text), `e2e/smoke.spec.ts` (SEVEN_TABS + click titles), `src/App.auth.test.tsx` (negative assertion),
`src/components/pending/PendingTasksTab.tsx` and `src/components/issues/IssuesRegisterTab.tsx`
(visible headings using the old wording), `src/components/dashboard/ExecutiveDashboardTab.tsx`
(hint text). Tab `id`s are unchanged, so routing and `data-testid`s are unaffected.
How to reverse: restore the NavStrip strings and the test assertions from the pre-H2 commit `244bb3e`.
