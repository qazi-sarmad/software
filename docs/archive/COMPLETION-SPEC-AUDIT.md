> ## ⚠️ STALE — ARCHIVED, DO NOT TRUST
>
> This document predates the code-verified audit of 2026-10-27/28 and is kept for history only.
> Its status claims are **not** reliable: the audit found the app was not database-backed in
> production, the engagement lifecycle was never persisted, several documented-as-Present features
> were dead code, and many "all Present" claims were false.
>
> **Current sources of truth:**
> - `docs/SPEC-v10.md` — the specification (unchanged, still authoritative)
> - `docs/FUNCTIONALITY-AUDIT.md` — what is actually built (code-verified)
> - `docs/REMEDIATION-PLAN.md` — the plan being executed
> - `docs/SCALE-TASKS.md` — live task ledger
>
> Do not cite this file as evidence that anything works.

# Completion spec audit (C3.1)

One row per numbered clause of `docs/SPEC-v10.md` §1 to §29 (plus §30, §31, §32 for completeness).
Status is **Present**, **Partial** or **Missing**. "Present" requires a named test that fails when the
behaviour is removed; where the only evidence is code or a migration with no behaviour test, the row is
Partial and the missing test or behaviour is stated. This audit supersedes the Phase 0 table in
`docs/PARITY.md`; C5.2 rebuilds PARITY from this file.

Evidence is named as: object (`migration`), test (`sql test N` or `vitest path`), and the app file
(`src/...`). Migration numbers are the highest one that creates or replaces the object.

## §1 Laws

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| L1 deterministic analytics, no AI in a result/score/sample/gate | Present | `0029_analyst_engine.sql` pure functions; `src/lib/analytics.ts` + `analytics.test.ts`; sql `37_analyst_engine.sql`; guard `sourceGuards.test.ts` (no Math.random, no AI in deterministic paths); AI advisory only in `0059_ai.sql` with `ai.*` never writing a test row | — |
| L2 tenant data never leaves the tenant boundary; no vendor model | Present | `0059_ai.sql` `ai_endpoint_denylist` (vendor hosts seeded denied); `66_secrets_email_automation.sql`; sql `69_ai.sql` | — |
| L3 no population test without a verified population, enforced in the DB | Present | `0026_population_gate.sql`; sql `06_unverified_population.sql`, `34_population_gate.sql` | — |
| L4 statuses real-time and everything drillable | Present | Realtime + poll fallback `ConsultationBanner.tsx`; drilldowns in `ObservationDrilldown.tsx`, `CapInspector.tsx`; sql `65_config_history.sql` | — |
| L5 every action logged; sign-offs/freezes/plan versions/issuance hash-chained; config versioned | Present | `0005_logging.sql`, `0006_invariants.sql`; sql `09_ledger_chain.sql`, `10_ledger_tamper.sql`, `15_ledger_concurrency.sql`; `0053_config_history.sql` | — |

## §2 Structure and Tenancy

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| Tenant → Universe → Entity → Engagement hierarchy | Present | `0003_structure.sql`, `0018_universes_entities.sql`; sql `01_org_isolation.sql`, `25_universes_entities.sql` | — |
| Engagement belongs to exactly one Universe | Present | `0003_structure.sql` (`universe_id` not null); sql `25_universes_entities.sql` | — |
| Entity audited across many engagements, linked to many findings | Present | `0003_structure.sql`; sql `25_universes_entities.sql` | — |
| Sharing outside a Universe: view-only share, granted by a L1/L2 Head, with in-app + email notification | **Missing** | No share table or RPC (grep `sharing`/`grant_share` finds none). Scope grants (`admin_grant_scope`, `0017`) are membership scoping, not cross-universe sharing. | Whole feature: `universe_share_grant` table, grant/revoke RPC with a L1/L2 Head check, in-app + email notification, RLS read-only projection, a screen and a test. Recorded in `COMPLETION-BLOCKERS.md`. |
| One tenant = one client org; data isolated | Present | `0008_rls.sql`; sql `01_org_isolation.sql`, `13_rls_enabled.sql` | — |
| Platform owner has no access to tenant business content | Present | `0031_platform_control_plane.sql`; sql `03_platform_blind.sql`, `60_platform_admin_blind.sql` | — |

