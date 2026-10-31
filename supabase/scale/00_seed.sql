-- Aggressive scale seed: 1000 organisations, 50 users each (50,000 users), plus a realistic
-- slice of tenant data per org. Deterministic ids via md5 so probes can name rows exactly.
-- Run as the owner (postgres), after the shim and all migrations.
\set ON_ERROR_STOP on
\i supabase/tests/00_lib.sql

drop table if exists scale_org, scale_user;
create temporary table scale_org as
  select i, md5('org' || i)::uuid as org_id from generate_series(1, 1000) i;
create temporary table scale_user as
  select i, j, md5('org' || i)::uuid as org_id, md5('user' || i || '-' || j)::uuid as user_id
  from generate_series(1, 1000) i, generate_series(1, 50) j;

-- Clean slate (owner).
truncate orgs cascade;

-- 1000 orgs.
insert into orgs (id, name, is_demo)
select org_id, 'Scale Org ' || i, false from scale_org;

-- Seven seed roles per org, mirroring the fixture rights matrix.
insert into roles (id, org_id, name, slug, is_seed, rights)
select md5('role' || o.i || '-' || r.slug)::uuid, o.org_id, r.name, r.slug, true, r.rights
from scale_org o
cross join (values
  ('CIA','cia','{"manage_users":false,"manage_roles":true,"edit_config":true,"manage_engagements":true,"approve_plan":true,"review_and_approve":true,"perform_work":true,"can_reopen":true,"view_all_scopes":true,"read_only":false,"manage_team":false,"view_board_pack":true,"generate_board_pack":true,"view_insights":true}'::jsonb),
  ('Preparer','preparer','{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":true,"can_reopen":false,"view_all_scopes":false,"read_only":false,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"view_insights":false}'::jsonb),
  ('Org Admin','org_admin','{"manage_users":true,"manage_roles":true,"edit_config":true,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":false,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"view_insights":false}'::jsonb),
  ('Audit Manager','audit_manager','{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":true,"approve_plan":false,"review_and_approve":true,"perform_work":true,"can_reopen":false,"view_all_scopes":true,"read_only":false,"manage_team":false,"view_board_pack":true,"generate_board_pack":false,"view_insights":true}'::jsonb),
  ('Observer','observer','{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":true,"read_only":true,"manage_team":false,"view_board_pack":true,"generate_board_pack":false,"view_insights":false}'::jsonb),
  ('Reviewer','reviewer','{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":true,"perform_work":true,"can_reopen":false,"view_all_scopes":false,"read_only":false,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"view_insights":false}'::jsonb),
  ('Auditee','auditee','{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":true,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"view_insights":false}'::jsonb)
) as r(name, slug, rights);

-- 50 users per org. User 1 is CIA; the rest are Preparers.
insert into org_members (org_id, user_id, role_id, hierarchy_level, display_name)
select u.org_id, u.user_id,
       md5('role' || u.i || '-' || (case when u.j = 1 then 'cia' else 'preparer' end))::uuid,
       (case when u.j = 1 then 1 else 3 end)::smallint,
       'User ' || u.i || '-' || u.j
from scale_user u;

-- Two universes, two approved entities, two engagements per org.
insert into universes (id, org_id, name)
select md5('univ' || o.i || '-' || k)::uuid, o.org_id, 'U' || k
from scale_org o cross join generate_series(1,2) k;

insert into entities (id, org_id, universe_id, name, approved, status)
select md5('ent' || o.i || '-' || k)::uuid, o.org_id, md5('univ' || o.i || '-' || k)::uuid,
       'E' || k, true, 'approved'
from scale_org o cross join generate_series(1,2) k;

insert into engagements (id, org_id, universe_id, entity_id, title)
select md5('eng' || o.i || '-' || k)::uuid, o.org_id, md5('univ' || o.i || '-' || k)::uuid,
       md5('ent' || o.i || '-' || k)::uuid, 'Eng ' || k
from scale_org o cross join generate_series(1,2) k;

-- Five ledger entries per org through the real append path (chain trigger computes seq/hash).
select append_ledger_entry(o.org_id, 'scale_seed', jsonb_build_object('k', k))
from scale_org o cross join generate_series(1,5) k;

select
  (select count(*) from orgs)         as orgs,
  (select count(*) from org_members)  as members,
  (select count(*) from roles)        as roles,
  (select count(*) from universes)    as universes,
  (select count(*) from engagements)  as engagements,
  (select count(*) from ledger_entries) as ledger_entries;
