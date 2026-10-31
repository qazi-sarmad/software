-- Test 148 (S4): D11 — the audit-domain axis. Three default universes, each with its own discipline.
--
-- docs/AUDIT-DOMAINS-MODEL.md is the model: a discipline is a universe's `domain`, the three defaults
-- are a SEED (never a hard limit), and an org may add a fourth and point it at a rule pack.
--
-- Happy path: the three defaults are seeded for one org; a re-run adds nothing; a universe's
-- discipline is set, reason-stamped and ledgered; a fourth, org-defined discipline is accepted.
-- Bad paths: an unknown universe is refused; a blank or malformed discipline is refused; a caller
-- without edit_config is refused; org B never reads org A's discipline (L2).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- The platform administrator is a real account (invite_cap_events.invited_by references auth.users).
select provio_test.as_owner();
insert into auth.users (id, email) values ('10000000-0000-0000-0000-0000000000f0', 'platform@qscorp.test')
on conflict (id) do nothing;

-- ===========================================================================
-- 1. The three defaults are seeded for one organisation, one row per discipline.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v jsonb;
begin
  v := public.seed_default_universes('a0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, true, 'D11: seeding reports ok');
  perform provio_test.assert_eq((v ->> 'added')::int, 3, 'D11: three default universes are seeded');
  perform provio_test.assert_eq(
    (select count(*) from universes
      where org_id = 'a0000000-0000-0000-0000-000000000001'
        and domain in ('management', 'shariah', 'it')),
    3::bigint, 'D11: the three disciplines are present, one universe each');
  perform provio_test.assert_true(
    (select bool_and(name <> '') from universes
      where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'D11: every seeded universe is named');
end $$;

-- ===========================================================================
-- 2. Idempotent: a second seed adds nothing (the three are a seed, not a duplicate factory).
-- ===========================================================================
do $$
declare
  v jsonb;
begin
  v := public.seed_default_universes('a0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_eq((v ->> 'added')::int, 0, 'D11: re-seeding is idempotent');
  perform provio_test.assert_eq(
    (select count(*) from universes
      where org_id = 'a0000000-0000-0000-0000-000000000001' and domain is not null),
    3::bigint, 'D11: no duplicate discipline universe is created');
end $$;

-- ===========================================================================
-- 3. A fourth, org-defined discipline is accepted — the model never hard-codes exactly three.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_id uuid;
  v jsonb;
begin
  v_id := public.create_universe('Forensic Audit', null);
  v := public.set_universe_domain(v_id, 'forensic', 'the org adds a fourth discipline');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, true, 'D11: a fourth, org-defined discipline is accepted');
  perform provio_test.assert_eq((v ->> 'changed')::boolean, true, 'D11: the discipline was set');
  perform provio_test.assert_eq(
    public.universe_discipline(v_id), 'forensic', 'D11: the fourth discipline reads back');
  -- The change is ledgered (L3/L5).
  perform provio_test.assert_true(
    (select exists (select 1 from ledger_entries
      where org_id = 'a0000000-0000-0000-0000-000000000001'
        and payload ->> 'universe_id' = v_id::text and payload ->> 'to' = 'forensic')),
    'D11: the discipline change is ledgered with its reason');
end $$;

-- ===========================================================================
-- 4. Bad path — a blank or malformed discipline is refused, and nothing is written.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_id uuid;
  v jsonb;
begin
  select id into v_id from universes
   where org_id = 'a0000000-0000-0000-0000-000000000001' and domain = 'it';
  v := public.set_universe_domain(v_id, '   ', 'blank');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, false, 'D11: a blank discipline is refused');
  v := public.set_universe_domain(v_id, 'not a slug!', 'malformed');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, false, 'D11: a malformed discipline is refused');
  perform provio_test.assert_eq(
    public.universe_discipline(v_id), 'it', 'D11: the refused writes left the discipline unchanged');
end $$;

-- ===========================================================================
-- 5. Bad path — an unknown universe is refused.
-- ===========================================================================
do $$
declare
  v jsonb;
begin
  v := public.set_universe_domain('30000000-0000-0000-0000-0000000000ff', 'it', 'unknown');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, false, 'D11: an unknown universe is refused');
end $$;

-- ===========================================================================
-- 6. Bad path — a caller without edit_config is refused (an observer may not re-discipline a universe).
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
declare
  v_id uuid;
  v jsonb;
begin
  select id into v_id from universes
   where org_id = 'a0000000-0000-0000-0000-000000000001' and domain = 'it';
  v := public.set_universe_domain(v_id, 'shariah', 'observer tries');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, false, 'D11: an observer may not set a discipline');
end $$;

-- ===========================================================================
-- 7. Bad path — seeding a universe for an unknown organisation is refused.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform provio_test.assert_raises($q$
    select public.seed_default_universes('30000000-0000-0000-0000-0000000000ff')
  $q$, 'unknown organisation', 'D11: seeding an unknown org is refused');
end $$;

-- ===========================================================================
-- 8. L2 isolation — org B sees none of org A's universes or disciplines.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from universes where org_id = 'a0000000-0000-0000-0000-000000000001'),
    0::bigint, 'D11: org B sees no universe of org A (RLS)');
  perform provio_test.assert_true(
    public.universe_discipline(
      (select id from universes where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1)) is null,
    'D11: universe_discipline returns null for another org''s universe');
end $$;

select provio_test.as_owner();
