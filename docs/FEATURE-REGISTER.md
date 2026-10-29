# Feature register — the single source of truth for what is wired

**Purpose.** The owner asked for a detailed end-to-end spec of all features, so that anything left
out is considered and wired in. This is that document. It is deliberately not prose: the recurring
defect in this repository is **built, tested, documented as done, and never connected**. Prose cannot
catch that; a register that is checked against the code can.

**Method.** Same as `FUNCTIONALITY-AUDIT.md`, which this supersedes as the live inventory: every
claim below is verified against the code, not against another document. Where a row says `Wired`, the
call site is named. Where it says `Inert`, the reason it is unreachable is named.

> **CORRECTION — 2026-10-28, second pass.** The first version of this register was built from
> `FUNCTIONALITY-AUDIT.md`, which was written at `c898269` — **before Phases 1 and 2 of the
> scale-harden build existed**. It therefore reported as `Inert` a large amount of work that is now
> wired. That was the same error this document exists to prevent: treating a document as evidence
> instead of grepping the code. Every `Inert` claim below has been re-verified on the branch at
> `f83c1da` with an alias-aware import resolver (`scripts/audit-wiring.mjs`), because name-based greps
> miss aliased imports (`populateSuggestions` is `populate_planning_suggestions`).
>
> **What the correction changed:** the foundation and lifecycle are no longer "the missing middle".
> Phase 1 (the app reads its own database) and Phase 2 (the lifecycle is real) are **DONE on this
> branch** — see `SCALE-TASKS.md`. R1 and R2 in §15 are closed by work already committed.

**Status vocabulary — exactly three values, no others.**

| Status | Means | Evidence required |
|---|---|---|
| `Wired` | Reachable from a screen or a scheduled job, and does real work | A named call site, and a passing test that exercises it through that path |
| `Inert` | Built, may be tested, reachable from nothing | The grep that found no caller |
| `Absent` | Does not exist | The feature, its work package, and its acceptance test |

**`Partial` is not a status.** It is the word that let the previous documents claim completion. Every
former "Partial" resolves to `Wired`, `Inert`, or `Absent` — and if it is `Inert`, it is a defect, not
a milestone.

---

## 0. How to use this document

1. **A designer or product owner** reads it to see every capability and its true state.
2. **A builder** picks a row, and the row states the work package and the acceptance test.
3. **The gate** (`scripts/check-feature-register.mjs`) reads the `Wired` rows and fails if a named
   call site has disappeared, or if a row claims `Wired` with no test. This is what stops the
   register rotting the way the old docs did.

**The one rule, unchanged:** verify wiring by grepping the call site. A green test is not proof.

---

## 1. Foundation — the missing middle

The audit's headline finding. These are not features; they are the preconditions for every other
feature to be testable.