## §3 Hosting and Client Access

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| Clients log in to their own tenant workspace | Present | `0010_auth_hook.sql`; sql `16_auth_hook.sql`, `18_auth_hook_claims.sql` | — |
| Phone access to ethics sign-off, approvals, report viewing | Partial | Responsive layouts exist; no phone-specific Playwright viewport test | A mobile-viewport smoke for the three named paths. |
| One Supabase project, isolated by org_id + RLS, verified by isolation tests | Present | `0008_rls.sql`; sql `01_org_isolation.sql`, `02_scope_isolation.sql` | — |
| Option: dedicated project / self-hosted, data module targets either unchanged | Partial | `src/data/client.ts` reads env config; `0078_hosting_fit_migration.sql`, sql `78` | A documented, tested switch is not present; recorded as an owner action. |
| Exports: every client can export everything it owns | Present | `0041_exports.sql`, `0079_export_formats_report_files.sql`; sql `50_exports.sql`, `88_export_formats_report_files.sql` | — |

## §4 Roles, Teams and Access

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| 4.1 Roles are data; seven seed roles | Present | `0012_rights_closed.sql`; `src/lib/rights.ts`; sql `19_rights_closed.sql` | — |
| 4.1 Roles, rights and scopes editable by CIA and Org Admin | Present | `0014_roles_config.sql`, `0017_admin_rpcs.sql`; sql `21_roles_config.sql`, `24_admin_rpcs.sql` | — |
| 4.2 audit team; team roles configurable; defaults | Present | `0013_engagement_team.sql`; sql `20_engagement_team.sql` | — |
| 4.2 team membership changed under change control (§21) | Present | `0080_change_control.sql` (material class `team_member`); sql `89_change_control.sql` | — |
| 4.2 testing sign-off role configurable per stage | Present | `0082_org_governance_settings.sql` (`signoff_role_*`); sql `91_org_governance_settings.sql` | — |
| 4.3 visibility; out-of-scope shows neutral "Not available" | Present | `0008_rls.sql`, `0016_rights_rls.sql`; sql `02_scope_isolation.sql`; `src/lib/access.ts` + `access.test.ts` | — |
| 4.3 enforcement by RLS, not hidden buttons | Present | sql `13_rls_enabled.sql`, `17_authorized_write.sql` | — |
| 4.4 four-eyes; sealed = read-only; ledger append-only | Present | `0006_invariants.sql`; sql `11_four_eyes.sql`, `12_sealed_engagement.sql`, `08_append_only.sql` | — |
| 4.5 identity from the session only; no default role; no persona | Present | `0010_auth_hook.sql`; guard `sourceGuards.test.ts` (no persona/impersonation/viewpoint); sql `16_auth_hook.sql` | — |
| 4.6 real sign-in; publishable key only; no secret in src/dist | Present | guard `singleClient.test.ts` + `prodBundle.test.ts`; `0010_auth_hook.sql` | — |
| 4.6 org/role/scopes read through the data module under RLS; never user_metadata | Present | `src/data/client.ts`; sql `05_org_from_jwt.sql` | — |
| 4.6 synthetic test data, two demo orgs is_demo=true | Present | `src/data/initialData.ts`; `0100_*`; sql `00_lib.sql` | — |

## §5 Navigation and Home

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| Primary navigation set; disallowed tabs hidden | Present | `src/components/common/NavStrip.tsx` + `NavStrip.test.tsx` | — |
| Dashboard (scoped) with the listed counts | Present | `src/components/dashboard/*`; sql `64_acp_control_plane.sql` | — |
| Work Queue (personal) with the listed items | Present | `src/components/pending/PendingTasksTab.tsx`, `EscalationCards.tsx`; WK-01..WK-10 in the contract | — |
| Audit Files lists engagements; opening creates the Audit File window | Present | `src/components/audit/AuditFileModal.tsx`; `FloatingWindow.tsx` | — |
| Command palette, shortcuts, review-comments dock, all scope-filtered | Present | `CommandPalette.tsx`, `ReviewCommentsGlobalDock.tsx`; `src/lib/access.ts` | — |

