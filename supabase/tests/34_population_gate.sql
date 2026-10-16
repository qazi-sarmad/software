-- Test 34 (4C): Population gate DB — verification invariant, L3 enforcement, lock and replacement
-- (spec §11.1, L3).
\i supabase/tests/00_lib.sql
select provio_test.seed();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');

-- ---------------------------------------------------------------------------
-- 1. Verification requires a SHA-256 and a positive row count.
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_raises(
    $q$insert into populations (org_id, engagement_id, sha256, row_count, status) values ('a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1',repeat('c',64),0,'verified')$q$,
    'positive row count', '4C: verification is refused with a zero row count');
  perform provio_test.assert_raises(
    $q$insert into populations (org_id, engagement_id, sha256, row_count, status) values ('a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1',null,1,'verified')$q$,
    'needs a SHA-256', '4C: verification is refused with no hash');
  -- A verified insert stamps verified_at/by.
  insert into populations (id, org_id, engagement_id, sha256, row_count, status)
  values ('70000000-0000-0000-0000-0000000000c1','a0000000-0000-0000-0000-000000000001',
          '50000000-0000-0000-0000-0000000000a1', repeat('d',64), 3, 'verified');
  perform provio_test.assert_true(
    (select verified_at is not null and verified_by is not null
       from populations where id = '70000000-0000-0000-0000-0000000000c1'),
    '4C: verification stamps verified_at/by');
end $$;

-- ---------------------------------------------------------------------------
-- 2. L3: a sample row whose sample is not backed by a verified (or locked) population is refused.
-- ---------------------------------------------------------------------------
do $$
begin
  -- A population still verifying cannot back a sample.
  insert into populations (id, org_id, engagement_id, sha256, row_count, status)
  values ('70000000-0000-0000-0000-0000000000c2','a0000000-0000-0000-0000-000000000001',
          '50000000-0000-0000-0000-0000000000a1', repeat('e',64), 2, 'verifying');
  perform provio_test.assert_raises(
    $q$insert into samples (org_id, population_id, population_sha256) values ('a0000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-0000000000c2',repeat('e',64))$q$,
    'population_gate', '4C: L3 — a sample on a verifying population is refused');
  -- A sample row on the seeded verified sample is accepted.
  insert into sample_rows (org_id, sample_id, row_ref)
  values ('a0000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-0000000000a1',99);
  perform provio_test.assert_true(true, '4C: a sample row on a verified sample is accepted');
end $$;

-- ---------------------------------------------------------------------------
-- 3. lock_population requires a verified population and writes a ledger entry.
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.lock_population('70000000-0000-0000-0000-0000000000c2')$q$,
    'only a verified population', '4C: a non-verified population cannot be locked');
end $$;
select public.lock_population('70000000-0000-0000-0000-0000000000c1');
do $$
begin
  perform provio_test.assert_eq(
    (select status from populations where id = '70000000-0000-0000-0000-0000000000c1'), 'locked',
    '4C: a verified population locks');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001'
            and action = 'population_locked'),
    '4C: locking writes a hash-chained ledger entry');
  perform provio_test.assert_raises(
    $q$select public.lock_population('70000000-0000-0000-0000-0000000000c1')$q$,
    'already locked', '4C: a locked population cannot be locked again');
end $$;

-- ---------------------------------------------------------------------------
-- 4. A locked population still backs samples (it is verified), so the L3 gate stays satisfied.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into samples (id, org_id, population_id, population_sha256)
  values ('80000000-0000-0000-0000-0000000000c1','a0000000-0000-0000-0000-000000000001',
          '70000000-0000-0000-0000-0000000000c1', repeat('d',64));
  perform provio_test.assert_true(true, '4C: a locked population still backs a sample');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Replacement of a locked population needs a rationale and creates a NEW row; the old row stays.
-- ---------------------------------------------------------------------------
do $$
declare
  v_new uuid;
begin
  perform provio_test.assert_raises(
    $q$select public.replace_locked_population('70000000-0000-0000-0000-0000000000c1','short')$q$,
    'at least 10 characters', '4C: replacement needs a rational of at least 10 characters');
  v_new := public.replace_locked_population('70000000-0000-0000-0000-0000000000c1',
    'The source ledger was re-extracted after a system upgrade.');
  perform provio_test.assert_true(v_new is not null, '4C: replacement returns the new population id');
  perform provio_test.assert_eq(
    (select status from populations where id = '70000000-0000-0000-0000-0000000000c1'), 'locked',
    '4C: the old locked population is retained, not deleted');
  perform provio_test.assert_eq(
    (select status from populations where id = v_new), 'uploading',
    '4C: the replacement starts unverified');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001'
            and action = 'population_replaced'),
    '4C: replacement writes a hash-chained ledger entry');
  -- The replacement is not locked, so it cannot itself be replaced yet.
  perform provio_test.assert_raises(
    format($q$select public.replace_locked_population(%L,'another good reason')$q$, v_new),
    'only a locked population', '4C: an unlocked population may not be replaced');
end $$;

-- ---------------------------------------------------------------------------
-- 6. A caller without perform_work cannot lock a population.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.lock_population('70000000-0000-0000-0000-0000000000c1')$q$,
    'perform_work', '4C: a caller without perform_work cannot lock a population');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 7. Isolation: an Org B caller reads no Org A populations and cannot replace them.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from populations where org_id = 'a0000000-0000-0000-0000-000000000001'), 0::bigint,
    '4C: an Org B caller reads zero Org A populations');
  perform provio_test.assert_raises(
    $q$select public.replace_locked_population('70000000-0000-0000-0000-0000000000c1','a good reason here')$q$,
    'not found in this organisation', '4C: replacement of another org''s population is refused');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 8. Anon reads nothing.
-- ---------------------------------------------------------------------------
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_eq((select count(*) from populations), 0::bigint,
    '4C: anon reads zero populations');
end $$;
select provio_test.as_owner();
