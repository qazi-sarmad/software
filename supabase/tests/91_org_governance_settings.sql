-- 91_org_governance_settings.sql — C3.2-B, spec §10, §12, §14.2, §20, §22, §23.
-- The remaining administration configuration: lifecycle (one/two-stage, sign-off roles), finding
-- structure, methodology scales and FSLI mapping, workflow/SLA/escalation, notification rules,
-- export/retention, BI parameters within fixed ranges, and upload limits. Every save is a versioned,
-- logged change; every read is org-scoped; every write refuses a caller without edit_config and
-- refuses another org's ids.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------- 1. Lifecycle settings: the Org Admin chooses the testing mode and sign-off roles. ----------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v jsonb;
begin
  perform public.admin_save_lifecycle_settings('one_stage', 'lead', 'reviewer', 'observer', true);
  v := public.lifecycle_settings_get();
  perform provio_test.assert_eq(v ->> 'testing_mode', 'one_stage', 'C3.2-B: the testing mode is saved');
  perform provio_test.assert_eq(v ->> 'signoff_role_testing', 'reviewer', 'C3.2-B: the Testing sign-off role is saved');
  perform provio_test.assert_eq((v ->> 'report_opinion_required')::boolean, true,
    'C3.2-B: the overall opinion can be made required');
  -- The change is a versioned, logged configuration change (L5, §23).
  perform provio_test.assert_true(
    exists (select 1 from config_versions where org_id = 'a0000000-0000-0000-0000-000000000001'
            and key = 'lifecycle_settings'),
    'C3.2-B: a lifecycle save writes a config version');
  perform provio_test.assert_true(
    exists (select 1 from activity_log where org_id = 'a0000000-0000-0000-0000-000000000001'
            and action = 'lifecycle_settings_saved'),
    'C3.2-B: a lifecycle save writes an activity row');
  -- A sign-off role outside the team roles is refused.
  perform provio_test.assert_raises(
    $q$select public.admin_save_lifecycle_settings('two_stage', 'wizard', 'reviewer', 'reviewer', false)$q$,
    'sign-off role'::text, 'C3.2-B: a sign-off role must be a team role');
  -- An unknown testing mode is refused.
  perform provio_test.assert_raises(
    $q$select public.admin_save_lifecycle_settings('three_stage', 'lead', 'reviewer', 'reviewer', false)$q$,
    'one_stage or two_stage'::text, 'C3.2-B: the testing mode is one_stage or two_stage');
end $$;

-- ---------- 2. Finding structure: role tags are closed, names are free (§14.2). ----------
do $$
declare
  v_id uuid;
  v_label text;
begin
  v_id := public.admin_upsert_finding_section('condition', 'What we found', 2, true);
  select label into v_label from finding_sections where id = v_id;
  perform provio_test.assert_eq(v_label, 'What we found', 'C3.2-B: a finding section can be renamed');
  -- Renaming does not change the role tag, so the readability check keeps working.
  perform provio_test.assert_eq(
    (select role_tag from finding_sections where id = v_id), 'condition',
    'C3.2-B: the role tag is stable across a rename');
  -- An unknown role tag is refused.
  perform provio_test.assert_raises(
    $q$select public.admin_upsert_finding_section('boilerplate', 'Nope', 9, false)$q$,
    'unknown finding role tag'::text, 'C3.2-B: an unknown finding role tag is refused');
  -- Delete works and is logged.
  perform public.admin_delete_finding_section(v_id);
  perform provio_test.assert_eq((select count(*) from finding_sections where id = v_id), 0::bigint,
    'C3.2-B: a finding section can be removed');
end $$;

-- ---------- 3. Methodology: a scale and an FSLI mapping. ----------
do $$
declare
  v_id uuid;