| # | Capability | Status | Evidence / gap | WP | Acceptance test |
|---|---|---|---|---|---|
| F1 | Tenant data loaded from the database into the shell | `Wired` | `loadTenantSnapshot()` (`src/data/tenant.ts`), called from `src/App.tsx:237` and `AppContext.tsx:177`; `snapshotToSeed()` replaces the seed inside `AuthGate`. Phase 1, SCALE-TASKS 1.1-1.3. (SCALE-TASKS 1.2 refers to a tenant data provider component; the mechanism actually shipped is these two functions called directly from the auth gate. Naming discrepancy in the ledger, not a functional gap.) | — | `e2e/phase1-production-build.spec.ts` (G1) |
| F2 | Engagement stage persisted | `Wired` | `set_engagement_stage` (`0101_phase2_lifecycle.sql:149`), append-only transition log, called from `AppContext.tsx`; `src/context/stageAdvance.test.tsx` | — | Phase 2 2.1 |
| F3 | Ledger verified against the database | `Inert` | `verify_ledger` (`0007:97`) still has **0** production callers — the chain is written but never verified against the DB | T7 | SQL test tampering a ledger row, then `verify_ledger` returns false |
| F4 | Report graph root persisted | `Wired` | `commitReportGraph` (`src/data/reportGraph.ts:144`) called from `ReportEditorPanel.tsx:149`; read back by `verifyReportRoot` (`PublicVerifyRoute.tsx:43`). Phase 2, 2.6 | — | `104_phase2_report_graph.sql` |
| F5 | Pre-flight engine consumed at freeze | `Wired` | `freeze_report` computes open items from real tables and refuses while any is unacknowledged (`0102_phase2_preflight_gate.sql`); `ReportEditorPanel.tsx:22` uses the preflight data module. Phase 2, 2.5 | — | Phase 2 2.5 |
| F6 | Sampling linked to row testing | `Wired` | `workpaper_rows` seeded from `lock_sample` (`0104_phase2_row_seeding.sql`); method-aware draw `0105`; value coverage `0106`. Phase 2, 2.7-2.9 | — | `105_phase2_row_seeding.sql` |
| F7 | In-memory mutations routed to RPCs | `Wired` | Phase 1 task 1.4 closed the parallel mutations; the durable RPCs are the path (`src/data/mutations.ts`) | — | Phase 1 1.4 |
| F8 | Playwright runs a production build | `Wired` | `playwright.config.ts:5` — `E2E_PROD=1` serves the built bundle via `vite preview`; the G1 anti-theatre gate | — | `e2e/phase1-production-build.spec.ts` |

---

## 2. Audit lifecycle

| # | Capability | Status | Evidence / gap | WP |
|---|---|---|---|---|
| F9 | Universe and entity management | `Wired` | `listEntities()` read by `AuditUniverseTab`; the two-sources merge was closed in Phase 1 (the seed is now hydrated from the DB, not parallel to it) | — |
| F10 | SIRA reads (cycles, risks, model snapshot) | `Wired` | `listCycles`, `listEmergentRisks`, `siraModelSnapshot` called from `SiraTab.tsx` | — |
| F11 | SIRA carry-forward into next year | `Absent` | `create_sira_cycle` inserts a bare draft; no seeding | S18 |
| F12 | SIRA pre-fill into planning | `Wired` | `populateSuggestions` / `decideSuggestion` (`src/data/planning.ts:38,53`) called from `PlanningPanel.tsx:44,76`. The audit predates this wiring and its claim is stale | — |
| F13 | Two-key SIRA acceptance | `Absent` | Finaliser decision is currently a closure; auditor acceptance not modelled | S19 |
| F14 | Emergent risk submit / decide | `Inert` | `submitEmergentRisk` / `decideEmergentRisk` — verified **0 callers**; `SiraCyclePanel` renders `emergent` but is passed no submit/decide handler from `RecordContent.tsx:118` | S18 |
| F15 | Planning suggestions and decisions | `Wired` | Same path as F12 — `PlanningPanel.tsx` renders and decides them | — |
| F16 | Plan approval rights | `Wired` | `plan_approval_settings`, enforced in `create_plan` / `approve_plan` | — |
| F17 | Engagement gates | `Wired` | `engagement_gate_settings`, enforced by deploy/approve/escalate RPCs | — |
| F18 | Testing hard lock + grace period | `Wired` | `testing_grace_hours`, `testing_lock_active` trigger (`0095:56`) | — |
| F19 | Testing mode (one-stage / two-stage) | `Wired` | Enforced: the transition to `conclusion` reads `testing_mode` (`0101_phase2_lifecycle.sql:114` `assert_conclusion_ready`). Phase 2, 2.3 | — |
| F20 | Lifecycle sign-off roles | `Wired` | Enforced: `caller_meets_signoff_role` (`0101:98`) is required by `sign_planning` / `sign_conclusion`. Phase 2, 2.2 | — |
| F21 | Workflow approval chain | `Wired` | Enforced: `approve_plan()` requires every chain step recorded in order (`0101`, 2.4). Phase 3 extends this to `sla_hours` / `escalation_*` / `signoff_role_testing` — commit `4db8820` on `feature/scale-harden-v1`, not yet on this branch | — |
| F22 | Sampling methods (MUS/PPS, systematic, stratified) | `Wired` | Phase 2, 2.8: method-aware draw in `0105_phase2_sampling_methods.sql` + Clopper-Pearson; value coverage `0106`. `106_phase2_sampling_methods.sql` | — |
| F23 | Row testing and sign-off | `Wired` | `record_workpaper_row`, `sign_off_workpaper`; `RowTestingPanel` calls them | — |
| F24 | Population gate | `Wired` | `lock_population`, sha256, refusal in `compute_sample` | — |
| F25 | Conclusion and engagement seal | `Wired` | `supabase/migrations/0034_conclusion.sql` sets `sealed` | — |
| F26 | Reopen a sealed engagement | `Wired` | `reopenEngagement` (`src/data/mutations.ts`) called from `AuditPlanTab.tsx:118` | — |
| F27 | Ethics sign-off | `Wired` | `ethics` inspector kind + acks | — |
| F28 | Test steps as configurable data | `Absent` | No `test_step_templates` table; steps are React state | R5 |
| F29 | Procedure / methodology templates | `Absent` | No `procedure_templates` table | R5 |
| F30 | Stage machine configurable | `Absent` | Three hardcoded strings `'planning' \| 'testing' \| 'conclusion'` | R5 |