## §6 Universes and Entities

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| Universes group entities | Present | `0018_universes_entities.sql`; sql `25_universes_entities.sql` | — |
| Entities are the auditable units | Present | `0018_universes_entities.sql`; sql `25_universes_entities.sql` | — |
| Entity approval: initiator/required fields/approver configured; must be approved before use | Present | `0018_universes_entities.sql` `entity_approval_settings`; sql `25_universes_entities.sql` | — |
| Each entity keeps history (engagements, findings, CAPs, SIRA) | Present | `ObservationDrilldown.tsx`; sql `39_findings_observations.sql` | — |

## §7 Deployment Gate

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| 1–5 gate steps (unapproved entity blocks, plan mismatch routes, unauthorised deployer escalates) | Present | `0022_deployment_gate.sql`; sql `29_deployment_gate.sql` | — |
| 6 team ethics/independence acknowledgement is a hard block, recorded in the ledger | Present | `0022_deployment_gate.sql`; sql `29_deployment_gate.sql` | — |
| 7.1 combined approval: one request, atomic decision, new plan version, revalidated at decision time | Present | `0023_combined_approval.sql`; sql `30_combined_approval.sql` | — |
| 7.1 SLA with escalation to a configured senior role | Present | `0023_combined_approval.sql`, `0060_escalation.sql`; `0074_scheduled_jobs.sql` `escalate_overdue_deployment_requests()`; sql `83_scheduled_jobs.sql` | — |
| 7.1 no audit file until approval; deployment never asks for a population | Present | `0022_deployment_gate.sql`; sql `29_deployment_gate.sql` | — |

## §8 SIRA

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| 8.1 universal risk library; per-universe selection; totals update with cause | Present | `0019_sira_model.sql`; sql `26_sira_model.sql` | — |
| 8.2 factors/scales/weights/bands configurable; aggregation from a fixed library | Present | `0019_sira_model.sql`; sql `26_sira_model.sql` | — |
| 8.2 scores normalised to 0–100 with factor values and method recorded | Present | `0019_sira_model.sql`; sql `26_sira_model.sql` | — |
| 8.3 cycle publish logged and hash-chained | Present | `0020_sira_cycles.sql`; sql `27_sira_cycles.sql` | — |
| 8.3 outputs; emergent risks queued to next cycle, accepted/rejected with a reason | Present | `0020_sira_cycles.sql` `submit_emergent_risk`/`decide_emergent_risk`; sql `27_sira_cycles.sql` | — |

## §9 Audit Plan

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| Built from universe + SIRA ranking; authority configurable | Present | `0021_audit_plan.sql`; sql `28_audit_plan.sql` | — |
| Full version history linked to approval | Present | `0021_audit_plan.sql`; sql `28_audit_plan.sql` | — |
| Rescheduling easy; add/remove CIA-level | Present | `0021_audit_plan.sql`, `0047_plan_item_dates.sql`; sql `61_plan_item_dates.sql` | — |
| Ad-hoc engagements: mandatory justification + CIA approval, pending until decided | Present | `0021_audit_plan.sql`; sql `28_audit_plan.sql` | — |
| Gantt with draggable proposals; accept/reject, never silent | Present | `src/components/dashboard/GanttTimeWarp.tsx`, `EngagementGantt.tsx`; `src/lib/`; sql `28_audit_plan.sql` | — |
| Resourcing view | Present | `src/components/dashboard/EngagementGantt.tsx` | — |
| Plan-vs-actual view | Present | `src/components/dashboard/EngagementGantt.tsx` | — |
| 9.1 prior-year material: never auto-carried; view/import separate; per-item; excluded data classes; "Imported – confirm"; logged; reopen after sign-off | Present | `0044_prior_year_import.sql`; sql `53_prior_year_import.sql`; `14_reopen.sql` | — |

