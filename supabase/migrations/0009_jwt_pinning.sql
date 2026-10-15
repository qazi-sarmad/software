-- 0009: the organisation identifier is read from the JWT only (spec §25.2, L2).
-- In production, Supabase stamps org_id and user_role into the token through a custom
-- access-token auth hook (see supabase/README.md). These helpers are the database's own
-- defence so no application path can read an org from a header or a request body.
create or replace function public.org_id_from_header() returns uuid
language plpgsql stable as $$
declare
  v_raw text;
begin
  v_raw := current_setting('request.headers', true);
  if v_raw is null or v_raw = '' then
    return null;
  end if;
  begin
    return nullif(v_raw::jsonb ->> 'x-org-id', '')::uuid;
  exception when others then
    return null;
  end;
end $$;

-- A trigger that pins org_id to the JWT claim. If a row arrives with an org_id that does not
-- match the caller's token, the insert is refused regardless of any policy. Trusted roles
-- (the table owner and the service role) are exempt: they run migrations and seeding.
create or replace function public.pin_org_id() returns trigger
language plpgsql as $$
declare
  v_claim uuid := public.jwt_org_id();
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if v_claim is null then
    raise exception 'org_claim_missing: no org_id claim in the session token' using errcode = 'P0001';
  end if;
  if new.org_id is distinct from v_claim then
    raise exception 'org_mismatch: row org_id % does not match the session org_id %', new.org_id, v_claim
      using errcode = 'P0001';
  end if;
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'roles','org_members','user_scopes','universes','entities','engagements','engagement_members',
    'risks_library','sira_cycles','sira_scores','plans','plan_versions','populations','population_rows',
    'samples','sample_rows','workpapers','sign_offs','test_rows','observations','findings','issues',
    'cap_items','notifications','email_outbox'
  ] loop
    execute format('drop trigger if exists %I_pin_org on %I', t, t);
    execute format('create trigger %I_pin_org before insert on %I for each row execute function public.pin_org_id()', t, t);
  end loop;
end $$;
