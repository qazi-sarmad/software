-- 0102: the corrected §2 model — group companies, joint-audit edit sharing, group configuration.
--
-- This migration REPLACES the view-only universe share from 0095 with the model the owner
-- confirmed:
--
--   * An audit universe is a sub-department scope inside ONE tenant (IT audit, management audit).
--   * Two tenants are ASSOCIATED when the platform owner records them in one group. Association is
--     the precondition for every cross-tenant path. No association => no sharing, ever.
--   * A JOINT AUDIT is an engagement worked by two parties. When it spans associated (group)
--     companies it is shared with EDIT rights to both: each party reads AND writes the engagement
--     and its working papers. Nothing else of either party is exposed.
--   * The group PARENT may DISTRIBUTE a configuration version to a member. A distribution is a
--     snapshot; the member keeps its own version and history.
--
-- M1 (no collision): grepped supabase/migrations and supabase/tests for every object below; all are
-- new names. M2 (idempotent): every statement is `create ... if not exists`, `add column if not
-- exists`, `create or replace function`, or `drop ... if exists` before a create.
--
-- RLS SHAPE. The invariant `org_id = public.jwt_org_id()` is KEPT in every tenant policy. A joint
-- audit is the single, deliberate exception, and it is bounded three ways: the caller's org must be
-- the OWNER or the COUNTERPARTY of a live joint-audit share; the share requires a recorded
-- association between the two orgs; and the extension is a boolean OR on the same policy, so an
-- ordinary tenant row can only ever be matched by its own org. A share adds reach to one shared
-- engagement; it never removes a restriction, and it never widens any other table.

-- ===========================================================================
-- 1. Group associations (platform-owned).
-- ===========================================================================
create table if not exists org_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid null,
  created_at timestamptz not null default now()
);

alter table org_groups enable row level security;
drop policy if exists org_groups_select on org_groups;
-- The group name is platform configuration, not tenant content: a platform administrator reads it,
-- a tenant session reads nothing. The tenant learns its own group only through org_associations.
create policy org_groups_select on org_groups for select to authenticated
  using (public.is_platform_admin());

-- One row per (group, member org). `parent` marks the group parent. An org belongs to at most one
-- group, which keeps the association relation a function, not a lattice.
create table if not exists org_associations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references org_groups(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  parent boolean not null default false,
  linked_by uuid null,
  linked_at timestamptz not null default now(),
  unique (org_id)
);
create index if not exists org_associations_group_idx on org_associations (group_id);

alter table org_associations enable row level security;
drop policy if exists org_associations_select on org_associations;
-- A tenant may read only its own association row: it learns who its group is, never another tenant's.
create policy org_associations_select on org_associations for select to authenticated
  using (org_id = public.jwt_org_id());

-- associated_org_ids: the orgs associated with the caller's org, EXCLUDING the caller's own org.
create or replace function public.associated_org_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(a2.org_id), array[]::uuid[])
  from org_associations a1
  join org_associations a2 on a2.group_id = a1.group_id
  where a1.org_id = public.jwt_org_id() and a2.org_id <> a1.org_id
$$;

create or replace function public.are_associated(p_org_a uuid, p_org_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_associations a1
    join org_associations a2 on a2.group_id = a1.group_id
    where a1.org_id = p_org_a and a2.org_id = p_org_b and a1.org_id <> a2.org_id)
$$;

-- ===========================================================================
-- 2. Joint-audit shares (edit rights to both parties).
-- ===========================================================================
create table if not exists engagement_joint_shares (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references engagements(id) on delete cascade,
  owner_org_id uuid not null references orgs(id) on delete cascade,
  counterparty_org_id uuid not null references orgs(id) on delete cascade,
  rights text not null default 'edit',
  granted_by uuid null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz null,
  revoked_at timestamptz null,
  revoke_reason text null
);
create index if not exists engagement_joint_shares_eng_idx on engagement_joint_shares (engagement_id);
create index if not exists engagement_joint_shares_cp_idx on engagement_joint_shares (counterparty_org_id);

