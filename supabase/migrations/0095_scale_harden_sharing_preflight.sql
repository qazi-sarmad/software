-- 0095: SCALE-1 WP2 — the three remaining Partial clauses closed in one migration.
--
--   §10.1  a configurable grace period before the Testing hard lock. The hard lock stays; the org
--          may allow a short overlap window after planning sign-off would otherwise be required.
--   §11.4  the central pre-flight: an append-only, logged acknowledge-with-reason store. The eight
--          checks themselves are the pure module src/lib/preflight.ts; this migration holds the
--          acknowledgements the module consults.
--   §2     cross-universe view-only sharing. A share is granted by a Level-1 or Level-2 Head, carries
--          an optional expiry, is revocable by the granting Head, a higher Head or an Org Admin, and
--          notifies the grantee in-app and by email. The projection is read-only and never weakens
--          `org_id = public.jwt_org_id()` for normal tenant data: every share is intra-organisation,
--          so the org equality is an additional restriction, never a relaxation.
--
-- M1: grepped supabase/migrations and supabase/tests for every object below; all are new. M2: every
-- statement is idempotent (`create table if not exists`, `add column if not exists`,
-- `create or replace function`, `drop policy if exists` before create, `insert ... on conflict`).

-- ===========================================================================
-- 1. §10.1 configurable grace period before the Testing hard lock.
-- ===========================================================================
alter table org_lifecycle_settings add column if not exists testing_grace_hours int not null default 0;
alter table org_lifecycle_settings drop constraint if exists ols_grace_range_chk;
alter table org_lifecycle_settings add constraint ols_grace_range_chk
  check (testing_grace_hours >= 0 and testing_grace_hours <= 336);

-- testing_lock_active: true when Testing is still hard-locked for the engagement. The lock lifts on
-- planning sign-off. While planning is not signed off, the org may allow an overlap: during the
-- grace window the lock is INACTIVE (testing is allowed) even without sign-off. With the default
-- grace of 0 the window is empty, so the hard lock behaves exactly as before (locked until sign-off).
-- The engagement's planning start is its created_at (Planning begins when the engagement exists,
-- §10.1). Time is read here, in the database, never inside a pure function.
create or replace function public.testing_lock_active(p_engagement_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.planning_signed_off(p_engagement_id) then false
    else coalesce(
      not (select e.created_at + make_interval(hours => coalesce(s.testing_grace_hours, 0)) > now()
             from engagements e
             left join org_lifecycle_settings s on s.org_id = e.org_id
            where e.id = p_engagement_id and e.org_id = public.jwt_org_id()),
      true)
  end
$$;

-- The guard now consults the grace-aware lock. The hard lock is unchanged in behaviour when the
-- grace period is 0 (the default): the overlap condition is false, so the lock is active exactly as
-- before until planning sign-off.
create or replace function public.guard_testing_lock() returns trigger
language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.stage = 'testing'
     and (tg_op = 'INSERT' or old.stage is distinct from 'testing')
     and public.testing_lock_active(new.engagement_id) then
    raise exception 'testing_locked: planning must be signed off before testing (engagement %)', new.engagement_id
      using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Extend the lifecycle save with the grace period. The new argument has a default, so every existing
-- 5-argument call keeps working. The old 5-argument signature is dropped first, or the two would be
-- ambiguous for a 5-argument call.
drop function if exists public.admin_save_lifecycle_settings(text, text, text, text, boolean);
create or replace function public.admin_save_lifecycle_settings(
  p_testing_mode text, p_signoff_role_planning text, p_signoff_role_testing text,
  p_signoff_role_conclusion text, p_report_opinion_required boolean,
  p_testing_grace_hours int default 0
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_roles text[] := array['lead', 'preparer', 'reviewer', 'observer'];
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  if p_testing_mode not in ('one_stage', 'two_stage') then
    raise exception 'the testing mode is one_stage or two_stage' using errcode = 'P0001';
  end if;
  if not (p_signoff_role_planning = any(v_roles) and p_signoff_role_testing = any(v_roles)
          and p_signoff_role_conclusion = any(v_roles)) then
    raise exception 'a sign-off role must be one of the organisation team roles' using errcode = 'P0001';
  end if;
  if p_testing_grace_hours is null or p_testing_grace_hours < 0 or p_testing_grace_hours > 336 then
    raise exception 'the testing grace period is between 0 and 336 hours' using errcode = 'P0001';
  end if;
  insert into org_lifecycle_settings (org_id, testing_mode, signoff_role_planning, signoff_role_testing,
                                      signoff_role_conclusion, report_opinion_required,
                                      testing_grace_hours, updated_at)
  values (v_org, p_testing_mode, p_signoff_role_planning, p_signoff_role_testing,
          p_signoff_role_conclusion, coalesce(p_report_opinion_required, false),
          coalesce(p_testing_grace_hours, 0), now())
  on conflict (org_id) do update set testing_mode = excluded.testing_mode,
    signoff_role_planning = excluded.signoff_role_planning,
    signoff_role_testing = excluded.signoff_role_testing,
    signoff_role_conclusion = excluded.signoff_role_conclusion,
    report_opinion_required = excluded.report_opinion_required,
    testing_grace_hours = excluded.testing_grace_hours, updated_at = now();
  perform public.admin_log_change(v_org, 'lifecycle_settings',
    jsonb_build_object('testing_mode', p_testing_mode,
                       'signoff_role_planning', p_signoff_role_planning,
                       'signoff_role_testing', p_signoff_role_testing,
                       'signoff_role_conclusion', p_signoff_role_conclusion,
                       'report_opinion_required', coalesce(p_report_opinion_required, false),
                       'testing_grace_hours', coalesce(p_testing_grace_hours, 0)),
    'lifecycle_settings_saved', 'org_lifecycle_settings', v_org);
end $$;

-- The read carries the new field.
create or replace function public.lifecycle_settings_get() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('testing_mode', s.testing_mode,
                               'signoff_role_planning', s.signoff_role_planning,
                               'signoff_role_testing', s.signoff_role_testing,
                               'signoff_role_conclusion', s.signoff_role_conclusion,
                               'report_opinion_required', s.report_opinion_required,
                               'testing_grace_hours', s.testing_grace_hours)
       from org_lifecycle_settings s where s.org_id = public.jwt_org_id()),
    jsonb_build_object('testing_mode', 'two_stage', 'signoff_role_planning', 'reviewer',
                       'signoff_role_testing', 'reviewer', 'signoff_role_conclusion', 'reviewer',
                       'report_opinion_required', false, 'testing_grace_hours', 0))