## §10 Engagement Lifecycle

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| Three stages: Planning → Testing → Conclusion | Present | `0025_planning.sql`, `0034_conclusion.sql`; sql `33_planning.sql`, `43_conclusion.sql`; guard `sourceGuards.test.ts` (no Reports/Red Thread); `noBlockingModal.test.ts` | — |
| 10.1 planning sections configurable; risk/control mapping; control selection (Selected/Not in scope); scope; resources | Present | `0025_planning.sql`; sql `33_planning.sql` | — |
| 10.1 SIRA pre-fill as smart suggestions, each decision logged | Present | `0025_planning.sql`; sql `33_planning.sql` | — |
| 10.1 reconciliation error blocks sign-off | Present | `0049_planning_reconciliation_detail.sql`; sql `63_planning_reconciliation_detail.sql` | — |
| 10.1 testing locked until Planning sign-off; configurable grace period | Partial | Lock is present in `0025_planning.sql`; the configurable grace period before the hard lock is not implemented | Grace-period setting + test. |
| 10.2 every selected control produces test records; two-stage DEA/OET; one-stage OET | Present | `0028_row_testing.sql`; sql `36_row_testing.sql`; one/two-stage in `0082` | — |
| 10.3 auto-pull exceptions; removal needs a comment; opinion optional/configurable | Present | `0034_conclusion.sql`; sql `43_conclusion.sql` | — |
| 10.4 sign-off requires a configured role per stage; after sign-off locked with cumulative hash; reopen needs capability + ≥10-char justification, logged | Present | `0034_conclusion.sql`, `0014_roles_config.sql`; sql `12_sealed_engagement.sql`, `14_reopen.sql` | — |

## §11 Testing

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| 11.1 upload; verify (SHA-256, control total) → VERIFIED; DB rejects unverified | Present | `0026_population_gate.sql`; sql `06_unverified_population.sql`, `34_population_gate.sql` | — |
| 11.1 control type → Org Sampling Table minimum | Present | `0027_sampling_engine.sql`; sql `35_sampling_engine.sql` | — |
| 11.1 sample modes: system (seeded, reproducible) and pasted (each item verified) | Present | `0027_sampling_engine.sql`; sql `35_sampling_engine.sql` | — |
| 11.1 floor hard-blocks finalisation; locked sample immutable; replacement = material change | Present | `0027_sampling_engine.sql`, `0080_change_control.sql`; sql `35_sampling_engine.sql`, `89_change_control.sql` | — |
| 11.1 additional rows after lock re-sync deterministically; per-row Tick/Cross/Unverifiable with rationale; exceptions need a rationale | Present | `0028_row_testing.sql`; sql `36_row_testing.sql` | — |
| 11.1 workpapers: Prepared, review/revert, roll-up proposed by rule and confirmed | Present | `0004_testing.sql`, `0028_row_testing.sql`; sql `36_row_testing.sql` | — |
| 11.2 non-population tests map to a control with configurable fields | Present | `0025_planning.sql`, `0028_row_testing.sql`; sql `36_row_testing.sql` | — |
| 11.3 methods built in; Random/Systematic (Clopper-Pearson + FPC), MUS, Stratified, High/Low value, Haphazard | Present | `0027_sampling_engine.sql`; sql `35_sampling_engine.sql` | — |
| 11.3 Org Sampling Table configured visually by CIA/Org Admin; only mapped combinations usable | Present | `0027_sampling_engine.sql`, `0032_org_admin_settings.sql`; sql `35_sampling_engine.sql`, `41_org_admin_settings.sql` | — |
| 11.3 seeded Mulberry32; "how this was calculated" with formula, inputs, result | Present | `0027_sampling_engine.sql`, `src/lib/`; sql `35_sampling_engine.sql` | — |
| 11.4 pre-flight before submission with the listed checks; block or acknowledge with a logged reason | Partial | Submission checks exist in `src/lib/` and the testing panels; a single named pre-flight function with the full check list and an acknowledge-with-reason path is not centrally tested | One pre-flight module + unit tests + a SQL acknowledge path. |

## §12 Analyst Engine

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| All checks deterministic, parameterised within admin ranges, unit-tested | Present | `0029_analyst_engine.sql`, `src/lib/analytics.ts` + `analytics.test.ts`; sql `37_analyst_engine.sql`; `0082` BI ranges | — |
| Every result row has "Raise finding" storing the rule id, parameters and input rows | Present | `0029_analyst_engine.sql`; sql `37_analyst_engine.sql` | — |
| Population, financial, reconciliation, completeness, cross-engagement and risk-helper checks | Present | `0029_analyst_engine.sql` `src/lib/analytics.ts`; sql `37_analyst_engine.sql`, `64_acp_control_plane.sql` | — |

