-- Test 110 (Phase 3.6): the last inert configuration fields now have an effect.
--
-- Before 0109 these seven columns were stored, versioned and echoed by a getter but consulted by no
-- decision (docs/FUNCTIONALITY-AUDIT.md §2.4, docs/REMEDIATION-PLAN.md Part 2):
--   org_lifecycle_settings.report_opinion_required, entity_approval_settings.required_fields,
--   pattern_settings.visibility_right, export_retention_settings.activity_retention_days,
--   export_retention_settings.export_schedule, org_settings_extra.certificate_auto_issue,
--   org_settings_extra.last_board_meeting_date.
-- Each block changes the value and asserts the product behaves differently, so the field is proven
-- enforced rather than merely stored (docs/CONFIG-EFFECT-MATRIX.md).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Fixture users must exist for engagement-team membership lookups.
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000a1', 'a1@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a3', 'a3@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a4', 'a4@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a5', 'a5@provio-test.invalid')
on conflict (id) do nothing;

-- Two engagements in A-U1 on the approved entity A-E1, each with one signed-off operating workpaper,
-- so a Conclusion can be signed and an engagement can be sealed.
insert into engagements (id, org_id, universe_id, entity_id, title) values
  ('50000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'A-Eng-opinion'),
  ('50000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'A-Eng-seal-off'),
  ('50000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'A-Eng-seal-on');

insert into workpapers (id, org_id, engagement_id, stage, status, test_phase) values
  ('60000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-0000000000e1', 'testing', 'signed_off', 'oet'),
  ('60000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-0000000000e2', 'testing', 'signed_off', 'oet'),
  ('60000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-0000000000e3', 'testing', 'signed_off', 'oet');

-- One-stage testing, so a single operating workpaper is enough to reach Conclusion / seal.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin
  perform public.admin_save_lifecycle_settings('one_stage', 'reviewer', 'reviewer', 'reviewer', false, 0);
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 1. report_opinion_required (org_lifecycle_settings): the Org Admin toggle gates sign_conclusion.
--    Before 0109 the function read only the legacy config_versions key, so the toggle did nothing.
-- ===========================================================================
-- Pull the exceptions (empty opinion) as the Audit Manager, so the signer (the CIA) differs (four-eyes).
insert into workpaper_rows (org_id, workpaper_id, row_ref, result, rationale, exception_flag) values
  ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000e1','R1','cross','Invoice missing','true');
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.pull_exceptions('50000000-0000-0000-0000-0000000000e1'); end $$;
select provio_test.as_owner();

-- The toggle on: sign-off is refused while the overall opinion is empty.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin
  perform public.admin_save_lifecycle_settings('one_stage', 'reviewer', 'reviewer', 'reviewer', true, 0);
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.sign_conclusion('50000000-0000-0000-0000-0000000000e1')$q$,
    'opinion_required', '3.6: report_opinion_required=true blocks sign-off while the opinion is empty');
end $$;
select provio_test.as_owner();

-- The toggle off: the same sign-off succeeds.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin
  perform public.admin_save_lifecycle_settings('one_stage', 'reviewer', 'reviewer', 'reviewer', false, 0);
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin perform public.sign_conclusion('50000000-0000-0000-0000-0000000000e1'); end $$;
select provio_test.as_owner();

do $$
begin
  perform provio_test.assert_true(
    (select sealed from engagements where id = '50000000-0000-0000-0000-0000000000e1'),
    '3.6: with the opinion not required the sign-off proceeds and seals the engagement');
end $$;

-- ===========================================================================
-- 2. required_fields (entity_approval_settings): submit_entity validates the named fields.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  -- Require both name and kind. The draft entity A-E3-draft has a name but no kind.
  perform public.admin_set_entity_approval('edit_config', 'manage_engagements', '["name","kind"]');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.submit_entity('40000000-0000-0000-0000-0000000000a3')$q$,
    'required_field', '3.6: required_fields ["name","kind"] refuses an entity with no kind');
end $$;
select provio_test.as_owner();

-- Supply the kind; the submit now succeeds (the field was the only thing missing).
update entities set kind = 'Subsidiary' where id = '40000000-0000-0000-0000-0000000000a3';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform public.submit_entity('40000000-0000-0000-0000-0000000000a3');
end $$;
select provio_test.as_owner();

do $$
begin
  perform provio_test.assert_eq(
    (select status from entities where id = '40000000-0000-0000-0000-0000000000a3'), 'pending',
    '3.6: once the required field is present the entity can be submitted');
end $$;

-- ===========================================================================
-- 3. visibility_right (pattern_settings): pattern_findings gates on the configured right.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$ begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','patterns',true,'Assurance','patterns add-on');
end $$;
select provio_test.as_owner();

-- Default 'view_insights': the CIA (which holds it) may read.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_n int;
begin
  select count(*) into v_n from public.pattern_findings('a0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_true(v_n >= 0, '3.6: with the default visibility right the CIA can read patterns');
  -- Raise the visibility right to manage_team, which the CIA does not hold.
  perform public.pattern_settings_save('a0000000-0000-0000-0000-000000000001', null, null, null, null, 'manage_team');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select * from public.pattern_findings('a0000000-0000-0000-0000-000000000001')$q$,
    'cannot view patterns', '3.6: raising visibility_right to manage_team refuses the CIA');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 4a. activity_retention_days (export_retention_settings): the archive window is clamped to it.
-- ===========================================================================
-- Default 365 days: a window ending 300 days ago is inside the archived range, so the archive runs.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_id uuid;
begin
  v_id := public.archive_activity_period('a0000000-0000-0000-0000-000000000001',
                                         current_date - 500, current_date - 300);
  perform provio_test.assert_true(v_id is not null,
    '3.6: with the default 365-day retention the window is archivable');
end $$;
select provio_test.as_owner();

-- Raise the retention to 3650 days: the same window now falls entirely inside the live period, so the
-- archive is refused (the clamp has no room).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin perform public.admin_save_export_retention('manual', 3650, 6); end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.archive_activity_period('a0000000-0000-0000-0000-000000000001', current_date - 500, current_date - 300)$q$,
    'retention_window', '3.6: a 3650-day retention refuses the same window');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 4b. export_schedule (export_retention_settings): scheduled_export_due honours it.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin perform public.admin_save_export_retention('manual', 365, 6); end $$;