$$;

-- ===========================================================================
-- 2. §11.4 central pre-flight: the append-only acknowledgement store.
-- ===========================================================================
create table if not exists preflight_acks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  check_key text not null,
  item_id text not null,
  reason text not null,
  acked_by uuid null,
  acked_at timestamptz not null default now()
);
create index if not exists preflight_acks_engagement_idx
  on preflight_acks (org_id, engagement_id, check_key, item_id);

alter table preflight_acks drop constraint if exists preflight_acks_reason_len_chk;
alter table preflight_acks add constraint preflight_acks_reason_len_chk
  check (length(btrim(reason)) >= 10);

-- The eight check keys are a closed list, so a typo cannot silently acknowledge nothing.
alter table preflight_acks drop constraint if exists preflight_acks_check_key_chk;
alter table preflight_acks add constraint preflight_acks_check_key_chk
  check (check_key in ('exceptions_without_rationale', 'unresolved_flags', 'missing_evidence',
                       'sample_below_floor', 'reviewer_equals_preparer', 'incomplete_findings',
                       'unanswered_comments', 'population_gate'));

alter table preflight_acks enable row level security;
drop policy if exists preflight_acks_select on preflight_acks;
create policy preflight_acks_select on preflight_acks for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- Acknowledge one open item with a logged reason. Append-only: it inserts, never updates, so the
-- history of every acknowledgement is kept. The latest row per (check, item) is the live one.
create or replace function public.preflight_acknowledge(
  p_engagement_id uuid, p_check_key text, p_item_id text, p_reason text
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
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'an acknowledgement reason of at least 10 characters is required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  insert into preflight_acks (org_id, engagement_id, check_key, item_id, reason, acked_by)
  values (v_org, p_engagement_id, p_check_key, p_item_id, btrim(p_reason), auth.uid())
  returning id into v_id;
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'preflight_acknowledged', 'engagement', p_engagement_id,
          jsonb_build_object('check_key', p_check_key, 'item_id', p_item_id, 'reason', btrim(p_reason)));
  perform public.append_ledger_entry(v_org, 'preflight_acknowledged',
    jsonb_build_object('engagement_id', p_engagement_id, 'check_key', p_check_key, 'item_id', p_item_id),
    auth.uid());
  return v_id;
end $$;

