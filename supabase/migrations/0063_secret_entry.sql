-- 0063: secret entry through an encrypted Edge Function (M-2, F5).
--
-- M1: grepped supabase/migrations and supabase/tests for secret_store, secret_put, secret_display,
-- secret_reveal, secret_mask_value, secret_store_ref. All exist from 0054 (secret_store,
-- secret_put, secret_display, secret_reveal, secret_mask_value). secret_store_ref does not exist.
-- This migration extends the existing objects (M1 decision D-M2-secret-store-ref) rather than
-- creating a parallel store.
--
-- The defect this fixes: 0054's secret_put took the plaintext as a SQL argument, stored only a mask
-- and wrote a `ciphertext` column that was nullable and never filled. Nothing encrypted and nothing
-- called Vault, so every API key, SMTP password and Microsoft secret was discarded.
--
-- Fixed rule (F5): the browser never sends a secret to a SQL function. A secret goes to the
-- secrets-put Edge Function over HTTPS, which encrypts it (AES-256-GCM) or stores it in Supabase
-- Vault, and the database receives only a reference and a mask. The database never sees the value.
--
-- M2: every statement is safe to re-apply. `create or replace` for functions, `drop function if
-- exists` where a signature changes, `add column if not exists` for columns.

-- ---------------------------------------------------------------------------
-- 1. secret_store.vault_id — the id returned by vault.create_secret when Vault is present (F5).
-- ---------------------------------------------------------------------------
alter table secret_store add column if not exists vault_id uuid;

-- ---------------------------------------------------------------------------
-- 2. secret_mask_value now receives ONLY the last four characters, computed inside the Edge
--    Function. The database therefore never receives the full value (F5). The parameter is renamed,
--    so the old signature must be dropped first (M4); the grant block below restores its ACL.
-- ---------------------------------------------------------------------------
drop function if exists public.secret_mask_value(text);
create or replace function public.secret_mask_value(p_last4 text) returns text
language sql immutable as $$
  select case
    when p_last4 is null or length(p_last4) = 0 then '•••• not set'
    else '•••• ' || right(p_last4, least(4, length(p_last4)))
  end
$$;

-- ---------------------------------------------------------------------------
-- 3. secret_store_ref — the single way a secret reference enters the store. Callable by service_role
--    ONLY (the secrets-put Edge Function). It accepts no plaintext: p_ciphertext is already AES-GCM
--    output (or null when Vault holds the value) and p_masked is already masked. Replacing a label
--    marks the previous live row replaced (never deleted) and writes a configuration-history entry
--    that names the label but carries no value (F5).
-- ---------------------------------------------------------------------------
create or replace function public.secret_store_ref(
  p_org uuid, p_label text, p_ciphertext text, p_masked text, p_vault_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_org uuid := coalesce(p_org, '00000000-0000-0000-0000-000000000000'::uuid);
begin
  if p_label is null or length(trim(p_label)) = 0 then
    raise exception 'a secret label is required' using errcode = 'P0001';
  end if;
  if p_ciphertext is null and p_vault_id is null then
    raise exception 'a secret must carry either a vault id or ciphertext' using errcode = 'P0001';
  end if;

  update secret_store set replaced_at = now(), updated_at = now()
   where coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_org
     and label = p_label and replaced_at is null;

  insert into secret_store (org_id, label, ciphertext, masked, vault_id, created_by)
  values (p_org, p_label, p_ciphertext, coalesce(p_masked, '•••• not set'), p_vault_id, auth.uid())
  returning id into v_id;

  -- Configuration history: the label and the fact of replacement, never the value (F5, L5).
  if p_org is not null then
    insert into config_versions (org_id, key, value, version, actor_id)
    select p_org, 'secret:' || p_label,
           jsonb_build_object('action', 'credential_replaced', 'label', p_label),
           coalesce(max(version), 0) + 1, auth.uid()
      from config_versions where org_id = p_org and key = 'secret:' || p_label;
  end if;

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. secret_vault_store — a service-role-only wrapper over vault.create_secret, used when Vault is
--    present. Returns the vault secret id. If Vault is absent it raises, and the Edge Function falls
--    back to AES-GCM (D-S2-vault-fallback).
-- ---------------------------------------------------------------------------
create or replace function public.secret_vault_store(p_secret text, p_name text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.vault_available() then
    raise exception 'vault is not available on this deployment' using errcode = 'P0001';
  end if;
  execute 'select vault.create_secret($1, $2)' into v_id using p_secret, p_name;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Drop secret_put. Its only callers were the SQL tests, changed in the same commit (M2 step 2).
--    A plaintext-taking SQL entry point must not exist (F5).
-- ---------------------------------------------------------------------------
drop function if exists public.secret_put(uuid, text, text, text);

-- ---------------------------------------------------------------------------
-- 6. Grants. secret_store_ref and secret_vault_store are service_role only: no browser session and no
--    tenant role can reach them. secret_mask_value stays callable by authenticated (it only formats a
--    suffix). secret_display stays readable by authenticated; secret_reveal stays service_role only.
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('secret_store_ref','secret_vault_store')
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from authenticated', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to service_role', fn.name, fn.args);
  end loop;

  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('secret_mask_value','secret_display')
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to authenticated', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to service_role', fn.name, fn.args);
  end loop;
end $$;