alter table engagement_joint_shares drop constraint if exists ejs_rights_chk;
alter table engagement_joint_shares add constraint ejs_rights_chk check (rights in ('edit'));
alter table engagement_joint_shares drop constraint if exists ejs_orgs_differ_chk;
alter table engagement_joint_shares add constraint ejs_orgs_differ_chk
  check (owner_org_id <> counterparty_org_id);
alter table engagement_joint_shares drop constraint if exists ejs_expiry_chk;
alter table engagement_joint_shares add constraint ejs_expiry_chk
  check (expires_at is null or expires_at > granted_at);

alter table engagement_joint_shares enable row level security;
drop policy if exists engagement_joint_shares_select on engagement_joint_shares;
-- The owner org and the counterparty org may read the share. No platform read into tenant content.
create policy engagement_joint_shares_select on engagement_joint_shares for select to authenticated
  using (owner_org_id = public.jwt_org_id() or counterparty_org_id = public.jwt_org_id());

-- joint_share_active: true when a live joint-audit share exists for the caller's org on this
-- engagement. "Live" means not revoked and not expired. Time is read here, in the database.
create or replace function public.joint_share_active(p_engagement_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from engagement_joint_shares s
    where s.engagement_id = p_engagement_id
      and (s.owner_org_id = public.jwt_org_id() or s.counterparty_org_id = public.jwt_org_id())
      and s.revoked_at is null
      and (s.expires_at is null or s.expires_at > now()))
$$;

-- ===========================================================================
-- 3. The joint-audit read/write extension on the shared engagement and its working papers.
--    `org_id = public.jwt_org_id()` is kept everywhere. The extension is ADDITIVE: a new permissive
--    policy is added beside the existing ones, and no existing policy is dropped. Postgres ORs
--    permissive policies, so the only change is extra reach to a live shared engagement over an
--    associated org. An ordinary row can still only be matched by its own org.
-- ===========================================================================

-- engagements: the counterparty org may read and write the shared engagement while the share is live.
drop policy if exists engagements_joint_select on engagements;
create policy engagements_joint_select on engagements for select to authenticated
  using (public.joint_share_active(id) and org_id = any(public.associated_org_ids()));

drop policy if exists engagements_joint_update on engagements;
create policy engagements_joint_update on engagements for update to authenticated
  using (public.joint_share_active(id) and org_id = any(public.associated_org_ids()))
  with check (public.joint_share_active(id) and org_id = any(public.associated_org_ids()));

-- entities: the counterparty may read the entity behind the shared engagement, and no other entity.
drop policy if exists entities_joint_select on entities;
create policy entities_joint_select on entities for select to authenticated
  using (exists (select 1 from engagements g
                 where g.entity_id = entities.id
                   and g.org_id = entities.org_id
                   and public.joint_share_active(g.id)
                   and g.org_id = any(public.associated_org_ids())));

-- The working papers: read and write only while the row's engagement is covered by a live share.
do $$
declare
  t text;
  tables text[] := array[
    'workpapers', 'observations', 'caps', 'cap_items', 'conclusion_records',
    'plan_items', 'populations', 'analysis_results', 'evidence_files',
    'preflight_acks', 'report_blocks', 'report_versions'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = 'engagement_id') then
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_joint_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ('
      || 'exists (select 1 from engagements g where g.id = %I.engagement_id '
      || 'and public.joint_share_active(g.id) and g.org_id = any(public.associated_org_ids())))',
      t || '_joint_select', t, t);
    execute format('drop policy if exists %I on public.%I', t || '_joint_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ('
      || 'exists (select 1 from engagements g where g.id = %I.engagement_id '
      || 'and public.joint_share_active(g.id) and g.org_id = any(public.associated_org_ids())))',
      t || '_joint_insert', t, t);
    execute format('drop policy if exists %I on public.%I', t || '_joint_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ('
      || 'exists (select 1 from engagements g where g.id = %I.engagement_id '
      || 'and public.joint_share_active(g.id) and g.org_id = any(public.associated_org_ids())))',
      t || '_joint_update', t, t);
  end loop;
