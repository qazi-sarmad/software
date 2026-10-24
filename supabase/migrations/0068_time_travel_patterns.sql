-- 0068: Time-Travel and Cross-engagement Patterns (S10, F14, F15).
--
-- F14: engagement_as_of(p_engagement_id, p_ts) reconstructs an engagement's workpapers, findings,
--      seals and statuses from APPEND-ONLY history (ledger_entries, activity_log, version tables).
--      Deterministic (L1): the function replays recorded rows; it never guesses. An entity that keeps
--      only current state cannot be reconstructed, so it is reported as "not_recorded_before" with the
--      earliest recorded date rather than invented. Activity archived out of the live window (0043)
--      is outside the as-of range and is reported as "earliest_available".
--      Every call writes ONE batched activity entry (L5).
--
-- F15: pattern_settings holds the deterministic similarity settings (threshold, minimum cluster size,
--      years back, severities, visibility right). The clustering itself is pure TypeScript in
--      src/lib/patterns.ts; this migration only stores the settings and exposes the finding corpus the
--      clustering reads. No Math.random, no AI (L1).
--
-- M1: grepped supabase/migrations and supabase/tests for engagement_as_of, pattern_settings,
--     pattern_settings_save, pattern_settings_get, pattern_findings, engagement_as_of_events.
--     None existed; this file creates them. The feature keys 'time_travel' and 'patterns' are already
--     seeded in feature_catalogue (0051), so no catalogue change is needed.
-- M2: create table if not exists + add column if not exists; create or replace function;
--     drop policy if exists before create policy; create index if not exists. Safe to apply twice.

-- ---------------------------------------------------------------------------
-- 1. pattern_settings — one row per organisation (F15). Deterministic settings only.
-- ---------------------------------------------------------------------------
create table if not exists pattern_settings (
  id uuid primary key default gen_random_uuid()
);
alter table pattern_settings add column if not exists org_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table pattern_settings add column if not exists similarity_threshold numeric(3,2) not null default 0.40;
alter table pattern_settings add column if not exists min_cluster_size int not null default 2;
alter table pattern_settings add column if not exists years_back int not null default 5;
alter table pattern_settings add column if not exists severities jsonb not null default '[]'::jsonb;
alter table pattern_settings add column if not exists visibility_right text not null default 'view_insights';
alter table pattern_settings add column if not exists updated_at timestamptz not null default now();
alter table pattern_settings add column if not exists updated_by uuid;
create unique index if not exists pattern_settings_org_idx on pattern_settings (org_id);

-- The documented ranges (F15): threshold 0.10 to 0.90, minimum cluster size 2 or more.
alter table pattern_settings drop constraint if exists pattern_settings_threshold_chk;
alter table pattern_settings add constraint pattern_settings_threshold_chk
  check (similarity_threshold >= 0.10 and similarity_threshold <= 0.90);
alter table pattern_settings drop constraint if exists pattern_settings_min_size_chk;
alter table pattern_settings add constraint pattern_settings_min_size_chk check (min_cluster_size >= 2);
alter table pattern_settings drop constraint if exists pattern_settings_years_chk;
alter table pattern_settings add constraint pattern_settings_years_chk
  check (years_back >= 1 and years_back <= 50);

alter table pattern_settings enable row level security;

drop policy if exists pattern_settings_org_select on pattern_settings;
create policy pattern_settings_org_select on pattern_settings for select to authenticated
  using (org_id = public.jwt_org_id());

revoke insert, update, delete on public.pattern_settings from public, anon, authenticated;

