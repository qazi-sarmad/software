# Overnight build D1-D23 progress

Branch: `feature/config-control-plane`. Base commit at start: `45b56ac`.
Numbering lock: new migrations start at **0046**; new SQL tests start at **59**.
Baseline counts at start: 65 vitest files, 58 SQL tests, 11 Playwright spec files (54 tests).

| Task | Commit | CI run | Result | Notes |
|---|---|---|---|---|
| D1 XLSX security | 083d48e | 39150045854 | green | xlsx 0.20.3 from vendor CDN; npm audit 0 vulnerabilities; D-D1-xlsx |
| D2 team_role_rights RLS | ec6ec91 | 39150503662 | green | migration 0046 + test 59; harness 1106 assertions x2 passes |
| D3 superadmin blindness | f3ed7db | 39150688512 | green | test 60; harness 1215 assertions x2 passes |
| D4 no-tenant fallback | a748055 | 39150989815 | green | AuthContext status + NoTenantScreen + EMPTY_SEED prod fallback; 715 tests |
| D5 demo clock injection | 2fbc7ce | 39152873058 | green | src/lib/demoTime.ts + 5 call sites; 722 tests |
| D6 ethics acknowledgement wiring | e9e27b7 | 39156011100 | green | EthicsPanel handler via acknowledge_ethics + ethics_status refetch; 724 tests |
| D7 combined approval entity picker | f0564f1 | 39156011100 | green | scoped entity picker + empty state; 727 tests |
| D8 deploy action in gate flow | ff1c9d1 | 39156011100 | green | hold-to-confirm deploy + entity picker; 730 tests |
| D9 persist plan date changes | a594058 | 39156011100 | green | migration 0047 `update_plan_item_dates`; test 61; Gantt drag→approve→persist; 741 tests; D-D9-rpc, D-D9-apply; D9-FIX aligned the phase3 e2e to the D7 picker |
| D10 CAP register in Issues tab | 844c01c | 39159142589 | green | Issues & CAP tab renders the existing CapRegisterPanel per engagement + picker; 3 unit tests; 741 tests |
| D11 remove retest workflow | bb7fe31 | 39159731923 | green (CI) | deleted RetestStatus axis, cap_fail_retest capability, fail_retest action, Re-Test column, Fail Re-Test panel; source guard added; 752 tests; D-D11-retest |
| D12 Work Queue user-specific | 026a943 | 39161290344 | green (CI) | src/lib/workQueue.ts (pure) + PendingTasksTab rewired to My workpapers / Awaiting my sign-off / Awaiting my approval / My team's work; 8 new tests; 752 tests; D-D12-queue |
| D13 HoverPreview keyboard | 0329d18 | (pending) | green (local) | onKeyDown fires onClick on Enter/Space + aria-disabled; 4 new tests; 756 tests; D-D13-keyboard |
| D14 readable disabled reasons | 4801e4e | (pending) | green (local) | src/lib/rightLabels.ts + replacements across 15 files; source guard; 6 new tests; 762 tests; D-D14-rights |
| D15 mobile widths | (pending) | (pending) | green (local) | HeaderBar compact search + mobile universe switcher; FloatingWindow min() clamp; HeaderCalendarPanel clamp; 4 new unit tests + e2e/responsive.spec.ts; 766 tests; D-D15-responsive |
| D16 hold-to-confirm | (see log) | (pending) | green (local) | src/test/holdToConfirm.ts + HoldToConfirm; irreversible actions require a hold; D-D16-hold |
| D17 terminology | 2c8a394 | (pending) | green (local) | Observation / Finding / Issue kept distinct in copy; guard in sourceGuards.test.ts; 774 tests; D-D17-terms |
| D18 sealed terminology | 5dc83a4 | (pending) | green (local) | "sealed" is the state, "sign off" is the action; guard added; 775 tests; D-D18-sealed |
| D19 plain-language copy | 2f0d0c5 | (pending) | green (local) | removed Zero-Trust / Hash-Chain / 4-Eyes / Risk Governance OS from screen copy; D19 guard; 776 tests; D-D19-plain |
| D20 email-based admin invite | (this commit) | (pending) | green (local) | migration 0048 invite_user_capped(email, role) + role_slug column + queued invite email; invite card in PeopleAdminPanel; test 62; 779 tests; D-D20-invite |