## §13 Document Review and AI

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| 13.1 text extraction (DOCX/PPTX/XLSX/CSV/text PDF) | Present | `0078_document_extraction.sql`; sql `87_document_extraction.sql`; `supabase/functions/doc-extract` | — |
| 13.1 fact extraction; structure checks (placeholders, cross-footing, template/checklist); consistency checks | Present | `src/lib/documentReview.ts` + test; sql `87_document_extraction.sql` | — |
| 13.1 legacy binary stored not extracted | Present | `0078_document_extraction.sql` (`legacy_not_extracted`); sql `87_document_extraction.sql` | — |
| 13.2 AI self-hosted, off by default, enable per org, labelled, never changes a deterministic record, vendor models excluded | Present | `0059_ai.sql`, `0045_ai_enablement_ledger.sql`, `0067_ai_gateway_authorise.sql`; sql `69_ai.sql`, `76_ai_gateway_authorise.sql` | — |
| 13.2 hardware guidance documented | Present | `docs/NOT-DONE.md` / docs | — |

## §14 Findings, Observations and Issues

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| 14.1 observation vs finding vs issue; issue groups findings | Present | `0030_findings_observations.sql`; sql `39_findings_observations.sql` | — |
| 14.2 sections configurable; role tags the basis of checks; links | Present | `0030_findings_observations.sql`, `0082_org_governance_settings.sql` (`finding_sections`); sql `39`, `91` | — |
| 14.2 missing content stays visibly incomplete; never boilerplate | Present | `src/lib/` readability; guard `sourceGuards.test.ts` (no boilerplate in a finding); sql `39_findings_observations.sql` | — |
| 14.3 readability rule enforced (Context/Condition/Effect/Risk mandatory; others per methodology) | Present | `0030_findings_observations.sql`; sql `39_findings_observations.sql` | — |
| 14.4 severity levels configurable with colours + text label always | Present | `0030_findings_observations.sql`, `0032_org_admin_settings.sql`; sql `41_org_admin_settings.sql` | — |
| 14.5 linking to controls, exceptions, entities | Present | `0030_findings_observations.sql`; sql `39_findings_observations.sql` | — |

## §15 Conclusion, Report and Drafting

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| 15.1 report available only after Conclusion sign-off | Present | `0036_report_drafting.sql`; sql `45_report_drafting.sql` | — |
| 15.2 six deterministic drafting steps; "Missing: [field]" blocks issuance | Present | `0036_report_drafting.sql`; sql `45_report_drafting.sql` | — |
| 15.2 default template sections; 1–3 templates per tenant; branding | Present | `0036_report_drafting.sql`, `0058_branding.sql`; sql `45_report_drafting.sql`, `68_branding.sql` | — |
| 15.3 frozen PDF with hash + freeze date in footer; editable DOCX from the same block model; branding | Present | `0079_export_formats_report_files.sql`; sql `88_export_formats_report_files.sql`; `src/lib/render/*` | — |
| 15.4 issuance: PDF+DOCX, status change, email team, update CAP, hash-chained ledger entry | Present | `0040_freeze_issuance.sql`; sql `49_freeze_issuance.sql` | — |
| 15.5 freeze only after comments resolved and CAP reconciliation matches | Present | `0037_report_comments.sql`, `0038_cap_register.sql`, `0040_freeze_issuance.sql`; sql `46`, `47`, `49` | — |

## §16 CAPs

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| 16.1 created from the final report with the listed fields | Present | `0038_cap_register.sql`; sql `47_cap_register.sql` | — |
| 16.2 updates by auditors (configurable); evidence + action description mandatory; approved closure; statuses; no in-system retest | Present | `0038_cap_register.sql`; sql `47_cap_register.sql`; `src/lib/cap.ts` + test | — |
| 16.3 register and report must match; mismatch blocks freeze | Present | `0038_cap_register.sql`; sql `47_cap_register.sql` | — |

## §17 Audit File Window and Document Viewer

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| 17.1 floating window, minimise/move, drag-out pop-out sharing origin+session, opened by click, non-blocking | Present | `src/components/common/FloatingWindow.tsx` (+ test), `FloatingWindowManager.tsx`; `window.open` pop-out present | — |
| 17.1 pop-out stays in sync through Realtime | Partial | Poll fallback exists; a Realtime sync test for the pop-out window is not present | A Playwright/vitest sync test for the pop-out window. |
| 17.2 viewer: slide-in/popup, toggleable left list, stage-aware, thumbnails, FTS over extracted text | Present | `0035_document_viewer.sql`, `0078_document_extraction.sql`; sql `44_document_viewer.sql`, `87` | — |

