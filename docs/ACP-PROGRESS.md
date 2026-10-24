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
| M-1 db: skip extension members in the anon-surface revoke | a64a061 | 39298253900 | fixed (local green) | 0062 revoke loop: pg_depend deptype='e' filter; test 72 counts non-extension functions only and reports the rest |
| M-2 db+lib+app: secret entry through an encrypted Edge Function | pending | pending | green (local) | 0063_secret_entry.sql (secret_store_ref, secret_vault_store, vault_id, drop secret_put); _shared/secretsCrypto.ts + 12 vitest; secrets-put Edge Function; src/data/secrets.ts; test 66 rewritten |

| M-2 db+lib+app: secret entry through an encrypted Edge Function | 3f980d1 | pending | green (local) | 0063_secret_entry.sql (secret_store_ref, secret_vault_store, vault_id, drop secret_put); _shared/secretsCrypto.ts + 12 vitest; secrets-put Edge Function; src/data/secrets.ts; test 66 rewritten |
| M-2 docs: secret-entry decisions and UI contract | 7717531 | pending | green (local) | D-M2-* decisions, OA-02/SA-04 secret-entry contract, tutorial keys |
| M-3 db+lib+app: email dispatcher and Graph OAuth | 5fd9c6d | 39314413666 | fixed (local green) | 0064_email_dispatch.sql (Vault dispatch token, pg_cron+pg_net every minute, platform Microsoft app registration, M7 repair of the 0056 SECURITY DEFINER guard); email-dispatch + graph-oauth Edge Functions; _shared/emailDispatchLoop.ts, _shared/graphOAuth.ts + 2 vitest files; test 73 (19 assertions) |
| M-3-FIX app: wait for the report panel to settle before holding | b1306be | pending | green (local) | test-only; 6H "issues the report" held the button before ReportEditorPanel's second load finished (CI 39314413666). No production code touched |
| S7-FIX app: reach the Board Pack as the CIA and seed its sections on read | d32ef00 | 39368904522 | fixed (local green) | spec signed in as the Org Admin, which by F3 holds none of the four assurance rights and no audit tab; now signs in as the CIA. listBoardPackSections seeds the F10 defaults on first read, so a fresh tenant's Sections tab is populated |
| M-4a lib+app: the AI gateway, the number guard and AiAssist | 13f7161 | d32ef00 CI | green (CI) | supabase/functions/ai-gateway + _shared/aiGateway.ts, 14 vitest; WK-07 AiAssist component + 7 tests; wired into the observation editor |
| M-4b db+app: retrofit the feature gate into nine feature RPCs | 629d721 | pending | green (local) | 0065_feature_gates.sql (9 functions: board_pack_snapshot, board_pack_sections_save, certificate_config_save, certificate_revoke, verify_certificate, ai_call_log, automation_rule_save, automation_rule_test, escalation_evaluate); test 74 (feature off refuses, on restores, no data loss); featureMap + certificate_config_save; test 71 grants board_pack first |
| S8.b lib+data: certificate model and data module | 1346282 | pending | green (local) | src/lib/certificate.ts (27 tests), src/data/certificate.ts (3 tests); canonical_value mirror, status labels, enabled-field ordering, public verify URL |
| S8.c app: certificate panel, public verification page and the anon-grant guard | cf4ab52 | 39379614007 | green (local) | WK-05 CertificatePanel (5 tests), WK-06 PublicVerifyRoute (5 tests), /verify/:id and /pack/:id outside the auth guard, Audit File Certificate view; src/guards/anonGrantAllowList.test.ts (6 tests); e2e/s8-certificate.spec.ts |
| S8.d docs: certificate decisions, UI contract and parity | this commit | 39379614007 | green (local) | D-S8-* decisions (4), WK-05/WK-06 UI contract, PARITY S8 row, NOT-DONE narrowed to S9-S13 |
| S9.a db: external auditor portal tables, ext_ RPCs and the zero-read proof | 69532f5 | pending | green (local) | 0066_external_auditors.sql; test 75; ext_* security-definer family logs every call and raises nothing on refusal; external_auditor role excluded from roles/orgs/findings/issues/cap_items/notifications/severity_levels; token stored as sha256 only; grants table has no write policy |
| S9.b lib+data: external auditor model, data module and feature map | 5491e56 | pending | green (local) | src/lib/externalAuditors.ts (permission matrix, expiry copy, signup hint; 20 tests), src/data/externalAuditors.ts (typed module, components never import the client); featureMap external_auditors |
| S9.c app: external auditor panel, portal, acceptance page and routes | 4ac6cd7 | pending | green (local) | OA-14 ExternalAuditorsPanel (6 tests), EX-01 ExternalAuditorAccept, EX-02..04 ExternalAuditorPortal, /external and /external/accept routes outside the tenant shell, external_auditor auth status, invite-user accept-external action; e2e/s9-external-auditor.spec.ts; global-setup seeds the auditor, grant and entitlement |
| S9.d docs: external auditor decisions, UI contract, parity and not-done | 30982c0 | 39386066582 | green (local) | D-S9-* decisions (5), OA-14 and EX-01..04 UI contract sections, PARITY S9 row, NOT-DONE narrowed to S10-S13 |
| R-1a lib: inject the AI gateway handler and add the failing authorisation cases | a7fb323 | 39397989353 | green (CI) | _shared/aiGatewayHandler.ts (deps injected), index.ts rewired, src/lib/aiGatewayHandler.test.ts 5 cases; 3 of 5 red against the old handler |
| S9-FIX app: wait for the tenant shell before opening /external | 2b0a770 | 39397989353 | green (CI) | test-only; e2e/s9-external-auditor.spec.ts used signIn then goto, which raced the session write (CI 39393636028 step 7). No production code touched |
| R-1b db+ops: the AI gateway authorises the caller and the org | 9686fbb | 39397989353 | green (CI) | 0067_ai_gateway_authorise.sql + test 76; getUser + ai_gateway_authorise before the service client; TDZ crypto line removed; M6 double-apply green (76/76 twice) |
| R-1c lib: map ai_gateway_authorise to ai_assist | 59b8762 | 39397989353 | green (CI) | src/lib/featureMap.ts; featureMapCompleteness guard green (vitest 118 files / 1307 tests) |
| R-1d docs: R-1 decisions, blocker records and progress rows | 4f4ba08 | 39400695720 | green (CI) | D-R1-* decisions (5) + D-R1-s9-fix; blockers record the TDZ defect, the S9 race, and B-credentials-outage already resolved |
| S10.a db: time-travel as-of reconstruction and pattern settings | b7e2798 | 39411022404 (with S10.b) | green (CI) | 0068_time_travel_patterns.sql + test 77; engagement_as_of, engagement_as_of_events, pattern_settings_get/save, pattern_findings; feature keys time_travel/patterns already seeded (0051); M6 double-apply 77/77 twice |
| S10.b lib+data: deterministic patterns clustering and as-of timeline logic | 1d3d73a | 39411022404 | green (CI) | src/lib/patterns.ts (TF-IDF, seeded layout, heatMap), src/lib/asOfTimeline.ts, src/data/patterns.ts, src/data/timeTravel.ts; unit tests |
| S10.c app: Time-Travel timeline, Patterns view, finding drill-down | 1de3a55 | 39416981015 | fixed | WK-09 AsOfTimeline, WK-10 PatternsPanel, FindingDrilldown; finding added to InspectorType/RECORD_TYPE_TO_INSPECTOR/recordTypeToPath and routed at /view/finding/:id; CI step 7 red, fixed in S10-FIX |
| S10-FIX app: clickable graph nodes and the entitlement spec moved off patterns | 008f322 | 39428654015 | green (CI) | transparent r=16 hit circle + role=button/keyboard on wk-patterns-node-*; acp-control-plane.spec.ts now toggles board_pack_pptx |
| S10.d docs: S10 decisions, UI contract, tutorials, parity and not-done | (this commit) | (see below) | pending | D-S10-* decisions (6), OA-21/WK-09/WK-10 UI contract sections, oa.timetravel + oa.patterns tutorial rows, PARITY S10 row, NOT-DONE narrowed to S11-S13 |
| S11.a db: hosting fit catalogue, migration jobs and the ledger-copy guard | 9432deb | 39431010424 | green (CI) | 0069_hosting_fit_migration.sql + test 78; hosting_stack_catalogue, hosting_fit_rules, hosting_connections, migration_jobs, migration_steps; hosting_fit_get/save, hosting_connection_save/list/set_secret, migration_job_create/list; ledger_copy_mode_ok + the inlined bypass in the chain trigger; FK order fixed (child tables after parents); revoke-then-grant satisfies the anon-grant guard; M6 double-apply 78/78 twice |
| S11.b lib+data: hosting fit verdicts, migration runner steps and data module | 557b571 | 39431010424 | green (CI) | src/lib/hostingFit.ts (evaluateFit/searchStacks/requiredChecklist; 23 tests), src/data/hostingFit.ts (typed module; password only through secrets-put), featureMap hosting_migration keys, tools/migration-runner/ (11 driver-injected steps; 10 node --test) |
| S11.c app: hosting fit / rules, migration jobs, deployment kit and the org hosting panel | (this commit) | (see below) | pending | SuperAdminHosting (SA-10/SA-11; 5 tests), SuperAdminMigration + DeploymentKitPanel (SA-12), OrgHostingPanel (OA-15; 5 tests); SA portal tabs hosting/migration; Org control tab hosting; e2e/s11-hosting-migration.spec.ts |
| S11.d docs: S11 decisions, UI contract, tutorials, parity and not-done | (this commit) | (see below) | pending | D-S11-* decisions, SA-10/SA-11 + SA-12 + OA-15 UI contract sections, sa.hosting-fit/sa.hosting-rules/sa.migration + oa.hosting/oa.migration/oa.deployment-kit/oa.retire-old tutorial rows, PARITY S11 row, NOT-DONE narrowed to S12-S13 |
| S11-FIX db+app: restore the seeded RAM rule and stop graph labels swallowing clicks | 833028d | (see below) | pending | test 78 restored size.ram.warning (M5 residue made the app AMBER); Patterns graph labels pointer-events-none (neighbour label intercepted the node click); CI 39432089966 step 7 red both |
| S10-FIX db+seed: close the engagement_as_of_events cross-tenant leak and open the fixture engagement | 7c8d8a4, (this commit) | 39465462476 green (seed fix) | seed fix green (all 12 steps, Playwright included); 0070_time_travel_events_guard.sql + test 79 guard engagement_as_of_events (feature, org/scope, right) exactly like engagement_as_of — it was SECURITY DEFINER, granted to authenticated, browser-called and unguarded (L2 leak); D-S10-FIX-seed-bridge + D-S10-FIX-events-guard |
| S12.c app: a "Show me how" tutorial button on every config screen, with first-visit autoplay | e730d83 | (folded into the S12 run below) | green (local) | TutorialButton wired into OrgControlPanel, SuperAdminPortal, PatternsPanel, AsOfTimeline, BoardPackPanel, CertificatePanel; autoplay once via localStorage acp.tutorial.seen.<key>; TutorialButton.test.tsx (4); e2e/s12-tutorials.spec.ts; acp-control-plane.spec.ts fresh contexts pre-seed AUTOPLAY_OFF |
| S12.a db: seed the tutorial registry for every Appendix A key | 5fbc905 | (see S12.d run) | green (local) | 0071_tutorial_registry_seed.sql seeds 85 rows (on conflict do nothing, M2-safe); test 80 proves every key has a complete row, both audiences read the registry, re-apply changes nothing; M6 double-apply 80/80 twice |
| S12.b lib: freeze the Appendix A tutorial keys in one registry | e17ef72 | (see S12.d run) | green (local) | src/lib/tutorialKeys.json (85 keys) as single source of truth; tutorialKeys.ts typed loader; tutorialKeys.test.ts (no duplicates, well-formed, both wizards' nine steps) |
| S12.d ops: the tutorial recorder, the check-tutorials gate and the 85 GIFs | 723a33d | 39502753545 | steps 1-7 green (step 8 red: the over-broad dialog assertion, fixed in S12-FIX) | scripts/record-tutorials.mjs (Playwright + gifenc + pngjs, no ffmpeg; placeholders without TUTORIALS_BASE_URL), scripts/check-tutorials.mjs, 85 GIFs under public/tutorials, CI step 6 + pre-pr-gates step 6 |
| S12.d docs: S12 decisions, UI contract, tutorials, parity and not-done | c4e2c74, 85fe744 | 39510252877 green | green | D-S12-* decisions (3), TUT-01 autoplay section, ACP-TUTORIALS key-list section, PARITY S12 row, NOT-DONE updated to S13; the run record + blocker committed on 85fe744 |
| S12-FIX app: the tutorial drawer assertion targets a modal, not any dialog | a63acb9 | 39506774584 green | green | the S12 spec asserted zero [role="dialog"] page-wide, but the Org Control panel legitimately opens in a non-blocking FloatingWindow (allow-listed role="dialog", no aria-modal); now asserts role="complementary" + zero [aria-modal="true"]. Test-only change. All 8 gates green: tsc, vitest 128 files/1428 tests, build, tokens, shrink, tutorials, SQL 80 files/71 migrations/1683 ok notices applied twice, Playwright 113 passed / 2 skipped |
| S12.d docs: the ACP report | b01c4b2 | 39513828455 green | green | docs/ACP-REPORT.md written (PR status, per-task table, S12 detail, blockers, decisions, real counts vs H0, NOT DONE, owner actions F23, tutorial/Edge commands); all 8 gates green |

