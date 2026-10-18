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
| D10 CAP register in Issues tab | (pending) | (pending) | green (local) | Issues & CAP tab renders the existing CapRegisterPanel per engagement + picker; 3 unit tests; 741 tests |
