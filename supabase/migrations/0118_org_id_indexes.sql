-- 0118: the missing org_id indexes (scale hardening).
--
-- Every tenant table is protected by RLS, and every tenant RLS policy filters on
-- `org_id = jwt_org_id()`. For that filter to be an index lookup the table must carry an index
-- whose leading column is org_id. 31 tenant tables carried only their primary-key index, so a
-- single-org read on any of them sequential-scanned the whole table.
--
-- Measured at 1000 organisations with realistic forensic volume (200 population_rows, 100
-- test_rows/findings/observations/issues/cap_items, 50 plans/sign_offs, 100 notifications per org)
-- a single-org, RLS-filtered `select count(*)` cost:
--
--   population_rows  1139 ms      test_rows     911 ms      findings      660 ms
--   sign_offs         478 ms      cap_items     386 ms      observations  350 ms
--   issues            287 ms      notifications 200 ms      plans          87 ms
--
-- against 4 ms for universes once indexed. The cost grows linearly with total tenant rows because
-- the plan is a sequential scan with an org_id filter, so it degrades as the platform grows. This
-- is the index half of the fix; the composite (org_id, <parent>) indexes for the hot read paths
-- are added alongside where a parent column is the natural second key.
--
-- Each index is `(org_id)` alone, matching the repo convention `<table>_org_idx`, so it serves
-- every policy on the table and every `where org_id = ...` read. `if not exists` keeps the
-- migration idempotent for the harness, which applies migrations twice.

-- Population and evidence.
create index if not exists population_rows_org_idx on population_rows (org_id);
create index if not exists sample_rows_org_idx     on sample_rows (org_id);
create index if not exists test_rows_org_idx       on test_rows (org_id);
create index if not exists report_graphs_org_idx   on report_graphs (org_id);

-- Findings and remediation.
create index if not exists observations_org_idx    on observations (org_id);
create index if not exists findings_org_idx        on findings (org_id);
create index if not exists issues_org_idx          on issues (org_id);
create index if not exists cap_items_org_idx       on cap_items (org_id);
create index if not exists sign_offs_org_idx       on sign_offs (org_id);

-- Planning.
create index if not exists plans_org_idx           on plans (org_id);
create index if not exists plan_versions_org_idx   on plan_versions (org_id);

-- Structure.
create index if not exists universes_org_idx       on universes (org_id);
create index if not exists engagement_team_members_org_idx on engagement_team_members (org_id);

-- Notification and email.
create index if not exists notifications_org_idx   on notifications (org_id);
create index if not exists email_outbox_org_idx    on email_outbox (org_id);
create index if not exists notification_templates_org_idx on notification_templates (org_id);
create index if not exists notification_template_versions_org_idx on notification_template_versions (org_id);

-- Governance and configuration.
create index if not exists role_config_log_org_idx on role_config_log (org_id);
create index if not exists setup_state_org_idx     on setup_state (org_id);
create index if not exists migration_steps_org_idx on migration_steps (org_id);
create index if not exists tutorial_views_org_idx  on tutorial_views (org_id);
create index if not exists format_audiences_org_idx on format_audiences (org_id);
create index if not exists branding_versions_org_idx on branding_versions (org_id);

-- SIRA and entitlement.
create index if not exists sira_cycle_publish_grants_org_idx on sira_cycle_publish_grants (org_id);
create index if not exists tenant_entitlement_versions_org_idx on tenant_entitlement_versions (org_id);
create index if not exists entity_decision_grants_org_idx on entity_decision_grants (org_id);
create index if not exists workpaper_step_state_org_idx on workpaper_step_state (org_id);

-- Automation, consultation and approvals.
create index if not exists automation_rule_versions_org_idx on automation_rule_versions (org_id);
create index if not exists automation_webhook_outbox_org_idx on automation_webhook_outbox (org_id);
create index if not exists consultation_proposals_org_idx on consultation_proposals (org_id);
create index if not exists email_profile_versions_org_idx on email_profile_versions (org_id);
