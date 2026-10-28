# Config effect matrix — every configurable field, its effect, and the test that proves it

Companion to `docs/FUNCTIONALITY-AUDIT.md` (what is built) and `docs/REMEDIATION-PLAN.md` Part 2 (the
plan). This document is the proof for Phase 3: **a setting that can be saved must be enforced, or it
must not be offered.**

Owner decision (2026-10-28, locked): enforce, do not remove. So every field below is either
**ENFORCED** (a decision in the product reads it, and a named test proves the behaviour changes) or
**HIDDEN** (it is not surfaced in the UI, so no user can set it; recorded here as deferred).

Method. Every claim was verified by grepping the call site, not by trusting a doc or a green test
(the one rule for this repo). For each field we record the reader — the function that consults it —
and the proving test. The classification was produced by parsing every `create function` body in
`supabase/migrations/` and attributing each column reference to its owning function, then excluding
pure echo functions (getters, setters, seeders) so that "stored and echoed" does not count as
"enforced". The script and its output are reproducible; the inert set it produced was exactly the
eight fields Phase 3.6 fixed.

---

## 1. Summary

| Surface | Fields | Enforced | Hidden / deferred |
|---|---|---|---|
| `org_lifecycle_settings` | 6 | 6 | 0 |
| `workflow_settings` | 5 | 5 | 0 |
| `export_retention_settings` | 3 | 3 | 0 |
| `org_settings_extra` | 8 | 8 | 0 |
| `entity_approval_settings` | 3 | 3 | 0 |
| `plan_approval_settings` | 2 | 2 | 0 |
| `engagement_gate_settings` | 5 | 5 | 0 |
| `pattern_settings` | 5 | 5 | 0 |
| `tenant_settings` | 2 | 2 | 0 |
| `invite_cap_settings` | 1 | 1 | 0 |
| `anchoring_settings` | 1 | 1 | 0 |
| `certificate_config` | 1 (×10 rows) | 1 | 0 |
| `change_control_settings` | 4 | 4 | 0 |
| `report_templates` | 1 | 1 | 0 |
| `notification_templates` | 1 | 1 | 0 |

The eight fields Phase 3.6 fixed (previously stored and echoed, read by no decision) are marked
**FIXED 3.6** below. Every other row was already enforced before Phase 3.6; the reader named is the
call site that proves it.

---

## 2. Lifecycle and workflow

| Table.field | Effect (what choosing it does) | Reader (call site) | Status | Proving test |
|---|---|---|---|---|
| `org_lifecycle_settings.testing_mode` | `one_stage` needs only an operating (OET) workpaper before Conclusion; `two_stage` also needs a signed-off design (DEA) workpaper | `assert_conclusion_ready`, `set_engagement_stage`, `seal_engagement` | ENFORCED | `102_phase2_lifecycle.sql` §2 |
| `org_lifecycle_settings.signoff_role_planning` | The team role that must sign Planning off; a caller without that role's rights is refused | `sign_planning` via `caller_meets_signoff_role` | ENFORCED | `102_phase2_lifecycle.sql` §3 |
| `org_lifecycle_settings.signoff_role_testing` | The team role that must sign Testing off | `sign_testing` via `caller_meets_signoff_role` | ENFORCED | `102_phase2_lifecycle.sql` §3 |
| `org_lifecycle_settings.signoff_role_conclusion` | The team role that must sign the Conclusion off | `sign_conclusion` via `caller_meets_signoff_role` | ENFORCED | `102_phase2_lifecycle.sql` §3 |
| `org_lifecycle_settings.report_opinion_required` | When true, `sign_conclusion` is refused while the overall opinion is empty | `sign_conclusion` | **FIXED 3.6** | `110_phase3_config_effects.sql` §1 |
| `org_lifecycle_settings.testing_grace_hours` | Testing stays locked for this many hours after the engagement is created, even before Planning sign-off | `testing_lock_active` (the workpaper trigger) | ENFORCED | `100_scale_harden.sql`, `0095` |
| `workflow_settings.approval_chain` | An ordered array of `{"role"}` steps; before a plan is approved every step must be recorded in order by a caller holding that role | `approve_plan`, `approval_chain_ready` | ENFORCED | `102_phase2_lifecycle.sql` §4 |
| `workflow_settings.sla_hours` | The due time a deployment/change request is given | `request_combined_deployment`, `request_change` | ENFORCED | `108_phase3_workflow_enforcement.sql` §1 |
| `workflow_settings.escalation_role` | The role a request escalates to when it passes its escalation window | `deployment_requests_escalate_all`, `escalate_overdue_deployment_requests` | ENFORCED | `108_phase3_workflow_enforcement.sql` §2 |
| `workflow_settings.escalation_hours` | How long after creation a pending request escalates (must be ≥ SLA) | same as above | ENFORCED | `108_phase3_workflow_enforcement.sql` §2 |

