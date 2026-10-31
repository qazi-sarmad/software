-- 103_group_joint_audit.sql — the corrected §2 model (SCALE-1 WP2).
--
-- Positive and negative coverage for group association, joint-audit edit sharing and group
-- configuration distribution. Every refusal is paired with the legitimate read, so a fix that blocks
-- everything fails here too.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. Association is the precondition. Without it, a joint-audit grant is refused.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_raises(
    $q$select public.joint_share_grant('50000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-000000000001', null::timestamptz)$q$,
    'not associated', 'an unassociated org cannot be the counterparty of a joint audit');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');

-- The platform records the association: Org A is the parent, Org B the member.
do $$
declare v_group uuid;
begin
  select public.platform_create_group('Group One') into v_group;
  perform public.platform_link_org(v_group, 'a0000000-0000-0000-0000-000000000001', true);
  perform public.platform_link_org(v_group, 'b0000000-0000-0000-0000-000000000001', false);
end $$;

-- A tenant user cannot create or link groups.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_raises($q$select public.platform_create_group('Rogue')$q$,
    'platform administrator only', 'a tenant CIA cannot create a group');
  perform provio_test.assert_raises(
    $q$select public.platform_link_org('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', false)$q$,
    'platform administrator only', 'a tenant CIA cannot link an org');
end $$;

-- After linking, the two orgs see each other as associated; a third org does not.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq(public.are_associated('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001'), true,
    'Org A and Org B are associated');
  perform provio_test.assert_eq(public.are_associated('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'), false,
    'an org is not associated with itself');
  perform provio_test.assert_eq(public.associated_org_ids(), array['b0000000-0000-0000-0000-000000000001'::uuid],
    'Org A sees exactly Org B as its associated org');
end $$;

-- ---------------------------------------------------------------------------
-- 2. Isolation is intact BEFORE any share: Org B sees nothing of Org A.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq((select count(*) from public.engagements where org_id = 'a0000000-0000-0000-0000-000000000001')::int, 0,
    'Org B cannot read Org A engagements without a share');
  perform provio_test.assert_eq((select count(*) from public.observations where org_id = 'a0000000-0000-0000-0000-000000000001')::int, 0,
    'Org B cannot read Org A observations without a share');
  perform provio_test.assert_eq(public.joint_share_active('50000000-0000-0000-0000-0000000000a1'), false,
    'no joint share is active before it is granted');
end $$;

-- ---------------------------------------------------------------------------
-- 3. A member WITHOUT manage_engagements cannot start a joint audit.
--    scoped_a (preparer) has perform_work but not manage_engagements.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$ begin
  perform provio_test.assert_raises(
    $q$select public.joint_share_grant('50000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-000000000001', null::timestamptz)$q$,
    'manage_engagements', 'a member without manage_engagements cannot grant a joint share');
end $$;

-- ---------------------------------------------------------------------------
-- 4. The happy path: Org A (manage_engagements) shares engagement g_a1 with Org B.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_share uuid;
begin
  select public.joint_share_grant('50000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-000000000001', null::timestamptz) into v_share;
  perform provio_test.assert_true(v_share is not null, 'the joint share is created');
end $$;

