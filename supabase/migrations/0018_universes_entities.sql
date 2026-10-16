-- 3B: universes and entities — entity approval workflow (spec §6).
--
-- The spec: "a new entity must be populated and approved before it can be used in any engagement.
-- The initiator, required fields and approver are organisation-configured." Phase 3 therefore adds
-- an explicit approval status to entities and two rights-checked functions (submit, decide). The
-- right that may initiate and the right that may approve are organisation data, never a role name.
--
-- Reuse (grep first): the entities table already exists (0003) with `approved boolean`, so this
-- migration ALTERs it rather than creating a second table. The select policy that already widens
-- entities by scope lives in 0016; it is not redefined here. `universes` already exists.

-- ---------------------------------------------------------------------------
-- Entity approval status and audit columns.
-- ---------------------------------------------------------------------------
-- CI re-applies migrations to the same project on every run, so the guard trigger may already
-- exist from a previous run when the backfill below runs. Drop it first; it is recreated at the end
-- of this file.
drop trigger if exists entities_status_guard on entities;

alter table entities add column if not exists status text not null default 'draft';
alter table entities add column if not exists submitted_by uuid null;
alter table entities add column if not exists submitted_at timestamptz null;
alter table entities add column if not exists decided_by uuid null;
alter table entities add column if not exists decided_at timestamptz null;
alter table entities add column if not exists rejection_reason text null;

alter table entities drop constraint if exists entities_status_chk;
alter table entities add constraint entities_status_chk
  check (status in ('draft', 'pending', 'approved', 'rejected'));

-- Existing rows: an entity that was already approved becomes status 'approved'.
update entities set status = 'approved' where approved is true and status = 'draft';
update entities set status = 'draft' where approved is false and status = 'approved';

create index if not exists entities_status_idx on entities (org_id, status);

-- ---------------------------------------------------------------------------
-- Per-organisation approval configuration: which right initiates, which approves, which fields are
-- required. Both rights must come from the closed list (0012 rights_keys_valid).
-- ---------------------------------------------------------------------------
create table if not exists entity_approval_settings (
  org_id uuid primary key references orgs(id) on delete cascade,
  initiate_right text not null default 'edit_config',
  approve_right text not null default 'approve_plan',
  required_fields jsonb not null default '["name"]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into entity_approval_settings (org_id) select id from orgs on conflict (org_id) do nothing;

alter table entity_approval_settings enable row level security;
drop policy if exists eas_select on entity_approval_settings;
create policy eas_select on entity_approval_settings for select to authenticated
  using (org_id = public.jwt_org_id());
-- No insert, update or delete policy: writes happen only through admin_set_entity_approval().

-- The effective configuration for an organisation, with defaults when no row exists.
create or replace function public.entity_approval_config(p_org uuid)
returns table(initiate_right text, approve_right text, required_fields jsonb)
language sql stable security definer set search_path = public as $$
  select coalesce(s.initiate_right, 'edit_config'),
         coalesce(s.approve_right, 'approve_plan'),
         coalesce(s.required_fields, '["name"]'::jsonb)
  from (select 1) one
  left join entity_approval_settings s on s.org_id = p_org
$$;

-- ---------------------------------------------------------------------------
-- Configure the approval rights. Requires edit_config. Versioned and logged (L5).
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_entity_approval(
  p_initiate_right text, p_approve_right text, p_required_fields jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_required jsonb := coalesce(p_required_fields, '["name"]'::jsonb);
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('edit_config'), false) then
    raise exception 'not allowed: caller lacks the edit_config right' using errcode = 'P0001';
  end if;
  if not public.rights_keys_valid(jsonb_build_object(coalesce(p_initiate_right, ''), true)) then
    raise exception 'initiate_right is not a known right' using errcode = 'P0001';
  end if;
  if not public.rights_keys_valid(jsonb_build_object(coalesce(p_approve_right, ''), true)) then
    raise exception 'approve_right is not a known right' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_required) <> 'array' then
    raise exception 'required_fields must be a JSON array' using errcode = 'P0001';
  end if;

  insert into entity_approval_settings (org_id, initiate_right, approve_right, required_fields, updated_at)
  values (v_org, p_initiate_right, p_approve_right, v_required, now())
  on conflict (org_id) do update
    set initiate_right = excluded.initiate_right,
        approve_right = excluded.approve_right,
        required_fields = excluded.required_fields,
        updated_at = now();

  insert into config_versions (org_id, key, value, version, actor_id)
  values (v_org, 'entity_approval',
          jsonb_build_object('initiate_right', p_initiate_right, 'approve_right', p_approve_right,
                             'required_fields', v_required),
          public.admin_next_version(v_org, 'entity_approval'), auth.uid());

  insert into activity_log (org_id, actor_id, action, object_type, detail)
  values (v_org, auth.uid(), 'entity_approval_configured', 'config',
          jsonb_build_object('initiate_right', p_initiate_right, 'approve_right', p_approve_right));