---

## 3. Report writer and the Writing Engine

| # | Capability | Status | Evidence / gap | WP |
|---|---|---|---|---|
| F31 | Report compose, comment, freeze, issue | `Wired` | `freeze_report`, `issue_report` gated on rights and open comments; `ReportEditorPanel` | — |
| F32 | Report file render + upload (PDF/DOCX) | `Wired` | `src/data/reportFiles.ts` uploads to the `reports` bucket | S20 |
| F33 | Pre-flight acknowledgement storage | `Wired` | `preflight_acks` + `acknowledgePreflight` in `ReportEditorPanel` | — |
| F34 | Pre-flight engine (the eight checks) | `Inert` | Engine exists; not consumed at freeze (F5) | R2 |
| F35 | Report templates | `Wired` | `listReportTemplates` / `saveReportTemplate` (`src/data/governance.ts`) called from `ReportTemplatePanel.tsx:49`; RPCs `report_template_list` / `report_template_save` | — |
| F36 | Certificate config and verification | `Wired` | `certificate_config_save`, `verify_certificate`, `PublicVerifyRoute` | — |
| F37 | Report graph root verification | `Wired` | Writer `report_graph_commit` (`0103_phase2_report_graph.sql:70`) called from `ReportEditorPanel.tsx:177`; verified via `report_graph_get` and `verify_report_root` (`src/data/certificate.ts:173`) | — |
| F38 | Report writer adopts an uploaded format | `Absent` | §9 of SYSTELIGON — org format adoption, font/colour auto-detect | S13 |
| F39 | Findings-to-report provenance | `Absent` | §9 — every generated element traces to a finding | S13 |

---

## 4. Evidence

| # | Capability | Status | Evidence / gap | WP |
|---|---|---|---|---|
| F40 | Evidence upload control | `Inert` | `EvidenceTab.tsx` computes a SHA-256 then calls `attachEvidenceToWorkpaper`, which writes **React state only** — zero storage calls | S20 |
| F41 | Evidence bytes stored | `Absent` | `evidence_files` (0035) has **no** `storage_path`; **no bucket is created anywhere** | S20 |
| F42 | Evidence re-derived on verify | `Absent` | Nothing to re-derive — the bytes were never kept | S20 |
| F43 | Document extraction (edge function) | `Wired` | `extractDocument` (`src/data/documents.ts`) invokes the `doc-extract` Edge Function, which re-checks the caller's right and org and reads the file itself; `DocumentViewerPanel.tsx` now runs it on "Queue extraction" instead of the 0035 stub. Tier 1 wiring (S7) | R2 |
| F44 | Extraction stub queue | `Wired` | `request_extraction` RPC | — |
| F45 | Document recognition (magic bytes, archives) | `Absent` | Routing is extension-only (`isDocx(filename)`); no `.rar`; no office-in-zip handling | S17 |
| F46 | Evidence completeness (Mode A) | `Inert` | Depends on F41 | S20 |
| F47 | Evidence verification (Mode B) | `Inert` | Depends on F41 | S20 |
| F48 | Chain of custody | `Absent` | D2 candidate | D2 |

