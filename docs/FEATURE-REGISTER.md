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
| F3 | Ledger verified against the database | `Wired` | `ledger_continuity_check` (`0121_integrity_alarm.sql:257`) calls `verify_ledger` (`0007:97`), raises an integrity incident on a break, and is called from `IntegrityAlarmPanel.tsx:74`; the chain is now verified, not just written | T7 | SQL test tampering a ledger row, then `verify_ledger` returns false |
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
| F11 | SIRA carry-forward into next year | `Wired` | `sira_carry_forward` (0110) + `sira_carry_forward_pack(cycle)` + `sira_seed_next_cycle_internal`; the pack is built on publish and the next cycle is seeded from it, marked `carried_forward` with provenance. `SiraCyclesInspector.tsx` builds and seeds; `src/data/sira.ts` `carryForwardPack`/`seedNextCycle` | S18 |
| F12 | SIRA pre-fill into planning | `Wired` | `populateSuggestions` / `decideSuggestion` (`src/data/planning.ts:38,53`) called from `PlanningPanel.tsx:44,76`. The audit predates this wiring and its claim is stale | — |
| F13 | Two-key SIRA acceptance | `Wired` | `sira_acceptances` (0110): `endorse_sira_cycle` (finaliser, `manage_engagements`) then `decide_sira_acceptance` (a **different** auditor holding `review_and_approve`). `remind_sira_acceptance` reports silence as a finding; publish of the next cycle is blocked while proposals are outstanding. `SiraCyclePanel.tsx` drives both controls | S19 |
| F14 | Emergent risk submit / decide | `Wired` | `propose_emergent_risks(cycle)` proposes from open findings/anomalies; `decide_emergent_risk` accepts/rejects with a mandatory reason. Both called from `SiraCyclesInspector.tsx`; `decideEmergentRisk` also in `src/data/sira.ts` | S18 |
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
| F28 | Test steps as configurable data | `Wired` | `test_step_templates` / `procedure_templates` (`0110_phase4_methodology.sql`); `applyTemplateToWorkpaper` (`src/data/writing.ts`) is called from `ProcedureStepsPanel.tsx` | R5 |
| F29 | Procedure / methodology templates | `Wired` | `MethodologyPanel.tsx` (mounted in `OrgControlPanel.tsx`) calls `listProcedureTemplates`/`saveProcedureTemplate`/`publishProcedureTemplate` | R5 |
| F30 | Stage machine configurable | `Wired` | `src/components/admin/StageMachinePanel.tsx` (mounted by `OrgGovernancePanel.tsx`); read path `src/data/lifecycle.ts`; the DB write path `set_engagement_stage` reads the machine (`0179_stage_machine.sql`). The three hardcoded strings are replaced by the configured stages. Proved by `StageMachinePanel.test.tsx` and `supabase/tests/138_stage_machine.sql` (happy + 6 refusals) | R5 |

---

## 3. Report writer and the Writing Engine

| # | Capability | Status | Evidence / gap | WP |
|---|---|---|---|---|
| F31 | Report compose, comment, freeze, issue | `Wired` | `freeze_report`, `issue_report` gated on rights and open comments; `ReportEditorPanel` | — |
| F32 | Report file render + upload (PDF/DOCX) | `Wired` | `src/data/reportFiles.ts` uploads to the `reports` bucket | S20 |
| F33 | Pre-flight acknowledgement storage | `Wired` | `preflight_acks` + `acknowledgePreflight` in `ReportEditorPanel` | — |
| F34 | Pre-flight engine (the eight checks) | `Wired` | `freeze_report` computes the open pre-flight items from real tables and refuses while any is unacknowledged (`0102_phase2_preflight_gate.sql`); `preflightBlocking`/`listPreflightItems` drive `ReportEditorPanel` | R2 |
| F35 | Report templates | `Wired` | `ReportTemplatePanel.tsx` (the Org Admin `templates` tab) lists templates through `listReportTemplates` and saves through `saveReportTemplate` → `report_template_save` (`src/data/governance.ts`). Tested by `ReportTemplatePanel.test.tsx` and `supabase/tests/109_phase3_report_templates.sql` | R3 |
| F36 | Certificate config and verification | `Wired` | `certificate_config_save`, `verify_certificate`, `PublicVerifyRoute` | — |
| F37 | Report graph root verification | `Wired` | `commitReportGraph` writes the graph (`ReportEditorPanel.tsx:160`) and `verifyReportRoot` re-derives the root (`PublicVerifyRoute.tsx:43`); `ReportEditorPanel` reads the committed graph back (`getReportGraph` → `report-graph-panel`) | R2 |
| F38 | Report writer adopts an uploaded format | `Wired` | §9 of SYSTELIGON — the org format is the `BrandingSpec` the writer reads (`src/data/reportFiles.ts`); font/colour auto-detect via `src/lib/fonts/detect.ts`, adopted in `OrgBrandingPanel.tsx` | F5, F6 |
| F39 | Findings-to-report provenance | `Wired` | §9 — every generated element traces to a finding. `commitReportGraph` (`src/data/reportGraph.ts`) copies each finding's rule id/version onto a report claim through `src/lib/systeligon/provenance.ts` and is invoked from `ReportEditorPanel.tsx` | S13 |