select provio_test.as_owner();

do $$
begin
  perform provio_test.assert_true(
    not public.scheduled_export_due('a0000000-0000-0000-0000-000000000001'),
    '3.6: with a manual schedule no periodic export is ever due');
end $$;

-- Daily with no exports yet: due. Record an export now: not due. Backdate it two days: due again.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin perform public.admin_save_export_retention('daily', 365, 6); end $$;
select provio_test.as_owner();

do $$
begin
  perform provio_test.assert_true(
    public.scheduled_export_due('a0000000-0000-0000-0000-000000000001'),
    '3.6: a daily schedule with no export on record is due');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform public.log_export('engagement', '50000000-0000-0000-0000-0000000000e1', 'csv', '{}'::jsonb, 'h');
end $$;
select provio_test.as_owner();

do $$
begin
  perform provio_test.assert_true(
    not public.scheduled_export_due('a0000000-0000-0000-0000-000000000001'),
    '3.6: a daily schedule with a fresh export is not due');
end $$;

update exports_log set created_at = now() - interval '2 days'
 where org_id = 'a0000000-0000-0000-0000-000000000001';

do $$
begin
  perform provio_test.assert_true(
    public.scheduled_export_due('a0000000-0000-0000-0000-000000000001'),
    '3.6: a daily schedule with a two-day-old export is due again');
end $$;

-- Monthly with the same two-day-old export is not due, proving the interval follows the setting.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin perform public.admin_save_export_retention('monthly', 365, 6); end $$;
select provio_test.as_owner();

do $$
begin
  perform provio_test.assert_true(
    not public.scheduled_export_due('a0000000-0000-0000-0000-000000000001'),
    '3.6: a monthly schedule with a two-day-old export is not due');
end $$;

-- ===========================================================================
-- 5. certificate_auto_issue (org_settings_extra): sealing issues the certificate when asked.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$ begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','certificates',true,'Assurance','cert add-on');
end $$;
select provio_test.as_owner();

