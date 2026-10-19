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

## D-D12-queue — the Work Queue is a pure selector over already-scoped data

Task D12. Unclear point: the prompt says to load "the user's own tasks" from the database
(`workpapers where preparer or reviewer is the signed-in user`), and to load approval queues (plan
requests, deployment requests, CAPs needing verification). The app has no per-user workpaper loader
in `src/data` and the pending requests are held in the in-memory `AppContext` seed, not a queryable
table.
Choice: build the queue as a pure function, `src/lib/workQueue.ts` (`buildWorkQueue`), over the rows
`useScopedData` already holds, and gate the manager section on the `review_and_approve` right rather
than a role name. `PendingTasksTab` becomes a thin renderer.
Reason: (a) the Laws require rights-based gates, and the pure function is deterministic and testable
(L1); (b) it adds no new DB object and no second loader, so it cannot drift from the scoped data the
rest of the app shows; (c) it obeys "every DB call through src/data" because it makes no DB call.
Options rejected: a `listMyWork(userId)` RPC — deferred until the app has a live workpaper loader,
since inventing one now would duplicate `useScopedData`.
How to reverse: delete `src/lib/workQueue.ts` + its test and restore `PendingTasksTab` from the
pre-D12 commit (the previous version grouped engagements by status, not by ownership).

## D-D13-keyboard — activate HoverPreview on Enter/Space

Task D13. Unclear point: the prompt says the trap is that "HoverPreview wraps a button but does not
handle Enter/Space keys". In fact HoverPreview renders a `div` with `role="button"` and
`tabIndex={0}` (not a real `<button>`), and its `onClick` prop carries the action. A div with
`role="button"` is focusable but not keyboard-activatable, so a keyboard user could focus the trigger
and never fire the action.
Choice: keep the div (replacing it with a native `<button>` would nest interactive children inside a
button in several call sites and change layout), add an `onKeyDown` handler that fires `onClick` on
`Enter`, `Space` and the legacy `Spacebar` value, calling `preventDefault` to stop the page scroll
that Space would otherwise cause, and set `aria-disabled` when `disabled` is set. `onClick` remains
the single action path for mouse, touch and keyboard.
Reason: smallest change that removes the trap without touching the 12 call sites; the pattern matches
the WAI-ARIA button role.
How to reverse: remove the `onKeyDown`/`handleKeyDown` wiring and the `aria-disabled` attribute and
delete the four keyboard tests in `HoverPreview.test.tsx`.

## D-D14-rights — disabled controls explain themselves in plain language

Task D14. Unclear point: the prompt says disabled controls show "internal slugs" and gives a literal
map (perform_work → "You don't have permission to perform work on this engagement", …). The code did
not use the exact `title={Requires ${right}}` pattern; instead each panel carried its own sentence,
and several leaked the slug verbatim ("You do not hold the perform_work right.") or interpolated an
RPC's `requiredRight` field straight into the UI.
Choice: add `src/lib/rightLabels.ts` exporting `rightReason(right)` (the prompt's map, extended to
every right in `src/lib/rights.ts`) and `rightReasonFor(raw)` (a safe fallback for a plain string).
Replace every slug-bearing user-visible string — in `title` attributes, inline banners and
`AppContext`'s error reasons — with these helpers, and add a source guard that fails if a slug appears
inside a user-visible string segment.
Reason: the Laws require human-readable copy (no jargon), and the prompt's map keys must match the
closed right vocabulary exactly; the fallback guarantees a slug can never reach the screen even when
the value arrives from an RPC. The guard keeps the fix from regressing.
How to reverse: `git revert` the D14 commit and delete `src/lib/rightLabels.ts` + its test and the
guard case; restore the old literal sentences.

## D-D15-responsive — mobile widths reflow instead of hiding

