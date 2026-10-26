-- Test 103: SCALE-1 WP4. Multi-tenant scale and isolation.
--
-- Three concurrent organisations, data written in each, and the RLS paths that must keep them
-- apart: the normal jwt_org_id() path, the cross-universe share path, the invitation-cap and
-- feature-flag switches, and the time-boxed support-grant surface. Every refusal is paired with the
-- legitimate read, so a fix that blocks everything fails here. The harness runs this file twice
-- against the same database; the fixture orgs are removed first so each pass starts clean.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- The third organisation (C). A and B come from the seed.
select provio_test.as_owner();
do $$
begin
  delete from orgs where id in ('c0000000-0000-0000-0000-000000000001',
                                'c0000000-0000-0000-0000-000000000002');
  insert into orgs (id, name) values
    ('c0000000-0000-0000-0000-000000000001', 'Org C'),
    ('c0000000-0000-0000-0000-000000000002', 'Org D');
end $$;

-- The platform administrator is a real account (invite_cap_events.invited_by references auth.users).
select provio_test.as_owner();
insert into auth.users (id, email) values ('10000000-0000-0000-0000-0000000000f0', 'platform@qscorp.test')
on conflict (id) do nothing;

-- ===========================================================================
-- 1. Three concurrent orgs: create each through the platform path and prove the isolation.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  v_c uuid;
  v_d uuid;
begin
  -- Create a new org for the platform path (a fifth tenant, so create + isolation are both proven).
  v_c := public.platform_create_tenant('Org E', 'admin.e@example.test', 'scale test');
  perform provio_test.assert_true(v_c is not null, 'scale: a fifth tenant is created');
  perform provio_test.assert_eq(
    (public.platform_provisioning_status(v_c) ->> 'roles_seeded')::int, 7,
    'scale: the fifth tenant has its seven roles');

  -- Org C and D are bare orgs (no roles); seed them through the repair path.
  perform public.platform_seed_org_roles('c0000000-0000-0000-0000-000000000001');
  perform public.platform_seed_org_roles('c0000000-0000-0000-0000-000000000002');
  perform provio_test.assert_eq(
    public.platform_seed_org_roles('c0000000-0000-0000-0000-000000000001'), 0,
    'scale: re-seeding org C is idempotent');
end $$;

-- Give C and D a universe, an entity and an engagement each, as owner.
select provio_test.as_owner();
do $$
begin
  insert into universes (id, org_id, name) values
    ('30000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-000000000001', 'C-U1'),
    ('30000000-0000-0000-0000-0000000000d1', 'c0000000-0000-0000-0000-000000000002', 'D-U1')
  on conflict (id) do nothing;
  insert into entities (id, org_id, universe_id, name, approved, status) values
    ('40000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000c1', 'C-E1', true, 'approved'),
    ('40000000-0000-0000-0000-0000000000d1', 'c0000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-0000000000d1', 'D-E1', true, 'approved')
  on conflict (id) do nothing;
  insert into engagements (id, org_id, universe_id, entity_id, title) values
    ('50000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-0000000000c1', 'C-Eng1'),
    ('50000000-0000-0000-0000-0000000000d1', 'c0000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-0000000000d1', 'D-Eng1')
  on conflict (id) do nothing;
  insert into org_members (org_id, user_id, role_id, hierarchy_level)
  select 'c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000c1', r.id, 1
    from roles r where r.org_id = 'c0000000-0000-0000-0000-000000000001' and r.slug = 'cia';
  insert into org_members (org_id, user_id, role_id, hierarchy_level)
  select 'c0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000d1', r.id, 1
    from roles r where r.org_id = 'c0000000-0000-0000-0000-000000000002' and r.slug = 'cia';
  -- Granting a share requires Head authority. scoped_a (the org A grantor) is made a Level-1 Head.
  update org_members set head_level = 1
   where org_id = 'a0000000-0000-0000-0000-000000000001'
     and user_id = '10000000-0000-0000-0000-0000000000a1';
end $$;

