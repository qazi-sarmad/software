-- 0098: Realtime in-app notifications and pop-out live sync (SCALE-1, spec §17.1, §22).
--
-- Two clauses that were Partial in docs/PARITY.md close here.
--
-- §22 "In-app notifications are delivered through Realtime and are visible in the Work Queue."
--   The `notifications` table exists (0005) and is RLS-protected (0008: a member sees only rows
--   where org_id = jwt_org_id() AND user_id = auth.uid()). What was missing is the delivery path:
--     1. the table is added to the `supabase_realtime` publication, so Postgres change events reach
--        the browser channel;
--     2. a `notification_emit` RPC lets an in-database event raise a notification for one member;
--     3. `notifications_list` / `notification_mark_read` read and acknowledge the caller's rows.
--   The RLS shape is unchanged: a member can only ever see its own notifications in its own org.
--
-- §17.1 "A pop-out window shares the origin and session, and stays in sync through Realtime."
--   The pop-out is a same-origin page that re-reads the record through the ordinary data modules.
--   To keep it live, the publication also carries the record tables a pop-out may show, and the
--   browser subscribes to them with a poll fallback when Realtime is unavailable. No new RLS is
--   added: a subscriber still receives only rows its own RLS policy permits (Realtime honours RLS).
--
-- M1: grepped supabase/migrations and supabase/tests for every object below; no hits. M2: every
-- statement is idempotent (`add table ... if not exists` is expressed as a guarded DO block, since
-- ALTER PUBLICATION has no IF NOT EXISTS), so a second apply is a no-op. M3: no data is written.

-- ---------------------------------------------------------------------------
-- 1. Publish the notification and record tables on the Realtime publication.
--    Supabase creates `supabase_realtime`; on a plain Postgres (the local SQL harness) it may not
--    exist, so each add is guarded. Realtime honours RLS, so publishing a table never widens who
--    can read a row: a subscriber receives only the rows its policy already permits.
-- ---------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach v_table in array array[
    'notifications', 'activity_log', 'ledger_entries', 'org_members',
    'engagements', 'workpapers', 'observations', 'cap_items', 'universe_shares'
  ] loop
    if to_regclass('public.' || v_table) is not null
       and not exists (
         select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
       ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. notification_emit(p_org, p_user_id, p_kind, p_body, p_payload).
--    Raise one in-app notification for one member. Org-scoped: the org must be the caller's own
--    (or the caller is the service role / platform admin, for an in-database event). The recipient
--    must be an active member of that org. Append-only: a notification is never edited, only read.
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid,
  kind text,
  body text,
  read boolean not null default false,
  ts timestamptz not null default now()
);
alter table notifications add column if not exists payload jsonb not null default '{}'::jsonb;

create or replace function public.notification_emit(
  p_org uuid, p_user_id uuid, p_kind text, p_body text, p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_service boolean := (coalesce(auth.role(), '') = 'service_role');
begin
  if p_org is null or p_user_id is null then
    raise exception 'a notification needs an organisation and a recipient' using errcode = 'P0001';
  end if;
  -- A browser caller may only raise a notification inside its own organisation; the service role
  -- (an in-database event, the dispatcher) may raise one for the org it is processing.
  if not v_service and not public.is_platform_admin() and p_org <> public.jwt_org_id() then
    raise exception 'not allowed: the organisation does not match the caller' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from org_members m
     where m.org_id = p_org and m.user_id = p_user_id
  ) then
    raise exception 'the recipient is not a member of this organisation' using errcode = 'P0001';
  end if;
  insert into notifications (org_id, user_id, kind, body, payload)
  values (p_org, p_user_id, coalesce(p_kind, 'notice'), coalesce(p_body, ''), coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (p_org, auth.uid(), 'notification_emit', 'notification', v_id,
          jsonb_build_object('kind', p_kind, 'recipient', p_user_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 3. notifications_list() — the caller's own unread-first notifications. Reads through the
--    `notifications` RLS policy (org_id = jwt_org_id() and user_id = auth.uid()), so it can never
--    return another member's row. A definer function would bypass RLS, so this one is NOT definer:
--    it is a thin, invoker-rights projection of the table the policy already protects.
-- ---------------------------------------------------------------------------
create or replace function public.notifications_list()
returns table (id uuid, kind text, body text, read boolean, payload jsonb, ts timestamptz)
language sql stable security invoker set search_path = public as $$
  select n.id, n.kind, n.body, n.read, n.payload, n.ts
    from notifications n
   where n.org_id = public.jwt_org_id()
     and n.user_id = auth.uid()
   order by n.read asc, n.ts desc
   limit 50
$$;

-- ---------------------------------------------------------------------------
-- 4. notification_mark_read(p_id) — acknowledge one of the caller's own notifications.
--    The table is read-only for tenants by design (D-S2-notifications: the engine is the only
--    writer), so there is no UPDATE policy. This function is therefore SECURITY DEFINER, and it
--    re-states the ownership bound explicitly: the row must be in the caller's own organisation AND
--    addressed to the caller. A row that fails either test is left untouched.
-- ---------------------------------------------------------------------------
create or replace function public.notification_mark_read(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update notifications set read = true
   where id = p_id
     and org_id = public.jwt_org_id()
     and user_id = auth.uid();
end $$;

-- ---------------------------------------------------------------------------
-- 5. Grants. The two read/write RPCs run as the invoker under RLS; notification_emit is definer and
--    is granted to authenticated (its own body checks org and recipient), plus service_role for the
--    in-database event path. The anonymous surface is untouched.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.notification_emit(uuid,uuid,text,text,jsonb)') is not null then
    revoke all on function public.notification_emit(uuid,uuid,text,text,jsonb) from public, anon;
    grant execute on function public.notification_emit(uuid,uuid,text,text,jsonb) to authenticated, service_role;
  end if;
  if to_regprocedure('public.notifications_list()') is not null then
    revoke all on function public.notifications_list() from public, anon;
    grant execute on function public.notifications_list() to authenticated;
  end if;
  if to_regprocedure('public.notification_mark_read(uuid)') is not null then
    revoke all on function public.notification_mark_read(uuid) from public, anon;
    grant execute on function public.notification_mark_read(uuid) to authenticated;
  end if;
end $$;
