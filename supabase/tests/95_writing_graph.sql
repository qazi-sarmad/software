-- 95: the Evidence-Bound Claim Graph tables (WRITE-1, 0088). Spec §15.6.
--   * RLS on every new table, no direct write from a tenant, isolation between organisations.
--   * The hash-chained version logs (report_template_versions, figure_function_versions,
--     report_claim_versions) link each row to the previous row of the same organisation.
--   * report_claims and report_graphs are append-only.
-- M5: the fixtures are written as the owner and removed by provio_test.seed() on the next run, so
--     this test leaves no residue.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. RLS is on for every table 0088 creates (spec §25.2).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  n int;
begin
  foreach t in array array[
    'report_templates','report_template_versions','report_claims','report_claim_versions',
    'report_terminology','figure_functions','figure_function_versions','report_graphs'
  ] loop
    select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relname = t and c.relrowsecurity;
    perform provio_test.assert_eq(n, 1, format('RLS is enabled on %s', t));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Fixtures (owner): an Org A template and figure function; the version logs must chain.
-- ---------------------------------------------------------------------------
insert into report_templates (org_id, model_id, version, title, plan)
  values ('a0000000-0000-0000-0000-000000000001', 'M1', 1, 'Full engagement report',
          '{"sections":[{"id":"exec","role":"lead_in","order":1,"registerInvariant":false,"heading":"Executive summary"}]}'::jsonb);
insert into report_templates (org_id, model_id, version, title, plan, is_current)
  values ('a0000000-0000-0000-0000-000000000001', 'M1', 2, 'Full engagement report',
          '{"sections":[]}'::jsonb, true);

insert into figure_functions (org_id, figure_id, version, description, result_scale, body_hash)
  values ('a0000000-0000-0000-0000-000000000001', 'count_findings_by_severity', 1,
          'Counts findings in scope grouped by severity level.', 0, repeat('1', 64));

do $$
declare
  v_count int;
  v_bad int;
begin
  select count(*) into v_count from report_template_versions
    where org_id = 'a0000000-0000-0000-0000-000000000001';
  perform provio_test.assert_eq(v_count, 2, 'each template insert wrote one version-log row');

  -- The chain links: the second row's prev_hash is the first row's row_hash, and each row_hash is
  -- the sha256 of (prev_hash | fields).
  select count(*) into v_bad
    from report_template_versions v
    join report_template_versions p on p.org_id = v.org_id and p.id < v.id
   where v.org_id = 'a0000000-0000-0000-0000-000000000001'
     and v.prev_hash is distinct from p.row_hash
     and p.id = (select max(p2.id) from report_template_versions p2 where p2.org_id = v.org_id and p2.id < v.id);
  perform provio_test.assert_eq(v_bad, 0, 'report_template_versions links each row to the previous');

  select count(*) into v_count from figure_function_versions
    where org_id = 'a0000000-0000-0000-0000-000000000001';
  perform provio_test.assert_eq(v_count, 1, 'the figure-function insert wrote one version-log row');
end $$;

-- ---------------------------------------------------------------------------
-- 3. A tenant cannot write directly; the tables take no insert from a client (spec §25.1).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_raises(
    $q$insert into report_templates (org_id, model_id, version, title) values ('a0000000-0000-0000-0000-000000000001','M9',1,'x')$q$,
    'permission denied', 'a tenant cannot insert a report template directly');
  perform provio_test.assert_raises(
    $q$insert into report_terminology (org_id, term_key, display_text) values ('a0000000-0000-0000-0000-000000000001','k','v')$q$,
    'permission denied', 'a tenant cannot insert terminology directly');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Isolation: Org B cannot read Org A's rows in any new table (L2, spec §25.2).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  t text;
  n int;
begin
  foreach t in array array[
    'report_templates','report_template_versions','report_claims','report_claim_versions',
    'report_terminology','figure_functions','figure_function_versions','report_graphs'
  ] loop
    execute format('select count(*) from %I where org_id = %L', t, 'a0000000-0000-0000-0000-000000000001') into n;
    perform provio_test.assert_eq(n, 0, format('Org B cannot read Org A rows in %s', t));
  end loop;
end $$;

-- Org A sees its own.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq(
    (select count(*) from report_templates where org_id = 'a0000000-0000-0000-0000-000000000001')::int, 2,
    'Org A still reads its own report templates');
end $$;

-- ---------------------------------------------------------------------------
-- 5. report_claims and report_graphs are append-only (L5). A claim needs a report version to hang
--    from; build one as the owner through the existing compose path, then try to edit the claim.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_eng uuid := '50000000-0000-0000-0000-0000000000a1';
  v_version uuid;
  v_claim uuid;
begin
  insert into report_versions (org_id, engagement_id, version_number, status)
    values (v_org, v_eng, 1, 'draft') returning id into v_version;

  insert into report_claims (org_id, report_version_id, claim_id, section_id, position, kind, claim_level,
                             phrase_id, phrase_version, rule_id, rule_version, claim_hash)
    values (v_org, v_version, 'c1', 'exec', 1, 'calculated', 'calculated',
            'p1', 1, 'r1', 1, repeat('a', 64)) returning id into v_claim;

  -- The claim insert wrote a claim-version row.
  perform provio_test.assert_eq(
    (select count(*) from report_claim_versions where report_version_id = v_version)::int, 1,
    'the claim insert wrote one claim-version row');

  -- An auditor claim needs no phrase (the constraint allows it); a calculated claim does.
  perform provio_test.assert_raises(
    $q$insert into report_claims (org_id, report_version_id, claim_id, section_id, kind, claim_level, claim_hash)
       values ('a0000000-0000-0000-0000-000000000001', (select id from report_versions limit 1), 'c2','exec','calculated','calculated','x')$q$,
    'rc_phrase_required', 'a calculated claim without a phrase is refused');

  perform provio_test.assert_raises(
    format('update report_claims set claim_hash = %L where id = %L', repeat('b', 64), v_claim),
    'recompose', 'a claim row cannot be edited');
  perform provio_test.assert_raises(
    format('delete from report_claims where id = %L', v_claim),
    'recompose', 'a claim row cannot be deleted');

  insert into report_graphs (org_id, report_version_id, model_id, formality, tone, voice, locale,
                             graph_root, render_hash, engine_version, template_version, phrase_library_version)
    values (v_org, v_version, 'M1', 3, 2, 'active', 'en-GB', repeat('c', 64), repeat('d', 64), '1.0.0', '1.0.0', '1.0.0');
  perform provio_test.assert_raises(
    format('update report_graphs set graph_root = %L where report_version_id = %L', repeat('e', 64), v_version),
    'append-only', 'a committed report graph cannot be edited');

  -- One row per (version, model, register, locale) variant.
  perform provio_test.assert_raises(
    format($q$insert into report_graphs (org_id, report_version_id, model_id, formality, tone, voice, locale, graph_root, render_hash) values ('%s', '%s', 'M1', 3, 2, 'active', 'en-GB', 'x', 'y')$q$, v_org, v_version),
    'rg_variant_idx', 'a duplicate variant row is refused');
end $$;

select provio_test.as_owner();