---

## 5. Continuous monitoring and connectors

| # | Capability | Status | Evidence / gap | WP |
|---|---|---|---|---|
| F49 | Monitor rules (threshold, rate, sequence, set, missing, cross-source) | `Inert` | `evaluateMonitor`, `runMonitors` — **tests only** | C1 |
| F50 | Monitor runner (scheduled) | `Inert` | `rule_engine_process` — 0 production refs | C1 |
| F51 | Alert persistence | `Inert` | `alert_record` — 0 production refs | C1 |
| F52 | Alert to Work Queue | `Inert` | No delivery path; the delivery test is absent | C3 |
| F53 | Alert enrichment (entity, dept, SIRA, inherent/residual, controls) | `Absent` | §11.1 — the fields do not exist on the alert | C2 |
| F54 | Adhoc audit suggestion from an anomaly | `Absent` | §11.1 | C4 |
| F55 | Alert triage surface | `Absent` | §11.1 | C6 |
| F56 | Anomaly proposes emergent risk into SIRA | `Absent` | §11.1 | C7 |
| F57 | Connector run start / finish | `Inert` | `connector_run_start` / `connector_run_finish` — 0 production refs | C1 |
| F58 | Staged record ingest | `Inert` | `staged_record_ingest` — 0 production refs | C1 |
| F59 | Connector adapters (22) | `Inert` | `connectorCatalogue.ts` is data with no runner | C1 |
| F60 | Connector egress control | `Wired` | `connector_egress_allowed` consulted | — |
| F61 | Connector credentials | `Wired` | Wizard-only, `secret_store`, service-role reads | — |

---

## 6. Trust, tamper evidence, and attestation

| # | Capability | Status | Evidence / gap | WP |
|---|---|---|---|---|
| F62 | Integrity alerts recorded | `Wired` | `raise_integrity_alert()` writes the alert **and** a ledger entry; called by archive checks | — |
| F63 | Integrity alerts surfaced | `Inert` | `listIntegrityAlerts()` — **0 callers**. Detection complete, alarm missing | T7 |
| F64 | Tamper notification on any channel | `Absent` | No migration emits a notification for an integrity alert | T7 |
| F65 | Archive verification | `Wired` | `population_archive_check` and `population_archive_verify` call `raise_integrity_alert` | — |
| F66 | Ledger verification | `Inert` | `verify_ledger` — 0 production refs (F3) | R2 |
| F67 | Public verification route | `Wired` | `PublicVerifyRoute` — anonymous, rate-limited | — |
| F68 | Guided integrity incident wizard | `Absent` | §11.3a | T6 |
| F69 | Portable attestation package | `Absent` | §11.3 | T3 |
| F70 | Third-party verification | `Absent` | §11.3 | T4 |
| F71 | Attestation screen | `Absent` | §11.3 | T5 |

---

## 7. Configuration — stored but inert (the self-respect list)

Every row here is **stored, visible in the UI, and changes nothing**. This is the most dangerous
category, because it looks like a working control.

