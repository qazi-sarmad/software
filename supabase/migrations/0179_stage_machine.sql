-- 0179 (S6 / F30, R5) — the configurable stage machine.
--
-- Before this migration the engagement stage machine was three hardcoded strings
-- (`'planning' | 'testing' | 'conclusion'`) in the TypeScript type and in a dozen SQL functions.
-- F30 asks for the stage machine to be configurable per tenant, or to be recorded honestly as out
-- of scope. It is built here, with a deliberate design that keeps the existing behaviour unchanged
-- by default:
--
--   * The DEFAULT stage list is exactly the three legacy stages, in the legacy order, with their
--     legacy labels. An org that configures nothing is unchanged: every migration, every SQL test
--     and every screen behaves exactly as before. That is the safety property the change rests on,
--     and §7 of test 138 proves it.
--
--   * The three stages carry a fixed, well-known KEY (`planning`, `testing`, `conclusion`). A tenant
--     may RENAME the labels and ADD stages (for example a `fieldwork` stage between planning and
--     conclusion), but the key is the anchor: `engagements.stage` keeps storing the key, so the
--     ethics gate, the testing lock, the conclusion-readiness rule and the TS `EngagementStage`
--     union all keep working on the default machine. The change is additive.
--
--   * `set_engagement_stage` becomes the ONE write path that reads the configured machine: the
--     forward order and the legality of a move come from `org_stage_machine`, not a hardcoded array.
--     A move to a stage the machine does not define is refused with `unknown_stage`; a move that is
--     not forward in the configured order is refused with `illegal_transition`. Both are refusals
--     with an exact reason and no write, per the honest-failure rule.
--
--   * `stage_machine_effective(org)` is the single read: the org's rows if it has any, otherwise the
--     three defaults. It is the config-honesty answer for F30 — the configuration is READ by the
--     write path, not merely stored and displayed.

-- ---------------------------------------------------------------------------
-- 1. The configured machine. One row per stage, ordered by `position`. `key` is the stable anchor
--    stored on `engagements.stage`; `label` is the tenant's display name. `anchor` names the legacy
--    gate the key inherits.
-- ---------------------------------------------------------------------------
create table if not exists org_stage_machine (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  key text not null,
  label text not null,
  position int not null,
  anchor text not null check (anchor in ('planning', 'testing', 'conclusion')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key),
  unique (org_id, position)
);
create index if not exists osm_org_idx on org_stage_machine (org_id, position);
alter table org_stage_machine enable row level security;

drop policy if exists osm_select on org_stage_machine;
create policy osm_select on org_stage_machine for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 2. The defaults, as a function, so a tenant that has configured nothing is still a first-class
--    machine (never a special case in the caller).
-- ---------------------------------------------------------------------------
create or replace function public.stage_machine_defaults()
returns table (key text, label text, pos int, anchor text)
language sql immutable as $$
  select * from (values
    ('planning',   'Planning',   1, 'planning'),
    ('testing',    'Testing',    2, 'testing'),
    ('conclusion', 'Conclusion', 3, 'conclusion')
  ) as d(key, label, pos, anchor)
$$;

-- The single read. The org's configured rows if it has any; otherwise the three defaults. Ordered.
create or replace function public.stage_machine_effective(p_org uuid)
returns table (key text, label text, pos int, anchor text)
language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from org_stage_machine m where m.org_id = p_org) then
    return query
      select m.key, m.label, m.position as pos, m.anchor
        from org_stage_machine m
       where m.org_id = p_org
       order by m.position;
  else
    return query select * from public.stage_machine_defaults();
  end if;
end $$;
revoke execute on function public.stage_machine_effective(uuid) from public, anon;
grant execute on function public.stage_machine_effective(uuid) to authenticated;

-- The position of a key on the effective machine, or null when the machine does not define it.
create or replace function public.stage_position(p_org uuid, p_key text)
returns int
language sql stable security definer set search_path = public as $$
  select m.pos from public.stage_machine_effective(p_org) m where m.key = p_key