end $$;

-- ===========================================================================
-- 4. The rights checks. A joint-audit share needs the right to manage engagements, and an
--    association with the counterparty. The rights come from the org's own role configuration, so an
--    Org Admin can widen or narrow who may start a joint audit without a code change.
-- ===========================================================================
create or replace function public.joint_share_grant(
  p_engagement_id uuid, p_counterparty_org_id uuid, p_expires_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_engagements'), false) then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if not public.are_associated(v_org, p_counterparty_org_id) then
    raise exception 'not allowed: the two organisations are not associated (group companies)'
      using errcode = 'P0001';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'the share expiry must be in the future' using errcode = 'P0001';
  end if;
  insert into engagement_joint_shares (engagement_id, owner_org_id, counterparty_org_id,
                                       rights, granted_by, expires_at)
  values (p_engagement_id, v_org, p_counterparty_org_id, 'edit', auth.uid(), p_expires_at)
  returning id into v_id;
  perform public.append_ledger_entry(v_org, 'joint_share_granted',
    jsonb_build_object('share_id', v_id, 'engagement_id', p_engagement_id,
                       'counterparty_org_id', p_counterparty_org_id), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'joint_share_granted', 'engagement', p_engagement_id,
          jsonb_build_object('share_id', v_id, 'counterparty_org_id', p_counterparty_org_id));
  return v_id;
end $$;

create or replace function public.joint_share_revoke(p_share_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_share engagement_joint_shares;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_engagements'), false) then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;
  select * into v_share from engagement_joint_shares where id = p_share_id;
  if v_share.id is null or v_share.owner_org_id <> v_org then
    raise exception 'share not found in this organisation' using errcode = 'P0001';
  end if;
  if v_share.revoked_at is not null then
    raise exception 'the share is already revoked' using errcode = 'P0001';
  end if;
  update engagement_joint_shares set revoked_at = now(), revoke_reason = coalesce(p_reason, '')
   where id = p_share_id;
  perform public.append_ledger_entry(v_org, 'joint_share_revoked',
    jsonb_build_object('share_id', p_share_id, 'reason', coalesce(p_reason, '')), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'joint_share_revoked', 'engagement', v_share.engagement_id,
          jsonb_build_object('share_id', p_share_id, 'reason', coalesce(p_reason, '')));
end $$;

-- What my org has shared out, and what is shared with my org.
create or replace function public.joint_shares_get() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'engagement_id', s.engagement_id,
           'owner_org_id', s.owner_org_id, 'counterparty_org_id', s.counterparty_org_id,
           'counterparty_name', co.name, 'rights', s.rights,
           'granted_at', s.granted_at, 'expires_at', s.expires_at,
           'revoked_at', s.revoked_at, 'revoke_reason', s.revoke_reason,
           'live', (s.revoked_at is null and (s.expires_at is null or s.expires_at > now())))
         order by s.granted_at desc, s.id), '[]'::jsonb)
  from engagement_joint_shares s
  join orgs co on co.id = s.counterparty_org_id
  where s.owner_org_id = public.jwt_org_id()
$$;

create or replace function public.joint_shares_with_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'engagement_id', s.engagement_id, 'engagement_title', e.title,
           'owner_org_id', s.owner_org_id, 'owner_name', oo.name, 'rights', s.rights,
           'granted_at', s.granted_at, 'expires_at', s.expires_at,
           'live', (s.revoked_at is null and (s.expires_at is null or s.expires_at > now())))
         order by s.granted_at desc, s.id), '[]'::jsonb)
  from engagement_joint_shares s
  join engagements e on e.id = s.engagement_id
  join orgs oo on oo.id = s.owner_org_id
  where s.counterparty_org_id = public.jwt_org_id()
$$;

