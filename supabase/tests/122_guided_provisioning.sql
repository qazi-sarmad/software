-- 122_guided_provisioning.sql — WP3: the guided client provisioning path (migration 0097).
--
-- Proves both directions for every new RPC: the happy path as the platform administrator, and the
-- RLS/authority refusal path as a tenant user. The harness runs this file twice against the same
-- database, so the fixture tenant is removed at the start of each pass and the assertions never
-- depend on a previous pass's rows.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- The org this file creates. Removed first so the second pass starts clean. Deleting the org
-- cascades to its roles, settings and invitation rows.
select provio_test.as_owner();
do $$
begin
  delete from orgs where name = 'WP3 Test Client';
  -- invite_cap_events.invited_by references auth.users, so the platform administrator must be a real
  -- account, exactly as they are on the hosted project. Idempotent.
  insert into auth.users (id, email) values ('10000000-0000-0000-0000-0000000000f0', 'platform@qscorp.test')
  on conflict (id) do nothing;
end $$;

-- ===========================================================================
-- P1: platform_create_tenant — the happy path.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  v_new uuid;
  v_report jsonb;
  v_trail int;
begin
  v_new := public.platform_create_tenant('WP3 Test Client', 'first.admin@example.test', 'onboarding client N');
  perform provio_test.assert_true(v_new is not null, 'provision: create_tenant returns the new org id');

  -- The platform administrator reads no tenant content (L2): roles_select is org_id = jwt_org_id(),
  -- so the rows created by the definer are invisible to this session. The report below is the
  -- designed read path, and it returns counts only.
  perform provio_test.assert_eq((select count(*) from roles where org_id = v_new), 0,
    'provision: a platform session cannot read the new org roles directly (L2)');

  v_report := public.platform_provisioning_status(v_new);
  perform provio_test.assert_eq(v_report ->> 'roles_seeded', '7',
    'provision: the definer path counts seven seed roles');
  perform provio_test.assert_eq(v_report ->> 'status', 'active', 'provision: the tenant starts active');
  perform provio_test.assert_eq(v_report ->> 'has_initial_invite', 'true',
    'provision: the initial administrator is invited once');
  perform provio_test.assert_eq(v_report ->> 'can_create_engagement', 'true',
    'provision: an engagement can be created once the roles and status are in place');
  perform provio_test.assert_eq(v_report ->> 'ready', 'true', 'provision: the tenant reports ready');
  perform provio_test.assert_true(
    not (v_report ? 'engagement_titles') and not (v_report ? 'findings'),
    'provision: the report carries no tenant content');

  select count(*) into v_trail from platform_trail
   where tenant_id = v_new and action = 'tenant_created';
  perform provio_test.assert_eq(v_trail, 1, 'provision: the creation is written to the platform trail');
end $$;

-- The deep row-level assertions run as the owner, the only role that may inspect across orgs.
select provio_test.as_owner();
do $$
declare
  v_new uuid;
  v_matched int;
begin
  select id into v_new from orgs where name = 'WP3 Test Client';
  perform provio_test.assert_eq((select name from orgs where id = v_new), 'WP3 Test Client',
    'provision: the org row carries the name');
  perform provio_test.assert_eq((select count(*) from roles where org_id = v_new), 7,
    'provision: seven seed roles are created');
  select count(*) into v_matched from roles r
    join roles a on a.org_id = 'a0000000-0000-0000-0000-000000000001' and a.slug = r.slug and a.rights = r.rights
   where r.org_id = v_new;
  perform provio_test.assert_eq(v_matched, 7,
    'provision: every seeded role carries the 0087 rights matrix (no drift)');
  perform provio_test.assert_eq((select status from tenant_settings where org_id = v_new), 'active',
    'provision: the tenant starts active');
  perform provio_test.assert_true(exists (select 1 from invite_cap_settings where org_id = v_new),
    'provision: the invite cap row is seeded by the org trigger');
  perform provio_test.assert_eq((select count(*) from invite_cap_events where org_id = v_new), 1,
    'provision: the initial administrator is invited once');
  perform provio_test.assert_eq((select email from invite_cap_events where org_id = v_new),
    'first.admin@example.test', 'provision: the invitation carries the lower-cased address');
  perform provio_test.assert_eq((select role_slug from invite_cap_events where org_id = v_new),
    'org_admin', 'provision: the initial administrator is invited as org_admin');
  perform provio_test.assert_eq((select count(*) from email_queue where org_id = v_new), 1,
    'provision: the invitation email is queued');
