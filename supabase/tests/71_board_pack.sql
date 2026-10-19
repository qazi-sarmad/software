-- Test 71 (S7.a): Board Pack (F10).
--
-- Covers: the deterministic snapshot; every figure carries at least one ref; the scope_key last-pack
-- detection does not collide across scopes; the delta against the previous pack; generation refuses
-- without the right, without the entitlement and before app_base_url is set; a ledger entry
-- (board_pack_generated) is written with the data_hash; the section list is configurable and
-- reorderable; cross-org isolation; RLS on both tables.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. The figure-ref walker: a figure with no refs is a bug (F10).
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare
  v_bad text[];
begin
  v_bad := public.board_pack_figure_refs(jsonb_build_object(
    'good', jsonb_build_object('value', 3, 'refs', jsonb_build_array(jsonb_build_object('type','cap','id','x'))),
    'bad',  jsonb_build_object('value', 3, 'refs', '[]'::jsonb)));
  perform provio_test.assert_eq(coalesce(array_length(v_bad, 1), 0), 1, 'exactly one figure with no refs is reported');
  perform provio_test.assert_eq(v_bad[1], 'bad', 'the offending figure path is named');

  v_bad := public.board_pack_figure_refs(jsonb_build_object(
    'good', jsonb_build_object('value', 1, 'refs', jsonb_build_array(jsonb_build_object('type','cap','id','x')))));
  perform provio_test.assert_eq(coalesce(array_length(v_bad, 1), 0), 0, 'a figure with a ref passes');
end $$;

-- ---------------------------------------------------------------------------
-- 2. The section list is seeded for an organisation, in the F10 order.
-- ---------------------------------------------------------------------------
do $$
declare
  org_a uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  perform public.board_pack_sections_seed(org_a);
  perform provio_test.assert_eq(
    (select count(*) from board_pack_sections where org_id = org_a), 8,
    'eight sections are seeded for the organisation');
  perform provio_test.assert_eq(
    (select label from board_pack_sections where org_id = org_a and ordinal = 1),
    'Cover and assurance statement', 'the first section is the cover');
  perform provio_test.assert_eq(
    (select label from board_pack_sections where org_id = org_a and ordinal = 8),
    'Sources index', 'the last section is the sources index');
  -- Idempotent: seeding again adds nothing (M2).
  perform public.board_pack_sections_seed(org_a);
  perform provio_test.assert_eq(
    (select count(*) from board_pack_sections where org_id = org_a), 8,
    'seeding the sections twice adds nothing');
end $$;

-- ---------------------------------------------------------------------------
-- 3. The snapshot is deterministic and every figure carries refs. Fixtures: one SIRA score, one
--    plan item, one open CAP, one signed-off workpaper and one sealed engagement.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare
  org_a uuid := 'a0000000-0000-0000-0000-000000000001';
  v_snap jsonb;
  v_snap2 jsonb;
  v_bad text[];
begin
  insert into plan_items (id, org_id, plan_id, title, status)
  values ('c1000000-0000-0000-0000-0000000000a1', org_a, 'a2000000-0000-0000-0000-0000000000a1', 'A plan item', 'approved');

  insert into caps (id, org_id, engagement_id, finding_id, due_date, status, action_description)
  select 'c2000000-0000-0000-0000-0000000000a1', org_a, '50000000-0000-0000-0000-0000000000a1',
         id, current_date - 45, 'open', 'Fix the control'
    from findings where org_id = org_a limit 1;

  update workpapers set status = 'signed_off'
   where id = '60000000-0000-0000-0000-0000000000a1';
  update engagements set sealed = true
   where id = '50000000-0000-0000-0000-0000000000a1';

  v_snap := public.board_pack_snapshot(org_a, 'org', null, null);
  perform provio_test.assert_true(v_snap ? 'sira', 'the snapshot carries a SIRA figure');
  perform provio_test.assert_true(v_snap ? 'plan', 'the snapshot carries a plan figure');
  perform provio_test.assert_true(v_snap ? 'cap', 'the snapshot carries a CAP figure');
  perform provio_test.assert_true(v_snap ? 'sealed_work', 'the snapshot carries a sealed-work figure');

  -- Every figure must carry at least one ref.
  v_bad := public.board_pack_figure_refs(v_snap);
  perform provio_test.assert_eq(coalesce(array_length(v_bad, 1), 0), 0, 'every top-level figure carries at least one ref');

  perform provio_test.assert_eq((v_snap -> 'cap' -> '31-60' ->> 'value')::int, 1,
    'the 45-day-overdue CAP lands in the 31-60 band');
  perform provio_test.assert_eq((v_snap -> 'sealed_work' ->> 'value')::int, 1,
    'one signed-off workpaper is counted');

  -- The same inputs produce the same snapshot (deterministic, L1).
  v_snap2 := public.board_pack_snapshot(org_a, 'org', null, null);
  perform provio_test.assert_eq(
    public.canonical_payload(v_snap) = public.canonical_payload(v_snap2), true,
    'two snapshots of the same state are byte-identical (deterministic)');

  -- Cross-org: Org B's snapshot never contains Org A's rows.
  perform provio_test.assert_true(
    not (public.board_pack_snapshot('b0000000-0000-0000-0000-000000000001', 'org', null, null)
         -> 'cap' ? '31-60'),
    'Org B does not see Org A cap aging');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Generation: refuses without the right, without the entitlement and before app_base_url is set.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.board_pack_generate('a0000000-0000-0000-0000-000000000001','org','custom',null,null)$q$,
    'not allowed', 'an Org Admin without generate_board_pack is refused');
end $$;

