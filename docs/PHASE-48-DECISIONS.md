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

## D-H3a — preferences table, RPCs and the no-blocking-modal guard scope

Task H3a. Unclear point: the task predicts the guard offender set as `AuditFileModal.tsx` plus
`ConfirmPanel.tsx`, but the repository has no `ConfirmPanel.tsx`, and the real full-viewport overlays
are `InspectorPanel.tsx`, `CommandPalette.tsx` and `HeaderCalendarPanel.tsx`.
Options: (a) create a `ConfirmPanel.tsx` that is not used; (b) write the guard against the real files
with a justified allow-list.
Choice: (b). `user_preferences` is a new table (grep found none; `config_versions` is org-level
configuration, not per-user state). Guard allow-list: `AuditFileModal.tsx` (§17.1 window chrome,
explicitly non-blocking), the global command palette (§5, Ctrl/⌘ K — transient, Esc-dismissed),
`HeaderCalendarPanel.tsx` (anchored popover, `role="dialog"` but no scrim, no focus trap; the page
stays usable). `ConfirmPanel.tsx` remains an allowed name for when the hold-to-confirm panel lands
(§27.5 names it). `InspectorPanel.tsx` is a genuine blocking modal and is in a TEMPORARY list that
H3c empties when the file is abolished.
Reason: ascribing blocking-modal status to a file that does not exist would hide the real offenders;
the guard must scan actual code while keeping the two surfaces §27.5 explicitly permits.
Files touched beyond the task list: `supabase/tests/00_lib.sql` (`user_preferences` added to
`org_tables()`, so tests 1/4 keep covering it). New SQL test `32_user_preferences.sql`.
How to reverse: delete 0024 + test 32, drop `user_preferences` from `org_tables()`, delete
`src/data/preferences.ts` and the guard; restore NavStrip etc. from `8500602`.

## D-H3a-M1 — no collision

Grep for `user_preferences`, `get_user_preference` and `set_user_preference` found no existing
object, so 0024 creates rather than alters. No M1 collision.
