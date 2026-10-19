-- 0064: email dispatcher and its schedule (M-3, F6, F21).
--
-- The queue (email_queue, 0039) and the sender profiles (email_sender_profiles, 0054) already
-- exist, and 0056 already added the claim/complete RPCs the dispatcher calls. What is missing is
-- the way the dispatcher is reached: the URL and the dispatch token live in Vault, and a pg_cron
-- job calls the email-dispatch Edge Function every minute with the token in an x-dispatch-token
-- header. The publishable key alone must not be enough (F6), so the function rejects a request whose
-- header does not match the Vault secret.
--
-- M1: grepped supabase/migrations and supabase/tests. `email_dispatch_state` (0054) and
--     `email_dispatch_claim`/`email_dispatch_complete` (0056) exist; this migration extends the
--     state table with the URL and re-registers the schedule, and does not redefine those RPCs.
--     `cron` and `net` schemas are Supabase-provided; neither exists on a bare local Postgres, so
--     every use is behind an existence check and the migration still applies without them.
-- M2: create or replace, add column if not exists, drop ... if exists before create, unschedule
--     before schedule, create extension if not exists.

-- ---------------------------------------------------------------------------
-- 1. Dispatcher state: the project URL and the function name. The token stays in Vault (F5); the
--    table holds only the secret id and a masked display.
-- ---------------------------------------------------------------------------
alter table email_dispatch_state add column if not exists project_url text;
alter table email_dispatch_state add column if not exists function_name text not null default 'email-dispatch';
alter table email_dispatch_state add column if not exists token_masked text;
alter table email_dispatch_state add column if not exists schedule_name text not null default 'email-dispatch';
alter table email_dispatch_state add column if not exists enabled boolean not null default true;
alter table email_dispatch_state add column if not exists pending_expired_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. email_dispatch_set_token — the platform admin (or the service role) stores the dispatch token in
--    Vault and records only the secret id and a mask. The value never returns. SECURITY DEFINER so a
--    platform RPC can reach vault.create_secret; executable by service_role only (the wizard's Edge
--    path), never by a tenant session.
-- ---------------------------------------------------------------------------
create or replace function public.email_dispatch_set_token(
  p_project_url text, p_token text, p_masked text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_vault_id uuid; v_row_id uuid;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'a dispatch token is required' using errcode = 'P0001';
  end if;
  if not public.vault_available() then
    raise exception 'vault is not available on this deployment' using errcode = 'P0001';
  end if;
  execute 'select vault.create_secret($1, $2)' into v_vault_id
    using p_token, 'email-dispatch-token';
  -- A secret_store row points at the Vault value so the reader and the mask have one place to look.
  insert into secret_store (org_id, label, masked, vault_id)
  values (null, 'email-dispatch-token', coalesce(p_masked, public.secret_mask_value(right(p_token, 4))), v_vault_id)
  returning id into v_row_id;
  update email_dispatch_state
     set dispatch_token_secret_id = v_row_id,
         project_url = coalesce(p_project_url, project_url),
         token_masked = (select masked from secret_store where id = v_row_id),
         updated_at = now()
   where id = true;
  return v_row_id;
end $$;

-- The token read back for the schedule's net.http_post header. Service-role only, never a UI path.
-- Vault is reached through dynamic SQL: a static reference to vault.decrypted_secrets would fail to
-- create on a deployment without Vault (M2), and 0054 uses the same technique for vault.create_secret.
create or replace function public.email_dispatch_token() returns text
language plpgsql stable security definer set search_path = public as $$
declare v_secret_id uuid; v_vault_id uuid; v_ciphertext text; v_value text;
begin
  select dispatch_token_secret_id into v_secret_id from email_dispatch_state where id = true;
  if v_secret_id is null then
    return null;
  end if;
  select vault_id, ciphertext into v_vault_id, v_ciphertext from secret_store where id = v_secret_id;
  if v_vault_id is not null and public.vault_available() then
    execute 'select decrypted_secret from vault.decrypted_secrets where id = $1'
      into v_value using v_vault_id;
    return v_value;
  end if;
  return v_ciphertext;
end $$;

-- ---------------------------------------------------------------------------
-- 3. platform_email_app — the ONE multi-tenant Microsoft app (F6). The client id and tenant id are
--    not secret and live here; the client secret and the delegated refresh token live in Vault and
--    this table keeps only their secret ids. Entered by the Super Admin in SA-04.
-- ---------------------------------------------------------------------------
create table if not exists platform_email_app (
  id boolean primary key default true
);
alter table platform_email_app add column if not exists client_id text;
alter table platform_email_app add column if not exists tenant_id text;
alter table platform_email_app add column if not exists redirect_uri text;
alter table platform_email_app add column if not exists client_secret_id uuid;
alter table platform_email_app add column if not exists refresh_secret_id uuid;
alter table platform_email_app add column if not exists updated_at timestamptz not null default now();

alter table platform_email_app enable row level security;
drop policy if exists pea_platform on platform_email_app;
create policy pea_platform on platform_email_app for select to authenticated
  using (public.is_platform_admin());

insert into platform_email_app (id) values (true) on conflict (id) do nothing;

-- The client id and secret the graph-oauth Edge Function reads. SECURITY DEFINER, service_role only
-- for the secret; the client id is readable by the platform admin too (it is not a secret).
create or replace function public.graph_client_id() returns text
language sql stable security definer set search_path = public as $$
  select client_id from platform_email_app where id = true
$$;

create or replace function public.graph_client_secret() returns text
language plpgsql stable security definer set search_path = public as $$
declare v_secret_id uuid; v_vault_id uuid; v_ciphertext text; v_value text;
begin
  select client_secret_id into v_secret_id from platform_email_app where id = true;
  if v_secret_id is null then return null; end if;
  select vault_id, ciphertext into v_vault_id, v_ciphertext from secret_store where id = v_secret_id;
  if v_vault_id is not null and public.vault_available() then
    execute 'select decrypted_secret from vault.decrypted_secrets where id = $1'
      into v_value using v_vault_id;
    return v_value;
  end if;
  return v_ciphertext;
end $$;

-- The Super Admin saves the app registration. The secret is passed to the Edge Function, which
-- encrypts it and calls secret_store_ref; this RPC only records the ids and the public fields.
create or replace function public.graph_app_save(
  p_client_id text, p_tenant_id text, p_redirect_uri text,
  p_client_secret_id uuid default null, p_refresh_secret_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed: platform administrator only' using errcode = 'P0001';
  end if;
  update platform_email_app
     set client_id = coalesce(p_client_id, client_id),
         tenant_id = coalesce(p_tenant_id, tenant_id),
         redirect_uri = coalesce(p_redirect_uri, redirect_uri),
         client_secret_id = coalesce(p_client_secret_id, client_secret_id),
         refresh_secret_id = coalesce(p_refresh_secret_id, refresh_secret_id),
         updated_at = now()
   where id = true;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Expire pending rows older than 7 days (F6). Called by the dispatcher before it claims, and by
--    the hourly sweep. Idempotent and cheap: only rows still pending are touched.
-- ---------------------------------------------------------------------------
create or replace function public.email_expire_stale(p_days int default 7) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  with aged as (
    update email_queue
       set status = 'expired', error_text = 'expired: pending for more than 7 days'
     where status = 'pending' and created_at < now() - make_interval(days => greatest(coalesce(p_days, 7), 1))
     returning 1
  )
  select count(*) into v_n from aged;
  update email_dispatch_state set pending_expired_at = now(), updated_at = now() where id = true;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The schedule. `cron.schedule` every minute calls net.http_post to the Edge Function with the
--    token header. Both extensions are Supabase-provided; on a bare Postgres they are unavailable, so
--    each create is guarded and the rest of the migration still applies (M2). Re-scheduling drops the
--    old job first.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and not exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute 'create extension pg_cron';
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net')
     and not exists (select 1 from pg_extension where extname = 'pg_net') then
    execute 'create extension pg_net';
  end if;
end $$;

do $$
declare
  v_url text;
  v_token text;
  v_fn text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_cron or pg_net is not available; the email-dispatch schedule was not created (F21).';
    return;
  end if;

  select project_url, function_name into v_url, v_fn from email_dispatch_state where id = true;
  if v_url is null then
    raise notice 'email_dispatch_state.project_url is not set; the email-dispatch schedule was not created.';
    return;
  end if;

  v_token := public.email_dispatch_token();
  if v_token is null then
    raise notice 'the dispatch token is not set; the email-dispatch schedule was not created.';
    return;
  end if;

  -- M2: unschedule above re-scheduling so a repeat apply never duplicates the job.
  begin
    perform cron.unschedule('email-dispatch');
  exception when others then
    null;  -- no such job yet
  end;

  perform cron.schedule('email-dispatch', '* * * * *', format(
    $job$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-dispatch-token', %L), body := '{}'::jsonb)$job$,
    rtrim(v_url, '/') || '/functions/v1/' || v_fn,
    v_token
  ));
end $$;

-- The hourly sweep job: expiry and the pending-grant sweep (F21).
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  begin
    perform cron.unschedule('email-expiry-sweep');
  exception when others then
    null;
  end;
  perform cron.schedule('email-expiry-sweep', '0 * * * *',
    $job$select public.email_expire_stale(7)$job$);
end $$;

-- ---------------------------------------------------------------------------
-- 5. M7 repair: 0056's dispatcher guard cannot pass. `email_dispatch_claim` and
--    `email_dispatch_complete` are SECURITY DEFINER and owned by the migration role, so `current_user`
--    inside them is the owner, never 'service_role'. The dispatcher (service_role through PostgREST)
--    therefore always fell through to the platform-admin branch and was refused. Redefine both with the
--    same body but a guard that also accepts the service-role JWT (`auth.role()`), which survives the
--    SECURITY DEFINER switch because the request claims are unchanged. M4: drop the old signature above.
-- ---------------------------------------------------------------------------
drop function if exists public.email_dispatch_claim(int);
create or replace function public.email_dispatch_claim(p_limit int default 10)
returns setof email_queue
language plpgsql security definer set search_path = public as $$
begin
  if not (current_user = 'service_role' or auth.role() = 'service_role'
          or public.is_platform_admin()) then
    raise exception 'not allowed: only the dispatcher claims email' using errcode = 'P0001';
  end if;
  return query
    select * from email_queue q
     where q.status = 'pending'
       and (q.next_attempt_at is null or q.next_attempt_at <= now())
       and q.created_at > now() - interval '7 days'
     order by q.created_at
     limit least(coalesce(p_limit, 10), 50);
end $$;

drop function if exists public.email_dispatch_complete(uuid, text, text, int, text, text);
create or replace function public.email_dispatch_complete(
  p_id uuid, p_status text, p_provider text default null, p_response_code int default null,
  p_provider_message_id text default null, p_error text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_attempts int;
begin
  if not (current_user = 'service_role' or auth.role() = 'service_role'
          or public.is_platform_admin()) then
    raise exception 'not allowed: only the dispatcher completes email' using errcode = 'P0001';
  end if;

  select attempts + 1 into v_attempts from email_queue where id = p_id;

  if p_status = 'sent' then
    update email_queue
       set status = 'sent', sent_at = now(), attempts = v_attempts, error_text = null,
           provider = p_provider, response_code = p_response_code,
           provider_message_id = p_provider_message_id, next_attempt_at = null
     where id = p_id;
  else
    update email_queue
       set status = case when v_attempts >= 5 then 'failed' else 'pending' end,
           attempts = v_attempts, error_text = public.mask_secrets_text(p_error),
           provider = p_provider, response_code = p_response_code,
           next_attempt_at = case v_attempts
             when 1 then now() + interval '1 minute'
             when 2 then now() + interval '5 minutes'
             when 3 then now() + interval '15 minutes'
             when 4 then now() + interval '60 minutes'
             else now() + interval '240 minutes' end
     where id = p_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants. The token setter and reader are service_role only; the sweep is callable by the platform.
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('email_dispatch_set_token','email_dispatch_token')
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from authenticated', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to service_role', fn.name, fn.args);
  end loop;

  -- M7 repair: 0056's grant loop revoked these from public and anon but not from authenticated, so
  -- the default grant to authenticated survived. The dispatcher's claim/complete and the engine run
  -- are service_role surfaces; close the hole here rather than editing 0056's meaning.
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'email_dispatch_claim','email_dispatch_complete','rule_engine_process')
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from authenticated', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to service_role', fn.name, fn.args);
  end loop;

  -- The Microsoft app secret is service_role only; the client id and the save RPC are the platform
  -- admin's. graph_app_save is definer and re-checks is_platform_admin.
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('graph_client_secret')
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from authenticated', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to service_role', fn.name, fn.args);
  end loop;

  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('graph_client_id','graph_app_save','email_expire_stale')
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to authenticated', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to service_role', fn.name, fn.args);
  end loop;
end $$;