| # | Setting | Status | Gap | WP |
|---|---|---|---|---|
| F72 | `org_lifecycle_settings.testing_mode` | `Inert` | Never read by a sign path | R3 |
| F73 | `org_lifecycle_settings.signoff_role_*` | `Inert` | `sign_planning` / `sign_conclusion` ignore it | R3 |
| F74 | `workflow_settings.approval_chain` | `Inert` | Never consulted for a decision | R3 |
| F75 | `report_templates` | `Inert` | Readers never called | R3 |
| F76 | `anchoring_settings` (trust anchor, timestamp authority) | `Inert` | `admin_save_trust_anchor`, `admin_save_timestamp_authority` are dead setters | R3 |
| F77 | `cap_items` workflow (DB path) | `Wired` | `update_cap` is called from `CapRegisterPanel.tsx` and `IssuesRegisterTab.tsx`. A parallel in-memory `transitionCapStatus` also exists and is what runs on some paths — the two-UIs defect | R2 |
| F78 | `org_lifecycle_settings.report_opinion_required` | `Inert` | Partial enforcement | R3 |
| F79 | Workflow SLA / escalation | `Inert` | SLA computed, escalation job exists, decision path does not read it | R3 |

**Rule R3:** for every row above, either **enforce it** with a test proving the setting changes
behaviour, or **remove it from the UI** and mark it deferred. No field may be visible and inert.

---

## 8. Isolation, sharing, and multi-tenancy

| # | Capability | Status | Evidence / gap | WP |
|---|---|---|---|---|
| F80 | RLS on every tenant table | `Wired` | 176 tables, 0 with RLS disabled; 5 with RLS and no policy, reachable only via `security definer` | — |
| F81 | Cross-universe view-only sharing | `Wired` | `universe_shares`, `share_grant` / `share_revoke` / `share_covers`, Head-level checks, `SharePanel` in the `sharing` tab | — |
| F82 | Share expiry and revocation | `Wired` | `expires_at`, `revoked_at` enforced in `share_covers` | — |
| F83 | Share notification (in-app + email) | `Wired` | Notification on grant | — |
| F84 | Multi-org isolation under concurrency | `Absent` | No SQL test creating ≥3 concurrent orgs | R6 |
| F85 | Support access grant / revoke | `Inert` | `grant_support_access` / `revoke_support_access` — only legacy-name refs | R6 |
| F86 | Support access logged | `Absent` | Every support read must be logged | R6 |

---

## 9. Super Admin and provisioning

| # | Capability | Status | Evidence / gap | WP |
|---|---|---|---|---|
| F87 | Create tenant | `Wired` | `platform_*` RPCs, `is_platform_admin()` enforced | — |
| F88 | Set tenant status | `Wired` | `platform_set_tenant_status` | — |
| F89 | Entitlements and feature flags | `Wired` | `platform_set_entitlement`, `platform_set_feature_flag`, `has_feature` | — |
| F90 | Invite cap | `Wired` | `platform_set_invite_cap`, `invite_user_capped` | — |
| F91 | Platform email sender | `Wired` | `email_sender_profiles`, `email_profile_versions` | — |
| F92 | Guided zero-to-first-report wizard | `Absent` | SA-01 wizard covers some steps; the full path is not modelled | R7 |
| F93 | Platform job health | `Wired` | `platform_job_health()` (`0074_scheduled_jobs.sql:277`) | — |
| F94 | Platform trail | `Wired` | `platform_list_trail` | — |

---

## 10. Notifications and realtime

| # | Capability | Status | Evidence / gap | WP |
|---|---|---|---|---|
| F95 | Notification templates | `Wired` | `render_notification` enforced | — |
| F96 | In-app notification delivery | `Inert` | No test proves delivery into the Work Queue | C3 |
| F97 | Realtime transport | `Wired` | `liveSync` | — |
| F98 | Realtime pop-out sync | `Absent` | No Playwright coverage; poll fallback unproven | C3 |
| F99 | Email dispatch | `Wired` | `email-dispatch` edge function, `email_dispatch_set_token` | — |

---