$$;
revoke execute on function public.stage_position(uuid, text) from public, anon;
grant execute on function public.stage_position(uuid, text) to authenticated;

-- The anchor (the legacy gate the key inherits), or null when the machine does not define the key.
create or replace function public.stage_anchor(p_org uuid, p_key text)
returns text
language sql stable security definer set search_path = public as $$
  select m.anchor from public.stage_machine_effective(p_org) m where m.key = p_key
$$;
revoke execute on function public.stage_anchor(uuid, text) from public, anon;
grant execute on function public.stage_anchor(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The configuration RPC. Replaces the whole machine in one call (a machine is an ordered set, so
--    a partial edit is a broken machine). The three legacy anchors must each be present, and in the
--    order planning, testing, conclusion. Extra tenant stages may share an anchor and sit anywhere,
--    so a tenant can insert a Fieldwork stage inside the planning phase (anchor 'planning'). A refusal returns {ok:false, reason} with no write.
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_stage_machine(p_stages jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_row jsonb;
  v_keys text[] := '{}';
  v_anchors text[] := '{}';
  v_i int := 0;
  v_rank int;
  v_prev_rank int := 0;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  if p_stages is null or jsonb_typeof(p_stages) <> 'array' or jsonb_array_length(p_stages) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'a stage machine needs at least the three stages');
  end if;

  for v_row in select * from jsonb_array_elements(p_stages) loop
    v_i := v_i + 1;
    if coalesce(btrim(v_row ->> 'key'), '') = '' then
      return jsonb_build_object('ok', false, 'reason', 'every stage needs a key');
    end if;
    if coalesce(btrim(v_row ->> 'label'), '') = '' then
      return jsonb_build_object('ok', false, 'reason', 'every stage needs a label');
    end if;
    if (v_row ->> 'key') !~ '^[a-z][a-z0-9_]{1,31}$' then
      return jsonb_build_object('ok', false, 'reason', 'a stage key is lower-case letters, digits and underscores');
    end if;
    if (v_row ->> 'anchor') not in ('planning', 'testing', 'conclusion') then
      return jsonb_build_object('ok', false, 'reason', 'a stage must anchor to planning, testing or conclusion');
    end if;
    if (v_row ->> 'key') = any(v_keys) then
      return jsonb_build_object('ok', false, 'reason', format('duplicate stage key: %s', v_row ->> 'key'));
    end if;
    v_keys := v_keys || (v_row ->> 'key');
    v_anchors := v_anchors || (v_row ->> 'anchor');
    -- The anchor order may never go backwards: planning, then testing, then conclusion.
    v_rank := array_position(array['planning', 'testing', 'conclusion'], v_row ->> 'anchor');
    if v_rank < v_prev_rank then
      return jsonb_build_object('ok', false,
        'reason', 'the anchors must appear in the order planning, testing, conclusion');
    end if;
    v_prev_rank := v_rank;
  end loop;

  -- The three legacy anchors must all be present (the built-in gates are anchored to them).
  if not (array['planning', 'testing', 'conclusion'] <@ v_anchors) then
    return jsonb_build_object('ok', false,
      'reason', 'the machine must carry planning, testing and conclusion');
  end if;

  -- A live engagement must not be orphaned. If an engagement sits on a stage the new machine drops,
  -- the save is refused with the stage and the count, so the tenant can move the engagement first.
  if exists (
    select 1 from engagements e
     where e.org_id = v_org and not (e.stage = any(v_keys))
  ) then
    return jsonb_build_object('ok', false,
      'reason', format('the stage %s is in use and cannot be removed',
        (select e.stage from engagements e where e.org_id = v_org and not (e.stage = any(v_keys))
          group by e.stage order by count(*) desc limit 1)));
  end if;

  delete from org_stage_machine where org_id = v_org;
  for v_row in select * from jsonb_array_elements(p_stages) loop
    insert into org_stage_machine (org_id, key, label, position, anchor)
    select v_org, btrim(e.val ->> 'key'), btrim(e.val ->> 'label'), e.ord::int, e.val ->> 'anchor'
      from jsonb_array_elements(p_stages) with ordinality as e(val, ord)
     where (e.val ->> 'key') = (v_row ->> 'key');
  end loop;

  perform public.admin_log_change(v_org, 'stage_machine', p_stages,
    'stage_machine_saved', 'org_stage_machine', v_org);
  return jsonb_build_object('ok', true, 'stages', jsonb_array_length(p_stages));
end $$;
revoke execute on function public.admin_save_stage_machine(jsonb) from public, anon;
grant execute on function public.admin_save_stage_machine(jsonb) to authenticated;

-- Reset to the defaults: delete the org's rows, so `stage_machine_effective` falls back.
create or replace function public.admin_reset_stage_machine()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  delete from org_stage_machine where org_id = v_org;
  perform public.admin_log_change(v_org, 'stage_machine', '[]'::jsonb,
    'stage_machine_reset', 'org_stage_machine', v_org);
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.admin_reset_stage_machine() from public, anon;
grant execute on function public.admin_reset_stage_machine() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. set_engagement_stage reads the machine. The two hardcoded arrays become the configured order;
--    the built-in gates (testing lock, ethics, conclusion readiness) keep firing on the ANCHOR, so a
--    renamed or interleaved stage inherits the right gate.
-- ---------------------------------------------------------------------------
create or replace function public.set_engagement_stage(
  p_engagement_id uuid, p_to_stage text, p_expected_stage text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_eng engagements;
  v_to_pos int;
  v_from_pos int;
  v_to_anchor text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_engagements'), false) then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;

  -- The configured machine is the only source of legal stages and their order.
  v_to_pos := public.stage_position(v_org, p_to_stage);
  if v_to_pos is null then
    raise exception 'unknown_stage: % is not a stage of this organisation''s machine', p_to_stage
      using errcode = 'P0001';
  end if;
  v_to_anchor := public.stage_anchor(v_org, p_to_stage);

  select * into v_eng from engagements where id = p_engagement_id and org_id = v_org;
  if v_eng.id is null then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if p_expected_stage is not null and v_eng.stage is distinct from p_expected_stage then
    raise exception 'stage_conflict: the engagement is at % but % was expected', v_eng.stage, p_expected_stage
      using errcode = 'P0001';
  end if;
  if v_eng.stage = p_to_stage then
    raise exception 'no_change: the engagement is already at %', p_to_stage using errcode = 'P0001';
  end if;

  -- The engagement's current stage must itself be on the machine.
  v_from_pos := public.stage_position(v_org, v_eng.stage);
  if v_from_pos is null then
    raise exception 'stage_orphaned: the engagement is at %, which the machine no longer defines',
      v_eng.stage using errcode = 'P0001';
  end if;

  -- Forward only, in the CONFIGURED order. A reopen is reopen_engagement(), not a backward move.
  if v_to_pos < v_from_pos then
    raise exception 'illegal_transition: % -> % is not a forward stage move', v_eng.stage, p_to_stage
      using errcode = 'P0001';
  end if;

  -- §10.1: Testing is locked until Planning sign-off. Fires on the anchor, so a tenant stage that
  -- anchors to 'testing' inherits the lock.
  if v_to_anchor = 'testing' and public.testing_lock_active(p_engagement_id) then
    raise exception 'testing_locked: planning must be signed off before testing (engagement %)', p_engagement_id
      using errcode = 'P0001';
  end if;

  -- 2.3: testing_mode. Two-stage testing needs a design (DEA) and an operating (OET) workpaper,
  -- both signed off, before Conclusion. Fires on the anchor.
  if v_to_anchor = 'conclusion' then
    perform public.assert_conclusion_ready(p_engagement_id);
  end if;

  update engagements set stage = p_to_stage where id = p_engagement_id and org_id = v_org;

  insert into engagement_stage_transitions (org_id, engagement_id, from_stage, to_stage, actor_id)
  values (v_org, p_engagement_id, v_eng.stage, p_to_stage, auth.uid());

  perform public.append_ledger_entry(v_org, 'stage_changed',
    jsonb_build_object('engagement_id', p_engagement_id::text, 'from', v_eng.stage, 'to', p_to_stage,
                       'anchor', v_to_anchor),
    auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'stage_changed', 'engagement', p_engagement_id,
          jsonb_build_object('from', v_eng.stage, 'to', p_to_stage, 'anchor', v_to_anchor));
end $$;
revoke execute on function public.set_engagement_stage(uuid, text, text) from public, anon;
grant execute on function public.set_engagement_stage(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The column check `stage in ('planning','testing','conclusion')` (0003) forbids a tenant stage,
--    so it is replaced by a trigger that validates against the EFFECTIVE MACHINE. A check constraint
--    cannot query a table, so the invariant "the stage is on the machine" lives in a trigger. The
--    default machine has the three legacy stages, so every existing row and insert still passes.
-- ---------------------------------------------------------------------------
alter table engagements drop constraint if exists engagements_stage_check;

create or replace function public.engagement_stage_on_machine() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.stage_position(new.org_id, new.stage) is null then
    raise exception 'unknown_stage: % is not a stage of this organisation''s machine', new.stage
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists engagements_stage_machine_guard on engagements;
create trigger engagements_stage_machine_guard before insert or update of stage on engagements
  for each row execute function public.engagement_stage_on_machine();

-- ---------------------------------------------------------------------------
-- 6. The ethics trigger reads the anchor. A tenant stage that anchors to 'testing' must run the
--    ethics acknowledgement gate, exactly as the literal 'testing' did.
-- ---------------------------------------------------------------------------
create or replace function public.engagement_stage_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_new_anchor text;
  v_old_anchor text;
begin
  v_new_anchor := coalesce(public.stage_anchor(new.org_id, new.stage), new.stage);
  v_old_anchor := coalesce(public.stage_anchor(old.org_id, old.stage), old.stage);
  if v_new_anchor = 'testing' and v_old_anchor is distinct from 'testing' then
    if exists (
      select 1 from engagement_team_members m
       where m.engagement_id = new.id
         and not exists (select 1 from ethics_acknowledgements a
                          where a.engagement_id = new.id and a.user_id = m.user_id)
    ) then
      raise exception 'ethics: every team member must acknowledge ethics before Testing can start'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 7. The reads for the settings screen: the effective machine, whether it is custom, and the stages
--    currently in use (so a tenant can see why a stage must not be removed).
-- ---------------------------------------------------------------------------
create or replace function public.stage_machine_get()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_custom boolean;
  v_rows jsonb;
  v_in_use jsonb;
begin
  if v_org is null then
    return jsonb_build_object('ok', false, 'reason', 'not signed in');
  end if;
  v_custom := exists (select 1 from org_stage_machine m where m.org_id = v_org);
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', m.key, 'label', m.label, 'position', m.pos, 'anchor', m.anchor)
           order by m.pos), '[]'::jsonb)
    into v_rows
    from public.stage_machine_effective(v_org) m;
  select coalesce(jsonb_agg(jsonb_build_object('stage', e.stage, 'count', e.n) order by e.stage), '[]'::jsonb)
    into v_in_use
    from (select e.stage, count(*) n from engagements e where e.org_id = v_org group by e.stage) e;
  return jsonb_build_object('ok', true, 'custom', v_custom, 'stages', v_rows,
    'in_use', coalesce(v_in_use, '[]'::jsonb));
end $$;
revoke execute on function public.stage_machine_get() from public, anon;
grant execute on function public.stage_machine_get() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The register entry (F7 config history): the stage machine is a config area.
-- ---------------------------------------------------------------------------
insert into config_areas (key, label, history_table, notify_policy) values
  ('stage_machine', 'Engagement stage machine', 'config_versions', 'both')
on conflict (key) do nothing;