Task D15. Unclear point: the prompt names `src/components/common/NavHeader.tsx` and
`HeaderSearchBar.tsx` as the files hiding the search field, but neither file exists; the search field
and the universe switcher both live in `HeaderBar.tsx`. The prompt also says floating windows are a
"fixed width 960px", but the 960px is a prop the caller passes (App shell: 960 for workbench/audit
file, 720 otherwise), and the floating-window chrome is `FloatingWindow.tsx`, not a modal.
Options: (1) keep `display:none` and add a separate mobile header; (2) reflow the existing header so
every entry point stays reachable at every width; (3) convert the floating window to a mobile sheet.
Choice: option 2 for the header and a `min()` clamp for the window. The header gains a compact
search icon button (`sm:hidden`) beside the full field (`hidden sm:block`), and the profile menu
gains an `md:hidden` copy of the universe switcher so the same choice is offered where the inline
`hidden md:flex` switcher disappears. `FloatingWindow` renders
`width: min(<prop>px, calc(100vw - <right>px - 0.5rem))` so it can never clip off the left edge, and
`HeaderCalendarPanel` uses `w-[min(340px,calc(100vw-2rem))]`. The NavStrip already collapses labels
to icons below `sm`; no change was needed there.
Reason: option 1 duplicates the header and risks two divergent copies; option 3 changes the record
view interaction model that 17.1/27.5 and the 5C tests pin. A clamp keeps the desktop rendering
byte-identical (the `min()` selects the prop width whenever the viewport is wide enough) while making
375px usable, which is what "unhide and reflow" asks for.
How to reverse: `git revert` the D15 commit; the header returns to hiding both entry points below
their breakpoints and the window returns to a bare `width` style.

## D-D16-hold — irreversible actions require a hold, not a click

Task D16. Unclear point: the prompt says ~15 irreversible actions (sign-off, lock, publish, freeze,
approve) are single-click and should "use hold-to-confirm", but it does not say which component or
how existing tests that `fireEvent.click` these controls should adapt.
Options: (1) wrap each button in a confirm panel (a blocking modal — banned by §27.5); (2) add a
second click "Are you sure?" step; (3) reuse the existing `HoldToConfirm` control (press-and-hold,
in place, no scrim) and migrate the affected call sites.
Choice: option 3. `HoldToConfirm` was extended with optional `className`, `title` and `children` so
it is a drop-in for each existing `<button>`; the hold duration is 2000 ms for these consequential
actions (the component default stays 1200 ms). Call sites migrated: planning sign-off, population
lock, sampling lock, row-testing sign-off, conclusion sign, CAP register close, CAP inspector
confirm-close, report issue, workbench seal & attest, engagement-file sign-off, plan tab sign-off &
seal, Gantt approve-shift, entity approve, SIRA cycle publish, admin delete-role. A shared test
helper `src/test/holdToConfirm.ts` drives the control under fake timers; the six unit tests that
previously single-clicked these controls were updated to hold, and a dedicated
`HoldToConfirm.test.tsx` pins click-inert / early-release-inert / disabled-inert behaviour.
Reason: a hold is the spec-named non-blocking alternative to a modal and needs no extra screen, so it
satisfies the ban while still preventing a stray click from sealing a file. Reusing one component
keeps one implementation and one test helper.
How to reverse: `git revert` the D16 commit; every call site returns to its plain `<button>` and
`src/test/holdToConfirm.ts` plus `HoldToConfirm.test.tsx` are removed.

## D-D17-terms — "Observation", "Finding" and "Issue" are three different things

Task D17. Unclear point: the prompt says the code "mixes observation_card, finding_status,
issue_detail" and lists colours (blue/green/gold), but spec §11.2 forbids blue and orange and
assigns verdigris (calm/pass/sealed), cinnabar (exception/flag/overdue) and brass (money only).
Which wins, and how far does the rename go?
Options: (1) rename every identifier to the three words, including DB columns and RPCs; (2) rename
only user-visible copy and keep identifiers stable; (3) rename user-visible copy and the local
variables that name the wrong concept, but leave the schema and RPC names.
Choice: option 3, and the colour law wins over the brief's palette. An Observation is the draft
working record raised from testing; a Finding is concluded once it passes readability; an Issue is a
thematic group of findings. The draft action was mislabelled "Raise Formal Audit Finding" /
"Commit Finding" and the issue register was headed as if it held findings; both were corrected to
"Record Observation" and "Issues & CAP Register". Colours stay verdigris / cinnabar / brass — no
blue, no gold-as-finding, no orange.
Reason: option 1 would churn migrations and RPC signatures (`raise_finding`,
`raise_finding_from_result`) for no user benefit and would risk the SQL suite; the spec's §28 rule is
about language the user reads, so copy plus the misleading local names is the right scope. The colour
law is an explicit law (§11.2) and outranks a colour hint in a task prompt.
How to reverse: `git revert` the D17 commit; the labels return to the old wording. The guard test in
`src/guards/sourceGuards.test.ts` pins the distinction going forward.

## D-D18-sealed — "sealed" is the state, "sign off" is the action

