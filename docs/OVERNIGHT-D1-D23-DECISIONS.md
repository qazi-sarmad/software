# Overnight build D1-D23 decisions

Decisions taken where the prompt was unclear, silent, or where the repository disagreed with the
prompt. Each entry names the task, the unclear point, the options, the choice, the reason and how to
reverse it.

## D-D1-xlsx — SheetJS distribution channel

Task D1. Unclear point: the prompt says to install `@sheetjs/xlsx@latest`, but that package does not
exist on the public npm registry (`npm view @sheetjs/xlsx` returns 404). SheetJS stopped publishing
to npm after 0.18.5; the current release is distributed from the vendor's own CDN.
Options: (1) drop XLSX import; (2) keep the vulnerable npm `xlsx@0.18.5`; (3) install the current
SheetJS release from `https://cdn.sheetjs.com`.
Choice: option 3. `xlsx@0.20.3` is installed from the vendor CDN tarball.
Reason: spec §19 requires XLSX import for five sources, so dropping it (option 1) would remove a
specified feature. Option 2 leaves two high advisories open, which is the thing D1 exists to fix.
The CDN tarball is SheetJS's documented distribution and resolves both advisories.
How to reverse: `npm remove xlsx && npm install xlsx@0.18.5`, then restore the advisory note in
`docs/NOT-DONE.md` item 12.

## D-D5-clock — the demo clock is injected, not deleted

Task D5. Unclear point: the prompt gives `getDemoNow` a shape that reads `window.__DEMO_NOW__` only
when `import.meta.env.MODE === 'test'`. Vitest and Playwright both run with `MODE === 'test'`, so the
hook is reachable in both. The prompt also lists `src/lib/orgDate.ts:13-16` for replacement, but that
file is the org-timezone date helper with its own tests that pin `DEMO_TODAY_ISO`.
Choice: `src/lib/demoTime.ts` owns `getDemoNow`/`getDemoTodayISO`. `orgDate.ts` keeps its exported
`DEMO_TODAY_ISO` constant but derives it from `getDemoTodayISO()` so there is one source of truth.
Reason: deleting the constant would break `orgDate.test.ts` and every screen that imports it; deriving
it keeps the public surface stable while removing the hard-coded literal.
How to reverse: restore the literal `'2026-09-30'` in `orgDate.ts` and delete `demoTime.ts`.

## D-PLATFORM-RIGHTS — platform portal is the only reader of user_role

Established in Phase 8 and unchanged. The platform portal is the sole place that may read `user_role`
from the JWT (for example `user_role = 'platform_admin'`). Every org-product RPC and all application
code use only `caller_has_right`/`hasRight`. Platform checks never leak into org RPCs.

## D-D9-rpc — `update_plan_item_dates` did not exist; added it in migration 0047

Task D9. Unclear point: the prompt states "The update_plan_item_dates RPC exists in migration 0025
(plan management)", but no such function exists anywhere in `supabase/` or `src/` (grep returns
nothing), and migration 0025 is the Phase 4B Planning migration, not plan management. The plan RPCs
live in `0021_audit_plan.sql` (`create_plan`, `add_plan_item`, `decide_adhoc_item`, `approve_plan`,
`snapshot_plan_version`).
Options: (1) stop and report; (2) build the RPC in a new migration.
Choice: option 2. Added `public.update_plan_item_dates(p_item uuid, p_start date, p_end date)` in
`supabase/migrations/0047_plan_item_dates.sql`.
Reason: overnight mode replaces the stop rule; the missing object is the only blocker. The RPC follows
the 0021 conventions: `security definer set search_path = public`, `jwt_org_id()` scope, the
configured `plan_approval_settings.create_right` (the same right `add_plan_item` needs, because a
reschedule is a plan change), an approved plan is refused with the same message `add_plan_item` uses,
the date range is validated, and a new immutable version is written via `snapshot_plan_version` (L5).
How to reverse: `drop function public.update_plan_item_dates(uuid, date, date)` and remove the Gantt
handler plus `updatePlanItemDates`/`planItemForEngagement` from `src/data/plan.ts`.

## D-D9-apply — reschedule is reflected in memory, not by a full refetch