-- Flag off: sealing e2 issues nothing.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform public.admin_set_org_settings_extra('https://provio-test.invalid', null, false, false);
  perform public.seal_engagement('50000000-0000-0000-0000-0000000000e2');
end $$;
select provio_test.as_owner();

do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from engagement_certificates where engagement_id = '50000000-0000-0000-0000-0000000000e2'),
    0::bigint, '3.6: with certificate_auto_issue off sealing issues no certificate');
end $$;

-- Flag on: sealing e3 issues one.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform public.admin_set_org_settings_extra('https://provio-test.invalid', null, true, false);
  perform public.seal_engagement('50000000-0000-0000-0000-0000000000e3');
end $$;
select provio_test.as_owner();

do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from engagement_certificates where engagement_id = '50000000-0000-0000-0000-0000000000e3'),
    1::bigint, '3.6: with certificate_auto_issue on sealing issues exactly one certificate');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001'
              and action = 'certificate_issued'),
    '3.6: the auto-issued certificate writes a hash-chained ledger entry');
end $$;

-- ===========================================================================
-- 6. last_board_meeting_date (org_settings_extra): a new 'since_last_meeting' pack boundary.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$ begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','board_pack',true,'Assurance','board pack add-on');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_id uuid; v_from timestamptz;
begin
  perform public.admin_set_org_settings_extra('https://provio-test.invalid', '2026-09-01', null, null);
  v_id := public.board_pack_generate('a0000000-0000-0000-0000-000000000001','org','since_last_meeting',null,null);
  select from_ts into v_from from board_pack_history where id = v_id;
  perform provio_test.assert_eq(v_from::date, '2026-09-01'::date,
    '3.6: the since_last_meeting boundary starts at the configured last board meeting');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_id uuid; v_from timestamptz;
begin
  -- The default boundary still starts from the previous pack, not the meeting date.
  v_id := public.board_pack_generate('a0000000-0000-0000-0000-000000000001','org','since_last',null,null);
  select from_ts into v_from from board_pack_history where id = v_id;
  perform provio_test.assert_true(v_from::date > '2026-09-01'::date,
    '3.6: the default since_last boundary is unchanged by the board-meeting date');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 7. usage_quota (tenant_settings): a tenant user limit caps member provisioning.
-- ===========================================================================
-- Org A's fixture has four members (a1, a2, a3, a4). With no quota the fifth is allowed.
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_true(
    public.tenant_user_limit('a0000000-0000-0000-0000-000000000001') is null,
    '3.6: with no usage_quota the tenant user limit is null (unlimited)');
end $$;

-- Set the quota to 4 (the current member count): a new member is now refused.
insert into tenant_settings (org_id, status, feature_flags, usage_quota)
values ('a0000000-0000-0000-0000-000000000001', 'active', '{}', '{"users": 4}'::jsonb)
on conflict (org_id) do update set usage_quota = '{"users": 4}'::jsonb, status = 'active';

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_eq(
    public.tenant_user_limit('a0000000-0000-0000-0000-000000000001'), 4,
    '3.6: the configured user quota is read back');
  perform provio_test.assert_raises(
    $q$select public.admin_provision_member('10000000-0000-0000-0000-0000000000a5', 'Fifth', 'preparer')$q$,
    'usage_quota', '3.6: a tenant at its user quota refuses a new member');
end $$;
select provio_test.as_owner();

-- Raise the quota: the same provisioning now succeeds.
insert into tenant_settings (org_id, usage_quota)
values ('a0000000-0000-0000-0000-000000000001', '{"users": 10}'::jsonb)
on conflict (org_id) do update set usage_quota = '{"users": 10}'::jsonb;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin
  perform public.admin_provision_member('10000000-0000-0000-0000-0000000000a5', 'Fifth', 'preparer');
end $$;
select provio_test.as_owner();

do $$
begin
  perform provio_test.assert_true(
    exists (select 1 from org_members where org_id = 'a0000000-0000-0000-0000-000000000001'
              and user_id = '10000000-0000-0000-0000-0000000000a5'),
    '3.6: raising the quota lets the member be provisioned');
end $$;
