-- 0072: OAuth state single-use store (C1.1, F5, F6).
--
-- The graph-oauth Edge Function signs a state token (user, org, nonce, 10-minute expiry) so the
-- delegated Microsoft consent flow cannot be driven by a forged or replayed request. The signature
-- is checked in the Edge Function; the single-use property is enforced here, in the database, so a
-- captured state cannot be replayed even inside its window.
--
-- The table is written and read ONLY through oauth_state_consume, a service-role-only SECURITY
-- DEFINER function. It has RLS enabled and NO policy, so no tenant role and no platform role can
-- read or write it directly (F11, spec §25.2). The Edge Function calls it with the service role.
--
-- M1: grepped supabase/migrations and supabase/tests for oauth_state, oauth_state_nonces and
--     oauth_state_consume; no hit. New names.
-- M2: create table if not exists + add column if not exists + create or replace function, so a
--     second apply on the persistent test project is a no-op.

create table if not exists oauth_state_nonces (
  nonce text primary key
);
alter table oauth_state_nonces add column if not exists user_id uuid not null;
alter table oauth_state_nonces add column if not exists org_id uuid;
alter table oauth_state_nonces add column if not exists expires_at timestamptz not null;
alter table oauth_state_nonces add column if not exists consumed_at timestamptz not null default now();

alter table oauth_state_nonces enable row level security;
-- Deliberately no policy: the table is reachable only through the SECURITY DEFINER function below.

create index if not exists oauth_state_nonces_expires_idx on oauth_state_nonces (expires_at);

-- oauth_state_consume: record a nonce as used. Returns true when the nonce was fresh (and is now
-- consumed) and false when it was already consumed, so a replay is refused. Expired rows older than
-- a day are pruned on each call, so the table stays small without a scheduled job.
create or replace function public.oauth_state_consume(
  p_nonce text, p_user uuid, p_org uuid, p_expires_at timestamptz
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_inserted boolean := false;
begin
  if p_nonce is null or length(trim(p_nonce)) = 0 then
    raise exception 'a state nonce is required' using errcode = 'P0001';
  end if;
  if p_user is null then
    raise exception 'a user is required' using errcode = 'P0001';
  end if;

  delete from oauth_state_nonces where expires_at < now() - interval '1 day';

  insert into oauth_state_nonces (nonce, user_id, org_id, expires_at, consumed_at)
  values (p_nonce, p_user, p_org, coalesce(p_expires_at, now()), now())
  on conflict (nonce) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end $$;

-- Service role only: no browser session and no tenant role can reach it.
revoke execute on function public.oauth_state_consume(text, uuid, uuid, timestamptz) from public;
revoke execute on function public.oauth_state_consume(text, uuid, uuid, timestamptz) from anon;
revoke execute on function public.oauth_state_consume(text, uuid, uuid, timestamptz) from authenticated;
grant execute on function public.oauth_state_consume(text, uuid, uuid, timestamptz) to service_role;