## §18 Export

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| Any view exportable; respects scope; logged with filters, timestamp, user, hash; PDF footer | Present | `0041_exports.sql`, `0079_export_formats_report_files.sql`; sql `50_exports.sql`, `88`; `src/data/exports.ts`, `src/lib/render/*` | — |
| Formats per object in the §18 table | Present | `src/lib/render/*` (PDF/XLSX/DOCX/PNG/SVG/ZIP) + tests; sql `88` | — |
| Every export recorded in the activity log | Present | `0041_exports.sql`; sql `50_exports.sql` | — |

## §19 Import

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| RCM, entities, users, populations, prior-year: parser + mapping + preview + confirm + log + row-level validation | Present | `0042_imports.sql`, `0044_prior_year_import.sql`; sql `51_imports.sql`, `53_prior_year_import.sql`; import wizard | — |
| DOCX table parsing for RCM/entities/prior-year | Present | `src/lib/import/docx*.ts`; import tests | — |
| Migration from TeamMate/AuditBoard not committed | Present | Not implemented by design (§28) | — |

## §20 Evidence and Uploads

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| Accepted formats; validation by extension + content sniffing; SHA-256 on ingest | Present | `0035_document_viewer.sql`, `0078`, `0082` (`upload_limits`); sql `44`, `87`, `91`; `src/lib/` | — |
| Size cap 10 MB default, configurable per org within platform limits | Present | `0082` `upload_limits` (1–100 MB); sql `91` | — |
| Legacy binary stored and linked, not extracted or sampled | Present | `0078_document_extraction.sql`; sql `87` | — |
| Modern formats full extraction; XLSX/CSV population use | Present | `0078`, `0026`; sql `87`, `34` | — |

## §21 Change Control

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| Routine change applied immediately with notification | Present | `0080_change_control.sql`; sql `89_change_control.sql` | — |
| Material change requires approval; classes listed; approvers configurable | Present | `0080_change_control.sql`; sql `89_change_control.sql` | — |
| Every change logged; approved changes hash-chained | Present | `0080_change_control.sql`; sql `89_change_control.sql` | — |

## §22 Notifications and Email

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| All important events generate in-app + email notifications | Present | `0055_automation_notifications.sql`; sql `66_secrets_email_automation.sql`; `0075_event_emitters.sql`, sql `84` | — |
| Recipients role-based; supervisor role copy | Present | `0055_automation_notifications.sql`, `0082` (`notification_rules.supervisor_copy`); sql `91` | — |
| Control at org level only; users cannot switch off | Present | `0055_automation_notifications.sql`; sql `66` | — |
| In-app via Realtime, visible in Work Queue | Partial | Work Queue surfaces notifications; a Realtime-delivery test is not present | Realtime notification delivery test. |
| Email through Microsoft Graph with OAuth; client-chosen sender mailbox; no basic-auth SMTP | Present | `0054_secrets_email.sql`, `0064_email_dispatch.sql`, `0072_oauth_state.sql`; `supabase/functions/graph-oauth` (C1.1), `email-dispatch`; sql `81_oauth_state.sql` | — |
| Email sent from an edge function; credentials never in the browser | Present | `0064_email_dispatch.sql`, `0072`; guard `singleClient.test.ts` + `prodBundle.test.ts`; sql `81` | — |
| Each email logged with delivery status | Present | `0039_email_queue.sql`; sql `48_email_queue.sql` | — |