---

## 4. Evidence

| # | Capability | Status | Evidence / gap | WP |
|---|---|---|---|---|
| F40 | Evidence upload control | `Wired` | `EvidenceTab.tsx` uploads the bytes to the private `evidence` bucket, then registers the row (`register_evidence_file`), then the ledger entry — bytes → row → ledger, never the reverse. Falls back to a labelled "session only" path when no bucket is wired | S20 |
| F41 | Evidence bytes stored | `Wired` | Four private buckets (`evidence`, `reports`, `archives`, `org-branding`) with org-scoped RLS on `storage.objects` keyed to `jwt_org_id()` by path prefix (0111); `evidence_files` gains `storage_path`/`mime_type`/`byte_size` | S20 |
| F42 | Evidence re-derived on verify | `Wired` | `verify_evidence_file` re-derives the SHA-256 from the stored bytes, records the status, and raises an integrity alert on a mismatch; `verifyEvidenceFile` (`src/data/evidence.ts`) downloads and hashes | S20 |
| F43 | Document extraction (edge function) | `Wired` | `extractDocument` (`src/data/documents.ts`) invokes the `doc-extract` Edge Function, which re-checks the caller's right and org and reads the file itself; `DocumentViewerPanel.tsx` runs it on "Queue extraction". Tier 1 wiring (S7) | R2 |
| F44 | Extraction stub queue | `Wired` | `request_extraction` RPC | — |
| F45 | Document recognition (magic bytes, archives) | `Wired` | `src/lib/recognition/` sniffs magic bytes, resolves office-in-zip by entry names, unpacks archives under limits, reads docProps//Info metadata; `ImportWizardPanel.tsx:onFile` routes on the sniffed kind and shows the inventory line | S17 |
| F46 | Evidence completeness (Mode A) | `Wired` | Depends on F41, now present — `evidence_files_for(workpaper)` returns the stored rows with their storage facts | S20 |
| F47 | Evidence verification (Mode B) | `Wired` | Depends on F41, now present — see F42 | S20 |
| F48 | Chain of custody | `Wired` | One of the twenty capabilities in `src/lib/capabilities/populationEvidence.ts`, evaluated by `evaluateCapability` and surfaced by `CapabilityLibraryPanel.tsx` (DB-02) | D2 |

---

## 5. Continuous monitoring and connectors

