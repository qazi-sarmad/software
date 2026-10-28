-- Test 107 (Phase 2.9): high-value items must be included or explicitly waived before a sample locks.
--
-- Before migration 0106 no value-coverage check existed: a sample could exclude the population's
-- largest items and still lock. 0106 adds `value_coverage`, `assert_value_coverage` (called by
-- `lock_sample`) and `waive_value_coverage`, with an append-only waiver record.
--
-- Every assertion runs under a real role.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Fixture: one workpaper with a verified 40-row population. Row 1 carries 1000000, so on its own it
-- is more than 10% of the total value (the rest sum to 820) and is the only high-value item.
do $$
declare
  v_pop uuid := '70000000-0000-0000-0000-0000000000f1';
  v_wp  uuid := '60000000-0000-0000-0000-0000000000f1';
begin
  insert into workpapers (id, org_id, engagement_id, stage) values
    (v_wp, 'a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1', 'testing');
  insert into populations (id, org_id, engagement_id, workpaper_id, sha256, row_count, status)
  values (v_pop, 'a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1',
          v_wp, repeat('f',64), 40, 'verified');
  insert into population_rows (org_id, population_id, row_ref, data)
  select 'a0000000-0000-0000-0000-000000000001', v_pop, g,
         jsonb_build_object('amt', case when g = 1 then 1000000 else g end)
  from generate_series(1, 40) g;
end $$;

-- ===========================================================================
-- 1. high_value_row_refs finds row 1, and only row 1.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    public.high_value_row_refs('70000000-0000-0000-0000-0000000000f1'), array[1],
    '2.9: the high-value set is the largest item that crosses 10% of total value');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 2. A pasted sample that omits the high-value item cannot lock.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_sample uuid;
  v_rows jsonb;
begin
  -- Paste ten rows, deliberately none of them row 1.
  select jsonb_agg(jsonb_build_object('row_ref', g)) into v_rows from generate_series(2, 11) g;
  perform public.compute_sample('60000000-0000-0000-0000-0000000000f1', 'auditor_paste', v_rows);
  select id into v_sample from samples where workpaper_id = '60000000-0000-0000-0000-0000000000f1';
  perform provio_test.assert_eq(
    (public.value_coverage(v_sample) ->> 'covered')::boolean, false,
    '2.9: coverage is false when the high-value item is missing');
  perform provio_test.assert_eq(
    public.value_coverage(v_sample) -> 'missing', '[1]'::jsonb,
    '2.9: the missing list names the high-value item');
  perform provio_test.assert_raises(
    format($q$select public.lock_sample(%L)$q$, v_sample),
    'value_coverage', '2.9: a sample that omits a high-value item cannot lock');
  perform provio_test.assert_eq(
    (select locked_at from samples where id = v_sample), null::timestamptz,
    '2.9: the refused lock leaves the sample unlocked');
end $$;

-- ===========================================================================
-- 3. A waiver of at least ten characters clears the gate.
-- ===========================================================================
do $$
declare
  v_sample uuid;
begin
  select id into v_sample from samples where workpaper_id = '60000000-0000-0000-0000-0000000000f1';
  perform provio_test.assert_raises(
    format($q$select public.waive_value_coverage(%L, 1, 'too short')$q$, v_sample),
    '10 characters', '2.9: a waiver reason shorter than ten characters is refused');
  perform public.waive_value_coverage(v_sample, 1, 'Immaterial: the item is a bank transfer already tested in the cash workpaper.');
  perform provio_test.assert_eq(
    (public.value_coverage(v_sample) ->> 'covered')::boolean, true,
    '2.9: a waiver clears the coverage gate');
  perform public.lock_sample(v_sample);
  perform provio_test.assert_eq(
    (select locked_at is not null from samples where id = v_sample), true,
    '2.9: the sample locks once the high-value item is waived');
end $$;

-- ===========================================================================
-- 4. The waiver is append-only and writes a ledger entry.
-- ===========================================================================
-- The append-only guard is tested as the owner: RLS alone would make the update a no-op for a
-- preparer, which proves nothing about the trigger.
select provio_test.as_owner();
do $$
declare
  v_waiver uuid;
begin
  select id into v_waiver from sample_value_waivers
   where sample_id = (select id from samples where workpaper_id = '60000000-0000-0000-0000-0000000000f1');
  perform provio_test.assert_raises(
    format($q$update sample_value_waivers set reason = 'rewritten' where id = %L$q$, v_waiver),
    'append-only', '2.9: a waiver cannot be edited');
  perform provio_test.assert_raises(
    format($q$delete from sample_value_waivers where id = %L$q$, v_waiver),
    'append-only', '2.9: a waiver cannot be deleted');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001'
            and action = 'value_coverage_waived'),
    '2.9: a waiver writes a ledger entry');
end $$;

-- ===========================================================================
-- 5. A system sample already covers the high-value item, so it locks without a waiver.
-- ===========================================================================
-- A second fixture, because a waived sample is append-only and must not be deleted.
do $$
declare
  v_pop uuid := '70000000-0000-0000-0000-0000000000f2';
  v_wp  uuid := '60000000-0000-0000-0000-0000000000f2';
begin
  insert into workpapers (id, org_id, engagement_id, stage) values
    (v_wp, 'a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1', 'testing');
  insert into populations (id, org_id, engagement_id, workpaper_id, sha256, row_count, status)
  values (v_pop, 'a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1',
          v_wp, repeat('f',64), 40, 'verified');
  insert into population_rows (org_id, population_id, row_ref, data)
  select 'a0000000-0000-0000-0000-000000000001', v_pop, g,
         jsonb_build_object('amt', case when g = 1 then 1000000 else g end)
  from generate_series(1, 40) g;
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_wp uuid := '60000000-0000-0000-0000-0000000000f2';
  v_sample uuid;
begin
  perform public.compute_sample(v_wp, 'system');
  select id into v_sample from samples where workpaper_id = v_wp;
  perform provio_test.assert_eq(
    (public.value_coverage(v_sample) ->> 'covered')::boolean, true,
    '2.9: a system sample already covers the high-value item');
  perform public.lock_sample(v_sample);
  perform provio_test.assert_eq(
    (select locked_at is not null from samples where id = v_sample), true,
    '2.9: a system sample locks without a waiver');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 6. Isolation: Org B cannot read Org A's coverage.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.value_coverage('80000000-0000-0000-0000-0000000000a1')$q$,
    'not found', '2.9: another organisation cannot read this coverage');
end $$;
select provio_test.as_owner();
