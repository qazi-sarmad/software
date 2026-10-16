-- 3E: Audit plan, hash-chained version history, plan items and ad-hoc justification (spec §9).
--
-- The spec:
--   §9 "Built from the Universe and the SIRA ranking. Creation and approval authority are
--       configurable per organisation. Full version history. Every change creates a version,
--       linked to its approval where one is needed. After approval, rescheduling is easy. Adding or
--       removing engagements is CIA-level. Ad-hoc engagements require a mandatory justification and
--       CIA approval. They show as pending until decided."
--
-- Reuse (grep first): plans and plan_versions already exist (0003) with status/current_version and
-- an append-only version snapshot, so this migration ALTERs them and adds one item table rather than
-- a parallel plan structure. The plan-approval rights are configurable per organisation in
-- plan_approval_settings, the same shape as entity_approval_settings (0018).

-- ---------------------------------------------------------------------------
-- Plan: a draft/approved lifecycle with a versioned snapshot on every change (L5).
-- ---------------------------------------------------------------------------
alter table plans add column if not exists created_by uuid null;
alter table plans add column if not exists approved_by uuid null;
alter table plans add column if not exists approved_at timestamptz null;

-- Which rights may create and approve a plan, per organisation (§9).
create table if not exists plan_approval_settings (
  org_id uuid primary key references orgs(id) on delete cascade,
  create_right text not null default 'manage_engagements',
  approve_right text not null default 'approve_plan',
  updated_at timestamptz not null default now(),
  constraint plan_approval_create_right_valid check (public.rights_keys_valid(jsonb_build_object(create_right, true))),
  constraint plan_approval_approve_right_valid check (public.rights_keys_valid(jsonb_build_object(approve_right, true)))
);

create or replace function public.seed_plan_approval_settings(p_org uuid) returns void
language sql security definer set search_path = public as $$
  insert into plan_approval_settings (org_id) values (p_org) on conflict (org_id) do nothing
$$;

select public.seed_plan_approval_settings(id) from orgs;

create or replace function public.orgs_seed_plan_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_plan_approval_settings(new.id);
  return new;
end $$;

drop trigger if exists orgs_seed_plan_approval on orgs;
create trigger orgs_seed_plan_approval after insert on orgs
  for each row execute function public.orgs_seed_plan_approval();

-- ---------------------------------------------------------------------------
-- Plan items: an engagement proposal within a plan, optionally ad-hoc (§9).
-- ---------------------------------------------------------------------------
create table if not exists plan_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  plan_id uuid not null references plans(id) on delete cascade,
  engagement_id uuid null references engagements(id) on delete set null,
  entity_id uuid null references entities(id) on delete set null,
  title text not null,
  planned_start date null,
  planned_end date null,
  is_adhoc boolean not null default false,
  justification text null,
  status text not null default 'proposed' check (status in ('proposed', 'pending_adhoc', 'approved', 'removed')),
  decided_by uuid null,
  decided_at timestamptz null,
  created_by uuid null,
  created_at timestamptz not null default now()
);
create index if not exists plan_items_plan_idx on plan_items (org_id, plan_id);

-- An ad-hoc item carries a justification of at least 10 characters, and only an ad-hoc item that is
-- waiting for a decision may be in pending_adhoc.
alter table plan_items drop constraint if exists plan_items_adhoc_chk;
alter table plan_items add constraint plan_items_adhoc_chk check (
  (not is_adhoc)
  or (justification is not null and length(btrim(justification)) >= 10)
);
alter table plan_items drop constraint if exists plan_items_pending_chk;
alter table plan_items add constraint plan_items_pending_chk check (
  status <> 'pending_adhoc' or is_adhoc
);

-- ---------------------------------------------------------------------------
-- RPCs.
-- ---------------------------------------------------------------------------

-- admin_set_plan_approval: configure which rights create and approve plans (§9). edit_config.
create or replace function public.admin_set_plan_approval(p_create text, p_approve text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('edit_config'), false) then
    raise exception 'not allowed: caller lacks the edit_config right' using errcode = 'P0001';
  end if;
  if not public.rights_keys_valid(jsonb_build_object(p_create, true))
     or not public.rights_keys_valid(jsonb_build_object(p_approve, true)) then
    raise exception 'unknown right' using errcode = 'P0001';
  end if;
  perform public.seed_plan_approval_settings(v_org);
  update plan_approval_settings set create_right = p_create, approve_right = p_approve, updated_at = now()
   where org_id = v_org;
  insert into activity_log (org_id, actor_id, action, object_type, detail)
  values (v_org, auth.uid(), 'plan_approval_config_set', 'config',
          jsonb_build_object('create_right', p_create, 'approve_right', p_approve));
end $$;

