-- 7D: Prior-year import DB (spec §19.2 prior-year import).
--
-- The spec:
--   §19.2 "A prior-year engagement's risk/control mapping, scope, procedures and resource estimates may
--          be imported into a new engagement as a starting point. Imported items are marked
--          'Imported - confirm' and do not count toward sign-off until confirmed."
--
-- M1: grep found no `prior_year_imports`, `import_prior_year_item` or `confirm_prior_year_item`. This
-- migration creates them (no collision).

create table if not exists prior_year_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  item_type text not null
    check (item_type in ('risk_control_mapping', 'scope', 'procedures', 'resource_estimates')),
  source_engagement_id uuid not null references engagements(id) on delete cascade,
  status text not null default 'imported_confirm'
    check (status in ('imported_confirm', 'confirmed', 'reverted')),
  imported_by uuid,
  imported_at timestamptz not null default now(),
  confirmed_by uuid,
  confirmed_at timestamptz
);
create index if not exists prior_year_imports_engagement_idx on prior_year_imports (org_id, engagement_id);

-- ---------------------------------------------------------------------------
-- import_prior_year_item: copy one item type from a source engagement to a target (§19.2). Requires
-- manage_engagements. Sets status = 'imported_confirm'. Populations, samples, results, conclusions and
-- evidence are not importable.
-- ---------------------------------------------------------------------------
create or replace function public.import_prior_year_item(
  p_source_engagement_id uuid, p_item_type text, p_engagement_id uuid
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
  if p_item_type not in ('risk_control_mapping', 'scope', 'procedures', 'resource_estimates') then
    raise exception 'not importable: % is not a prior-year import type (populations, samples, results, conclusions and evidence are never importable)', p_item_type
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_source_engagement_id and e.org_id = v_org) then
    raise exception 'source engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'target engagement not found in this organisation' using errcode = 'P0001';
  end if;

  insert into prior_year_imports (org_id, engagement_id, item_type, source_engagement_id, status, imported_by)
  values (v_org, p_engagement_id, p_item_type, p_source_engagement_id, 'imported_confirm', auth.uid())
  returning id into v_id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'prior_year_imported', 'prior_year_import', v_id,
          jsonb_build_object('item_type', p_item_type, 'source_engagement_id', p_source_engagement_id,
                             'engagement_id', p_engagement_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- confirm_prior_year_item: confirm an imported item (§19.2). Sets status = 'confirmed' and logs it.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_prior_year_item(p_import_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_rec prior_year_imports;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_engagements'), false) then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;
  select * into v_rec from prior_year_imports p where p.id = p_import_id and p.org_id = v_org;
  if v_rec.id is null then
    raise exception 'prior-year import not found in this organisation' using errcode = 'P0001';
  end if;
  if v_rec.status <> 'imported_confirm' then
    raise exception 'not_pending: only an imported-confirm item can be confirmed' using errcode = 'P0001';
  end if;

  update prior_year_imports
     set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
   where id = p_import_id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'prior_year_confirmed', 'prior_year_import', p_import_id,
          jsonb_build_object('item_type', v_rec.item_type));
end $$;

-- ---------------------------------------------------------------------------
-- revert_prior_year_item: revert an unconfirmed import.
-- ---------------------------------------------------------------------------
create or replace function public.revert_prior_year_item(p_import_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_rec prior_year_imports;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_engagements'), false) then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;
  select * into v_rec from prior_year_imports p where p.id = p_import_id and p.org_id = v_org;
  if v_rec.id is null then
    raise exception 'prior-year import not found in this organisation' using errcode = 'P0001';
  end if;

  update prior_year_imports set status = 'reverted' where id = p_import_id;
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'prior_year_reverted', 'prior_year_import', p_import_id,
          jsonb_build_object('item_type', v_rec.item_type));
end $$;

-- ---------------------------------------------------------------------------
-- unconfirmed_prior_year_imports: the count of imported_confirm items for an engagement. sign_planning
-- (0025) calls this so an unconfirmed import blocks sign-off (§19.2).
-- ---------------------------------------------------------------------------
create or replace function public.unconfirmed_prior_year_imports(p_engagement_id uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from prior_year_imports p
   where p.org_id = public.jwt_org_id() and p.engagement_id = p_engagement_id
     and p.status = 'imported_confirm'
$$;

-- ---------------------------------------------------------------------------
-- sign_planning: CREATE OR REPLACE of the 0025 function, adding the §19.2 prior-year gate. An item
-- marked 'imported_confirm' blocks sign-off until it is confirmed. (D-7D-M1b)
-- ---------------------------------------------------------------------------
create or replace function public.sign_planning(p_engagement_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_sections int;
  v_self int;
  v_unconfirmed int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if public.planning_signed_off(p_engagement_id) then
    raise exception 'planning_locked: planning sections are already signed off' using errcode = 'P0001';
  end if;

  select count(*) into v_sections from planning_sections
   where engagement_id = p_engagement_id and org_id = v_org;
  if v_sections = 0 then
    raise exception 'no planning sections to sign off' using errcode = 'P0001';
  end if;

  select count(*) into v_self from planning_sections
   where engagement_id = p_engagement_id and org_id = v_org and prepared_by = auth.uid();
  if v_self = v_sections then
    raise exception 'four_eyes: the signer prepared every planning section' using errcode = 'P0001';
  end if;

  if not public.check_planning_reconciliation(p_engagement_id)
     and not exists (select 1 from planning_reconciliation_acks a
                     where a.engagement_id = p_engagement_id and a.org_id = v_org) then
    raise exception 'planning_reconciliation: risks do not match the current SIRA and no discrepancy is acknowledged'
      using errcode = 'P0001';
  end if;

  -- §19.2: an item marked 'Imported - confirm' does not count toward sign-off.
  v_unconfirmed := public.unconfirmed_prior_year_imports(p_engagement_id);
  if v_unconfirmed > 0 then
    raise exception 'unconfirmed_imports: % prior-year item(s) are imported but not confirmed', v_unconfirmed
      using errcode = 'P0001';
  end if;

  update planning_sections
     set signed_off_at = now(), signed_off_by = auth.uid()
   where engagement_id = p_engagement_id and org_id = v_org;

  perform public.append_ledger_entry(
    v_org, 'planning_signed_off',
    jsonb_build_object('engagement_id', p_engagement_id, 'sections', v_sections), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'planning_signed_off', 'engagement', p_engagement_id,
          jsonb_build_object('sections', v_sections));
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security: an org sees its own imports only. Writes go through the RPCs.
-- ---------------------------------------------------------------------------
alter table prior_year_imports enable row level security;

drop policy if exists prior_year_imports_select on prior_year_imports;
create policy prior_year_imports_select on prior_year_imports for select to authenticated
  using (org_id = public.jwt_org_id());

revoke insert, update, delete on public.prior_year_imports from public, anon, authenticated;

drop trigger if exists prior_year_imports_pin_org on prior_year_imports;
create trigger prior_year_imports_pin_org before insert on prior_year_imports
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.import_prior_year_item(uuid, text, uuid) from public, anon;
revoke execute on function public.confirm_prior_year_item(uuid) from public, anon;
revoke execute on function public.revert_prior_year_item(uuid) from public, anon;
revoke execute on function public.unconfirmed_prior_year_imports(uuid) from public, anon;

grant execute on function public.import_prior_year_item(uuid, text, uuid) to authenticated;
grant execute on function public.confirm_prior_year_item(uuid) to authenticated;
grant execute on function public.revert_prior_year_item(uuid) to authenticated;
grant execute on function public.unconfirmed_prior_year_imports(uuid) to authenticated;