-- The live acknowledgements for an engagement: the latest row per (check, item).
create or replace function public.preflight_acks_get(p_engagement_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'check_key', a.check_key, 'item_id', a.item_id, 'reason', a.reason,
           'acked_by', a.acked_by, 'acked_at', a.acked_at)
         order by a.check_key, a.item_id), '[]'::jsonb)
  from (
    select distinct on (check_key, item_id) check_key, item_id, reason, acked_by, acked_at
      from preflight_acks
     where org_id = public.jwt_org_id() and engagement_id = p_engagement_id
     order by check_key, item_id, acked_at desc, id desc
  ) a
$$;

-- ===========================================================================
-- 3. §2 cross-universe view-only sharing.
-- ===========================================================================

-- 3a. The Head attribute. A flag on the member record: none, 1 or 2, set by an Org Admin.
alter table org_members add column if not exists head_level smallint null;
alter table org_members drop constraint if exists org_members_head_level_chk;
alter table org_members add constraint org_members_head_level_chk
  check (head_level is null or head_level in (1, 2));

-- The caller's own Head level, as a number (0 = not a Head). SECURITY DEFINER so it reads org_members
-- without recursion.
create or replace function public.caller_head_level() returns int
language sql stable security definer set search_path = public as $$
  select coalesce(max(m.head_level), 0)
  from org_members m
  where m.org_id = public.jwt_org_id() and m.user_id = auth.uid()
$$;

-- is_head: the caller is a Head of at least `p_min_level` (1 = Level-1, 2 = Level-2). A Level-2 Head
-- satisfies a Level-1 requirement (higher authority covers lower).
create or replace function public.is_head(p_min_level int) returns boolean
language sql stable security definer set search_path = public as $$
  select public.caller_head_level() >= p_min_level
$$;

-- An Org Admin may also set the Head flag (§2: set by an Org Admin).
create or replace function public.admin_set_head_level(p_user uuid, p_level int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('manage_users');
  if p_level is not null and p_level not in (1, 2) then
    raise exception 'the Head level is none, 1 or 2' using errcode = 'P0001';
  end if;
  if not exists (select 1 from org_members m where m.org_id = v_org and m.user_id = p_user) then
    raise exception 'member not found in this organisation' using errcode = 'P0001';
  end if;
  update org_members set head_level = p_level where org_id = v_org and user_id = p_user;
  perform public.admin_log_change(v_org, 'head_levels',
    jsonb_build_object('user_id', p_user, 'head_level', p_level),
    'head_level_set', 'org_members', null);
end $$;

-- 3b. The share table: grant (the granting Head), grantee, universe, expiry, revocation.
create table if not exists universe_shares (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  universe_id uuid not null references universes(id) on delete cascade,
  grantee_user_id uuid not null,
  granted_by uuid null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz null,
  revoked_at timestamptz null,
  revoke_reason text null
);
create index if not exists universe_shares_org_idx on universe_shares (org_id, universe_id);
create index if not exists universe_shares_grantee_idx on universe_shares (org_id, grantee_user_id);

alter table universe_shares drop constraint if exists universe_shares_expiry_chk;
alter table universe_shares add constraint universe_shares_expiry_chk
  check (expires_at is null or expires_at > granted_at);

alter table universe_shares enable row level security;
drop policy if exists universe_shares_select on universe_shares;
create policy universe_shares_select on universe_shares for select to authenticated
  using (org_id = public.jwt_org_id()
         and (grantee_user_id = auth.uid() or public.caller_head_level() > 0
              or public.is_org_admin() or public.is_cia()));

-- Every read of a shared universe is logged (§2 read-only projection, WP4 support-grant parity).
create table if not exists share_access_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  share_id uuid not null references universe_shares(id) on delete cascade,
  viewer_id uuid null,
  universe_id uuid not null,
  accessed_at timestamptz not null default now()
);
create index if not exists share_access_log_idx on share_access_log (org_id, share_id);
alter table share_access_log enable row level security;
drop policy if exists share_access_log_select on share_access_log;
create policy share_access_log_select on share_access_log for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- has_active_share: true when a live share of `p_universe_id` exists for the caller. A share is live
-- while it is not revoked and not expired. SECURITY DEFINER so the RLS policies below can consult it.
create or replace function public.has_active_share(p_universe_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from universe_shares s
    where s.org_id = public.jwt_org_id()
      and s.universe_id = p_universe_id
      and s.grantee_user_id = auth.uid()
      and s.revoked_at is null
      and (s.expires_at is null or s.expires_at > now())
  )
$$;