-- The counterparty (Org B) now sees the shared engagement and its working papers, and may write.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq((select count(*) from public.engagements where id = '50000000-0000-0000-0000-0000000000a1')::int, 1,
    'Org B reads the shared engagement');
  perform provio_test.assert_eq((select count(*) from public.observations where engagement_id = '50000000-0000-0000-0000-0000000000a1')::int, 1,
    'Org B reads the shared engagement working papers');
  perform provio_test.assert_eq((select count(*) from public.entities where id = '40000000-0000-0000-0000-0000000000a1')::int, 1,
    'Org B reads the entity behind the shared engagement');
  -- Edit rights to both: Org B may update the shared engagement.
  update public.engagements set stage = 'testing' where id = '50000000-0000-0000-0000-0000000000a1';
  perform provio_test.assert_eq((select stage from public.engagements where id = '50000000-0000-0000-0000-0000000000a1'), 'testing',
    'Org B may edit the shared engagement (edit rights to both)');
  -- But NOT another Org A engagement, and NOT Org A's other data.
  perform provio_test.assert_eq((select count(*) from public.engagements where id = '50000000-0000-0000-0000-0000000000a2')::int, 0,
    'Org B cannot read an unshared Org A engagement');
  perform provio_test.assert_eq((select count(*) from public.observations where engagement_id = '50000000-0000-0000-0000-0000000000a2')::int, 0,
    'Org B cannot read an unshared Org A engagement working papers');
  perform provio_test.assert_eq((select count(*) from public.entities where id = '40000000-0000-0000-0000-0000000000a2')::int, 0,
    'Org B cannot read an unrelated Org A entity');
  perform provio_test.assert_eq((select count(*) from public.universes where org_id = 'a0000000-0000-0000-0000-000000000001')::int, 0,
    'Org B cannot read Org A universes');
end $$;

-- Org A still sees its own data, unchanged.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq((select count(*) from public.engagements where org_id = 'a0000000-0000-0000-0000-000000000001')::int, 2,
    'Org A still reads its own two engagements');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Revocation: after revoke, the projection is gone for Org B.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_share uuid;
begin
  select id into v_share from public.engagement_joint_shares
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' and owner_org_id = 'a0000000-0000-0000-0000-000000000001';
  perform public.joint_share_revoke(v_share, 'audit concluded');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq((select count(*) from public.engagements where id = '50000000-0000-0000-0000-0000000000a1')::int, 0,
    'a revoked joint share is invisible to the counterparty');
  perform provio_test.assert_eq((select count(*) from public.observations where engagement_id = '50000000-0000-0000-0000-0000000000a1')::int, 0,
    'a revoked joint share exposes no working papers');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 6. Group configuration distribution: parent -> member snapshot.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  -- A member (Org B) is not a parent, so it cannot distribute.
  perform provio_test.assert_raises(
    $q$select public.group_distribute_config('a0000000-0000-0000-0000-000000000001', null::text[])$q$,
    'group parent', 'a member org cannot distribute configuration');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_dist uuid;
begin
  select public.group_distribute_config('b0000000-0000-0000-0000-000000000001', array['sampling']) into v_dist;
  perform provio_test.assert_true(v_dist is not null, 'the parent distributes a config snapshot');
end $$;
select provio_test.as_owner();

-- The member adopts the snapshot; its own config history gains a new version.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_dist uuid;
begin
  select id into v_dist from public.config_distributions
   where member_org_id = 'b0000000-0000-0000-0000-000000000001';
  perform provio_test.assert_eq(public.group_adopt_config(v_dist), 1, 'the member adopts one config key');
  perform provio_test.assert_eq(
    (select max(version) from public.config_versions
      where org_id = 'b0000000-0000-0000-0000-000000000001' and key = 'sampling')::int, 2,
    'adoption adds a new version to the member history');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 7. The platform-blind rule holds: a platform administrator sees no tenant content through the
--    new tables' row policies, and the new tables grant no direct DML to a tenant.
-- ---------------------------------------------------------------------------
do $$ begin
  perform provio_test.assert_true(
    not has_table_privilege('authenticated', 'public.engagement_joint_shares', 'insert'),
    'authenticated has no direct insert on engagement_joint_shares');
  perform provio_test.assert_true(
    not has_table_privilege('authenticated', 'public.org_associations', 'update'),
    'authenticated has no direct update on org_associations');
end $$;

-- ---------------------------------------------------------------------------
-- 8. Expiry is honoured (time is an argument, never the clock, in the check under test).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_raises(
    $q$select public.joint_share_grant('50000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-000000000001', now() - interval '1 hour')$q$,
    'expiry must be in the future', 'a share expiry in the past is refused');
end $$;
select provio_test.as_owner();