-- ===========================================================================
-- 5. Group configuration distribution (parent -> member), a snapshot.
-- ===========================================================================
create table if not exists config_distributions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references org_groups(id) on delete cascade,
  parent_org_id uuid not null references orgs(id) on delete cascade,
  member_org_id uuid not null references orgs(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  distributed_by uuid null,
  distributed_at timestamptz not null default now(),
  revoked_at timestamptz null
);
create index if not exists config_distributions_member_idx
  on config_distributions (member_org_id, distributed_at desc);

alter table config_distributions enable row level security;
drop policy if exists config_distributions_select on config_distributions;
create policy config_distributions_select on config_distributions for select to authenticated
  using (parent_org_id = public.jwt_org_id() or member_org_id = public.jwt_org_id());

-- The parent may distribute the CURRENT configuration version to a member of its own group. The
-- payload is a snapshot taken now; a later change at the parent does not alter it.
create or replace function public.group_distribute_config(
  p_member_org_id uuid, p_keys text[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_group uuid;
  v_payload jsonb;
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('edit_config'), false) then
    raise exception 'not allowed: caller lacks the edit_config right' using errcode = 'P0001';
  end if;
  select a.group_id into v_group from org_associations a
   where a.org_id = v_org and a.parent;
  if v_group is null then
    raise exception 'not allowed: only a group parent distributes configuration' using errcode = 'P0001';
  end if;
  if not exists (select 1 from org_associations a
                 where a.group_id = v_group and a.org_id = p_member_org_id) then
    raise exception 'the member is not in this group' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_object_agg(v.key, v.value), '{}'::jsonb) into v_payload
    from (
      select distinct on (key) key, value
        from config_versions
       where org_id = v_org and (p_keys is null or key = any(p_keys))
       order by key, version desc
    ) v;
  insert into config_distributions (group_id, parent_org_id, member_org_id, payload, distributed_by)
  values (v_group, v_org, p_member_org_id, v_payload, auth.uid())
  returning id into v_id;
  perform public.append_ledger_entry(v_org, 'config_distributed',
    jsonb_build_object('distribution_id', v_id, 'member_org_id', p_member_org_id,
                       'keys', (select jsonb_agg(k) from jsonb_object_keys(v_payload) k)), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'config_distributed', 'org', p_member_org_id,
          jsonb_build_object('distribution_id', v_id));
  return v_id;
end $$;

-- A member adopts a distribution: it copies the snapshot into its own config history as a new
-- version. The member's own version wins afterwards; the snapshot is immutable.
create or replace function public.group_adopt_config(p_distribution_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_dist config_distributions;
  v_key text;
  v_next int;
  v_count int := 0;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('edit_config'), false) then
    raise exception 'not allowed: caller lacks the edit_config right' using errcode = 'P0001';
  end if;
  select * into v_dist from config_distributions
   where id = p_distribution_id and member_org_id = v_org and revoked_at is null;
  if v_dist.id is null then
    raise exception 'distribution not found for this organisation' using errcode = 'P0001';
  end if;
  for v_key in select jsonb_object_keys(v_dist.payload) loop
    select coalesce(max(version), 0) + 1 into v_next
      from config_versions where org_id = v_org and key = v_key;
    insert into config_versions (org_id, key, value, version, actor_id)
    values (v_org, v_key, v_dist.payload -> v_key, v_next, auth.uid());
    v_count := v_count + 1;
  end loop;
  perform public.append_ledger_entry(v_org, 'config_adopted',
    jsonb_build_object('distribution_id', p_distribution_id, 'keys', v_count), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'config_adopted', 'org', v_org,
          jsonb_build_object('distribution_id', p_distribution_id, 'keys', v_count));
  return v_count;
end $$;

create or replace function public.group_config_distributions() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'parent_org_id', d.parent_org_id, 'parent_name', po.name,
           'member_org_id', d.member_org_id, 'member_name', mo.name,
           'keys', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(d.payload) k),
           'distributed_at', d.distributed_at, 'revoked_at', d.revoked_at)
         order by d.distributed_at desc, d.id), '[]'::jsonb)
  from config_distributions d
  join orgs po on po.id = d.parent_org_id
  join orgs mo on mo.id = d.member_org_id
  where d.parent_org_id = public.jwt_org_id() or d.member_org_id = public.jwt_org_id()