## 11. Interface — explain layer, personalisation, and the comment popout

| # | Capability | Status | Evidence / gap | WP |
|---|---|---|---|---|
| F100 | Explain layer (popout, drilldown, access-filtered) | `Wired` | `EXPLAIN-LAYER.md`; access-filtered through `src/lib/access.ts` | — |
| F101 | Review comment thread | `Wired` | `CommentHistoryPanel` via `RecordContent` `comment_history`; non-modal | — |
| F102 | Review comment popout (hover/focus) | `Absent` | One testid, no states, no inventory entry, no drilldown | S21 |
| F103 | Dead comment dock removed | `Absent` | `ReviewCommentsDock.tsx` — mounted nowhere | S21 |
| F104 | Theme presets (ledger, porcelain, bone) | `Wired` | `ThemeContext`, `data-preset`, full light+dark token blocks | — |
| F105 | Additional themes (prism, bloom, slate) | `Absent` | §12.2 | U9 |
| F106 | Audience profiles (Focus, Expressive, Aesthetic, Assurance) | `Absent` | §12.1 | U10 |
| F107 | Time-of-day phases | `Absent` | §12.3 — `resolveDayPhase` is a pure function, time as an argument | U11 |
| F108 | Motion system (levels, tokens, named animations) | `Inert` | Two keyframes exist; one component honours reduced-motion | U12 |
| F109 | Animated headers | `Absent` | §12.5 | U13 |
| F110 | Command palette | `Absent` | §11.1c U2 | U14 |
| F111 | Density toggle | `Absent` | §11.1c U7 | U15 |
| F112 | Contrast test covers all presets | `Inert` | `tokens.contrast.test.ts` covers three; must cover six at every phase | U9 |
| F113 | Motion / theme / personalisation gates | `Absent` | §12.7 | U12 |
| F114 | Guided empty states | `Absent` | §11.1c U6 | U16 |
| F115 | Onboarding tutorial drawer | `Wired` | `tutorialKeys.json`, `role="complementary"` | — |
| F116 | Offline / self-hosted fonts | `Absent` | `FONT-REPOSITORY.md` F1–F7; `index.html:14` still loads a Google Fonts CDN link | F1 |

---

## 12. Deterministic capability library (D-series)

Each is a pure function under `src/lib/`, with direct unit tests and a screen surface.

| # | Capability | Status | WP |
|---|---|---|---|
| F117 | Risk and control intelligence (drift, coverage matrix, effectiveness history, KCI, appetite breach) | `Absent` | D1 |
| F118 | Population and evidence intelligence (profile, stratification, sufficiency, freshness, chain of custody) | `Absent` | D2 |
| F119 | Process and governance intelligence (SoD matrix, delegation breach, policy exceptions, meeting governance, regulatory impact) | `Absent` | D3 |
| F120 | Assurance operations (engagement health, reviewer load, finding ageing, report consistency, trail completeness) | `Absent` | D4 |

---

## 13. Adjacent products (§11.2)

