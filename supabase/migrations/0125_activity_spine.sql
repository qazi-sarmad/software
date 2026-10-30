-- 0116: the live activity spine (U4). The quiet stream that makes the product feel inhabited.
--
-- "Ayesha approved the SIRA cycle", "Report R-2026-014 was sealed" — a stream of what is happening in
-- the organisation, on the transport that already exists (`src/lib/liveSync.ts`: Realtime when a socket
-- is available, a bounded poll otherwise). The transport is solved; what was missing is a READ surface
-- a screen can subscribe to, and the reason the plain `activity_log` read is wrong for it.
--
-- Why a function and not the table:
--   * `activity_log_select` (0008) is `is_cia() or is_org_admin()` — the whole accountability log,
--     including the raw `detail` jsonb. The spine is a *summary* stream, not the audit log, and it
--     must not widen that read.
--   * The spine needs the actor's DISPLAY NAME, which lives on `org_members`, not on the row.
--   * The spine must never leak tenant content: `detail` is reduced to the small set of fields the
--     sentence needs (a title, a period, a stage), and every other key is dropped. Law L2.
--
-- Rights, not role names: the stream is for a caller who may read all scopes (`view_all_scopes` — the
-- audit_manager / observer / Head / cia breadth), or an integrity owner (`is_cia()` / `is_org_admin()`).
-- A scoped member (an auditee) gets an EMPTY stream, never an error: the spine is simply quiet for
-- them, because they cannot read the organisation's activity.
--
-- Laws: L2 (no tenant content leaves beyond the reduced summary), rights not role names, idempotent
-- (applied twice by the harness), additive only, and a security-definer RPC with an explicit caller
-- check. Time is a parameter (`p_since`), never read from the clock here.

create or replace function public.activity_spine_list(
  p_limit int default 40,
  p_since timestamptz default null
)
returns table (
  id uuid,
  actor_id uuid,
  actor_name text,
  action text,
  object_type text,
  object_id uuid,
  summary jsonb,
  ts timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_limit int := least(greatest(coalesce(p_limit, 40), 1), 200);
begin
  if v_org is null then
    return;
  end if;

  -- Rights, not role names. A caller who may read all scopes, or an integrity owner, sees the stream;
  -- anyone else gets an empty stream (never an error — an empty spine is a quiet product, not a fault).
  if not (public.can_read_all_scopes() or public.is_cia() or public.is_org_admin()) then
    return;
  end if;

  return query
  select
    a.id,
    a.actor_id,
    coalesce(m.display_name, 'System') as actor_name,
    a.action,
    a.object_type,
    a.object_id,
    -- Reduce `detail` to the fields a sentence may need. Everything else is dropped, so no tenant
    -- content that a screen has not already filtered can pass through the stream.
    jsonb_strip_nulls(jsonb_build_object(
      'title', a.detail -> 'title',
      'period', a.detail -> 'period',
      'stage', a.detail -> 'stage',
      'from', a.detail -> 'from',
      'to', a.detail -> 'to',
      'kind', a.detail -> 'kind',
      'severity', a.detail -> 'severity'
    )) as summary,
    a.ts
  from activity_log a
  left join org_members m on m.org_id = a.org_id and m.user_id = a.actor_id
  where a.org_id = v_org
    and (p_since is null or a.ts > p_since)
  order by a.ts desc
  limit v_limit;
end $$;

comment on function public.activity_spine_list(int, timestamptz) is
  'U4: the live activity spine — the organisation''s recent activity as a summary stream (actor, '
  'action, object, reduced detail, ts). Rights-gated to a caller who may read all scopes or an '
  'integrity owner; a scoped member gets an empty stream. Never returns tenant content beyond the '
  'reduced summary.';

revoke execute on function public.activity_spine_list(int, timestamptz) from public, anon;
grant execute on function public.activity_spine_list(int, timestamptz) to authenticated;