$$;

-- ===========================================================================
-- 6. Platform association management. Platform admins only, enforced in the database.
-- ===========================================================================
create or replace function public.platform_create_group(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_platform_admin();
  if p_name is null or length(btrim(p_name)) < 2 then
    raise exception 'a group name of at least 2 characters is required' using errcode = 'P0001';
  end if;
  insert into org_groups (name, created_by) values (btrim(p_name), auth.uid()) returning id into v_id;
  perform public.platform_log('group_created', null, 'org_group', v_id,
    jsonb_build_object('name', btrim(p_name)));
  return v_id;
end $$;

create or replace function public.platform_link_org(
  p_group_id uuid, p_org_id uuid, p_parent boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_platform_admin();
  if not exists (select 1 from org_groups g where g.id = p_group_id) then
    raise exception 'group not found' using errcode = 'P0001';
  end if;
  if not exists (select 1 from orgs o where o.id = p_org_id) then
    raise exception 'organisation not found' using errcode = 'P0001';
  end if;
  if p_parent and exists (select 1 from org_associations a
                          where a.group_id = p_group_id and a.parent and a.org_id <> p_org_id) then
    raise exception 'the group already has a parent' using errcode = 'P0001';
  end if;
  insert into org_associations (group_id, org_id, parent, linked_by)
  values (p_group_id, p_org_id, coalesce(p_parent, false), auth.uid())
  on conflict (org_id) do update set group_id = excluded.group_id, parent = excluded.parent
  returning id into v_id;
  perform public.platform_log('org_linked', p_org_id, 'org_association', v_id,
    jsonb_build_object('group_id', p_group_id, 'parent', coalesce(p_parent, false)));
  return v_id;
end $$;

create or replace function public.platform_unlink_org(p_org_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  delete from org_associations where org_id = p_org_id;
  perform public.platform_log('org_unlinked', p_org_id, 'org_association', null, '{}'::jsonb);
end $$;

create or replace function public.platform_list_associations() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_platform_admin() then coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'group_id', a.group_id, 'group_name', g.name,
           'org_id', a.org_id, 'org_name', o.name, 'parent', a.parent,
           'linked_at', a.linked_at)
         order by g.name, a.parent desc, o.name), '[]'::jsonb)
         else '[]'::jsonb end
  from org_associations a
  join org_groups g on g.id = a.group_id
  join orgs o on o.id = a.org_id
$$;

-- ===========================================================================
-- 7. Table grants. Tenant data: authenticated gets SELECT (RLS filters), no direct DML, and
--    platform_admin gets SELECT so a zero-row isolation proof reads empty rather than failing.
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array['org_groups', 'org_associations', 'engagement_joint_shares',
                           'config_distributions'] loop
    execute format('revoke insert, update, delete on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated, platform_admin', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

revoke execute on function public.associated_org_ids() from public, anon;
revoke execute on function public.are_associated(uuid, uuid) from public, anon;
revoke execute on function public.joint_share_active(uuid) from public, anon;
revoke execute on function public.joint_share_grant(uuid, uuid, timestamptz) from public, anon;
revoke execute on function public.joint_share_revoke(uuid, text) from public, anon;
revoke execute on function public.joint_shares_get() from public, anon;
revoke execute on function public.joint_shares_with_me() from public, anon;
revoke execute on function public.group_distribute_config(uuid, text[]) from public, anon;
revoke execute on function public.group_adopt_config(uuid) from public, anon;
revoke execute on function public.group_config_distributions() from public, anon;
revoke execute on function public.platform_create_group(text) from public, anon;
revoke execute on function public.platform_link_org(uuid, uuid, boolean) from public, anon;
revoke execute on function public.platform_unlink_org(uuid) from public, anon;
revoke execute on function public.platform_list_associations() from public, anon;