## 3. Gates, approvals and rights

| Table.field | Effect | Reader | Status | Proving test |
|---|---|---|---|---|
| `engagement_gate_settings.deploy_right` | The right a caller needs to deploy an engagement | `deploy_engagement`, `decide_combined_deployment` | ENFORCED | `29_deployment_gate.sql` |
| `engagement_gate_settings.approve_right` | The right a caller needs to approve a deployment | `deploy_engagement` | ENFORCED | `29_deployment_gate.sql` |
| `engagement_gate_settings.sla_hours` | The gate's SLA when the workflow SLA is unset | `request_combined_deployment` | ENFORCED | `30_combined_approval.sql` |
| `engagement_gate_settings.escalate_right` | The right required to escalate a request | `deployment_requests_escalate_all` | ENFORCED | `30_combined_approval.sql` |
| `plan_approval_settings.create_right` | The right needed to create a plan | `create_plan`, `add_plan_item` | ENFORCED | `28_audit_plan.sql` |
| `plan_approval_settings.approve_right` | The right needed to approve a plan | `approve_plan` | ENFORCED | `28_audit_plan.sql` |
| `entity_approval_settings.initiate_right` | The right needed to add/submit an entity | `add_entity`, `submit_entity` | ENFORCED | `25_universes_entities.sql` |
| `entity_approval_settings.approve_right` | The right needed to approve/reject an entity | `decide_entity` | ENFORCED | `25_universes_entities.sql` |
| `entity_approval_settings.required_fields` | The entity fields that must be present before an entity can be submitted | `submit_entity` | **FIXED 3.6** | `110_phase3_config_effects.sql` §2 |
| `change_control_settings.approver_right` | The right needed to decide a change request | `decide_change` | ENFORCED | `89_change_control.sql` |
| `change_control_settings.routine_classes` | The change classes treated as routine (fast path) | `request_change` | ENFORCED | `89_change_control.sql` |
| `change_control_settings.sla_hours` | The change request SLA | `request_change` | ENFORCED | `89_change_control.sql` |
| `change_control_settings.escalate_right` | The right required to escalate a change | `deployment_requests_escalate_all` | ENFORCED | `89_change_control.sql` |
| `tenant_settings.feature_flags` | Per-tenant feature switches, read by `has_feature` | `has_feature`, `platform_list_tenants` | ENFORCED | `74_feature_gates.sql` |
| `tenant_settings.status` | `suspended` blocks writes across the product | read by ~120 RPCs' status guards | ENFORCED | `40_platform_control_plane.sql` |
| `tenant_settings.usage_quota` | A tenant user limit (`{"users": n}`); when set, provisioning beyond it is refused | `admin_provision_member` via `tenant_user_limit` | **FIXED 3.6** | `110_phase3_config_effects.sql` §7 |
| `invite_cap_settings.per_user_daily` | The per-user daily invitation cap | `invite_user_capped` | ENFORCED | `40_platform_control_plane.sql` |
| `roles.rights` | The rights a role carries; `caller_has_right` reads them for every guard | `caller_has_right` | ENFORCED | `19_rights_closed.sql` |

## 4. Reporting, retention and evidence