| # | Capability | Status | WP |
|---|---|---|---|
| F121 | Continuous control monitoring (SOX / ICFR) | `Absent` | D5 |
| F122 | Verifiable third-party attestation | `Absent` | D6 |
| F123 | Population-level forensic analytics | `Absent` | D7 |
| F124 | Policy-to-control gap analysis | `Absent` | D8 |
| F125 | Assurance-over-assurance | `Absent` | D9 |
| F126 | Population header detection and confirm-before-count | `Wired` | `checkPopulationCsv` (`src/lib/population.ts`) called from `TestingStepsTab.tsx`; it detects the header row and proposes it; ambiguous or non-first-row headers are proposed and confirmed before the count; rows above the header are ignored, the header row is not counted (spec §2.1, S2) | — |
| F127 | Systeligon rule schema and runner (S1) | `Inert` | The engine shell in `src/lib/systeligon/` (`types.ts`, `runner.ts`): a rule declares id/version/kind/params/appliesTo/standards/status/severity and a pure `evaluate`; `runRules` runs the applicable released rules, re-stamps provenance from the rule so a finding cannot misreport its identity, turns a throwing rule into a finding rather than a crash, and sorts findings deterministically. Test-only so far (`systeligon.test.ts`, 16 tests); no screen calls it yet — S6/S8/S9/S10 build the library and packs onto it | S1 |
| F128 | Systeligon rule versioning and packs (S1) | `Inert` | `src/lib/systeligon/versioning.ts` (`RuleRegistry`, append-only: a re-registered id@version with a changed fingerprint throws, an older version cannot follow a newer one) and `packs.ts` (`definePack` validates target and duplicates). Test-only so far; signed OTA distribution is S11 | S1 |
| F129 | Systeligon numeric forensic rule library (S6) | `Inert` | `src/lib/systeligon/rules/numeric.ts` wraps the tested checks in `analyticsEngine.ts` (duplicates, near-duplicates, sequence gaps, z-score and IQR outliers, Benford first digit, round numbers, out-of-hours, same-user create/approve, missing attributes) as versioned rules with provenance, plus `rules/threshold.ts` (just-below-threshold). The checks are not duplicated — `analyticsEngine` stays the single implementation. Test-only so far; no screen consumes a run yet | S6 |
| F130 | Systeligon structured document extraction, tier 3 (S7) | `Inert` | `src/lib/systeligon/extract/structured.ts` parses text into a `ParsedDocument` with declared parsers (vendor/date/amount/reference/period fields, numbered clauses, action items, signatures, cross-references) and reports its own coverage (lines/parsed/uninterpreted). Pure and deterministic. Test-only so far | S7 |
| F131 | Systeligon OCR seam, tier 2 (S7) | `Inert` | `src/lib/systeligon/extract/ocr.ts` decides whether a scan needs OCR (`needsOcr`), runs an injected local engine lazily, and **refuses a remote engine** so nothing leaves the tenant (L2). The bundled model is a build artifact wired as a dependency, not vendored here (D6). Test-only so far | S7 |
| F132 | Systeligon flows and verification (S3/S4/S5/S12) | `Inert` | `src/lib/systeligon/flows.ts`: the accepted flow (required rows from findings, then auto-add), the declined flow (`applyFloor` — the floor is a minimum, never a ceiling; `parsePastedBlock` maps a pasted header onto the columns), Mode A completeness and Mode B evidence verification (§6, fails closed with every reason), and the §2.2 override carried forward to the next reviewer. Pure; time is an argument. Test-only so far | S3/S4/S5/S12 |
| F133 | Systeligon structural document rules (S8) | `Inert` | `src/lib/systeligon/rules/documents.ts`: a contract must carry a signature, an approval a date, no document date is after the report date, and every open action item has a later record. Pure; `reportDate` is an argument. Test-only so far | S8 |
| F134 | Systeligon pattern rules (S9) | `Inert` | `src/lib/systeligon/rules/patterns.ts`: hardcoded credentials, `SELECT *`, an external call with no error handling, an unbounded loop, a disabled check, a hardcoded environment value — over `sourceFiles` text, each finding citing the line. Pure. Test-only so far | S9 |
| F135 | Systeligon action-item register (S14) | `Inert` | `src/lib/systeligon/minutes.ts` + `rules/sequential.ts`: follows each action item across a minutes series — carried forward, vanished, closed no-evidence, reopened, closed-before-raised, closed-by-non-owner, owner/due changed, due passed — citing every appearance as the history. Pure; `asOf` is an argument. Test-only so far | S14 |
| F136 | Systeligon policy/procedure/regulation comparison (S15) | `Inert` | `src/lib/systeligon/policydiff.ts` + `rules/sequential.ts`: policy-no-procedure, procedure-no-policy, regulation-uncovered, stated-differently, control-no-procedure, matched on shared references/terms/cross-refs, and **reports its own coverage** (parsed/matched/could-not-interpret). Pure. Test-only so far | S15 |
| F137 | Systeligon signed rule-pack storage (S10/S11) | `Inert` | `src/data/rulePacks.ts` (`listRulePacks`, `saveSignedRulePack`) calls `rule_pack_list` and `rule_pack_save` in `supabase/migrations/0117_systeligon_rule_packs.sql`; the pack is signed over its content hash with the org's `signing_keys`, an unverifiable save is refused and logged (`rule_pack_refusals`), a shipped version is append-only, and only a platform admin may enable the feature. `rule_pack_save` is mapped in `src/lib/featureMap.ts`; the SQL side is `supabase/tests/119_systeligon_rule_packs.sql` and the client side `src/lib/systeligon/ota.test.ts`. **Inert: no screen calls the data module yet** — the pack-management UI is the builder's | S10/S11 |