end $$;

-- ---------------------------------------------------------------------------
-- Guard: a status decision may only happen inside submit_entity()/decide_entity().
-- The existing entities_write policy (0008) lets a cia/org_admin edit entity structure, which
-- would also let it set status='approved' directly. A client cannot be trusted to set a session
-- variable, so — exactly as reopen_grants does for the sealed-row guard — the grant is a table
-- row keyed to the current transaction, and application roles hold no INSERT on it.
-- ---------------------------------------------------------------------------
create table if not exists entity_decision_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  entity_id uuid not null,
  txid bigint not null,
  granted_at timestamptz not null default now()
);

create or replace function public.entity_decision_granted(p_entity_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from entity_decision_grants g
    where g.entity_id = p_entity_id and g.txid = txid_current()
  )
$$;

create or replace function public.entities_status_guard() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status
     or new.approved is distinct from old.approved
     or new.decided_by is distinct from old.decided_by
     or new.submitted_by is distinct from old.submitted_by
  then
    if not public.entity_decision_granted(new.id) then
      raise exception 'entity_approval: status changes must go through submit_entity()/decide_entity()'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists entities_status_guard on entities;
create trigger entities_status_guard before update on entities
  for each row execute function public.entities_status_guard();

-- ---------------------------------------------------------------------------
-- submit_entity: move a draft entity to 'pending'. Requires the configured initiate right.
-- ---------------------------------------------------------------------------
create or replace function public.submit_entity(p_entity_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_entity entities;
  v_cfg record;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;

  select * into v_entity from entities where id = p_entity_id;
  if v_entity.id is null then
    raise exception 'entity not found' using errcode = 'P0001';
  end if;
  if v_entity.org_id <> v_org then
    raise exception 'entity is outside the caller''s organisation' using errcode = 'P0001';
  end if;

  select * into v_cfg from public.entity_approval_config(v_org);
  if not coalesce(public.caller_has_right(v_cfg.initiate_right), false) then
    raise exception 'not allowed: caller lacks the % right to submit an entity', v_cfg.initiate_right
      using errcode = 'P0001';
  end if;
  if v_entity.status not in ('draft', 'rejected') then
    raise exception 'entity is already %; only a draft or rejected entity can be submitted', v_entity.status
      using errcode = 'P0001';
  end if;

  insert into entity_decision_grants (org_id, entity_id, txid) values (v_org, p_entity_id, txid_current());

  update entities
     set status = 'pending', submitted_by = auth.uid(), submitted_at = now(),
         rejection_reason = null
   where id = p_entity_id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'entity_submitted', 'entity', p_entity_id,
          jsonb_build_object('status', 'pending'));
end $$;