-- plan_approval_config: the effective configuration.
create or replace function public.plan_approval_config(p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('create_right', s.create_right, 'approve_right', s.approve_right)
  from plan_approval_settings s where s.org_id = p_org
$$;

-- snapshot_plan_version: append the current plan + items as the next immutable version (L5).
create or replace function public.snapshot_plan_version(p_plan uuid, p_reason text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_version int;
  v_snapshot jsonb;
begin
  select coalesce(max(version), 0) + 1 into v_version
    from plan_versions where plan_id = p_plan;

  update plans set current_version = v_version where id = p_plan and org_id = v_org;

  select jsonb_build_object(
           'period', p.period,
           'status', p.status,
           'items', coalesce((select jsonb_agg(jsonb_build_object(
                       'id', i.id, 'title', i.title, 'engagement_id', i.engagement_id,
                       'entity_id', i.entity_id, 'planned_start', i.planned_start,
                       'planned_end', i.planned_end, 'is_adhoc', i.is_adhoc, 'status', i.status)
                     order by i.created_at)
                    from plan_items i where i.plan_id = p.id), '[]'::jsonb)
         )
    into v_snapshot
    from plans p where p.id = p_plan and p.org_id = v_org;

  insert into plan_versions (org_id, plan_id, version, snapshot, reason, actor_id)
  values (v_org, p_plan, v_version, coalesce(v_snapshot, '{}'::jsonb), p_reason, auth.uid());

  return v_version;
end $$;

-- create_plan: start a plan for a universe (§9). The configured create right is required.
create or replace function public.create_plan(p_universe uuid, p_period text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_right text;
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  perform public.seed_plan_approval_settings(v_org);
  select create_right into v_right from plan_approval_settings where org_id = v_org;
  if not coalesce(public.caller_has_right(v_right), false) then
    raise exception 'not allowed: caller lacks the % right', v_right using errcode = 'P0001';
  end if;
  if not exists (select 1 from universes where id = p_universe and org_id = v_org) then
    raise exception 'universe not found in this organisation' using errcode = 'P0001';
  end if;
  insert into plans (org_id, universe_id, period, status, created_by)
  values (v_org, p_universe, p_period, 'draft', auth.uid())
  returning id into v_id;
  perform public.snapshot_plan_version(v_id, 'created');
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'plan_created', 'plan', v_id,
          jsonb_build_object('universe_id', p_universe, 'period', p_period));
  return v_id;
end $$;

-- add_plan_item: add an engagement proposal. A non-ad-hoc item needs the create right; an ad-hoc
-- item additionally needs a justification of at least 10 characters and is pending until decided.
create or replace function public.add_plan_item(
  p_plan uuid, p_title text, p_entity uuid default null, p_engagement uuid default null,
  p_start date default null, p_end date default null, p_adhoc boolean default false,
  p_justification text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_right text;
  v_id uuid;
  v_status text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not exists (select 1 from plans where id = p_plan and org_id = v_org) then
    raise exception 'plan not found in this organisation' using errcode = 'P0001';
  end if;
  if (select status from plans where id = p_plan) = 'approved' then
    raise exception 'an approved plan cannot be changed without a new version' using errcode = 'P0001';
  end if;
  perform public.seed_plan_approval_settings(v_org);
  select create_right into v_right from plan_approval_settings where org_id = v_org;
  if not coalesce(public.caller_has_right(v_right), false) then
    raise exception 'not allowed: caller lacks the % right', v_right using errcode = 'P0001';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'a plan item needs a title' using errcode = 'P0001';
  end if;
  if p_adhoc then
    if p_justification is null or length(btrim(p_justification)) < 10 then
      raise exception 'an ad-hoc engagement needs a justification of at least 10 characters' using errcode = 'P0001';
    end if;
    v_status := 'pending_adhoc';
  else
    v_status := 'proposed';
  end if;
  insert into plan_items (org_id, plan_id, engagement_id, entity_id, title, planned_start, planned_end,
                          is_adhoc, justification, status, created_by)
  values (v_org, p_plan, p_engagement, p_entity, btrim(p_title), p_start, p_end,
          p_adhoc, case when p_adhoc then btrim(p_justification) else null end, v_status, auth.uid())
  returning id into v_id;
  perform public.snapshot_plan_version(p_plan, case when p_adhoc then 'adhoc item added' else 'item added' end);
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'plan_item_added', 'plan_item', v_id,
          jsonb_build_object('plan_id', p_plan, 'adhoc', p_adhoc));
  return v_id;
end $$;

-- decide_adhoc_item: an ad-hoc item is approved or rejected by the configured approve right (§9).
create or replace function public.decide_adhoc_item(p_item uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_right text;
  v_status text;
  v_plan uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  perform public.seed_plan_approval_settings(v_org);
  select approve_right into v_right from plan_approval_settings where org_id = v_org;
  if not coalesce(public.caller_has_right(v_right), false) then
    raise exception 'not allowed: caller lacks the % right', v_right using errcode = 'P0001';
  end if;
  select status, plan_id into v_status, v_plan from plan_items where id = p_item and org_id = v_org;
  if v_status is null then
    raise exception 'plan item not found in this organisation' using errcode = 'P0001';
  end if;
  if v_status <> 'pending_adhoc' then
    raise exception 'only a pending ad-hoc item can be decided' using errcode = 'P0001';
  end if;
  if not p_approve and (p_reason is null or length(btrim(p_reason)) < 10) then
    raise exception 'a rejection reason of at least 10 characters is required' using errcode = 'P0001';
  end if;
  update plan_items
     set status = case when p_approve then 'approved' else 'removed' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_item and org_id = v_org;
  perform public.snapshot_plan_version(v_plan, case when p_approve then 'adhoc approved' else 'adhoc rejected' end);
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), case when p_approve then 'adhoc_item_approved' else 'adhoc_item_rejected' end,
          'plan_item', p_item, jsonb_build_object('reason', p_reason));
end $$;

-- approve_plan: approve a plan (§9). The configured approve right is required; the approval is
-- recorded on the plan and in the version history.
create or replace function public.approve_plan(p_plan uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_right text;
  v_status text;
  v_version int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  perform public.seed_plan_approval_settings(v_org);
  select approve_right into v_right from plan_approval_settings where org_id = v_org;
  if not coalesce(public.caller_has_right(v_right), false) then
    raise exception 'not allowed: caller lacks the % right', v_right using errcode = 'P0001';
  end if;
  select status into v_status from plans where id = p_plan and org_id = v_org;
  if v_status is null then
    raise exception 'plan not found in this organisation' using errcode = 'P0001';
  end if;
  if v_status = 'approved' then
    raise exception 'plan is already approved' using errcode = 'P0001';
  end if;
  if exists (select 1 from plan_items where plan_id = p_plan and status = 'pending_adhoc') then
    raise exception 'a plan with a pending ad-hoc item cannot be approved' using errcode = 'P0001';
  end if;
  update plans set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_plan and org_id = v_org;
  v_version := public.snapshot_plan_version(p_plan, 'approved');
  perform public.append_ledger_entry(v_org, 'plan_approved',
    jsonb_build_object('plan_id', p_plan::text, 'version', v_version), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'plan_approved', 'plan', p_plan, jsonb_build_object('version', v_version));
  return v_version;
end $$;

-- plan_history: the immutable version history of a plan (§9).
create or replace function public.plan_history(p_plan uuid)
returns table(version int, reason text, actor_id uuid, ts timestamptz)
language sql stable security definer set search_path = public as $$
  select v.version, v.reason, v.actor_id, v.created_at
  from plan_versions v
  join plans p on p.id = v.plan_id
  where v.plan_id = p_plan and p.org_id = public.jwt_org_id()
  order by v.version
$$;

-- ---------------------------------------------------------------------------
-- RLS. plan_approval_settings and plan_items carry org_id, have RLS on, select policy only.
-- plans/plan_versions keep their existing policies; plan_items has no write policy, so every write
-- goes through the RPCs above.
-- ---------------------------------------------------------------------------
alter table plan_approval_settings enable row level security;
alter table plan_items            enable row level security;

drop policy if exists pas_select on plan_approval_settings;
create policy pas_select on plan_approval_settings for select to authenticated
  using (org_id = public.jwt_org_id());
drop policy if exists pi_select on plan_items;
create policy pi_select on plan_items for select to authenticated
  using (org_id = public.jwt_org_id()
         and exists (select 1 from plans p where p.id = plan_id
                     and (public.can_read_all_scopes() or public.has_scope(p.universe_id, null, null))));

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.seed_plan_approval_settings(uuid) from public, anon;
revoke execute on function public.orgs_seed_plan_approval() from public, anon;
revoke execute on function public.admin_set_plan_approval(text, text) from public, anon;
revoke execute on function public.plan_approval_config(uuid) from public, anon;
revoke execute on function public.snapshot_plan_version(uuid, text) from public, anon;
revoke execute on function public.create_plan(uuid, text) from public, anon;
revoke execute on function public.add_plan_item(uuid, text, uuid, uuid, date, date, boolean, text) from public, anon;
revoke execute on function public.decide_adhoc_item(uuid, boolean, text) from public, anon;
revoke execute on function public.approve_plan(uuid) from public, anon;
revoke execute on function public.plan_history(uuid) from public, anon;

grant execute on function public.admin_set_plan_approval(text, text) to authenticated;
grant execute on function public.plan_approval_config(uuid) to authenticated;
grant execute on function public.create_plan(uuid, text) to authenticated;
grant execute on function public.add_plan_item(uuid, text, uuid, uuid, date, date, boolean, text) to authenticated;
grant execute on function public.decide_adhoc_item(uuid, boolean, text) to authenticated;
grant execute on function public.approve_plan(uuid) to authenticated;
grant execute on function public.plan_history(uuid) to authenticated;