Task D18. Unclear point: the prompt says replace "Formally Signed-Off" with "Sealed" and "signed off"
(adjective) with "sealed", but also says buttons become "Sign off and seal" — i.e. the verb "sign off"
survives in the action while the state word becomes "sealed". It also says to keep `signed_off_at`.
Options: (1) purge every occurrence of "sign off"/"signed off" including the action; (2) treat "sealed"
as the state and "sign off" as the action, and only rewrite strings where "signed off" is used as a
state/adjective; (3) also rename the `signed_off` status slug and `signed_off_at` column.
Choice: option 2. State/adjective strings became "sealed" (AuditFileModal badge, ExecutiveDashboard
subtitle, Gantt legend and status, ReviewTab note, RowTestingPanel note, ConclusionPanel preflight
and locked note, PlanningPanel note, ReportEditorPanel empty state, `workpaperLock` and `access`
reasons, AppContext ledger summaries, the demoSeed canary). Action buttons became "Sign off and seal
…". The `signed_off` status slug, `signed_off_at` column and `signOff`/`SignOffState` identifiers are
unchanged.
Reason: option 1 leaves the product with no word for the action the user performs; option 3 breaks
the database and the RPC contract for a cosmetic gain, and the prompt explicitly says to keep
`signed_off_at`. Option 2 matches the spec's separation of state from action and keeps the SQL layer
untouched.
How to reverse: `git revert` the D18 commit; the guard in `src/guards/sourceGuards.test.ts` (which
ignores slug-shaped `data-testid` values) must be reverted with it.

## D-D19-plain — screen copy says what it means, in words a new auditor knows

Task D19. Unclear point: the brief says to remove jargon ("Zero-Trust", "Attested on Hash-Chain",
"4-Eyes", "Internal Audit & Risk Governance OS") but some of those strings are also used in tests and
in the product's own marketing surface (README, index.html meta). How far does the sweep go, and do
internal identifiers move too?
Options: (1) rewrite every occurrence including code comments, test names and the README/meta;
(2) rewrite only user-visible screen copy and the plain reasons the UI shows, and leave comments,
test names, identifiers and marketing metadata alone; (3) also rename the ledger/hash identifiers.
Choice: option 2. Screen copy changed: the GlassBox portal subtitle, the Executive Cockpit eyebrow
("Audit Platform"), the sealed-papers hover ("Verified", "Ledger Verification"), the evidence vault
panel and its upload state, the sampling and analytics panel headings and badges, the workbench
"Sealed" badge and "Sign off and seal (second reviewer)" action, the review-trail heading, the review
dock tooltip, the record-content label and the "Segregation of duties" reasons in `access.ts` and
`orgCapabilities.ts`. Comments, test titles and the `ledger`/hash identifiers are unchanged; the
README and meta description still describe the hash-chained ledger for a technical audience.
Reason: option 1 would rewrite prose that is not on a screen and would churn test names for no user
benefit; option 3 breaks the ledger contract. The spec's plain-language rule is about what the user
reads on a screen, so that is the scope. "Four-eyes" was replaced with "Segregation of duties"
because that is the term the reasons already need to be defensible with, and it keeps the reason
readable to a reviewer who has never heard the shorthand.
How to reverse: `git revert` the D19 commit; the D19 guard in `src/guards/sourceGuards.test.ts` must
be reverted with it.

## D-D20-invite — the invite collects an email and a role, and queues the email itself

Task D20. Unclear point: the brief says to call `invite_user_capped` with an email, but the function
that exists (0015) takes only an email and writes only the cap ledger. The brief also wants a status
line "Invitation sent to user@org.com (no actual email yet; recorded in email_queue)". Three ways to
reach that: (1) change the RPC to take the email and the role, record both, and queue the email in
the same transaction; (2) leave the RPC alone and have the UI call it and then call `queue_email`
separately; (3) keep the UUID provisioning form and only relabel it.
Choice: option 1. `0048_admin_invite_email.sql` replaces `invite_user_capped(text)` with
`invite_user_capped(text, text default null)`; it validates the role against `roles` for the caller's
organisation, records the email (lower-cased) and the role slug in `invite_cap_events`, and calls the
one helper that may write the queue (`queue_email`, 6E / 0039) with the invitee copy. One nullable
column `invite_cap_events.role_slug` is added. The panel gets an "Invite a colleague" card (email
input, a `Select` of real role names, "Send invite", and the confirmation line); the old UUID form
moves into a collapsed "Provision an existing account" disclosure, because it is still the only way
to attach a role to an account that already exists.
Reason: option 2 splits one logical action across two round-trips, so a failed queue write would
leave an invite recorded but no email — a silent half-success. Option 3 does not solve the brief's
complaint (a non-technical administrator cannot find a UUID). Doing it in the definer RPC keeps the
cap check, the ledger write and the queue write atomic, and keeps every write behind the right
check that already exists. The role argument is optional and the old one-argument call still works
(tested), so 0015's own tests and any existing caller are untouched.
How to reverse: `git revert` the D20 commit, then drop `invite_cap_events.role_slug` and restore the
single-argument function if the ledger column is unwanted. The D20 test is
`supabase/tests/62_admin_invite_email.sql`; the panel test is
`src/components/admin/PeopleAdminPanel.test.tsx`.