begin
  v_id := public.admin_upsert_methodology_scale('likelihood', 'Likelihood', '[{"point":1,"label":"Rare"}]'::jsonb);
  perform provio_test.assert_true(v_id is not null, 'C3.2-B: a methodology scale is saved');
  perform provio_test.assert_raises(
    $q$select public.admin_upsert_methodology_scale('likelihood', 'Likelihood', '"not an array"'::jsonb)$q$,
    'must be an array'::text, 'C3.2-B: the scale points must be an array');
  perform public.admin_upsert_fsli_mapping('1000', 'Cash and cash equivalents', 'Assets');
  perform provio_test.assert_eq(
    (select category from fsli_mappings where org_id = 'a0000000-0000-0000-0000-000000000001' and code = '1000'),
    'Assets', 'C3.2-B: an FSLI mapping is saved');
end $$;

-- ---------- 4. Workflow: SLA and escalation must be ordered. ----------
do $$
declare
  v jsonb;
begin
  perform public.admin_save_workflow_settings('[{"role":"cia"}]'::jsonb, 24, 'cia', 48);
  v := public.workflow_settings_get();
  perform provio_test.assert_eq((v ->> 'sla_hours')::int, 24, 'C3.2-B: the SLA is saved');
  perform provio_test.assert_eq((v ->> 'escalation_hours')::int, 48, 'C3.2-B: the escalation time is saved');
  perform provio_test.assert_raises(
    $q$select public.admin_save_workflow_settings('[]'::jsonb, 48, 'cia', 24)$q$,
    'at or after the SLA'::text, 'C3.2-B: the escalation must not precede the SLA');
end $$;

-- ---------- 5. Notification rules: recipients by role, with a supervisor copy (§22). ----------
do $$
declare
  v_id uuid;
begin
  v_id := public.admin_upsert_notification_rule('cap.overdue', array['cia', 'audit_manager'], true, true);
  perform provio_test.assert_eq(
    (select supervisor_copy from notification_rules where id = v_id), true,
    'C3.2-B: a notification rule can copy the supervisor');
  perform provio_test.assert_eq(
    (select recipient_roles from notification_rules where id = v_id), array['cia', 'audit_manager'],
    'C3.2-B: notification recipients are role-based');
end $$;

-- ---------- 6. Export and retention, bounded. ----------
do $$
declare
  v jsonb;
begin
  perform public.admin_save_export_retention('weekly', 730, 12);
  v := public.export_retention_get();
  perform provio_test.assert_eq(v ->> 'export_schedule', 'weekly', 'C3.2-B: the export schedule is saved');
  perform provio_test.assert_eq((v ->> 'population_retention_months')::int, 12,
    'C3.2-B: the organisation may set its own population retention period');
  perform provio_test.assert_raises(
    $q$select public.admin_save_export_retention('hourly', 730, 12)$q$,
    'manual, daily, weekly or monthly'::text, 'C3.2-B: an unknown export schedule is refused');
  perform provio_test.assert_raises(
    $q$select public.admin_save_export_retention('weekly', 5, 12)$q$,
    'between 30 and 3650'::text, 'C3.2-B: activity retention is bounded');
end $$;

-- ---------- 7. BI parameters stay inside the platform-fixed range (§12). ----------
do $$
declare
  v_value numeric;
begin
  perform public.admin_set_bi_parameter('outlier_z_threshold', 2.5);
  select value into v_value from bi_parameters
   where org_id = 'a0000000-0000-0000-0000-000000000001' and check_key = 'outlier_z_threshold';
  perform provio_test.assert_eq(v_value, 2.5, 'C3.2-B: a BI parameter inside its range is saved');
  -- Outside the range: the platform range is fixed and the organisation cannot widen it.
  perform provio_test.assert_raises(
    $q$select public.admin_set_bi_parameter('outlier_z_threshold', 0.5)$q$,
    'must be between'::text, 'C3.2-B: a BI parameter below its range is refused');
  perform provio_test.assert_raises(
    $q$select public.admin_set_bi_parameter('not_a_check', 1)$q$,
    'unknown check'::text, 'C3.2-B: an unknown check is refused');