alter table pattern_settings drop constraint if exists pattern_settings_org_fk;
alter table pattern_settings add constraint pattern_settings_org_fk
  foreign key (org_id) references orgs(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 2. pattern_settings_seed — the F15 defaults for one org, created on first read.
-- ---------------------------------------------------------------------------
create or replace function public.pattern_settings_seed(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into pattern_settings (org_id) values (p_org)
  on conflict (org_id) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- 3. pattern_settings_get — read the settings (seeding the defaults on first call).
-- ---------------------------------------------------------------------------
create or replace function public.pattern_settings_get(p_org uuid)
returns table (similarity_threshold numeric, min_cluster_size int, years_back int,
               severities jsonb, visibility_right text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_feature(p_org, 'patterns') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  -- The settings are a configuration screen (F15: "Settings (Org Admin, visual)"), so reading them
  -- is an edit_config act; the pattern DATA is a view_insights act (checked in pattern_findings).
  if not public.config_actor_ok(p_org, 'edit_config') then
    raise exception 'not allowed: the caller cannot view insight settings' using errcode = 'P0001';
  end if;
  perform public.pattern_settings_seed(p_org);
  return query
    select s.similarity_threshold, s.min_cluster_size, s.years_back, s.severities, s.visibility_right
      from pattern_settings s where s.org_id = p_org;
end $$;

-- ---------------------------------------------------------------------------
-- 4. pattern_settings_save — Org Admin (edit_config) edits the settings visually (F1, F15).
-- ---------------------------------------------------------------------------
create or replace function public.pattern_settings_save(
  p_org uuid, p_threshold numeric default null, p_min_cluster_size int default null,
  p_years_back int default null, p_severities jsonb default null, p_visibility_right text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text;
begin
  if not public.has_feature(p_org, 'patterns') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  v_actor := public.require_config_actor(p_org, 'edit_config');
  if v_actor = 'proposal' then
    raise exception 'This change needs the client Org Admin to approve it in the live session.'
      using errcode = 'P0001';
  end if;
  perform public.pattern_settings_seed(p_org);
  update pattern_settings
     set similarity_threshold = coalesce(p_threshold, similarity_threshold),
         min_cluster_size = coalesce(p_min_cluster_size, min_cluster_size),
         years_back = coalesce(p_years_back, years_back),
         severities = coalesce(p_severities, severities),
         visibility_right = coalesce(nullif(btrim(p_visibility_right), ''), visibility_right),
         updated_at = now(),
         updated_by = auth.uid()
   where org_id = p_org;

  insert into config_versions (org_id, key, value, version, actor_id)
  values (p_org, 'patterns.settings',
          jsonb_build_object('similarity_threshold', p_threshold, 'min_cluster_size', p_min_cluster_size,
                             'years_back', p_years_back, 'severities', p_severities,
                             'visibility_right', p_visibility_right),
          (select coalesce(max(version), 0) + 1 from config_versions
            where org_id = p_org and key = 'patterns.settings'),
          auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 5. pattern_findings — the deterministic corpus the clustering reads (F15). One row per finding in
--    scope, carrying the four text fields, the shared tags and the entity/year it belongs to. The
--    similarity maths runs in TypeScript (src/lib/patterns.ts); this function only assembles the
--    input, filtered by the caller's scope and the configured severities/years.
-- ---------------------------------------------------------------------------
create or replace function public.pattern_findings(p_org uuid)
returns table (finding_id uuid, entity_id uuid, entity_name text, year int, severity text,
               title text, condition_text text, risk_text text, effect_text text,
               control_tags text[], risk_tags text[], category_tags text[], entity_type text)
language plpgsql security definer set search_path = public as $$
declare
  v_years int;
  v_sev jsonb;
begin
  if not public.has_feature(p_org, 'patterns') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  if not public.config_actor_ok(p_org, 'view_insights') then
    raise exception 'not allowed: the caller cannot view patterns' using errcode = 'P0001';
  end if;
  perform public.pattern_settings_seed(p_org);
  select s.years_back, s.severities into v_years, v_sev from pattern_settings s where s.org_id = p_org;
  v_years := coalesce(v_years, 5);

  return query
    select f.id,
           f.entity_id,
           e.name,
           extract(year from f.created_at)::int,
           coalesce(sl.name, f.severity),
           coalesce(nullif(btrim(f.sections ->> 'title'), ''), o.title, 'Untitled finding'),
           coalesce(f.sections ->> 'condition', ''),
           coalesce(f.sections ->> 'risk', ''),
           coalesce(f.sections ->> 'effect', ''),
           coalesce((
             select array_agg(r.name order by r.name)
               from risks_library r where r.id = any(f.linked_control_ids)), '{}'),
           coalesce((
             select array_agg(r.name order by r.name)
               from risks_library r
              where r.id in (select (value)::uuid from jsonb_array_elements_text(f.sections -> 'risk_ids'))), '{}'),
           coalesce((
             select array_agg(distinct i2.title order by i2.title)
               from issues i2
              where i2.org_id = p_org and i2.entity_id = f.entity_id), '{}'),
           coalesce(e.kind, '')
      from findings f
      left join entities e on e.id = f.entity_id
      left join observations o on o.id = f.observation_id
      left join severity_levels sl on sl.id = f.severity_level_id
     where f.org_id = p_org
       and f.status = 'concluded'
       and (v_sev = '[]'::jsonb or coalesce(sl.name, f.severity) in (
              select value from jsonb_array_elements_text(v_sev)))
       and f.created_at >= (now() - make_interval(years => v_years))
       and (public.can_read_all_scopes()
            or public.has_scope(null, f.entity_id, null))
     order by f.created_at asc, f.id asc;
end $$;

-- ---------------------------------------------------------------------------
-- 6. engagement_as_of_events — the recorded events for one engagement up to a moment, in sequence.
--    Reads the append-only sources only: ledger_entries and activity_log. A row that a source does
--    not record is not returned (F14: never guessed).
-- ---------------------------------------------------------------------------
create or replace function public.engagement_as_of_events(p_engagement_id uuid, p_ts timestamptz)
returns table (seq text, kind text, action text, at timestamptz, object_type text, object_id uuid,
               detail jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select e.org_id into v_org from engagements e where e.id = p_engagement_id;
  if v_org is null then
    return;
  end if;
  return query
    select l.seq::text, 'ledger'::text, l.action, l.ts, null::text, null::uuid, l.payload
      from ledger_entries l
     where l.org_id = v_org and l.ts <= p_ts
       and (l.payload ->> 'engagement_id')::uuid = p_engagement_id
    union all
    select a.id::text as seq_text, 'activity'::text, a.action, a.ts, a.object_type, a.object_id, a.detail
      from activity_log a
     where a.org_id = v_org and a.ts <= p_ts
       and ((a.object_type = 'engagement' and a.object_id = p_engagement_id)
            or (a.object_type = 'workpaper' and a.object_id in (
                  select w.id from workpapers w where w.engagement_id = p_engagement_id)))
    order by 4 asc, 1 asc;
end $$;

-- ---------------------------------------------------------------------------
-- 7. engagement_as_of — the F14 reconstruction. Returns one JSON document:
--      status: 'ok' | 'not_recorded_before' | 'earliest_available'
--      as_of, earliest_recorded
--      workpapers: [{id, status, prepared, signed_off_at}]  (replayed from sign-off/reopen events)
--      findings:   [{id, severity, title, at}]
--      seal:       {sealed boolean, at}
--      statuses:   [{action, at, detail}]
--    Every call writes ONE batched activity entry (L5).
-- ---------------------------------------------------------------------------
create or replace function public.engagement_as_of(p_engagement_id uuid, p_ts timestamptz)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_scope_ok boolean;
  v_earliest timestamptz;
  v_archived_until timestamptz;
  v_wp jsonb := '[]'::jsonb;
  v_findings jsonb := '[]'::jsonb;
  v_statuses jsonb := '[]'::jsonb;
  v_sealed boolean := false;
  v_sealed_at timestamptz := null;
  v_ev record;
  v_wp_state jsonb;
  v_result jsonb;
begin
  select e.org_id,
         (e.org_id = public.jwt_org_id()
          and (public.can_read_all_scopes() or public.has_scope(e.universe_id, e.entity_id, e.id)))
    into v_org, v_scope_ok
    from engagements e where e.id = p_engagement_id;
  if v_org is null then
    raise exception 'engagement_as_of: engagement % not found', p_engagement_id using errcode = 'P0001';
  end if;
  if not public.has_feature(v_org, 'time_travel') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  -- Scope before right, so a cross-org or out-of-scope read is refused as such rather than as a
  -- rights failure (RLS parity: can_read_all_scopes or a scope on the engagement).
  if not coalesce(v_scope_ok, false) then
    raise exception 'not allowed: the engagement is outside the caller''s scope' using errcode = 'P0001';
  end if;
  if not public.config_actor_ok(v_org, 'view_insights') then
    raise exception 'not allowed: the caller cannot view the engagement timeline' using errcode = 'P0001';
  end if;
  -- The earliest moment the append-only history records for this engagement.
  select min(t) into v_earliest from (
    select l.ts as t from ledger_entries l
     where l.org_id = v_org and (l.payload ->> 'engagement_id')::uuid = p_engagement_id
    union all
    select a.ts from activity_log a
     where a.org_id = v_org
       and ((a.object_type = 'engagement' and a.object_id = p_engagement_id)
            or (a.object_type = 'workpaper' and a.object_id in (
                  select w.id from workpapers w where w.engagement_id = p_engagement_id)))
  ) s;

  -- The oldest live activity. Anything before this was archived out of the live window (0043).
  select max(j.period_end) into v_archived_until from archive_jobs j
   where j.org_id = v_org and j.status = 'done';

  if v_earliest is null then
    v_result := jsonb_build_object('status', 'not_recorded_before', 'as_of', p_ts,
                                   'earliest_recorded', null,
                                   'note', 'This engagement has no recorded history.');
  elsif p_ts < v_earliest then
    v_result := jsonb_build_object('status', 'not_recorded_before', 'as_of', p_ts,
                                   'earliest_recorded', v_earliest,
                                   'note', 'Not recorded before this date.');
  elsif v_archived_until is not null and p_ts < v_archived_until::timestamptz then
    v_result := jsonb_build_object('status', 'earliest_available', 'as_of', p_ts,
                                   'earliest_available', v_archived_until::timestamptz,
                                   'note', 'Activity before this date was archived and is outside the as-of range.');
  else
    -- Replay the recorded events in order. State is derived, never guessed.
    for v_ev in select * from public.engagement_as_of_events(p_engagement_id, p_ts) loop
      if v_ev.action in ('workpaper_signed_off', 'workpaper_reopened') then
        v_wp_state := jsonb_build_object(
          'id', coalesce(v_ev.detail ->> 'workpaper_id', v_ev.object_id::text),
          'status', case when v_ev.action = 'workpaper_signed_off' then 'signed_off' else 'reviewed' end,
          'at', v_ev.at);
        v_wp := v_wp || jsonb_build_array(v_wp_state);
      elsif v_ev.action = 'finding_promoted' then
        v_findings := v_findings || jsonb_build_array(jsonb_build_object(
          'id', v_ev.detail ->> 'finding_id', 'at', v_ev.at,
          'observation_id', v_ev.detail ->> 'observation_id'));
      elsif v_ev.action = 'conclusion_signed_off' then
        v_sealed := true; v_sealed_at := v_ev.at;
      elsif v_ev.action = 'engagement_reopen' then
        v_sealed := false; v_sealed_at := v_ev.at;
      end if;
      if v_ev.kind = 'activity' then
        v_statuses := v_statuses || jsonb_build_array(jsonb_build_object(
          'action', v_ev.action, 'at', v_ev.at, 'object_type', v_ev.object_type,
          'object_id', v_ev.object_id, 'detail', v_ev.detail));
      end if;
    end loop;

    v_result := jsonb_build_object(
      'status', 'ok', 'as_of', p_ts, 'earliest_recorded', v_earliest,
      'workpapers', v_wp, 'findings', v_findings,
      'seal', jsonb_build_object('sealed', v_sealed, 'at', v_sealed_at),
      'statuses', v_statuses);
  end if;

  -- One batched activity entry per call (F14, L5).
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'engagement_as_of_viewed', 'engagement', p_engagement_id,
          jsonb_build_object('as_of', p_ts, 'status', v_result ->> 'status'));

  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Grants. Nothing here goes to anon.
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('engagement_as_of','engagement_as_of_events','pattern_settings_get',
                        'pattern_settings_save','pattern_findings','pattern_settings_seed')
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to authenticated', fn.name, fn.args);
  end loop;
end $$;