Task D9. Unclear point: the prompt's handler says "Refetch plan or update local state". The Gantt
draws `AuditEngagement` rows from `useScopedData`/`AppContext`, and there is no engagement-list data
module to refetch through (`src/data` has no engagement loader).
Choice: the Gantt resolves the plan item behind the engagement (`planItemForEngagement`), persists the
new dates (`updatePlanItemDates`), then reports the change to its caller via `onRescheduled`, which
`ExecutiveDashboardTab` applies through a new `AppContext.applyPlanItemDates` setter. The plan item
stays authoritative; the in-memory engagement mirrors it until the next load.
Reason: simplest option that obeys the Laws and the "every DB call through src/data" rule, with no new
loader to invent.
How to reverse: drop the `onRescheduled`/`applyPlanItemDates` path and call a real engagement reload
once an engagement data module exists.

## D-D10-reuse — the CAP register is surfaced, not rebuilt

Task D10. Unclear point: the prompt names `src/components/issues/IssuesAndCAPTab.tsx` and says to add a
CAP section that loads `listCaps(orgId, engagementId)`. That file does not exist (the tab is
`IssuesRegisterTab.tsx`), and `listCaps` takes only an engagement id.
Choice: render the existing `src/components/audit/CapRegisterPanel.tsx` (built in 6H, already tested in
`phase6Panels.test.tsx`) inside the Issues & CAP tab, with an engagement picker that defaults to the
selected engagement or the first in scope. No second CAP UI is written.
Reason: the register, its status vocabulary (D-6D-CAP) and its close action already exist and are
tested; duplicating them would create the divergent second status set D-6D-CAP forbids.
How to reverse: remove the section and the picker from `IssuesRegisterTab.tsx` and delete
`IssuesRegisterTab.test.tsx`.

## D-D11-retest — the retest workflow is deleted, not hidden

Task D11. Unclear point: the prompt says "remove retest workflow" and SPEC §28 lists "A retest
workflow and 'proposed' CAP due dates" as never-reintroduce. The old code carried a parallel
`RetestStatus` axis (`Not tested | Passed | Failed | In retest`), a `cap_fail_retest` capability, a
`fail_retest` transition action, a Re-Test table column and a "Fail Re-Test" panel in CapInspector.
Choice: delete the axis entirely rather than hide it. Specifically:
- removed the `RetestStatus` type and the `retestStatus` field from `AuditCapItem` (`src/types/index.ts`);
- removed the `cap_fail_retest` capability from both capability unions and from
  `buildDefaultOrgRoleConfig` (`src/lib/orgCapabilities.ts`);
- removed the `fail_retest` action from `CapStatusAction`/`ACTION_CAPABILITY` and the
  `retestStatus` writes from `transitionCapStatus` (`src/lib/cap.ts`);
- removed the Re-Test column, badge and `getRetestBadge` from `CapTable.tsx` (colSpan 9→8);
- removed the "Independent Re-Test" readout and the Fail Re-Test button/panel from `CapInspector.tsx`;
- removed `updateCapStatus` from `AppContext` (its only caller was CapTable, and its retestStatus
  parameter no longer exists) — the gated `transitionCap` path remains the single writer;
- removed `retestStatus` from the CAP seed rows in `src/data/initialData.ts`;
- added a source guard in `src/guards/sourceGuards.test.ts` that fails if `fail_retest`,
  `retestStatus`, `RetestStatus` or `Re-?[Tt]est` reappears anywhere under `src` (excluding tests).
Reason: §16.2 states "No in-system retest. Verification is documented through the action description,
rationale and supporting evidence." A dormant type/column left in place would re-enable the workflow
on the next edit and would keep the CAP register vocabulary divergent, which the Laws forbid. The
database already uses the §16.2 vocabulary (`open | verified_closed | verified_closed_delay |
unverified | overdue_unverified`), so no migration change is needed.
Note: "proposed" CAP due dates (the other half of §28) were never implemented — there is no
`proposed` due-date field in the codebase, so there is nothing to remove; recorded here for
completeness.
Baseline: `docs/baseline-lines.json` updated for `CapTable.tsx` (350 → 313 lines) so the intentional
removal is not reported as an accidental shrink.
How to reverse: `git revert` the D11 commit; restore `RetestStatus`, `retestStatus`, `cap_fail_retest`,
the `fail_retest` action, the Re-Test column and the Fail Re-Test panel, and delete the retest guard.