end $$;

-- ===========================================================================
-- P3: platform_seed_org_roles repairs an org that has no roles, and is idempotent.
--
-- Seed roles cannot be deleted (roles_delete_guard refuses it), so the repair is tested against a
-- bare org created without roles rather than by stripping an existing one. That is the real repair
-- case: an org that exists but whose role catalogue was never seeded.
-- ===========================================================================
select provio_test.as_owner();
do $$
begin
  delete from orgs where name = 'WP3 Bare Org';
  insert into orgs (id, name) values ('c0000000-0000-0000-0000-000000000001', 'WP3 Bare Org');
end $$;

select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from roles where org_id = 'c0000000-0000-0000-0000-000000000001'), 0,
    'provision: a bare org starts with no roles');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform provio_test.assert_eq(
    public.platform_seed_org_roles('c0000000-0000-0000-0000-000000000001'), 7,
    'provision: the repair seeds seven roles');
  perform provio_test.assert_eq(
    public.platform_seed_org_roles('c0000000-0000-0000-0000-000000000001'), 0,
    'provision: a second seed adds nothing (idempotent)');
end $$;

select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from roles where org_id = 'c0000000-0000-0000-0000-000000000001'), 7,
    'provision: the repaired org ends with seven roles');
end $$;

-- ===========================================================================
-- P4: platform_configure_email_sender.
-- ===========================================================================
select provio_test.as_owner();
do $$
begin
  delete from email_sender_profiles where scope = 'platform' and from_address = 'no-reply@wp3.test';
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  v_id uuid;
begin
  v_id := public.platform_configure_email_sender('Provio', 'no-reply@wp3.test', 'support@wp3.test', 'stub', 'platform fallback sender');
  perform provio_test.assert_true(v_id is not null, 'provision: the platform sender is created');
  perform provio_test.assert_true(
    (select enabled and is_default from email_sender_profiles where id = v_id),
    'provision: the platform sender is enabled and default');
  perform provio_test.assert_raises(
    $q$select public.platform_configure_email_sender('Provio', 'no-reply@wp3.test', null, 'stub', '')$q$,
    'a reason is required', 'provision: a sender change without a reason is refused');
  perform provio_test.assert_raises(
    $q$select public.platform_configure_email_sender('Provio', 'not-an-email', null, 'stub', 'x')$q$,
    'valid from address', 'provision: a malformed from address is refused');
end $$;

-- ===========================================================================
-- N1: a tenant user cannot call any of the new RPCs.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.platform_create_tenant('Sneaky', 'x@example.test', 'because')$q$,
    'platform administrator only', 'provision: a tenant user cannot create a tenant');
  perform provio_test.assert_raises(
    format($q$select public.platform_seed_org_roles('%s')$q$, 'a0000000-0000-0000-0000-000000000001'),
    'platform administrator only', 'provision: a tenant user cannot seed roles');
  perform provio_test.assert_raises(
    format($q$select public.platform_provisioning_status('%s')$q$, 'a0000000-0000-0000-0000-000000000001'),
    'platform administrator only', 'provision: a tenant user cannot read the readiness report');
  perform provio_test.assert_raises(
    $q$select public.platform_configure_email_sender('X', 'x@example.test', null, 'stub', 'x')$q$,
    'platform administrator only', 'provision: a tenant user cannot set the platform sender');
end $$;

-- ===========================================================================
-- N2: input validation on the create path.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.platform_create_tenant('', 'x@example.test', 'reason')$q$,
    'organisation name is required', 'provision: an empty name is refused');
  perform provio_test.assert_raises(
    $q$select public.platform_create_tenant('X', 'nope', 'reason')$q$,
    'valid initial administrator email', 'provision: a malformed admin email is refused');
  perform provio_test.assert_raises(
    $q$select public.platform_create_tenant('X', 'x@example.test', '')$q$,
    'a reason is required', 'provision: a create without a reason is refused');
  perform provio_test.assert_raises(
    $q$select public.platform_provisioning_status('00000000-0000-0000-0000-0000000000ff')$q$,
    'unknown organisation', 'provision: an unknown org is refused');
end $$;

-- ===========================================================================
-- N3: the org the path creates is isolated — a tenant session sees none of it.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from roles where org_id = (select id from orgs where name = 'WP3 Test Client')),
    0, 'provision: a tenant session cannot read the new org''s roles (RLS)');
end $$;

select provio_test.as_owner();