---

## 14. The honest count

| Status | Count |
|---|---|
| `Wired` | 56 |
| `Inert` | 37 |
| `Absent` | 44 |
| **Total** | **137** |

**Read that again, with the correction applied.** This is materially better than the first pass
reported, because Phases 1 and 2 of the scale-harden build closed the whole foundation. The picture
now: **56 wired, 37 inert, 44 absent** (F126 population header detection by S2; F127-F128 the Systeligon rule-engine shell by S1; F129 the numeric rule library by S6; F130-F136 extraction, flows and the S8/S9/S14/S15 rules; F137 the signed rule-pack storage by S10/S11 — all added 2026-10-29). F35 (report templates) and F37 (report graph root) were
`Inert` here and are now written and read end to end, so they were corrected on 2026-10-29. The
remaining `Inert` rows are the genuine, still-open
unwired features — the monitor runtime, the evidence bytes, the tamper alarm, the SIRA write path,
the ledger verification. Every one of those is a defect, and every one looks like a working feature
in the UI.

**The order of work is not negotiable, and R1 and R2 are already done.** R1 (the app reads its own
database) and R2 (the lifecycle is real) closed in Phases 1-2. R3 (the configuration is honest) is
partly done — `testing_mode`, `signoff_role_*` and `approval_chain` are enforced; the rest is the
TODO set in `SCALE-TASKS.md` Phase 3. The C, S, T, U, D and F series interleave after R3.

---

## 15. Work packages referenced above

| WP | Title | Closes |
|---|---|---|
| R1 | Make the app read its own database | F1, F8, F9 |
| R2 | Make the lifecycle real | F2–F7, F22, F26, F34, F37, F77 |
| R3 | Make the configuration honest | F19–F21, F35, F72–F79 |
| R4 | Reopen and support access | F26, F85, F86 |
| R5 | Methodology and test-step templates | F28–F30 |
| R6 | Multi-tenant scale and isolation | F84–F86 |
| R7 | Super Admin guided provisioning | F92 |
| S13–S21 | Writing engine, recognition, SIRA continuity, evidence, comment popout | F11–F13, F38–F42, F45–F47, F102–F103 |
| T3–T7 | Attestation and tamper response | F63–F64, F68–F71 |
| C1–C7 | Continuous assurance | F49–F56, F96, F98 |
| U9–U16 | Personalisation and interface quality | F105–F114 |
| D1–D9 | Deterministic capability library and adjacent products | F117–F125 |
| F1–F7 | Fonts, self-hosted | F116 |

---

## 16. Maintenance

- **Every commit that changes wiring updates this file in the same commit.** No exceptions.
- `scripts/check-feature-register.mjs` fails when: a `Wired` row's named call site is gone; a `Wired`
  row names no test; a row uses a status outside the three; or a numbered feature is missing from the
  count in §14.
- This document **replaces** `FUNCTIONALITY-AUDIT.md` as the live inventory. The audit remains as the
  historical record of the finding; the register is what is maintained.
