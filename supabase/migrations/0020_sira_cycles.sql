-- 3D: SIRA cycles, publishing (frozen + hash-chained) and the emergent-risk queue (spec §8.3).
--
-- The spec:
--   §8.3 "A cycle is one annual run for a Universe. Publishing a cycle is logged and hash-chained."
--        "Outputs: inherent risks and the overall risk environment per Entity and Universe."
--        "Emergent risks: concluded engagements write emergent risks to a queue for the next cycle.
--         Each is accepted or rejected, with a reason."
--
-- Reuse (grep first): sira_cycles and sira_scores already exist (0003) with the columns this needs,
-- so this migration ALTERs them rather than creating parallel tables. The cycle score for an entity
-- is written to sira_scores via sira_compute (0019), so scores stay in one place.

-- ---------------------------------------------------------------------------
-- Cycle: one per universe per year (§8.3). A published cycle is frozen: no score or factor value
-- may change afterwards, and the publish is recorded in the hash-chained ledger (L5).
-- ---------------------------------------------------------------------------
alter table sira_cycles add column if not exists created_by uuid null;
alter table sira_cycles add column if not exists published_by uuid null;

drop index if exists sira_cycles_universe_year_idx;
create unique index if not exists sira_cycles_universe_year_idx
  on sira_cycles (org_id, universe_id, year);

-- One score row per cycle/entity/risk; record_sira_score upserts on this key.
create unique index if not exists sira_scores_key_idx
  on sira_scores (org_id, cycle_id, entity_id, risk_id);

-- Freeze guard: once published, a cycle row cannot be changed except by publish/unpublish RPCs.
create table if not exists sira_cycle_publish_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  cycle_id uuid not null references sira_cycles(id) on delete cascade,
  txid bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists scpg_cycle_idx on sira_cycle_publish_grants (cycle_id);

create or replace function public.sira_cycle_guard() returns trigger
language plpgsql as $$
begin
  -- A publish/unpublish RPC records a grant for this transaction; then any change is allowed.
  if exists (
    select 1 from sira_cycle_publish_grants g
    where g.cycle_id = old.id and g.txid = txid_current()
  ) then
    return new;
  end if;
  if old.status = 'published' then
    raise exception 'sira cycle is published and frozen' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists sira_cycles_freeze on sira_cycles;
create trigger sira_cycles_freeze before update on sira_cycles
  for each row execute function public.sira_cycle_guard();

-- Scores are frozen with the cycle: once the cycle is published, no score row may change.
create or replace function public.sira_score_guard() returns trigger
language plpgsql as $$
declare
  v_status text;
begin
  select status into v_status from sira_cycles where id = coalesce(new.cycle_id, old.cycle_id);
  if v_status = 'published' then
    if exists (
      select 1 from sira_cycle_publish_grants g
      where g.cycle_id = coalesce(new.cycle_id, old.cycle_id) and g.txid = txid_current()
    ) then
      return coalesce(new, old);
    end if;
    raise exception 'sira cycle is published and frozen' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists sira_scores_freeze on sira_scores;
create trigger sira_scores_freeze before insert or update or delete on sira_scores
  for each row execute function public.sira_score_guard();

-- ---------------------------------------------------------------------------
-- Emergent-risk queue (§8.3): a concluded engagement writes an emergent risk for the next cycle.
-- Each entry is accepted or rejected, always with a reason.
-- ---------------------------------------------------------------------------
create table if not exists sira_emergent_risks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  universe_id uuid not null references universes(id) on delete cascade,
  entity_id uuid null references entities(id) on delete set null,
  source_engagement_id uuid null references engagements(id) on delete set null,
  target_cycle_id uuid null references sira_cycles(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  decision_reason text null,
  decided_by uuid null,
  decided_at timestamptz null,
  created_by uuid null,
  created_at timestamptz not null default now()
);
create index if not exists ser_universe_idx on sira_emergent_risks (org_id, universe_id, status);

-- An accepted or rejected entry must carry a reason (>= 10 characters), and the decision fields
-- must be consistent with the status.
alter table sira_emergent_risks drop constraint if exists ser_decision_chk;
alter table sira_emergent_risks add constraint ser_decision_chk check (
  (status = 'pending' and decision_reason is null and decided_by is null and decided_at is null)
  or (status in ('accepted', 'rejected')
      and decision_reason is not null and length(btrim(decision_reason)) >= 10
      and decided_by is not null and decided_at is not null)
);

-- ---------------------------------------------------------------------------
-- RPCs.
-- ---------------------------------------------------------------------------

