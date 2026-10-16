-- Test 53 (7D): Prior-year import — import types, the imported-confirm gate on planning sign-off, and
-- confirmation (spec §19.2).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. import_prior_year_item requires manage_engagements and refuses non-importable types.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.import_prior_year_item('50000000-0000-0000-0000-0000000000a2', 'scope', '50000000-0000-0000-0000-0000000000a1')$q$,
    'manage_engagements', '7D: a preparer cannot import a prior-year item');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.import_prior_year_item('50000000-0000-0000-0000-0000000000a2', 'populations', '50000000-0000-0000-0000-0000000000a1')$q$,
    'not importable', '7D: populations are never importable');
end $$;

-- ---------------------------------------------------------------------------
-- 2. Importing a scope item creates an imported_confirm row.
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  v_id := public.import_prior_year_item('50000000-0000-0000-0000-0000000000a2', 'scope', '50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq((select status from prior_year_imports where id = v_id), 'imported_confirm',
    '7D: a new import is imported_confirm');
  perform provio_test.assert_eq(
    public.unconfirmed_prior_year_imports('50000000-0000-0000-0000-0000000000a1'), 1,
    '7D: the unconfirmed count is 1');
end $$;

-- ---------------------------------------------------------------------------
-- 3. The imported-confirm item blocks planning sign-off (§19.2).
-- ---------------------------------------------------------------------------
-- Prepare a planning section as the preparer, then try to sign as cia.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
select public.save_planning_section('50000000-0000-0000-0000-0000000000a1', 'scope', jsonb_build_object('summary', 'Scope'));
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.sign_planning('50000000-0000-0000-0000-0000000000a1')$q$,
    'unconfirmed_imports', '7D: an unconfirmed prior-year item blocks planning sign-off');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Confirming the item clears the gate.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_id uuid;
begin
  select id into v_id from prior_year_imports
   where org_id = 'a0000000-0000-0000-0000-000000000001' and engagement_id = '50000000-0000-0000-0000-0000000000a1'
   limit 1;
  perform public.confirm_prior_year_item(v_id);
  perform provio_test.assert_eq((select status from prior_year_imports where id = v_id), 'confirmed',
    '7D: a confirmed item is confirmed');
  perform provio_test.assert_eq(
    public.unconfirmed_prior_year_imports('50000000-0000-0000-0000-0000000000a1'), 0,
    '7D: the unconfirmed count is 0 after confirmation');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select public.sign_planning('50000000-0000-0000-0000-0000000000a1');
do $$
begin
  perform provio_test.assert_true(
    public.planning_signed_off('50000000-0000-0000-0000-0000000000a1'),
    '7D: planning signs off once the import is confirmed');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Cross-org refusal and visibility.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b4', 'b0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_eq((select count(*) from prior_year_imports), 0::bigint,
    '7D: another organisation sees no prior-year imports');
  perform provio_test.assert_raises(
    $q$select public.import_prior_year_item('50000000-0000-0000-0000-0000000000a2', 'scope', '50000000-0000-0000-0000-0000000000a1')$q$,
    'source engagement not found', '7D: another organisation cannot import from org A');
end $$;

select provio_test.as_owner();
