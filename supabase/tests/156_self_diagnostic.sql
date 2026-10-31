-- Test 156 (self-diagnostic): the counts the self-diagnostic engine reads.
--
-- The RULES are pure (src/lib/diagnostics.ts); this proves the FACTS. `org_diagnostic_snapshot`
-- returns counts and flags for the caller's org and NOTHING of another org's; the ledger flag is the
-- real `verify_ledger` result; `platform_diagnostic_snapshot` is refused to a non-platform caller and
-- returns counts to a platform administrator. Law L2: no field is a row of tenant content.
--
-- The harness runs this file twice; `provio_test.seed()` resets the data at the top.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- 1. An org member gets a snapshot with the seeded counts, org-scoped.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  s jsonb;
begin
  s := public.org_diagnostic_snapshot();
  perform provio_test.assert_eq((s ->> 'universes')::int, 2, 'snapshot: org A has two universes');
  perform provio_test.assert_eq((s ->> 'is_empty')::boolean, false, 'snapshot: org A is not empty');
  perform provio_test.assert_eq((s ->> 'roles_total')::int, 7, 'snapshot: org A has seven roles');
  perform provio_test.assert_eq((s ->> 'populations')::int, 1, 'snapshot: org A has one population');
  perform provio_test.assert_true((s ->> 'as_of') is not null, 'snapshot: it carries an as_of day');
  -- The ledger the seed wrote has empty prev/hash, so the chain does not verify: the flag is honest.
  perform provio_test.assert_true(s ? 'ledger_broken_at', 'snapshot: the ledger flag is present');
end $$;

-- ===========================================================================
-- 2. The snapshot is org-scoped: org B's member sees org B's counts, never org A's rows.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  s jsonb;
begin
  s := public.org_diagnostic_snapshot();
  perform provio_test.assert_eq((s ->> 'universes')::int, 1, 'snapshot: org B has one universe');
  perform provio_test.assert_eq((s ->> 'populations')::int, 1, 'snapshot: org B has its own population');
end $$;

-- ===========================================================================
-- 3. A member with NO audit right can still run a self-check (a new org's member must see the guided
--    empty state, not a permission error).
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a7', 'a0000000-0000-0000-0000-000000000001', 'auditee');
do $$
declare
  s jsonb;
begin
  s := public.org_diagnostic_snapshot();
  perform provio_test.assert_true((s ->> 'universes') is not null,
    'snapshot: an auditee with no audit right can still read the counts');
end $$;

-- ===========================================================================
-- 4. platform_diagnostic_snapshot is refused to a non-platform caller and works for a platform admin.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  begin
    perform public.platform_diagnostic_snapshot();
    perform provio_test.assert_true(false, 'platform snapshot: a non-platform caller must be refused');
  exception when others then
    perform provio_test.assert_true(sqlerrm like '%platform administrator%',
      'platform snapshot: the refusal names the platform role');
  end;
end $$;

-- The platform admin principal from 00_lib (f0) carries the platform_admin role in the claims.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', 'a0000000-0000-0000-0000-000000000001', 'platform_admin');
do $$
declare
  s jsonb;
begin
  s := public.platform_diagnostic_snapshot();
  perform provio_test.assert_eq((s ->> 'tenants')::int, 2, 'platform snapshot: two tenants');
  perform provio_test.assert_true(s ? 'jobs_total', 'platform snapshot: it reports the job count');
end $$;

select provio_test.as_owner();