-- A user in each of A, B and C. Each sees exactly its own org's universe, entity and engagement.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from universes where org_id = 'a0000000-0000-0000-0000-000000000001'), 2,
    'scale: org A sees its own two universes');
  perform provio_test.assert_eq((select count(*) from universes where org_id <> 'a0000000-0000-0000-0000-000000000001'), 0,
    'scale: org A sees no other org''s universes');
  perform provio_test.assert_eq((select count(*) from engagements where org_id <> 'a0000000-0000-0000-0000-000000000001'), 0,
    'scale: org A sees no other org''s engagements');
  perform provio_test.assert_eq((select count(*) from entities where org_id <> 'a0000000-0000-0000-0000-000000000001'), 0,
    'scale: org A sees no other org''s entities');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from universes), 1,
    'scale: org B sees exactly its one universe');
  perform provio_test.assert_eq((select count(*) from engagements where org_id <> 'b0000000-0000-0000-0000-000000000001'), 0,
    'scale: org B sees no other org''s engagements');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from universes), 1,
    'scale: org C sees exactly its one universe');
  perform provio_test.assert_eq((select count(*) from engagements), 1,
    'scale: org C sees exactly its one engagement');
end $$;

-- ===========================================================================
-- 2. The cross-universe share path never crosses a tenant.
-- ===========================================================================
-- A share of an Org A universe to an Org A user is intra-org. It must never make an Org A universe
-- visible to Org B, and it must never make an Org B universe visible to an Org A grantee.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.share_grant('30000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a2', null);
end $$;

-- The grantee (scoped_a, who normally sees only u_a1) now sees u_a2 through the share.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_rows int;
begin
  perform provio_test.assert_eq((select count(*) from universes where id = '30000000-0000-0000-0000-0000000000a2'), 1,
    'scale: the grantee sees the shared universe');
  -- The share is view-only: RLS filters the write, so it changes no row and raises nothing.
  update universes set name = 'renamed' where id = '30000000-0000-0000-0000-0000000000a2';
  get diagnostics v_rows = row_count;
  perform provio_test.assert_eq(v_rows, 0,
    'scale: a shared universe is read-only for the grantee (no row is written)');
end $$;

select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select name from universes where id = '30000000-0000-0000-0000-0000000000a2'), 'A-U2',
    'scale: the shared universe name is unchanged after the grantee''s write attempt');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');

-- A share in Org A is invisible to Org B, and the Org B user cannot reach an Org A universe at all.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from universe_shares), 0,
    'scale: org B sees no share rows from org A');
  perform provio_test.assert_eq((select count(*) from universes where id = '30000000-0000-0000-0000-0000000000a2'), 0,
    'scale: a share never makes an org A universe visible to org B');
  perform provio_test.assert_true(not public.has_active_share('30000000-0000-0000-0000-0000000000a2'),
    'scale: has_active_share is false for a user of another org');
end $$;

-- Revoking the share removes the grantee's view immediately.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_share uuid;
begin
  select id into v_share from universe_shares
   where universe_id = '30000000-0000-0000-0000-0000000000a2'
     and grantee_user_id = '10000000-0000-0000-0000-0000000000a2';
  perform public.share_revoke(v_share, 'scale test cleanup');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_eq((select count(*) from universes where id = '30000000-0000-0000-0000-0000000000a2'), 0,
    'scale: a revoked share is invisible to the grantee');
  perform provio_test.assert_true(not public.has_active_share('30000000-0000-0000-0000-0000000000a2'),
    'scale: has_active_share is false after revocation');
end $$;

-- ===========================================================================
-- 3. Invitation-cap isolation: a cap set on one org does not touch another.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_invite_cap('c0000000-0000-0000-0000-000000000001', 3);
  perform public.platform_set_invite_cap('c0000000-0000-0000-0000-000000000002', 50);
end $$;

select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select per_user_daily from invite_cap_settings where org_id = 'c0000000-0000-0000-0000-000000000001'), 3,
    'scale: org C has its own cap of 3');
  perform provio_test.assert_eq(
    (select per_user_daily from invite_cap_settings where org_id = 'c0000000-0000-0000-0000-000000000002'), 50,
    'scale: org D has its own cap of 50');
  perform provio_test.assert_eq(
    (select per_user_daily from invite_cap_settings where org_id = 'a0000000-0000-0000-0000-000000000001'), 20,
    'scale: org A keeps the platform default of 20');
end $$;

-- The cap is enforced per org: a user of org A cannot see org C's setting, and org C's cap does not
-- apply to org A.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from invite_cap_settings where org_id = 'c0000000-0000-0000-0000-000000000001'), 0,
    'scale: an org A admin cannot read org C''s cap setting');