-- A projection-only view flag: the caller may READ the universe/entity/engagement because of a live
-- share, but may not write it. This is used to extend the select policies only.
create or replace function public.share_covers(
  p_universe_id uuid, p_entity_id uuid, p_engagement_id uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from universe_shares s
    where s.org_id = public.jwt_org_id()
      and s.grantee_user_id = auth.uid()
      and s.revoked_at is null
      and (s.expires_at is null or s.expires_at > now())
      and s.universe_id = coalesce(
        p_universe_id,
        (select e.universe_id from entities e where e.id = p_entity_id),
        (select g.universe_id from engagements g where g.id = p_engagement_id))
  )
$$;

-- 3c. Extend the read policies. The `org_id = public.jwt_org_id()` clause is KEPT in every policy:
-- a share is intra-organisation, so it adds a way to see a universe in the same tenant, never a way
-- to cross tenants. A write policy is untouched, so a share is view-only.
drop policy if exists universes_select on universes;
create policy universes_select on universes for select to authenticated
  using (org_id = public.jwt_org_id()
         and (public.can_read_all_scopes() or public.has_scope(id, null, null)
              or public.has_active_share(id)));

drop policy if exists entities_select on entities;
create policy entities_select on entities for select to authenticated
  using (org_id = public.jwt_org_id()
         and (public.can_read_all_scopes() or public.has_scope(universe_id, id, null)
              or public.has_active_share(universe_id)));

-- engagements_select: the read-all-scopes right (D1) plus the share projection. No new write path.
drop policy if exists engagements_select on engagements;
create policy engagements_select on engagements for select to authenticated
  using (org_id = public.jwt_org_id()
         and (public.can_read_all_scopes() or public.has_scope(universe_id, entity_id, id)
              or public.has_active_share(universe_id)));

-- 3d. Grant, revoke and read.
create or replace function public.share_grant(
  p_universe_id uuid, p_grantee_user_id uuid, p_expires_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not public.is_head(1) then
    raise exception 'not allowed: a share is granted by a Level-1 or Level-2 Head' using errcode = 'P0001';
  end if;
  if not exists (select 1 from universes u where u.id = p_universe_id and u.org_id = v_org) then
    raise exception 'universe not found in this organisation' using errcode = 'P0001';
  end if;
  if not exists (select 1 from org_members m where m.org_id = v_org and m.user_id = p_grantee_user_id) then
    raise exception 'the grantee is not a member of this organisation' using errcode = 'P0001';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'the share expiry must be in the future' using errcode = 'P0001';
  end if;
  insert into universe_shares (org_id, universe_id, grantee_user_id, granted_by, expires_at)
  values (v_org, p_universe_id, p_grantee_user_id, auth.uid(), p_expires_at)
  returning id into v_id;

  -- In-app notification to the grantee, and an email through the queue (§2).
  insert into notifications (org_id, user_id, kind, body, event_key, role_target)
  values (v_org, p_grantee_user_id, 'share.granted',
          'A universe was shared with you (view-only).', 'share.granted', 'all');
  perform public.queue_email(v_org, array[]::text[],
    'A universe was shared with you',
    '<p>A universe was shared with you view-only.</p>',
    'A universe was shared with you view-only.',
    jsonb_build_object('event_key', 'share.granted', 'share_id', v_id));

  perform public.append_ledger_entry(v_org, 'share_granted',
    jsonb_build_object('share_id', v_id, 'universe_id', p_universe_id, 'grantee', p_grantee_user_id),
    auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'share_granted', 'universe', p_universe_id,
          jsonb_build_object('share_id', v_id, 'grantee', p_grantee_user_id));
  return v_id;
end $$;

create or replace function public.share_revoke(p_share_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_share universe_shares;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  select * into v_share from universe_shares where id = p_share_id and org_id = v_org;
  if v_share.id is null then
    raise exception 'share not found in this organisation' using errcode = 'P0001';
  end if;
  if v_share.revoked_at is not null then
    raise exception 'the share is already revoked' using errcode = 'P0001';
  end if;
  -- Revocable by the granting Head, a higher Head, or an Org Admin.
  if not (public.is_org_admin()
          or auth.uid() = v_share.granted_by
          or public.caller_head_level() > coalesce(
               (select m.head_level from org_members m
                 where m.org_id = v_org and m.user_id = v_share.granted_by), 0)) then
    raise exception 'not allowed: revoke requires the granting Head, a higher Head or an Org Admin'
      using errcode = 'P0001';
  end if;
  update universe_shares set revoked_at = now(), revoke_reason = coalesce(p_reason, '')
   where id = p_share_id and org_id = v_org;
  perform public.append_ledger_entry(v_org, 'share_revoked',
    jsonb_build_object('share_id', p_share_id, 'reason', coalesce(p_reason, '')), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'share_revoked', 'universe', v_share.universe_id,
          jsonb_build_object('share_id', p_share_id, 'reason', coalesce(p_reason, '')));
end $$;

-- The shares this org has granted (a Head or an Org Admin sees them).
create or replace function public.shares_get() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'universe_id', s.universe_id, 'universe_name', u.name,
           'grantee_user_id', s.grantee_user_id, 'granted_by', s.granted_by,
           'granted_at', s.granted_at, 'expires_at', s.expires_at,
           'revoked_at', s.revoked_at, 'revoke_reason', s.revoke_reason)
         order by s.granted_at desc, s.id), '[]'::jsonb)
  from universe_shares s
  join universes u on u.id = s.universe_id
  where s.org_id = public.jwt_org_id()