end $$;

-- ---------- 8. Upload limits: the cap is bounded and formats are restricted (§20). ----------
do $$
declare
  v jsonb;
begin
  perform public.admin_save_upload_limits(25, array['pdf', 'xlsx']);
  v := public.upload_limits_get();
  perform provio_test.assert_eq((v ->> 'max_file_mb')::int, 25, 'C3.2-B: the evidence size cap is saved');
  perform provio_test.assert_raises(
    $q$select public.admin_save_upload_limits(500, array['pdf'])$q$,
    'between 1 and 100'::text, 'C3.2-B: the size cap is bounded by the platform');
  perform provio_test.assert_raises(
    $q$select public.admin_save_upload_limits(10, array['exe'])$q$,
    'unsupported format'::text, 'C3.2-B: an unsupported format is refused');
end $$;

-- ---------- 9. A caller without edit_config is refused (Preparer holds perform_work only). ----------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.admin_save_lifecycle_settings('two_stage', 'lead', 'reviewer', 'reviewer', false)$q$,
    'lacks the edit_config right'::text, 'C3.2-B: a caller without edit_config cannot save settings');
  perform provio_test.assert_raises(
    $q$select public.admin_set_bi_parameter('outlier_z_threshold', 3)$q$,
    'lacks the edit_config right'::text, 'C3.2-B: a caller without edit_config cannot set a BI parameter');
end $$;

-- ---------- 10. Cross-org: Org B's Org Admin sees none of Org A's settings and cannot change them. ----------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b3', 'b0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v jsonb;
begin
  -- Org B has saved nothing, so it reads the platform defaults, not Org A's saved values.
  v := public.lifecycle_settings_get();
  perform provio_test.assert_eq(v ->> 'testing_mode', 'two_stage',
    'C3.2-B: Org B reads the default testing mode, not Org A''s one_stage');
  perform provio_test.assert_eq(
    (select count(*) from finding_sections where org_id = 'b0000000-0000-0000-0000-000000000001'), 0::bigint,
    'C3.2-B: Org B sees no finding sections of its own');
  -- A direct select is org-scoped by RLS: Org B cannot read Org A's rows.
  perform provio_test.assert_eq(
    (select count(*) from methodology_scales where org_id = 'a0000000-0000-0000-0000-000000000001'), 0::bigint,
    'C3.2-B: RLS hides another organisation''s methodology scales');
  -- Org B saving its own settings writes only Org B's row (a direct read of Org A's row is hidden by
  -- RLS, so the cross-org proof is that Org B now reads its own value and Org A still reads its own).
  perform public.admin_save_lifecycle_settings('two_stage', 'reviewer', 'reviewer', 'reviewer', false);
  perform provio_test.assert_eq(
    (public.lifecycle_settings_get() ->> 'testing_mode'), 'two_stage',
    'C3.2-B: Org B''s save is visible to Org B');
end $$;

-- Read back as Org A: its own setting is untouched by Org B's save.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_eq(
    (public.lifecycle_settings_get() ->> 'testing_mode'), 'one_stage',
    'C3.2-B: Org B''s save leaves Org A''s setting unchanged');
end $$;

-- ---------- 11. The new read functions and RPCs are never anon-callable (guard anonGrantAllowList). ----------
do $$
begin
  perform provio_test.assert_true(
    not exists (
      select 1 from information_schema.role_routine_grants
       where routine_schema = 'public' and grantee = 'anon'
         and routine_name in ('admin_save_lifecycle_settings', 'admin_upsert_finding_section',
                              'admin_save_workflow_settings', 'admin_set_bi_parameter',
                              'lifecycle_settings_get', 'workflow_settings_get',
                              'export_retention_get', 'upload_limits_get')),
    'C3.2-B: no new function is granted to anon');
end $$;
