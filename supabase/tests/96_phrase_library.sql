-- 96: the phrase library and the review workbook (WRITE-1, 0089). Spec §15.6, W2.1, W2.9.
--   * RLS on every new table, no direct write from a tenant, isolation between organisations.
--   * A released phrase is immutable: an update to its wording is refused.
--   * A release is refused until every workbook cell is reviewed; releasing is a platform-admin act.
--   * The version log is hash-chained and append-only.
-- M5: the fixtures are written as the owner and removed by provio_test.seed() on the next run.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. RLS is on for every table 0089 creates.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  n int;
begin
  foreach t in array array['phrases', 'phrase_versions', 'phrase_reviews'] loop
    select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relname = t and c.relrowsecurity;
    perform provio_test.assert_eq(n, 1, format('RLS is enabled on %s', t));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. No direct write from a tenant to any of the tables.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_n int;
begin
  foreach t in array array['phrases', 'phrase_versions', 'phrase_reviews'] loop
    select count(*) into v_n from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = t
        and g.grantee in ('anon', 'authenticated', 'public')
        and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE');
    perform provio_test.assert_eq(v_n, 0, format('%s takes no direct write from a tenant', t));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. A phrase is created as a draft; the version log chains it.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
select public.phrase_create('a0000000-0000-0000-0000-000000000001', 'condition.test_exceptions',
  'The engagement tested {tests} {test_noun}, of which {exceptions} produced exceptions.',
  'calculated', 3, 2, 'active', 'en-GB', repeat('c', 64));

do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from phrases where org_id = 'a0000000-0000-0000-0000-000000000001')::int, 1,
    'the phrase was created');
  perform provio_test.assert_eq(
    (select status from phrases where phrase_id = 'condition.test_exceptions'), 'draft',
    'a new phrase is a draft');
  perform provio_test.assert_eq(
    (select count(*) from phrase_versions where org_id = 'a0000000-0000-0000-0000-000000000001')::int, 1,
    'the version log holds one row');
  perform provio_test.assert_true(
    (select coalesce(prev_hash, '') = '' from phrase_versions where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'the first version row has an empty prev_hash');
end $$;

-- A second phrase chains onto the first.
select public.phrase_create('a0000000-0000-0000-0000-000000000001', 'effect.approval_gap',
  '{exceptions} payments were made without evidence of approval.', 'verified', 3, 2, 'active', 'en-GB', repeat('d', 64));
do $$
declare v_prev text;
begin
  select row_hash into v_prev from phrase_versions
    where org_id = 'a0000000-0000-0000-0000-000000000001' order by id limit 1;
  perform provio_test.assert_eq(
    (select prev_hash from phrase_versions where org_id = 'a0000000-0000-0000-0000-000000000001' order by id desc limit 1),
    v_prev, 'the second version row chains onto the first');
end $$;

-- ---------------------------------------------------------------------------
-- 4. The version log is append-only.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$ begin
  perform provio_test.assert_raises(
    $q$update phrase_versions set status = 'x'$q$, 'append-only',
    'phrase_versions refuses an update');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');

-- ---------------------------------------------------------------------------
-- 5. A release is refused until every workbook cell is reviewed, and only a platform admin may
--    release.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$ begin
  perform provio_test.assert_raises(
    format('select public.phrase_release(%L, 100)', (select id from phrases where phrase_id = 'condition.test_exceptions')),
    'unreviewed workbook cells',
    'a release is refused while a workbook cell is unreviewed');
end $$;

-- Review one cell only: still refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select public.phrase_review_cell('a0000000-0000-0000-0000-000000000001', 'condition.test_exceptions', 1, 'M1',
  'f3-t2-active-en-GB', 'reviewed');
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$ begin
  perform provio_test.assert_raises(
    format('select public.phrase_release(%L, 100)', (select id from phrases where phrase_id = 'condition.test_exceptions')),
    'unreviewed workbook cells',
    'one reviewed cell is not enough for a release');
end $$;

-- Review every cell the workbook would carry for this phrase at one model: then the release succeeds.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  f int; t int; v text; l text;
begin
  foreach f in array array[1, 2, 3, 4, 5] loop
    foreach t in array array[1, 2, 3, 4, 5] loop
      foreach v in array array['active', 'passive'] loop
        foreach l in array array['en-GB', 'en-US'] loop
          perform public.phrase_review_cell('a0000000-0000-0000-0000-000000000001',
            'condition.test_exceptions', 1, 'M1',
            format('f%s-t%s-%s-%s', f, t, v, l), 'reviewed');
        end loop;
      end loop;
    end loop;
  end loop;
end $$;

-- A tenant CIA cannot release even when the cells are reviewed: releasing is a platform-admin action.
do $$ begin
  perform provio_test.assert_raises(
    format('select public.phrase_release(%L, 100)', (select id from phrases where phrase_id = 'condition.test_exceptions')),
    'platform administrator', 'a tenant user cannot release a phrase');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
select public.phrase_release((select id from phrases where phrase_id = 'condition.test_exceptions'), 100);
do $$ begin
  perform provio_test.assert_eq(
    (select status from phrases where phrase_id = 'condition.test_exceptions'), 'released',
    'a platform administrator releases the phrase once every cell is reviewed');
end $$;

-- ---------------------------------------------------------------------------
-- 6. A released phrase is immutable: changing its wording is refused.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$ begin
  perform provio_test.assert_raises(
    $q$update phrases set template = 'changed wording' where phrase_id = 'condition.test_exceptions'$q$,
    'immutable', 'a released phrase refuses a wording change');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');

-- ---------------------------------------------------------------------------
-- 7. Cross-organisation: Org B cannot read Org A phrases, and cannot create one in Org A.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq(
    (select count(*) from public.phrase_list('a0000000-0000-0000-0000-000000000001'))::int, 0,
    'org B cannot read org A phrases');
  perform provio_test.assert_raises(
    $q$select public.phrase_create('a0000000-0000-0000-0000-000000000001', 'x', 'y', 'calculated', 3, 2, 'active', 'en-GB', 'z')$q$,
    'not the caller', 'org B cannot create a phrase in org A');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq(
    (select count(*) from public.phrase_list('a0000000-0000-0000-0000-000000000001'))::int, 2,
    'org A still reads its own phrases');
end $$;

select provio_test.as_owner();