-- ---------------------------------------------------------------------------
-- decide_entity: approve or reject a pending entity. Requires the configured approve right and,
-- consistent with the four-eyes invariant (spec §4.4), an approver different from the submitter.
-- ---------------------------------------------------------------------------
create or replace function public.decide_entity(p_entity_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_entity entities;
  v_cfg record;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;

  select * into v_entity from entities where id = p_entity_id;
  if v_entity.id is null then
    raise exception 'entity not found' using errcode = 'P0001';
  end if;
  if v_entity.org_id <> v_org then
    raise exception 'entity is outside the caller''s organisation' using errcode = 'P0001';
  end if;

  select * into v_cfg from public.entity_approval_config(v_org);
  if not coalesce(public.caller_has_right(v_cfg.approve_right), false) then
    raise exception 'not allowed: caller lacks the % right to decide an entity', v_cfg.approve_right
      using errcode = 'P0001';
  end if;
  if v_entity.status <> 'pending' then
    raise exception 'entity is %, not pending', v_entity.status using errcode = 'P0001';
  end if;
  if v_entity.submitted_by is not null and v_entity.submitted_by = auth.uid() then
    raise exception 'four-eyes: the approver must differ from the submitter' using errcode = 'P0001';
  end if;
  if not p_approve and length(v_reason) < 10 then
    raise exception 'a rejection requires a reason of at least 10 characters' using errcode = 'P0001';
  end if;

  insert into entity_decision_grants (org_id, entity_id, txid) values (v_org, p_entity_id, txid_current());

  update entities
     set status = case when p_approve then 'approved' else 'rejected' end,
         approved = p_approve,
         decided_by = auth.uid(),
         decided_at = now(),
         rejection_reason = case when p_approve then null else v_reason end
   where id = p_entity_id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(),
          case when p_approve then 'entity_approved' else 'entity_rejected' end,
          'entity', p_entity_id,
          jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end,
                             'reason', case when p_approve then null else v_reason end));

  perform public.append_ledger_entry(
    v_org, case when p_approve then 'entity_approved' else 'entity_rejected' end,
    jsonb_build_object('entity_id', p_entity_id::text,
                       'decision', case when p_approve then 'approved' else 'rejected' end,
                       'reason', case when p_approve then null else v_reason end),
    auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- entity_history: the recorded history of one entity (spec §6, L5).
-- ---------------------------------------------------------------------------
create or replace function public.entity_history(p_entity_id uuid)
returns table(action text, actor_id uuid, detail jsonb, ts timestamptz)
language sql stable security definer set search_path = public as $$
  select a.action, a.actor_id, a.detail, a.ts
  from activity_log a
  join entities e on e.id = a.object_id
  where a.object_type = 'entity'
    and a.object_id = p_entity_id
    and e.org_id = public.jwt_org_id()
    and (public.can_read_all_scopes() or public.has_scope(e.universe_id, e.id, null))
  order by a.ts asc
$$;

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
alter table entity_decision_grants enable row level security;
drop policy if exists edg_select on entity_decision_grants;
create policy edg_select on entity_decision_grants for select to authenticated
  using (org_id = public.jwt_org_id());
-- No insert/update/delete policy, and no INSERT grant: only submit_entity()/decide_entity() write
-- here, so a client cannot forge the status-change grant.
revoke insert, update, delete on entity_decision_grants from public, anon, authenticated;

revoke execute on function public.entity_approval_config(uuid) from public, anon;
revoke execute on function public.admin_set_entity_approval(text, text, jsonb) from public, anon;
revoke execute on function public.submit_entity(uuid) from public, anon;
revoke execute on function public.decide_entity(uuid, boolean, text) from public, anon;
revoke execute on function public.entity_history(uuid) from public, anon;
grant execute on function public.entity_approval_config(uuid) to authenticated;
grant execute on function public.admin_set_entity_approval(text, text, jsonb) to authenticated;
grant execute on function public.submit_entity(uuid) to authenticated;
grant execute on function public.decide_entity(uuid, boolean, text) to authenticated;
grant execute on function public.entity_history(uuid) to authenticated;
