-- Test 41 (C2): Org Admin settings RPCs. edit_config is required; rows are org-scoped; the sampling
-- method enum, the severity design-token colour and the email provider enum are validated; email
-- provider secrets (provider_config) are not selectable by tenant roles (spec §11.2, §14.4, §16, §24).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. An Org Admin with edit_config manages the org sampling table.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_id uuid;
begin
  v_id := public.admin_upsert_sampling_row('any', 'any', 'small', 'random', 5, 0.10, null);
  perform provio_test.assert_true(v_id is not null, 'an Org Admin creates a sampling row');
  perform provio_test.assert_eq(
    (select method from org_sampling_table where id = v_id), 'random', 'the sampling method is stored');

  perform public.admin_upsert_sampling_row('any', 'any', 'small', 'mus', 8, 0.20, v_id);
  perform provio_test.assert_eq(
    (select base_size from org_sampling_table where id = v_id), 8, 'an Org Admin updates a sampling row');

  perform provio_test.assert_raises(
    $q$select public.admin_upsert_sampling_row('any','any','small','coin_toss',5,0.1,null)$q$,
    'unknown sampling method', 'an unknown sampling method is refused');
  perform provio_test.assert_raises(
    $q$select public.admin_upsert_sampling_row('any','any','small','random',0,0.1,null)$q$,
    'at least 1', 'a base size below 1 is refused');
  perform provio_test.assert_raises(
    $q$select public.admin_upsert_sampling_row('any','any','small','random',5,1.5,null)$q$,
    'at most 1', 'a percentage above 1 is refused');

  perform public.admin_delete_sampling_row(v_id);
  perform provio_test.assert_eq(
    (select count(*) from org_sampling_table where id = v_id), 0, 'an Org Admin deletes a sampling row');
end $$;

-- ---------------------------------------------------------------------------
-- 2. A user without edit_config cannot touch the sampling table.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.admin_upsert_sampling_row('any','any','small','random',5,0.1,null)$q$,
    'edit_config', 'a Preparer cannot create a sampling row');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Cross-org: Org Admin B cannot delete an Org A row.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_id uuid;
begin
  v_id := public.admin_upsert_sampling_row('any', 'any', 'medium', 'systematic', 10, 0.08, null);
  perform set_config('provio_test.a_row', v_id::text, false);
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000b3', 'b0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    format($q$select public.admin_delete_sampling_row('%s')$q$, current_setting('provio_test.a_row')),
    'not found in this organisation', 'Org Admin B cannot delete an Org A sampling row');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Severity levels: a raw colour is refused; a design token is accepted.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_id uuid;
begin
  perform provio_test.assert_raises(
    $q$select public.admin_upsert_severity_level('High','#ff0000',1,null)$q$,
    'must be a design token', 'a raw colour is refused for a severity level');
  v_id := public.admin_upsert_severity_level('High', '--accent-cinnabar', 1, null);
  perform provio_test.assert_eq(
    (select color_token from severity_levels where id = v_id), '--accent-cinnabar',
    'a design-token colour is stored');
  perform public.admin_delete_severity_level(v_id);
  perform provio_test.assert_eq(
    (select count(*) from severity_levels where id = v_id), 0, 'an Org Admin deletes a severity level');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Email provider: the org reads its own shape but never provider_config.
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.admin_set_email_provider('resend', 'audit@example.com');
  perform provio_test.assert_eq(
    (select provider from email_settings where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'resend', 'the Org Admin sets the email provider');
  perform provio_test.assert_raises(
    $q$select provider_config from email_settings$q$,
    'permission denied', 'a tenant role cannot select email provider secrets');
end $$;

-- Org B does not see Org A's email settings row.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b3', 'b0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_eq((select count(*) from email_settings), 0,
    'Org B does not see Org A email settings');
end $$;

-- ---------------------------------------------------------------------------
-- 6. The platform admin reads the email provider shape (metadata, not tenant business content).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform provio_test.assert_eq((select count(*) from email_settings), 1,
    'the platform admin reads the email provider shape');
end $$;

select provio_test.as_owner();
