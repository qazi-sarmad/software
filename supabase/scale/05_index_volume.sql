-- Demonstrate the missing-org_id-index defect at realistic forensic volume.
-- 200 population_rows, 100 sample_rows, 100 test_rows, 100 findings, 100 observations,
-- 100 issues, 100 cap_items, 50 plans, 50 sign_offs, 100 notifications per org x 1000 orgs.
\set ON_ERROR_STOP on
\i supabase/tests/00_lib.sql

do $$ begin
  reset role;
  perform set_config('request.jwt.claims', '{}', false);
  insert into populations (id, org_id, engagement_id, filename, sha256, status, row_count)
  select md5('pop'||i)::uuid, md5('org'||i)::uuid, md5('eng'||i||'-1')::uuid, 'p.csv', repeat('a',64), 'verified', 200
  from generate_series(1,1000) i;

  insert into population_rows (org_id, population_id, row_ref, data)
  select md5('org'||i)::uuid, md5('pop'||i)::uuid, k, jsonb_build_object('amt', k)
  from generate_series(1,1000) i, generate_series(1,200) k;

  insert into workpapers (id, org_id, engagement_id, stage)
  select md5('wp'||i)::uuid, md5('org'||i)::uuid, md5('eng'||i||'-1')::uuid, 'testing'
  from generate_series(1,1000) i;

  insert into test_rows (org_id, workpaper_id, result)
  select md5('org'||i)::uuid, md5('wp'||i)::uuid, 'pass'
  from generate_series(1,1000) i, generate_series(1,100) k;

  insert into observations (org_id, engagement_id, title)
  select md5('org'||i)::uuid, md5('eng'||i||'-1')::uuid, 'O'
  from generate_series(1,1000) i, generate_series(1,100) k;

  insert into findings (org_id, severity)
  select md5('org'||i)::uuid, 'high'
  from generate_series(1,1000) i, generate_series(1,100) k;

  insert into issues (org_id, title)
  select md5('org'||i)::uuid, 'I'
  from generate_series(1,1000) i, generate_series(1,100) k;

  insert into cap_items (org_id, action)
  select md5('org'||i)::uuid, 'A'
  from generate_series(1,1000) i, generate_series(1,100) k;

  insert into plans (id, org_id, universe_id)
  select md5('plan'||i||'-'||k)::uuid, md5('org'||i)::uuid, md5('univ'||i||'-1')::uuid
  from generate_series(1,1000) i, generate_series(1,50) k;

  insert into sign_offs (org_id, workpaper_id, stage, preparer_id, reviewer_id)
  select md5('org'||i)::uuid, md5('wp'||i)::uuid, 'testing', md5('user'||i||'-2')::uuid, md5('user'||i||'-3')::uuid
  from generate_series(1,1000) i, generate_series(1,50) k;

  insert into notifications (org_id, user_id, kind)
  select md5('org'||i)::uuid, md5('user'||i||'-1')::uuid, 'scale'
  from generate_series(1,1000) i, generate_series(1,100) k;
end $$;

analyze;

-- Measure a single-org RLS-filtered read on each table, as that org's CIA.
do $$
declare o int := 500; t text; t0 timestamptz; ms numeric;
  tbls text[] := array['population_rows','test_rows','findings','observations',
                        'issues','cap_items','plans','sign_offs','notifications','universes'];
begin
  perform provio_test.as_user(md5('user500-1'), md5('org500')::text, 'cia');
  foreach t in array tbls loop
    t0 := clock_timestamp();
    execute format('select count(*) from %I', t);
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    raise notice 'READ %: % ms', t, round(ms,2);
  end loop;
end $$;