| Table.field | Effect | Reader | Status | Proving test |
|---|---|---|---|---|
| `export_retention_settings.export_schedule` | `manual` never exports on a schedule; daily/weekly/monthly make `scheduled_export_due` true once the interval has elapsed | `scheduled_export_due` via `export_schedule` | **FIXED 3.6** | `110_phase3_config_effects.sql` §4b |
| `export_retention_settings.activity_retention_days` | The live-retention boundary; `archive_activity_period` clamps the archived range to it, so newer activity is never archived out of the live window | `archive_activity_period` via `activity_retention_days` | **FIXED 3.6** | `110_phase3_config_effects.sql` §4a |
| `export_retention_settings.population_retention_months` | The population retention period | `population_retention_months` | ENFORCED | `86_verified_archival.sql` §7 |
| `org_settings_extra.app_base_url` | The base URL used to build verification links/QR codes; Board Pack generation refuses without it | `board_pack_generate` | ENFORCED | `71_board_pack.sql` |
| `org_settings_extra.last_board_meeting_date` | The start of a `since_last_meeting` Board Pack window | `board_pack_generate` | **FIXED 3.6** | `110_phase3_config_effects.sql` §6 |
| `org_settings_extra.certificate_auto_issue` | When true, sealing an engagement issues its certificate automatically | `seal_engagement` | **FIXED 3.6** | `110_phase3_config_effects.sql` §5 |
| `org_settings_extra.public_verify_show_title` | Whether the org name and engagement title appear on the public verification surface | `ext_verify_certificate`, `verify_certificate` | ENFORCED | `72_certificate.sql` |
| `org_settings_extra.population_archive_after_months` | How old a finalised population must be before it is due for archival | `population_retention_months` | ENFORCED | `86_verified_archival.sql` §7 |
| `org_settings_extra.cap_due_soon_days` | The window inside which a CAP is reported as "due soon" | `escalation_evaluate` via `cap_due_soon_days` | ENFORCED | `70_escalation.sql` |
| `org_settings_extra.time_zone` | The time zone scheduled jobs evaluate "today" in | `scheduled_jobs` | ENFORCED | `74_scheduled_jobs.sql` |
| `report_templates.plan` | The section list a composed report uses | `compose_report` | ENFORCED | `109_phase3_report_templates.sql` |
| `notification_templates` | The subject/blocks a queued notification renders from | `render_notification` | ENFORCED | `82_rpc_authority.sql` |
| `upload_limits.max_file_mb` / `allowed_extensions` | The evidence upload size and file-type limits the client reads | `upload_limits_get` | ENFORCED | `91_org_governance_settings.sql`; `OrgGovernancePanel.test.tsx` |
| `certificate_config` (10 field rows) | Which certificate fields appear, and in what order | `certificate_config_get`, `certificate_issue` | ENFORCED | `72_certificate.sql` §1 |
| `anchoring_settings.min_authorities` | How many independent authorities a sealed report's root must be anchored against | `anchoring_status` | ENFORCED | `101_integrity_anchoring.sql` |

## 5. Insights and methodology

| Table.field | Effect | Reader | Status | Proving test |
|---|---|---|---|---|
| `pattern_settings.similarity_threshold` | The similarity at or above which two findings cluster | `clusterFindings` (TS engine) | ENFORCED | `src/lib/patterns.test.ts` ("a higher threshold splits the cluster") |
| `pattern_settings.min_cluster_size` | The smallest group reported as a cluster | `clusterFindings` (TS engine) | ENFORCED | `src/lib/patterns.test.ts` |
| `pattern_settings.years_back` | How far back the finding corpus is read | `pattern_findings` | ENFORCED | `77_time_travel_patterns.sql` |
| `pattern_settings.severities` | The severities included in the corpus | `pattern_findings` | ENFORCED | `77_time_travel_patterns.sql` |
| `pattern_settings.visibility_right` | The right required to read the pattern corpus | `pattern_findings` | **FIXED 3.6** | `110_phase3_config_effects.sql` §3 |
| `methodology_scales` | The scoring scale points used by SIRA | `sira_compute` | ENFORCED | `91_org_governance_settings.sql`; `26_sira_model.sql` |

## 6. Hidden / deferred (offered nowhere, recorded honestly)

| Table.field | Why it is deferred | Where it is surfaced |
|---|---|---|
| `usage_quota` keys other than `users` | The column is a free-form `jsonb`; Phase 3.6 enforced the `users` key (a user-seat quota). Other keys are not defined by the spec and are not read | none — no UI writes them |

There are no other unenforced configuration columns. The eight fields marked **FIXED 3.6** were the
complete inert set: every column of every configuration table in §1 now has a reader that makes a
decision, proven by the test named in its row.

---

## 7. How to reproduce the classification

The classification is mechanical. For each configuration column, attribute every reference in every
`create function` body in `supabase/migrations/` to its owning function, drop the pure echo functions
(`*_get`, `*_list`, `*_config`, `*_seed`, `*_save`, `admin_save_*`, `admin_set_*`, `platform_get_*`,
`platform_set_*`, `org_settings_extra*`, `*_status`), and the columns left with no reader are the
inert set. Before Phase 3.6 that set was:

```
entity_approval_settings.required_fields
export_retention_settings.activity_retention_days
export_retention_settings.export_schedule
org_lifecycle_settings.report_opinion_required
org_settings_extra.certificate_auto_issue
org_settings_extra.last_board_meeting_date
pattern_settings.visibility_right
tenant_settings.usage_quota
```

`0109_phase3_config_effects.sql` gives each one a reader, and `110_phase3_config_effects.sql` proves
each effect. The two-sources defect for `report_opinion_required` (the UI saved
`org_lifecycle_settings`, but `sign_conclusion` read the legacy `config_versions` key) is closed:
either source now makes the opinion required.
