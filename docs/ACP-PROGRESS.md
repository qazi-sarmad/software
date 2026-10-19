# ACP progress

Branch: `feature/board-ai-control-plane`. Base: `feature/config-control-plane` head `3678c93` (PR #10 open, so this branch stacks on it).

## H0 baselines (recorded 2026-10-19, before any ACP change)

| Metric | Baseline |
|---|---|
| vitest files | 75 |
| vitest tests | 791 |
| SQL test files | 63 |
| SQL assertions (one pass) | 1243 |
| migrations | 49 (next number **0050**) |
| SQL tests | 63 files, next number **64** |
| Playwright spec files | 12 |
| Playwright tests | 49 |
| check-tokens files scanned | 105 |
| check-shrink files verified | 58 |
| base branch CI run | 39203217570 green (all 7 steps) |

Local harness: PostgreSQL 17.11, database `provio_test`, `/tmp/auth_shim.sql` + `/tmp/run_sql_tests.sh`
(migrate x2, test x2). Both passes green at baseline.

## Tasks

| Task | Commit | CI run | Result | Notes |
|---|---|---|---|---|
| S0 housekeeping (xlsx vendoring, no-JSON guard) | 846c236 | 39241755386 | green | D-S0-xlsx, D-S0-scandirs, D-S0-json |
| S1.a db: control plane foundations | 3f1502b | 39244058813 | fixed | rights to 15 keys, config_areas, consultation, entitlements, wizards, tutorials |
| S1.a-FIX | a320de7 | (folded into S1.b run) | fixed | SQL test corrections |
| S1.b lib+data: ACP data modules | f33981a | 39244823463 | green | setup, consultation, tutorials, platformSettings, entitlements, featureMap |
| S1.c app: ACP screens, e2e, history read | da52b5f | 39252678614 | green | OrgControlPanel tabs, SetupWizard, ConsultationBanner, SuperAdmin panels, acp-control-plane.spec.ts |
| S1.d docs: decisions, progress, UI contract | da52b5f | 39252678614 | green | ACP-DECISIONS.md, ACP-PROGRESS.md, ACP-UI-CONTRACT.md |
| S2.a db: secrets, email, automation engine | 87c0757 | 39257108516 | green | 0054-0056; test 66 (31 assertions); fixed platform-blind notifications policy, digest schema, seed cleanup |
| S2.b lib+data: adapters, rules, templating | 08c5bcd | 39257108516 | green | 42 unit tests; emailAdapters in _shared |
| S2.c app: secrets, email, automation screens | 5b33321 | 39260101456 | fixed | SA-04/07/08, OA-11/12/13; component tests |
| S2.c-FIX: empty org id becomes null | 435a8ee | 39267810047 | green | D-S2c-empty-uuid; Playwright failure in 39260101456 resolved |
| S3.a db: invitation acceptance | 16a0df4 | 39267810047 | green | 0057 auth_invites, admin_accept_invite, invite_status; test 67 (24 assertions) |
| S3.b lib+data: invitation logic | 234847f | 39267810047 | green | _shared/invites.ts, 13 unit tests; inviteUser returns queue status |
| S3.c app: honest invite copy | 435a8ee | 39267810047 | green | "Invitation queued for", never "sent"; e2e clears auth_invites |
| S3.d docs: record S2.c fix and S3 green | e74d78e | 39267810047 | green | ACP-PROGRESS, ACP-DECISIONS |
| S4.a db: branding, report format, assets | edde814 | 39276190620 | green (local) | 0058 org_branding/branding_assets/branding_versions; test 68 (15 assertions) |
| S4.b lib+data: branding spec and renderers | b0b502d | 39276190620 | green (local) | src/lib/render (branding, pdf, pptx, qr), src/data/branding.ts, 18 unit tests |
| S4.c app: branding screens with live preview | f4f44c1 | 39276190620 | green (local) | OA-02/OA-03 OrgBrandingPanel, 5 component tests |
| S4.d docs: decisions, UI contract, PARITY | f479439 | 39276190620 | green (local) | D-S4-* decisions, OA-02/03 UI contract section |
| S5.a db: AI registry, deny-list, use cases, voice library | 5504084 | pending | green (local) | 0059_ai.sql; test 69 (24 assertions); ai_require_org_actor gates on has_feature |
| S5.b lib+data: SSRF, number guard, prompt assembly, data module | da477f2 | pending | green (local) | _shared/aiSsrf, aiNumberGuard, aiPrompt; 58 unit tests; src/data/ai.ts; featureMap ai_require_org_actor |
| S5.c app: AI settings, voice library, model registry | aded51f | pending | green (local) | OA-06/OA-07 OrgAiPanel, SA-06 SuperAdminAi; 8 component tests; e2e/s5-ai.spec.ts |
| S5.d docs: AI decisions, UI contract, progress | a09981f | pending | green (local) | D-S5-* decisions, OA-06/07 UI contract, progress row |
| S6.a db: escalation rules and Work Queue proposals | 563d57b | pending | green (local) | 0060_escalation.sql; test 70 (25 assertions); escalate action on the F7 engine; 3 platform template rules |
| S6.b lib+data: escalation logic and data module | fb1e613 | pending | green (local) | src/lib/escalation.ts, src/data/escalation.ts, 18 unit tests; featureMap escalation |
| S6.c app: escalation screen and Work Queue cards | fb612b2 | pending | green (local) | OA-13 OrgEscalationPanel (5 tests), WK-08 EscalationCards, e2e/s6-escalation.spec.ts; AI status vocabulary aligned |
| S6.d docs: escalation decisions and UI contract | c0b5212 | pending | green (local) | D-S6-* decisions, OA-13/WK-08 UI contract sections, tutorial keys |
| B-push-token resolved; branch pushed | a12be8d | 39290788312 | green | origin URL token is valid; GITHUB_TOKEN env var is stale |
| S7.a db: Board Pack snapshot, history and sections | fa520c0 | pending | green (local) | 0061_board_pack.sql; test 71 (36 assertions); figure-ref validation, canonical data_hash, ledger entry |
| S7.b lib+data: Board Pack model and data module | 7306601 | 39290788312 | green | src/lib/boardPack.ts (25 tests), src/data/boardPack.ts; row model, delta, drill-down URL, section visibility |
| S7.c app: Board Pack panel, generator and web view | 3454417 | 39292142326 | green (local) | WK-01 to WK-04, OA-09; BoardPackPanel, boardPackDocuments (12 tests), e2e/s7-board-pack.spec.ts; org_settings_extra_get/save |
| S7.d docs: Board Pack decisions, sources, UI contract and parity | 9428061 | pending | green (local) | D-S7-* decisions, docs/ACP-BOARD-PACK-SOURCES.md, OA-09/WK-01..04 UI contract, 5 tutorial keys |
| S8.a db: engagement certificate and public verification | e5c9504 | pending | green (local) | 0062_certificate.sql; test 72 (36 assertions); cert hash in DB, anon surface closed to exactly 2 functions |
| MID-JOB CORRECTION M-0 started at e5c9504 | e5c9504 | — | started | corrective build: M-1 red CI, M-2 secrets, M-3 email dispatch, M-4a ai-gateway, M-4b F25 coverage, M-5 report |
