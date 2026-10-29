-- Concurrency and RLS-under-load probe. The isolation probe (01) proves no cross-tenant leak
-- sequentially; this proves the same under PARALLEL load, where a connection pool reuses roles and
-- a leak would surface as a row from another org. Run via pgbench, not psql: see 06_concurrency.sh.
--
-- This file is documentation of the probe's shape; the executable driver is 06_concurrency.sh.
--
-- For each client, pick a random org in 1..1000 and act as that org's CIA (user i-1). Then read the
-- org's tables and assert every row belongs to that org. Any row from another org is a leak.
\set ON_ERROR_STOP on
select set_config('request.jwt.claims',
  jsonb_build_object(
    'sub', md5('user' || :org || '-1'),
    'org_id', md5('org' || :org)::text,
    'user_role', 'cia', 'aal', 'aal1')::text, false);
set role authenticated;
select count(*) from universes where org_id <> md5('org' || :org)::uuid;
select count(*) from entities where org_id <> md5('org' || :org)::uuid;
select count(*) from engagements where org_id <> md5('org' || :org)::uuid;
select count(*) from org_members where org_id <> md5('org' || :org)::uuid;
select count(*) from ledger where org_id <> md5('org' || :org)::uuid;