-- create_sira_cycle: start the annual run for a universe. Requires manage_engagements.
create or replace function public.create_sira_cycle(p_universe uuid, p_year int)
returns uuid
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
  if not exists (select 1 from universes where id = p_universe and org_id = v_org) then
    raise exception 'universe not found in this organisation' using errcode = 'P0001';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'a cycle year is required' using errcode = 'P0001';
  end if;
  insert into sira_cycles (org_id, universe_id, year, status, created_by)
  values (v_org, p_universe, p_year, 'draft', auth.uid())
  on conflict (org_id, universe_id, year) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from sira_cycles
     where org_id = v_org and universe_id = p_universe and year = p_year;
  end if;
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'sira_cycle_created', 'sira_cycle', v_id,
          jsonb_build_object('universe_id', p_universe, 'year', p_year));
  return v_id;
end $$;

-- record_sira_score: store the computed score and the factor values for one entity risk in a cycle.
create or replace function public.record_sira_score(
  p_cycle uuid, p_entity uuid, p_risk uuid, p_factor_values jsonb
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_method text;
  v_weights jsonb;
  v_max int;
  v_score numeric;
  v_status text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_engagements'), false) then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;
  select c.status into v_status from sira_cycles c where c.id = p_cycle and c.org_id = v_org;
  if v_status is null then
    raise exception 'cycle not found in this organisation' using errcode = 'P0001';
  end if;
  if v_status = 'published' then
    raise exception 'sira cycle is published and frozen' using errcode = 'P0001';
  end if;
  if not exists (select 1 from entities where id = p_entity and org_id = v_org) then
    raise exception 'entity not found in this organisation' using errcode = 'P0001';
  end if;
  if not exists (select 1 from risks_library where id = p_risk and org_id = v_org) then
    raise exception 'risk not found in this organisation' using errcode = 'P0001';
  end if;

  perform public.seed_sira_model(v_org);
  select aggregation into v_method from sira_models where org_id = v_org;
  select coalesce(jsonb_object_agg(f.key, f.weight), '{}'::jsonb) into v_weights
    from sira_factors f where f.org_id = v_org;
  select greatest(coalesce(max(point), 5), 2) into v_max
    from sira_scales where org_id = v_org;

  v_score := public.sira_compute(p_factor_values, v_weights, v_max, v_method);

  insert into sira_scores (org_id, cycle_id, entity_id, risk_id, score, factor_values, method)
  values (v_org, p_cycle, p_entity, p_risk, v_score, coalesce(p_factor_values, '{}'::jsonb), v_method)
  on conflict (org_id, cycle_id, entity_id, risk_id) do update
    set score = excluded.score, factor_values = excluded.factor_values, method = excluded.method;

  return v_score;
end $$;

-- publish_sira_cycle: freeze the cycle and write the publish to the hash-chained ledger (§8.3, L5).
create or replace function public.publish_sira_cycle(p_cycle uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_status text;
  v_summary jsonb;
  v_entry ledger_entries;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('approve_plan'), false) then
    raise exception 'not allowed: caller lacks the approve_plan right' using errcode = 'P0001';
  end if;
  select status into v_status from sira_cycles where id = p_cycle and org_id = v_org;
  if v_status is null then
    raise exception 'cycle not found in this organisation' using errcode = 'P0001';
  end if;
  if v_status = 'published' then
    raise exception 'sira cycle is already published' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
           'universe_id', c.universe_id,
           'year', c.year,
           'entity_count', (select count(distinct s.entity_id) from sira_scores s where s.cycle_id = c.id),
           'score_count', (select count(*) from sira_scores s where s.cycle_id = c.id),
           'mean_score', (select round(avg(s.score), 2) from sira_scores s where s.cycle_id = c.id)
         )
    into v_summary
    from sira_cycles c where c.id = p_cycle;

  -- Grant this transaction the right to change the frozen rows.
  insert into sira_cycle_publish_grants (org_id, cycle_id, txid) values (v_org, p_cycle, txid_current());

  update sira_cycles
     set status = 'published', published_at = now(), published_by = auth.uid()
   where id = p_cycle and org_id = v_org;

  v_entry := public.append_ledger_entry(v_org, 'sira_cycle_published', v_summary, auth.uid());

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'sira_cycle_published', 'sira_cycle', p_cycle, v_summary);

  delete from sira_cycle_publish_grants where cycle_id = p_cycle and txid = txid_current();

  return v_entry.hash;
end $$;