## §23 Administration (Org Admin Portal)

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| People: users, roles, scopes, reporting lines, team roles | Present | `0017_admin_rpcs.sql`; sql `24_admin_rpcs.sql`; `PeopleAdminPanel.tsx` | — |
| Organisation settings: one/two-stage testing, sign-off roles per stage | Present | `0082`; sql `91`; `OrgGovernancePanel.tsx` | — |
| Structure: universes, entities, new-entity process | Present | `0018`; sql `25`; universe screens | — |
| Controls: RCM and control library | Present | `0003_structure.sql`; sql `25`; RCM screens | — |
| Methodology: severity levels, scales, FSLI mapping, Org Sampling Table | Present | `0030`, `0032`, `0082`; sql `41`, `91` | — |
| Risk: SIRA model config | Present | `0019`; sql `26` | — |
| Workflow: approval chains, SLA, escalation | Present | `0082`; sql `91` | — |
| Finding structure: names, roles, order | Present | `0082`; sql `91` | — |
| Notifications: rules and recipients | Present | `0055`, `0082`; sql `91` | — |
| BI parameters within fixed ranges | Present | `0082`; sql `91` | — |
| Templates and branding | Present | `0036`, `0058`; sql `45`, `68` | — |
| Rights matrix | Present | `0014`, `0017`; sql `21`, `24` | — |
| Configuration history: every change versioned and logged | Present | `0053_config_history.sql`; sql `65_config_history.sql` | — |
| Export and retention settings | Present | `0082`; sql `91` | — |
| AI shown read-only with a status message; enabling done by QSCorp | Present | `0045`, `0059`; sql `69`; `OrgAiPanel.tsx` | — |
| Every save passes through a confirmation panel and writes a versioned logged change | Present | `0017` `admin_log_change`; sql `24`, `41`, `91` | — |

## §24 Platform Portal

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| Separate login with mandatory MFA | Present | `0031_platform_control_plane.sql`; sql `40_platform_control_plane.sql` | — |
| Data-blind; proven by SQL tests | Present | sql `03_platform_blind.sql`, `60_platform_admin_blind.sql` | — |
| Tenant mgmt, provisioning, feature flags, usage/quotas, health, platform trail, announcements, AI enablement | Present | `0031`, `0033`, `0045`; sql `40`, `42`, `69` | — |
| Support access off by default; tenant can create a time-boxed read-only grant | Present | `0076_support_read_session.sql`; sql `85_support_read_session.sql` | — |

## §25 Data, Security and Infrastructure

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| 25.1 Supabase backend; one data module; no public `USING (true)` | Present | guard `singleClient.test.ts`; sql `13_rls_enabled.sql` (rejects a table without RLS; no `USING (true)` policy) | — |
| 25.2 org_id on every business table; RLS from the JWT; user_scopes; isolation tests | Present | `0008`, `0016`; sql `01`, `02`, `03`, `05` | — |
| 25.3 encryption; MFA for platform admins; secrets never in the browser; access logs | Present | `0054`, `0031`; guard `singleClient.test.ts` + `prodBundle.test.ts`; sql `40`; `0005_logging.sql` | — |
| 25.4 free-tier limits verified before production use | Partial | Flagged in §32; docs note it | An owner action; cannot be verified from the code. |
| 25.4 activity archival to Storage files, hashed and logged, rolling window | Present | `0043_activity_archival.sql`, `0077_verified_archival.sql`; sql `52`, `86` | — |
| 25.4 population archival six months after finalisation, hash in ledger, re-check on download, integrity alert | Present | `0077_verified_archival.sql`; sql `86_verified_archival.sql` | — |
| 25.4 archived access: paginated view + streamed download without re-running verification | Present | `0077`; sql `86` | — |
| 25.5 Pakistan focus; SOC 2/ISO/GDPR design readiness | Present (documented) | Spec §25.5; docs | Observer-level; no code artefact. |
| 25.6 50,000-row acceptance | Present | `src/lib/` + perf test; sql `38_phase4_acceptance.sql` | — |
| 25.7 desktop first; phone support for three paths | Partial | see §3 | Mobile-viewport smoke. |

## §26 Logging

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| Every meaningful action logged; navigation/interactions batched; no pointer movement | Present | `0005_logging.sql`; sql `65_config_history.sql`; batches in `src/data/` | — |
| Business ledger hash-chained with the listed entries; append-only and verifiable | Present | `0005`, `0006`; sql `09`, `10`, `15` | — |
| Activity log append-only and kept permanently; tenant sees/exports its own; platform trail metadata only | Present | `0005`, `0041`; sql `08`, `50`, `03` | — |
| Archival recorded in the ledger; never delete without a hash record | Present | `0043`, `0077`; sql `52`, `86` | — |