end $$;

-- ===========================================================================
-- 4. Feature-flag isolation: an entitlement on one org does not leak to another.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('c0000000-0000-0000-0000-000000000001', 'board_pack', true, null, 'scale test');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(public.has_feature('c0000000-0000-0000-0000-000000000001', 'board_pack'),
    'scale: org C has the feature it was granted');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000d1', 'c0000000-0000-0000-0000-000000000002', 'cia');
do $$
begin
  perform provio_test.assert_true(not public.has_feature('c0000000-0000-0000-0000-000000000002', 'board_pack'),
    'scale: org D does not have org C''s feature');
  -- A tenant user may not even ask about another org's entitlement.
  perform provio_test.assert_true(not public.has_feature('c0000000-0000-0000-0000-000000000001', 'board_pack'),
    'scale: an org D user asking about org C''s feature is refused (false)');
end $$;

-- ===========================================================================
-- 5. Support-grant surface: only the granted org, only while the grant is live, every read logged.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  v_grant uuid;
begin
  v_grant := public.platform_grant_support_access(
    'c0000000-0000-0000-0000-000000000001', '{"content_read": true}'::jsonb, 4);
  perform provio_test.assert_true(v_grant is not null, 'scale: a support grant is created for org C');

  -- The granted org is readable.
  perform provio_test.assert_eq(
    (select count(*) from public.support_list_engagements('c0000000-0000-0000-0000-000000000001'))::int, 1,
    'scale: the granted org''s engagement is readable');

  -- An ungranted org is refused, and the refusal is logged.
  perform provio_test.assert_eq(
    (select count(*) from public.support_list_engagements('c0000000-0000-0000-0000-000000000002'))::int, 0,
    'scale: an ungranted org returns nothing');
end $$;

select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from support_access_log
      where org_id = 'c0000000-0000-0000-0000-000000000001' and outcome = 'ok'), 1,
    'scale: the granted read is logged as ok');
  perform provio_test.assert_eq(
    (select count(*) from support_access_log
      where org_id = 'c0000000-0000-0000-0000-000000000002' and outcome = 'denied'), 1,
    'scale: the refused read is logged as denied against the refused org');
end $$;

-- A tenant session cannot open a support session at all.
select provio_test.as_user('10000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select * from public.support_list_engagements('c0000000-0000-0000-0000-000000000001')$q$,
    'platform administrator only', 'scale: a tenant session cannot open a support session');
end $$;

-- ===========================================================================
-- 6. Load-oriented: many rows across orgs, and the list paths stay correct and bounded.
-- ===========================================================================
select provio_test.as_owner();
do $$
declare
  i int;
begin
  -- 60 platform trail rows, so platform_list_trail's ordering and limit are exercised on volume.
  for i in 1..60 loop
    insert into platform_trail (actor_id, action, tenant_id, object_type, object_id, payload)
    values ('10000000-0000-0000-0000-0000000000f0', 'scale_probe', 'c0000000-0000-0000-0000-000000000001',
            'tenant', 'c0000000-0000-0000-0000-000000000001', jsonb_build_object('i', i));
  end loop;
  -- 40 extra universes in org C, so a list of org C's universes is non-trivial.
  for i in 1..40 loop
    insert into universes (org_id, name)
    values ('c0000000-0000-0000-0000-000000000001', 'C-bulk-' || i);
  end loop;
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform provio_test.assert_eq((select count(*) from public.platform_list_tenants()) >= 5, true,
    'scale: platform_list_tenants returns every tenant');
  perform provio_test.assert_eq((select count(*) from public.platform_list_trail(10)), 10,
    'scale: platform_list_trail honours its limit under volume');
  perform provio_test.assert_eq((select count(*) from public.platform_list_trail(1000)) >= 60, true,
    'scale: platform_list_trail returns the full trail under volume');
end $$;

-- Org C's own list is exactly its own universes, never another org's, even with 40+ rows.
select provio_test.as_user('10000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from universes), 41,
    'scale: org C sees its 41 universes and no others');
  perform provio_test.assert_eq(
    (select count(*) from universes where org_id <> 'c0000000-0000-0000-0000-000000000001'), 0,
    'scale: org C sees no other org''s universes under volume');
end $$;

select provio_test.as_owner();