-- submit_emergent_risk: a concluded engagement queues an emergent risk for a later cycle.
create or replace function public.submit_emergent_risk(
  p_universe uuid, p_title text, p_entity uuid default null,
  p_engagement uuid default null, p_target_cycle uuid default null, p_description text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from universes where id = p_universe and org_id = v_org) then
    raise exception 'universe not found in this organisation' using errcode = 'P0001';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'an emergent risk needs a title' using errcode = 'P0001';
  end if;
  insert into sira_emergent_risks (org_id, universe_id, entity_id, source_engagement_id, target_cycle_id,
                                   title, description, created_by)
  values (v_org, p_universe, p_entity, p_engagement, p_target_cycle, btrim(p_title), p_description, auth.uid())
  returning id into v_id;
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'emergent_risk_submitted', 'sira_emergent_risk', v_id,
          jsonb_build_object('universe_id', p_universe, 'engagement_id', p_engagement));
  return v_id;
end $$;

-- decide_emergent_risk: accept or reject, always with a reason (>= 10 characters, §8.3).
create or replace function public.decide_emergent_risk(p_id uuid, p_status text, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_status text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  if p_status not in ('accepted', 'rejected') then
    raise exception 'a decision is accepted or rejected' using errcode = 'P0001';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'a decision reason of at least 10 characters is required' using errcode = 'P0001';
  end if;
  select status into v_status from sira_emergent_risks where id = p_id and org_id = v_org;
  if v_status is null then
    raise exception 'emergent risk not found in this organisation' using errcode = 'P0001';
  end if;
  if v_status <> 'pending' then
    raise exception 'this emergent risk has already been decided' using errcode = 'P0001';
  end if;
  update sira_emergent_risks
     set status = p_status, decision_reason = btrim(p_reason), decided_by = auth.uid(), decided_at = now()
   where id = p_id and org_id = v_org;
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'emergent_risk_decided', 'sira_emergent_risk', p_id,
          jsonb_build_object('status', p_status, 'reason', btrim(p_reason)));
end $$;

-- cycle_summary: the inherent risk environment per entity and universe (§8.3).
create or replace function public.cycle_summary(p_cycle uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'cycle_id', c.id,
           'universe_id', c.universe_id,
           'year', c.year,
           'status', c.status,
           'entities', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'entity_id', x.entity_id,
                      'name', x.name,
                      'mean_score', x.mean_score,
                      'max_score', x.max_score,
                      'band', public.sira_band_for(c.org_id, x.mean_score))
                    order by x.name)
               from (
                 select e.id as entity_id, e.name,
                        round(avg(s.score), 2) as mean_score,
                        max(s.score) as max_score
                   from sira_scores s join entities e on e.id = s.entity_id
                  where s.cycle_id = c.id
                  group by e.id, e.name
               ) x), '[]'::jsonb),
           'mean_score', (select round(avg(s.score), 2) from sira_scores s where s.cycle_id = c.id),
           'band', public.sira_band_for(c.org_id, (select round(avg(s.score), 2) from sira_scores s where s.cycle_id = c.id))
         )
  from sira_cycles c
  where c.id = p_cycle and c.org_id = public.jwt_org_id()
$$;

-- ---------------------------------------------------------------------------
-- RLS. Every new table carries org_id, has RLS on, and a select policy only.
-- ---------------------------------------------------------------------------
alter table sira_emergent_risks          enable row level security;
alter table sira_cycle_publish_grants    enable row level security;

drop policy if exists ser_select on sira_emergent_risks;
create policy ser_select on sira_emergent_risks for select to authenticated
  using (org_id = public.jwt_org_id()
         and (public.can_read_all_scopes() or public.has_scope(universe_id, entity_id, null)));
drop policy if exists scpg_select on sira_cycle_publish_grants;
create policy scpg_select on sira_cycle_publish_grants for select to authenticated
  using (org_id = public.jwt_org_id());

-- sira_cycles and sira_scores already have select policies from 0008/0016; nothing to add here.

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.sira_cycle_guard() from public, anon;
revoke execute on function public.sira_score_guard() from public, anon;
revoke execute on function public.create_sira_cycle(uuid, int) from public, anon;
revoke execute on function public.record_sira_score(uuid, uuid, uuid, jsonb) from public, anon;
revoke execute on function public.publish_sira_cycle(uuid) from public, anon;
revoke execute on function public.submit_emergent_risk(uuid, text, uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.decide_emergent_risk(uuid, text, text) from public, anon;
revoke execute on function public.cycle_summary(uuid) from public, anon;

grant execute on function public.create_sira_cycle(uuid, int) to authenticated;
grant execute on function public.record_sira_score(uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.publish_sira_cycle(uuid) to authenticated;
grant execute on function public.submit_emergent_risk(uuid, text, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.decide_emergent_risk(uuid, text, text) to authenticated;
grant execute on function public.cycle_summary(uuid) to authenticated;