$$;

-- The shares granted TO the caller (the grantee's view).
create or replace function public.shares_with_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'universe_id', s.universe_id, 'universe_name', u.name,
           'granted_by', s.granted_by, 'granted_at', s.granted_at,
           'expires_at', s.expires_at, 'live', (s.revoked_at is null and (s.expires_at is null or s.expires_at > now())))
         order by s.granted_at desc, s.id), '[]'::jsonb)
  from universe_shares s
  join universes u on u.id = s.universe_id
  where s.org_id = public.jwt_org_id() and s.grantee_user_id = auth.uid()
$$;

-- The read-only projection of a shared universe, and the access log entry. The projection returns
-- the universe with its entities and engagements, and nothing writable. Only a live share to the
-- caller is honoured; a revoked or expired share returns an empty projection and does not log.
create or replace function public.shared_universe_view(p_share_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_share universe_shares;
  v_result jsonb;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  select * into v_share from universe_shares
   where id = p_share_id and org_id = v_org and grantee_user_id = auth.uid();
  if v_share.id is null then
    raise exception 'share not found for this caller' using errcode = 'P0001';
  end if;
  if v_share.revoked_at is not null or (v_share.expires_at is not null and v_share.expires_at <= now()) then
    return jsonb_build_object('universe_id', v_share.universe_id, 'entities', '[]'::jsonb,
                              'engagements', '[]'::jsonb, 'live', false);
  end if;
  insert into share_access_log (org_id, share_id, viewer_id, universe_id)
  values (v_org, v_share.id, auth.uid(), v_share.universe_id);
  select jsonb_build_object(
           'universe_id', v_share.universe_id,
           'live', true,
           'entities', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'status', e.status)
                          order by e.name) from entities e where e.universe_id = v_share.universe_id), '[]'::jsonb),
           'engagements', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'stage', g.stage)
                              order by g.title) from engagements g where g.universe_id = v_share.universe_id), '[]'::jsonb))
    into v_result;
  return v_result;
end $$;

-- Grants: application roles only, never anon.
revoke execute on function public.testing_lock_active(uuid) from public, anon;
revoke execute on function public.preflight_acknowledge(uuid, text, text, text) from public, anon;
revoke execute on function public.preflight_acks_get(uuid) from public, anon;
revoke execute on function public.caller_head_level() from public, anon;
revoke execute on function public.is_head(int) from public, anon;
revoke execute on function public.admin_set_head_level(uuid, int) from public, anon;
revoke execute on function public.has_active_share(uuid) from public, anon;
revoke execute on function public.share_covers(uuid, uuid, uuid) from public, anon;
revoke execute on function public.share_grant(uuid, uuid, timestamptz) from public, anon;
revoke execute on function public.share_revoke(uuid, text) from public, anon;
revoke execute on function public.shares_get() from public, anon;
revoke execute on function public.shares_with_me() from public, anon;
revoke execute on function public.shared_universe_view(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 4. Table grants. The shim (local) and the hosted project grant anon/authenticated DML on new
--    tables by default; the hardening migration 0083 revoked that for anon. These three tables are
--    tenant data, so they follow the 0008 convention: authenticated gets SELECT (RLS filters the
--    rows), no direct DML (every write is through an RPC), and platform_admin keeps SELECT so the
--    platform-blind zero-row proofs read an empty set rather than failing on privilege.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.preflight_acks from public, anon, authenticated;
revoke insert, update, delete on public.universe_shares from public, anon, authenticated;
revoke insert, update, delete on public.share_access_log from public, anon, authenticated;
grant select on public.preflight_acks to authenticated, platform_admin;
grant select on public.universe_shares to authenticated, platform_admin;
grant select on public.share_access_log to authenticated, platform_admin;
revoke all on public.preflight_acks from anon;
revoke all on public.universe_shares from anon;
revoke all on public.share_access_log from anon;