| # | Capability | Status | Evidence / gap | WP |
|---|---|---|---|---|
| F49 | Monitor rules (threshold, rate, sequence, set, missing, cross-source) | `Wired` | `src/lib/writing/monitors.ts` — six deterministic rule kinds, the spec/parity twin of the SQL evaluator. The production path is `monitor_evaluate_org` (`0111_phase5_monitor_runner.sql`): the `pg_cron` `monitor-runner` job (`*/5 * * * *`) evaluates every organisation's released rules over its staged records and writes a hash-chained alert per firing rule. The two implementations are pinned to the same lineage hashes by `src/lib/writing/monitorRunnerParity.test.ts`. Proved by `supabase/tests/112_phase5_monitor_runner.sql` (all six released rules fire) | C1 |
| F50 | Monitor runner (scheduled) | `Wired` | `monitor_runner_sweep(limit)` (`0111_phase5_monitor_runner.sql:472`) is the scheduled entry point; `cron.schedule('monitor-runner', '*/5 * * * *', …)`. It also drains the `automation_events` outbox through `automation_dispatch_pending` → `rule_engine_process` (no trigger, so test 66's direct call stays valid). Proved by `supabase/tests/112_phase5_monitor_runner.sql` | C1 |
| F51 | Alert persistence | `Wired` | `alert_record` (0090) is called by `monitor_evaluate_org` (`0111_phase5_monitor_runner.sql:353`) for each firing rule; it writes a hash-chained `monitor_alerts` row (dedup on the signal set, not the lineage hash). Proved by `supabase/tests/112_phase5_monitor_runner.sql` (six alerts written, `verify_monitor_chain` passes, a later sweep writes none) | C1 |
| F52 | Alert to Work Queue | `Wired` | `monitor_alert_notify` (`0113_phase5_delivery.sql`) is called at the end of `alert_record` — the single write path for an alert — so no alert can be written undelivered. It writes one in-app `notifications` row per member holding `review_and_approve` (visible in the Work Queue, read by `notifications_list()`) and queues one `email_queue` row per recipient with an address. Proved by `supabase/tests/114_phase5_delivery.sql` (21 assertions) | C3 |
| F53 | Alert enrichment (entity, dept, SIRA, inherent/residual, controls) | `Wired` | §11.1 — `alert_enrichment` (`0112_phase5_alert_enrichment.sql`) resolves the fields; `listAlerts` (`src/data/writing.ts`) reads them and `ConnectorMonitorPanel.tsx` renders them on each alert | C2 |
| F54 | Adhoc audit suggestion from an anomaly | `Wired` | §11.1 — `alertAdhocSuggestion`/`alertAdhocAuditRaise` (`src/data/writing.ts`) called from `AlertActionsPanel.tsx` | C4 |
| F55 | Alert triage surface | `Wired` | §11.1 — `triageAlert` (`src/data/writing.ts`) called from `ConnectorMonitorPanel.tsx` | C6 |
| F56 | Anomaly proposes emergent risk into SIRA | `Absent` | §11.1 | C7 |
| F57 | Connector run start / finish | `Wired` | `runConnector` (`src/data/connectors.ts`) is the caller: it starts a run with `connector_run_start`, closes it with `connector_run_finish`, and is invoked from the mounted connector screen (`ConnectorMonitorPanel.tsx`, the `Run now` button). 0169 adds the lifecycle guards (a second finish is refused, one live run per instance). Proved by `src/data/connectors.test.ts` (6) and `supabase/tests/139_connector_run_guards.sql` (4) | C1 |
| F58 | Staged record ingest | `Wired` | `runConnector` maps each fetched row through the adapter's pure `map` and writes it with `staged_record_ingest` (idempotent by content hash: a duplicate is counted `skipped`, never `staged`). Reached from the `Run now` button in `ConnectorMonitorPanel.tsx`. Proved by `src/data/connectors.test.ts` (6) and `supabase/tests/139_connector_run_guards.sql` | C1 |
| F59 | Connector adapters (22) | `Wired` | The 25 catalogue adapters (`src/lib/writing/connectorCatalogue.ts`) now have a runner: `runConnector` calls `connectorById(id)` to resolve the adapter and drives its `fetch`/`map` through the egress-checked `browserTransport`. Reached from the `Run now` button in `ConnectorMonitorPanel.tsx`. Proved by `src/components/writing/ConnectorMonitorPanel.test.tsx` (3) and `src/data/connectors.test.ts` | C1 |
| F60 | Connector egress control | `Wired` | `connector_egress_allowed` consulted | — |
| F61 | Connector credentials | `Wired` | Wizard-only, `secret_store`, service-role reads | — |

---

## 6. Trust, tamper evidence, and attestation

| # | Capability | Status | Evidence / gap | WP |
|---|---|---|---|---|
| F62 | Integrity alerts recorded | `Wired` | `raise_integrity_alert()` writes the alert **and** a ledger entry; called by archive checks | — |
| F63 | Integrity alerts surfaced | `Wired` | `listIntegrityAlerts()` reads `integrity_alerts_list` (rights-gated, severity-annotated); `IntegrityAlarmPanel.tsx` is the OA-29 surface and `IntegrityAlarmBanner.tsx` is the DB-01 banner | T7 |
| F64 | Tamper notification on any channel | `Wired` | `raise_integrity_alert` calls `integrity_alert_notify` (0112): in-app notification to each integrity owner, an email, and an `integrity.alert` automation event | T7 |
| F65 | Archive verification | `Wired` | `population_archive_check` and `population_archive_verify` call `raise_integrity_alert` | — |
| F66 | Ledger verification | `Wired` | `ledger_continuity_check` (0112) wraps `verify_ledger`, raises an incident on a break; `IntegrityAlarmPanel.tsx` offers "Verify the ledger now" | T7 |
| F67 | Public verification route | `Wired` | `PublicVerifyRoute` — anonymous, rate-limited | — |
| F68 | Guided integrity incident wizard | `Wired` | `IncidentWizardPanel.tsx` (OA-31, the `org_control` `incidents` tab) reads `listIntegrityIncidents` (0114) and runs each guided step through `incidentAction` / `verifyIntegrityIncident` / `openIntegrityIncident` | T6 |
| F69 | Portable attestation package | `Wired` | `buildAttestationPackage` + `attestation_input_get` (0113); `AttestationPanel.tsx` is the OA-30 surface | T3 |
| F70 | Third-party verification | `Wired` | `verifyAttestationPackage` + the standalone `scripts/verify-attestation.mjs`; both implement the documented procedure in `docs/ATTESTATION-VERIFICATION.md` | T4 |
| F71 | Attestation screen | `Wired` | `AttestationPanel.tsx` (OA-30, the `org_control` `attestation` tab) — view, export, verify | T5 |

---

## 7. Configuration — stored but inert (the self-respect list)

Every row here is **stored, visible in the UI, and changes nothing**. This is the most dangerous
category, because it looks like a working control.

| # | Setting | Status | Gap | WP |
|---|---|---|---|---|
| F72 | `org_lifecycle_settings.testing_mode` | `Wired` | `set_engagement_stage` enforces `two_stage` (a DEA and an OET workpaper, both signed off) before the transition to `conclusion` (`0101_phase2_lifecycle.sql`). Proved by `supabase/tests/102_phase2_lifecycle.sql` §2 | R3 |
| F73 | `org_lifecycle_settings.signoff_role_*` | `Wired` | `sign_planning` / `sign_conclusion` require the configured team role through `caller_meets_signoff_role` (`0101_phase2_lifecycle.sql:98`), and `sign_off_workpaper` requires `signoff_role_testing` (`0107_phase3_workflow_enforcement.sql`). Proved by `supabase/tests/102_phase2_lifecycle.sql` §3 | R3 |
| F74 | `workflow_settings.approval_chain` | `Wired` | `approve_plan` requires every step of the chain to be recorded, in order, before approval (`0101_phase2_lifecycle.sql` §4, via `approval_chain_for`/`approval_chain_ready`). Proved by `supabase/tests/102_phase2_lifecycle.sql` §4 | R3 |
| F75 | `report_templates` | `Wired` | See F35 — the Org Admin `templates` tab lists and saves templates through the real readers (`src/data/governance.ts`); the DB save path is `report_template_save`. Proved by `supabase/tests/109_phase3_report_templates.sql` | R3 |
| F76 | `anchoring_settings` (trust anchor, timestamp authority) | `Wired` | `IntegrityAnchoringPanel.tsx` (Super Admin `integrity` tab) saves through `saveTrustAnchor`/`saveTimestampAuthority` → `admin_save_trust_anchor`/`admin_save_timestamp_authority` (`src/data/integrityAnchoring.ts`). Tested by `IntegrityAnchoringPanel.test.tsx` | R3 |
| F77 | `cap_items` workflow (DB path) | `Wired` | `update_cap` is called from `CapRegisterPanel.tsx` and `IssuesRegisterTab.tsx`. A parallel in-memory `transitionCapStatus` also exists and is what runs on some paths — the two-UIs defect | R2 |
| F78 | `org_lifecycle_settings.report_opinion_required` | `Wired` | `sign_conclusion` requires the opinion when either the column or the legacy config key asks for it (a two-sources fix, `0109_phase3_config_effects.sql` §1). Proved by `supabase/tests/110_phase3_config_effects.sql` §1 | R3 |
| F79 | Workflow SLA / escalation | `Wired` | `request_combined_deployment` computes `sla_due_at` from `workflow_settings.sla_hours`; `escalate_overdue_deployment_requests`/`deployment_requests_escalate_all` escalate past `escalation_hours` and notify `escalation_role` (`0107_phase3_workflow_enforcement.sql`). Proved by `supabase/tests/108_phase3_workflow_enforcement.sql` | R3 |

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
| F84 | Multi-org isolation under concurrency | `Wired` | `supabase/tests/123_scale_isolation.sql` creates three-plus concurrent organisations, writes data in each, and proves the RLS paths keep them apart (the `jwt_org_id()` path, the cross-universe share path, the invite-cap and feature-flag switches, the support-grant surface) — every refusal paired with the legitimate read, run twice by the harness | R6 |
| F85 | Support access grant / revoke | `Wired` | The Super Admin support screen (`SuperAdminSupport.tsx`, SA-02) grants and revokes through `grantSupportAccess`/`revokeSupportAccess` (`src/data/platform.ts`) → `platform_grant_support_access`/`platform_revoke_support_access` (0031), both gated on `require_platform_admin()`. The org-admin variant `grant_support_access` is the tenant-side path (`manage_users`). Tested by `src/components/superadmin/SuperAdminSupport.test.tsx` and `supabase/tests/40_platform_control_plane.sql` | R6 |
| F86 | Support access logged | `Wired` | Every support read is written to `support_access_log` — including a refused read, which writes a denied row. `support_read_object`/`support_list_engagements` write the trail; `support_access_log` has no write policy (service/definer only). Proved by `supabase/tests/85_support_read_session.sql` (refused reads logged, expiry/revocation stop access, no support function is a write path) | R6 |

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
| F96 | In-app notification delivery | `Wired` | Delivery is proved at the database: `supabase/tests/114_phase5_delivery.sql` §2 asserts the triager sees the alert through `notifications_list()` (the Work Queue read path) and a non-triager does not. The screen path is `e2e/s15-notifications.spec.ts`: a notification raised in the database reaches the Work Queue and the bell without a reload | C3 |
| F97 | Realtime transport | `Wired` | `liveSync` | — |
| F98 | Realtime pop-out sync | `Wired` | `e2e/s14-popout-sync.spec.ts` (SCALE-1 §17.1) proves the pop-out and its parent converge on the same record: a revision published in either window is visible to the other, and the same-origin storage channel (`useRecordRevisionSync.ts`, policy in `src/lib/liveSync.ts`) converges the two windows even when Realtime is unavailable — the documented fallback, exercised | C3 |
| F99 | Email dispatch | `Wired` | `email-dispatch` edge function, `email_dispatch_set_token` | — |

---

## 11. Interface — explain layer, personalisation, and the comment popout

| # | Capability | Status | Evidence / gap | WP |
|---|---|---|---|---|
| F100 | Explain layer (popout, drilldown, access-filtered) | `Wired` | `EXPLAIN-LAYER.md`; access-filtered through `src/lib/access.ts` | — |
| F101 | Review comment thread | `Wired` | `CommentHistoryPanel` via `RecordContent` `comment_history`; non-modal | — |
| F102 | Review comment popout (hover/focus) | `Wired` | `CommentPopout.tsx` renders the access-filtered `commentPopout` model (`src/lib/commentPopout.ts`, pure) on the shared `HoverPreview` chrome; `CommentHistoryPanel.tsx` mounts it per comment and drives the search / cycle / status states and the `CH-07-drilldown` drilldown (contract CH-07) | S21 |
| F103 | Dead comment dock removed | `Wired` | the dead ReviewCommentsDock was deleted in U14/S21 after `node scripts/audit-wiring.mjs` reported no reachable caller; the live review surface is `CommentHistoryPanel` | S21 |
| F104 | Theme presets (ledger, porcelain, bone) | `Wired` | `ThemeContext`, `data-preset`, full light+dark token blocks | — |
| F105 | Additional themes (prism, bloom, slate) | `Absent` | §12.2 | U9 |
| F106 | Audience profiles (Focus, Expressive, Aesthetic, Assurance) | `Absent` | §12.1 | U10 |
| F107 | Time-of-day phases | `Absent` | §12.3 — `resolveDayPhase` is a pure function, time as an argument | U11 |
| F108 | Motion system (levels, tokens, named animations) | `Inert` | Two keyframes exist; one component honours reduced-motion | U12 |
| F109 | Animated headers | `Absent` | §12.5 | U13 |
| F110 | Command palette | `Wired` | `CommandPalette.tsx` (Cmd/Ctrl-K) over the pure `rankCommands`/`visibleCommands`/`recordCommands` in `src/lib/commandPalette.ts`; screens, records, actions and explain entries; non-blocking | U2 |
| F111 | Density toggle | `Absent` | §11.1c U7 | U15 |
| F112 | Contrast test covers all presets | `Wired` | `src/styles/tokens.contrast.test.ts` covers all six presets (ledger-light, ledger-dark, porcelain-light, porcelain-dark, bone-light, bone-dark): it iterates `SELECTORS` and asserts every text and accent token meets WCAG AA (4.5:1) on both canvas and surface, and that no banned warning hue appears | U9 |
| F113 | Motion / theme / personalisation gates | `Absent` | §12.7 | U12 |
| F114 | Guided empty states | `Wired` | A new organisation's dashboard shows `GuidedFirstRun.tsx` (DB-01) instead of a wall of zeros: the pure `src/lib/guidedFirstRun.ts` rule decides the step, `createUniverse` on the app context is the button's write path, and `src/data/guidedFirstRun.ts` reads the gated `get_org_data_state` RPC (`supabase/migrations/0126_guided_first_run.sql`). `create_universe` is the first-run action that had no write path anywhere | U6 |
| F115 | Onboarding tutorial drawer | `Wired` | `tutorialKeys.json`, `role="complementary"` | — |
| F116 | Offline / self-hosted fonts | `Wired` | `src/lib/fonts/catalogue.ts` (curated repository + licence metadata), `loader.ts` (lazy loader), `detect.ts` (DOCX/PPTX font-colour auto-detect), consumed by `OrgBrandingPanel.tsx` (OA-02/OA-03); `index.html` loads no external font host | G10 (`src/guards/fontLicence.test.ts`) |

---

## 12. Deterministic capability library (D-series)

Each is a pure function under `src/lib/`, with direct unit tests and a screen surface.

| # | Capability | Status | Evidence | WP |
|---|---|---|---|---|
| F117 | Risk and control intelligence (drift, coverage matrix, effectiveness history, KCI, appetite breach) | `Wired` | Five pure functions in `src/lib/capabilities/riskControl.ts`, evaluated by `evaluateCapability` and surfaced by `CapabilityLibraryPanel.tsx` (DB-02) | D1 |
| F118 | Population and evidence intelligence (profile, stratification, sufficiency, freshness, chain of custody) | `Wired` | Five pure functions in `src/lib/capabilities/populationEvidence.ts`, surfaced by `CapabilityLibraryPanel.tsx` (DB-02) | D2 |
| F119 | Process and governance intelligence (SoD matrix, delegation breach, policy exceptions, meeting governance, regulatory impact) | `Wired` | Five pure functions in `src/lib/capabilities/processGovernance.ts`, surfaced by `CapabilityLibraryPanel.tsx` (DB-02) | D3 |
| F120 | Assurance operations (engagement health, reviewer load, finding ageing, report consistency, trail completeness) | `Wired` | Five pure functions in `src/lib/capabilities/assuranceOps.ts`, surfaced by `CapabilityLibraryPanel.tsx` (DB-02) | D4 |

---

## 13. Adjacent products (§11.2)

| # | Capability | Status | WP |
|---|---|---|---|
| F121 | Continuous control monitoring (SOX / ICFR) | `Absent` | D5 — IN SCOPE (owner 2026-10-29) |
| F122 | Verifiable third-party attestation | `Absent` | D6 — REMOVED by owner 2026-10-29; do not build |
| F123 | Population-level forensic analytics | `Absent` | D7 — IN SCOPE (owner 2026-10-29) |
| F124 | Policy-to-control gap analysis | `Absent` | D8 — IN SCOPE (owner 2026-10-29) |
| F125 | Assurance-over-assurance | `Absent` | D9 — IN SCOPE (owner 2026-10-29) |
| F126 | Live activity spine | `Wired` | `ActivitySpine.tsx` (DB-01) renders the pure `src/lib/activitySpine.ts` layer (sentence, kind, age) over the rights-gated `activity_spine_list` RPC (`supabase/migrations/0125_activity_spine.sql`) via `src/data/activity.ts` on the existing `liveSync` transport (Realtime when available, bounded poll otherwise) | U4 |

---

## 13b. The Systeligon engine (S-series, §3.1–§3.3 of the spec)

`src/lib/systeligon/` is a deterministic, versioned rule engine: `types`, `runner`, `versioning`,
`packs`, `ota`, `flows`, `minutes`, `policydiff`, `provenance`, `extract/` (structured, ocr) and
`rules/` (numeric, threshold, structural, documents, patterns, sequential), 17 re-exports in
`index.ts`, six test files. **The engine is built and tested; the screens that would drive it are the
last mile.** A row is `Wired` only when a screen (or a scheduled job) reaches it; where the surface
is not mounted the row is `Inert` and says so, because an engine attached to nothing is the defect
this register exists to catch.

| # | Capability | Status | Evidence / gap | WP |
|---|---|---|---|---|
| F127 | Rule schema, runner and result shape (S1) | `Wired` | `src/lib/systeligon/{types,runner}.ts` — `runRules` is pure, total and stably ordered, and turns a rule that throws into a finding against its own identity. **Wired** by the rule-run screen (`RuleRunTab.tsx`, workbench sub-tab "Rule Run", contract AF-16): it evaluates `runRules` over a population's rows and records the run via `recordSysteligonFindings` | S1 |
| F128 | Rule versioning and packs (S1) | `Wired` | `src/lib/systeligon/{versioning,packs}.ts` — `RuleRegistry`, `definePack`, `releasedRules`, `packRules`; append-only versions, duplicate `id@version` collapses. All four are called by `RulePackPanel.tsx` (OA-33): the registry holds the shipped base (`registry.registerAll(systeligonPopulationRules)`, `registry.history()` renders the append-only summary) and `packRules` assembles the flat run set the pack signs. Proved by `RulePackPanel.test.tsx` ('reports the shipped rule base from the append-only RuleRegistry', 'saves the shipped pack assembled by packRules over the registry') | S1 |
| F129 | Numeric forensic rules (S6) | `Wired` | `src/lib/systeligon/rules/{numeric,threshold}.ts` — 11 rules wrapping the tested `analyticsEngine` checks (Benford, duplicates, near-duplicates, sequence gaps, z-score and IQR outliers, round numbers, out-of-hours, SoD, missing attributes, just-below-threshold) with provenance. Assembled as `systeligonPopulationRules` (`library.ts`) and **run by the rule-run screen** (`RuleRunTab.tsx`) | S6 |
| F130 | Structured document extraction, tier 3 (S7) | `Wired` | `src/lib/systeligon/extract/structured.ts` — `parseDocumentStructure` parses a document's text into structure and reports its own coverage (parsed + uninterpreted = lines, never rounded). **Wired** by the document-review screen (`DocumentReviewPanel.tsx`, mounted in `AuditFileModal.tsx` phase `documents`, contract OA-36): it parses every attached document before any rule runs, and `documentScale.test.ts` exercises it over 2,000 documents | S7 |
| F131 | OCR seam, tier 2 (S7) | `Wired` | `src/lib/systeligon/extract/ocr.ts` — `needsOcr` and `runOcr` read a scan locally with the bundled engine and **refuse a remote engine** so nothing leaves the tenant (L2). **Wired** by the document-review screen (`DocumentReviewPanel.tsx`, OA-36): a document with no text layer routes to `runOcr` with the bundled engine; the remote refusal is proved by `extract.test.ts` | S7 |
| F132 | Accepted/declined flows and Mode A/B verification (S3/S4/S5/S12) | `Wired` | `src/lib/systeligon/flows.ts` — `buildAcceptedTestingSet`, `applyFloor` (a minimum, never a ceiling), `parsePastedBlock`, `verifyRows`, `carriedOverrides`; pure, time is an argument. **Wired** by `FlowVerifyPanel.tsx` (the accepted/declined flow and Mode A/B on the rule-run screen, AF-16, mounted in `RuleRunTab.tsx`): the rows a run's findings named are the required set, the declined flow fixes a floor, and an override closed despite a failed verification is carried forward; evidence read by `listEvidenceRecords` (`src/data/population.ts`). Proved by `FlowVerifyPanel.test.tsx` (9) | S3/S4/S5/S12 |
| F133 | Structural document rules (S8) | `Wired` | `src/lib/systeligon/rules/documents.ts` — contract signature, approval date, no date after the report date, absent follow-through. **Wired** by the document-review screen (`DocumentReviewPanel.tsx`, OA-36): the `structural` review option runs these rules through `reviewOptions.ts`, and `DocumentReviewPanel.test.tsx` proves a `doc.absent_follow_through` finding reaches the screen | S8 |
| F134 | Pattern rules (S9) | `Wired` | `src/lib/systeligon/rules/patterns.ts` — hardcoded credentials, `SELECT *`, external call without error handling, unbounded loop, disabled check, hardcoded environment; each finding cites its line. **Wired** by the document-review screen (`DocumentReviewPanel.tsx`, OA-36): the `patterns` review option runs these rules through `reviewOptions.ts` | S9 |
| F135 | Action-item register from minutes (S14) | `Wired` | `src/lib/systeligon/minutes.ts` — `buildActionRegister` builds carried / vanished / closed-no-evidence / reopened / closed-before-raised / closed-by-non-owner / owner-due-changed / due-passed from the minute set. **Wired** by the document-review screen (`DocumentReviewPanel.tsx`, OA-36): the `minutes` option calls `buildActionRegister` and renders the register (`minutes-register`) | S14 |
| F136 | Policy/procedure/regulation comparison (S15) | `Wired` | `src/lib/systeligon/policydiff.ts` — `compareDocuments` reports its own coverage (parsed / matched / could-not-interpret), because an unparsed clause is not a clean clause. **Wired** by the document-review screen (`DocumentReviewPanel.tsx`, OA-36): the `policy` option calls `compareDocuments` and renders the comparison (`policydiff`) | S15 |
| F137 | Signed rule-pack storage (S10/S11) | `Wired` | `src/lib/systeligon/ota.ts` (`signPack`, `verifyPack`, `buildAdhocRule`) + `src/data/rulePacks.ts` (`listRulePacks`, `listRulePackRefusals`, `getReleasedRulePack`, `saveSignedRulePackArtifact`, `releaseRulePack`, `registerSigningKey`, `generateSigningKey`) + `0128_rule_pack_release.sql` (`rule_pack_save`/`rule_pack_list`/`rule_pack_release`/`rule_pack_refusals_list`/`rule_pack_released_rules`/`signing_key_register`). The pack-management screen is `RulePackPanel.tsx` (OA-33, mounted in `OrgControlPanel.tsx`): it lists packs, generates and registers a signing key, signs and verifies a draft, releases it and reads the refusal log. `RuleRunTab.tsx` reads the released pack through `getReleasedRulePack`/`resolveReleasedRules` and runs it | S10/S11 |
| F138 | Single product/engine name (S16) | `Wired` | `src/lib/product.ts` is the one constants module (product name, tagline, title and the engine name); `scripts/sync-product-name.mjs` mirrors it to the Edge functions, `src/guards/productName.test.ts` holds it, and screens read it — `PRODUCT_NAME` in ten (`HeaderBar.tsx`, `SignInScreen.tsx`, `AttestationPanel.tsx`, …) and `ENGINE_NAME` in the rule-run screen (`RuleRunTab.tsx`) | S16 |
| F139 | Client classification at onboarding, and the ICFR trigger | `Absent` | D10 — owner decision 2026-10-29; source `docs/PAKISTAN-ASSURANCE-REGIMES.md` |
| F140 | Audit domains (Management / Shari'ah / IT) and their rule packs | `Absent` | D11 — owner decision 2026-10-29; model `docs/AUDIT-DOMAINS-MODEL.md`; IT pack from `docs/ASSURANCE-RULEBOOKS.md` §1; Shari'ah pack from AAOIFI SS 1–54 + SBP Compendium (31 Oct 2024) + SBP SGF (1 Jan 2025) — all verified in-repo |
| F141 | Actionable traffic-signal readiness panels (Super Admin + Org Admin) | `Absent` | D12 — owner decision 2026-10-29; corrective-action flow + complaint management + self-diagnostic |
| F142 | Deployment and environment readiness in the Super Admin | `Absent` | D13 — owner decision 2026-10-29 |
| F143 | Risk library, auto-adjusted factors and manual override | `Absent` | D14 — owner decision 2026-10-29; source `docs/RISK-ASSESSMENT-MODEL.md` |
| F144 | Dynamic risk assessment (inputs, ERM map, triggers, narrative) | `Absent` | D15 — owner decision 2026-10-29; source `docs/ASSURANCE-RULEBOOKS.md` §6 + `docs/Risk Assessment, reimagined.pdf` |
| F145 | Standards distribution — Super Admin rollout of signed rule-base packs to entitled tenants | `Wired` | `src/data/standards.ts` (`publishStandardsPack`, `rolloutStandardsPack`, `pinStandardsVersion`, `buildSignedStandardsPack`) + `0191_standards_distribution.sql`. **Wired** by the Super Admin standards surface (`SuperAdminStandards.tsx`, SA-21, mounted as the `standards` tab in `SuperAdminPortal.tsx`): it publishes a signed pack, rolls it out to entitled tenants (an unentitled tenant is `skipped-not-entitled` with a log row and no subscription row), and pins a version with a reason. Proved by `SuperAdminStandards.test.tsx` (14) and `supabase/tests/137_standards_distribution.sql` (37) | D16 |

---

## 14. The honest count

| Status | Count |
|---|---|
| `Wired` | 125 |
| `Inert` | 1 |
| `Absent` | 19 |
| **Total** | **145** |

**Read that again, with the correction applied.** This pass corrected a systematic understatement:
the register's own gate passes on a stale claim, so rows that name a thing as dead were re-checked
against the code and the SQL tests. The document surfaces (S7's OA-36 review), the monitor cluster
(the `monitor-runner` scheduled job reaches F49–F52), the support-grant surface (F84–F86), the
notification delivery and the pop-out sync (F96, F98), the contrast coverage (F112) and the whole
"stored but inert" configuration list (F35, F72–F79) are all **built, wired and tested** — the
Phase 2/3 migrations (`0101`, `0107`, `0109`) landed the enforcement and `supabase/tests/102`–`110`
prove it, while the delivery and sync rows are proved by `supabase/tests/114` and the Playwright
specs `s14`/`s15`. The four remaining `Inert` rows are the genuine, still-open defects: the connector
run and ingest RPCs and the adapter runner (F57–F59) and the motion system (F108). Every one is a defect,
and every one looks like a working feature in the UI.

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