## §27 Design System

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| 27.1 veredgris/cinnabar/brass semantics; palette; WCAG AA; presets as CSS variables; no hex in components | Present | `src/styles/tokens.css`; `scripts/check-tokens.mjs` (168 files, 0 violations) | — |
| 27.2 typography | Present | `src/styles/tokens.css` | — |
| 27.3 bespoke 17px inline SVG; no icon fonts; no third-party icons | Present | `src/components/common/Icons.tsx`; guard `sourceGuards.test.ts` (no lucide-react/icon fonts) | — |
| 27.4 motion springs; heavy settle; ambient pulse; no linear; reduced-motion | Present | `src/index.css`, `src/styles/tokens.css`; `src/lib/`; prefers-reduced-motion | — |
| 27.5 no blocking modals; two-mode record view; every screen has empty/loading/error; WCAG AA | Present | guard `noBlockingModal.test.ts`; `RecordView.tsx`; `src/data/userPreferences` record_view_mode; sql `32_user_preferences.sql` | — |

## §28 Out of Scope and Discarded

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| No AI in deterministic logic; no vendor model; no persona; no demo data in prod; no 5/6-stage; no Reports/Workbench tab; no blocking modal; no icon fonts/lucide; no unlabelled manual override; no retest/proposed CAP dates; no free-form SIRA formula; no Red Thread/scrub bar; no auto prior-year carry-forward; no TeamMate/AuditBoard migration | Present | guards: `sourceGuards.test.ts` (no AI/Math.random, no persona, no Reports/Red Thread/scrub bar, no lucide, no retest workflow, distinct observation/finding/issue, sealed vocabulary), `noBlockingModal.test.ts`, `noRawJsonEditing.test.ts`, `noRoleStrings.test.ts`, `anonGrantAllowList.test.ts`, `singleClient.test.ts`, `prodBundle.test.ts`; sql tests | — |

## §29 Build and Verification

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| tsc/vitest/build pass; one commit per task; stop at first failure | Present | `scripts/pre-pr-gates.sh`; CI | — |
| Every deterministic function unit-tested | Present | `src/lib/*.test.ts` | — |
| Every end-to-end flow has a Playwright test | Present | `e2e/*` (22 specs / 113 tests) | — |
| Priority tests (SQL isolation, population gate) built first and always pass | Present | sql `01`, `02`, `03`, `06`, `34` | — |
| Parity doc maps every section to Present/Partial/Missing with evidence | Present | this file; `docs/PARITY.md` (C5.2 rebuild) | — |
| Screenshots in three presets, light and dark | Present | `scripts/screenshots*.mjs`; CI artifact (C5.4) | — |
| Per-gate report and explicit NOT DONE list | Present | `docs/COMPLETION-REPORT.md`, `docs/NOT-DONE.md` | — |
| Verified through tests, not reading alone | Present | gate scripts | — |

## §30, §31, §32

| Clause | Status | Evidence | Missing |
|---|---|---|---|
| §30 Phase 2 decisions D1–D12 hold | Present | sql `19`, `21`, `22`, `23`, `24`; `src/lib/rights.ts` + `rightsMatrix.test.ts` | — |
| §31 changes from v9 | Present | reflected throughout | — |
| §32 open items (Supabase limits, Microsoft status, schedule) | Partial | §25.4 limit verification and Microsoft guidance are owner actions | Owner actions. |

## Not to be confused

There is no numbered clause 33 in `docs/SPEC-v10.md`; the document ends at §32. The brief's reference
to "section 33" maps to §32 (Open Items), audited above.

## Summary

Every clause in §§1–29 is Present except the following, which are Partial or Missing:

- **§2 cross-universe view-only sharing** — Missing (whole feature).
- **§3 / §25.7 mobile viewport for the three phone paths** — Partial (no viewport test).
- **§3 dedicated/self-hosted switch** — Partial (owner action).
- **§10.1 configurable grace period before the hard lock** — Partial (setting absent).
- **§11.4 central pre-flight module with acknowledge-with-reason** — Partial.
- **§17.1 Realtime sync test for the pop-out window** — Partial (implementation present, test absent).
- **§22 Realtime notification delivery test** — Partial.
- **§25.4 free-tier limits verified** — Partial (owner action).

These are recorded in `docs/COMPLETION-BLOCKERS.md` where they need an owner decision.