## D-D21-next — dead ends become named next actions

Task D21. Unclear point: the brief lists five dead-end screens and says to "add contextual links or
buttons on every such screen", but several of the named screens do not exist as written (the review
dock is a dock, not a dead end; there is no "entity approval pending" screen separate from
`EntityApprovalPanel`). Two of the five need a decision the brief does not make:

1. **Planning reconciliation.** The brief says "show which risks don't match". The gate
   `check_planning_reconciliation` (0025) returns only a boolean, and the offending risk ids live
   inside `planning_sections.content->'risks'` while the SIRA side is `sira_scores`. Nothing in the
   app could name the mismatches without a new read.
2. **Deployment gate.** The brief says each outcome shows the next action. The panel already showed
   a `detail` sentence from the RPC, but no route to the screen where the fix happens.

Options: (1) hard-code the fix sentence in the component and stop there; (2) add a read RPC that
returns the mismatching risks, then route the buttons through `setActiveTab`/`openInspector`.
Choice: option 2. `0049_planning_reconciliation_detail.sql` adds
`planning_reconciliation_detail(uuid)`, a stable read that returns `reconciled`, `unmatched_planning`
and `unmatched_sira` with names; it copies the exact definition of a planning risk from
`check_planning_reconciliation` so the detail and the gate can never disagree (test 63 pins this in
both directions). The Planning banner names the mismatching risks and offers "Review the SIRA cycle"
(`setActiveTab('sira')`) and "Import risks and controls" (`openInspector('import_wizard')`). The
deployment gate gains a `NEXT_ACTION` sentence per outcome and buttons that route to the universe,
the plan, or a combined request. The combined panel now states who decides a pending request and
that it escalates on the SLA, and `EntityApprovalPanel` tells a waiting submitter who decides and
offers a "Check status" refresh. The population empty state gained the explicit "Upload a population
to begin sampling" line.
Reason: the brief's own words are "show which risks don't match"; a hard-coded sentence cannot do
that, and a boolean gate gives the screen nothing to name. The read RPC is the smallest object that
answers the question, it obeys "every DB call through src/data" (`reconciliationDetail` in
`src/data/planning.ts`), and it is a read, so a read-only principal may call it (test 63 asserts
that, and that another organisation cannot). Routing with the existing `setActiveTab`/`openInspector`
keeps one navigation model.
How to reverse: `git revert` the D21 commit; drop `planning_reconciliation_detail(uuid)` and delete
`supabase/tests/63_planning_reconciliation_detail.sql`. The panel tests are the new D21 cases in
`PlanningPanel.test.tsx`, `DeploymentGatePanel.test.tsx`, `PlanPanels.test.tsx` and
`EntityApprovalPanel.test.tsx`.


## D-D22-gates — one script for the pre-PR gates

Task D22. Unclear point: the brief lists six gates to run before the PR, but five of them already run
in CI and three of the six are also enforced as vitest guard files (`singleClient`, `noBlockingModal`,
`sourceGuards` for demo ids and Math.random). Running them by hand invites drift.
Options: (1) run each gate by hand and paste the output into the progress file; (2) add
`scripts/pre-pr-gates.sh` that runs the six in order and stops at the first failure.
Choice: option 2. The script runs tsc, vitest, build, the token check, the shrink check and the guard
tests. The two steps that need the hosted test project (SQL migrations/tests and Playwright) are not
in the script; they are CI steps 6 and 7 and their evidence is the CI run id. `npm run ci` already
chained five of the six; the script adds the guard run and is what the brief's checklist describes.
Reason: a single command that matches the checklist is the smallest way to make "the gates are green"
a fact rather than a claim, and it stops at the first failure so a red gate is never buried under a
later green one. The confirmations the brief asks for are already guards, not manual greps: no demo
tenant id (`provio-corp-tenant`), no `Math.random` outside tests, one Supabase client, no blocking
modal outside the `ConfirmPanel`/`FloatingWindow`/`RecordView` allow-list.
How to reverse: delete `scripts/pre-pr-gates.sh`; nothing else depends on it.