-- The CIA holds generate_board_pack, but the entitlement is off and app_base_url is unset.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.board_pack_generate('a0000000-0000-0000-0000-000000000001','org','custom',null,null)$q$,
    'not included in your plan', 'generation is refused when the board_pack feature is off');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Turn the entitlement on (as the platform admin), then generation still refuses until
--    app_base_url is set, and succeeds once it is.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','board_pack',true,'Assurance','board pack add-on');
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','board_pack_pptx',true,'Assurance','board pack add-on');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.board_pack_generate('a0000000-0000-0000-0000-000000000001','org','custom',null,null)$q$,
    'Set the application web address', 'generation is refused until app_base_url is set');
end $$;

select provio_test.as_owner();
insert into org_settings_extra (org_id, app_base_url)
values ('a0000000-0000-0000-0000-000000000001', 'https://provio-test.invalid')
on conflict (org_id) do update set app_base_url = excluded.app_base_url;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
create temp table if not exists bp_pack as select public.board_pack_generate('a0000000-0000-0000-0000-000000000001','org','custom',null,null) as id;

-- The hash and ledger assertions run as the owner, because ledger_payload_hash() calls
-- extensions.digest() which the authenticated role may not execute (it is not security definer).
select provio_test.as_owner();
do $$
declare
  v_id uuid;
  v_row record;
  v_ledger record;
begin
  select id into v_id from bp_pack;
  perform provio_test.assert_true(v_id is not null, 'the pack is generated');

  select * into v_row from board_pack_history where id = v_id;
  perform provio_test.assert_eq(v_row.status, 'ready', 'the pack is ready');
  perform provio_test.assert_eq(length(v_row.data_hash), 64, 'the data_hash is a SHA-256 hex digest');
  perform provio_test.assert_eq(v_row.data_hash,
    public.ledger_payload_hash(public.canonical_payload(v_row.snapshot)),
    'the data_hash is the hash of the canonical snapshot, computed in the database');

  -- The ledger entry carries the hash (F20 kind board_pack_generated).
  select * into v_ledger from ledger_entries where id = v_row.ledger_entry_id;
  perform provio_test.assert_eq(v_ledger.action, 'board_pack_generated', 'a ledger entry is written');
  perform provio_test.assert_eq(v_ledger.payload ->> 'data_hash', v_row.data_hash,
    'the ledger entry carries the data hash');
end $$;

-- ---------------------------------------------------------------------------
-- 6. The last-pack detection is per scope_key: a second pack of the same scope chains to the first,
--    and a pack of a different scope does not see it.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_first uuid;
  v_second uuid;
  v_other uuid;
  v_row record;
  v_other_row record;
begin
  select id into v_first from board_pack_history
   where org_id = 'a0000000-0000-0000-0000-000000000001' and scope_key = 'org'
   order by generated_at desc limit 1;

  v_second := public.board_pack_generate('a0000000-0000-0000-0000-000000000001','org','since_last',null,null);
  select * into v_row from board_pack_history where id = v_second;
  perform provio_test.assert_eq(v_row.previous_pack_id, v_first,
    'a second pack of the same scope chains to the first');
  perform provio_test.assert_true(v_row.from_ts > '1970-01-01'::timestamptz,
    'the boundary starts at the previous pack, not at the epoch');

  -- A different scope_key has no previous pack.
  v_other := public.board_pack_generate('a0000000-0000-0000-0000-000000000001','universe:A-U1','since_last',null,null);
  select * into v_other_row from board_pack_history where id = v_other;
  perform provio_test.assert_eq(v_other_row.previous_pack_id, null::uuid,
    'a pack of a different scope has no previous pack');
  perform provio_test.assert_eq(v_other_row.from_ts, '1970-01-01'::timestamptz,
    'a pack of a different scope starts at the epoch');
end $$;

-- ---------------------------------------------------------------------------
-- 7. board_pack_list is per right; board_pack_get returns the snapshot. A preparer (no
--    view_board_pack) gets nothing.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(
    (select count(*) from public.board_pack_list('a0000000-0000-0000-0000-000000000001')) >= 3,
    'the CIA sees the pack history');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from public.board_pack_list('a0000000-0000-0000-0000-000000000001')), 0,
    'a preparer without view_board_pack sees no pack');
end $$;

-- ---------------------------------------------------------------------------
-- 8. The section list is configurable: reorder, disable, set role visibility.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform public.board_pack_sections_save('a0000000-0000-0000-0000-000000000001',
    jsonb_build_array(
      jsonb_build_object('section_key','sira','ordinal',1,'enabled',true,'visible_roles',jsonb_build_array('cia')),
      jsonb_build_object('section_key','cover','ordinal',2,'enabled',false)));
  perform provio_test.assert_eq(
    (select ordinal from board_pack_sections where org_id = 'a0000000-0000-0000-0000-000000000001' and section_key = 'sira'),
    1, 'the SIRA section is moved to the top');
  perform provio_test.assert_eq(
    (select enabled from board_pack_sections where org_id = 'a0000000-0000-0000-0000-000000000001' and section_key = 'cover'),
    false, 'the cover section is turned off, not deleted');
  perform provio_test.assert_eq(
    (select visible_roles from board_pack_sections where org_id = 'a0000000-0000-0000-0000-000000000001' and section_key = 'sira'),
    array['cia'], 'the section role visibility is stored');
end $$;

-- ---------------------------------------------------------------------------
-- 9. RLS: a tenant reads only its own rows and cannot write directly.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from board_pack_history where org_id = 'a0000000-0000-0000-0000-000000000001'), 0,
    'Org B reads no Org A pack through RLS');
  perform provio_test.assert_raises(
    $q$insert into board_pack_history (org_id, scope_key) values ('b0000000-0000-0000-0000-000000000001','x')$q$,
    'board_pack_history', 'a tenant cannot insert a pack directly');
end $$;
