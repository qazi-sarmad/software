-- Provio pilot: first-organisation provisioning. Run ONCE in the Supabase SQL editor,
-- AFTER (1) running supabase/migrations/202610080001_trust.sql and
--       (2) creating the three users in Authentication > Users (email + password, "Auto confirm" on).
-- Replace the three email addresses below. Never run supabase/tests/bootstrap.sql on Supabase.
do $$
declare
  org uuid := gen_random_uuid();
  ent uuid := gen_random_uuid();
  prep uuid; rev uuid; cia uuid;
begin
  select id into prep from auth.users where email = 'preparer@example.com';
  select id into rev  from auth.users where email = 'reviewer@example.com';
  select id into cia  from auth.users where email = 'cia@example.com';
  if prep is null or rev is null or cia is null then
    raise exception 'Create the three users in Authentication > Users first, and fix the emails above.';
  end if;
  insert into public.organizations(id, name) values (org, 'Pilot organisation');
  insert into public.audit_entities(id, org_id, name) values (ent, org, 'Procurement');
  insert into public.memberships(org_id, user_id, role) values
    (org, prep, 'preparer'), (org, rev, 'reviewer'), (org, cia, 'cia');
  insert into public.entity_access(org_id, entity_id, user_id)
    select org, ent, user_id from public.memberships where org_id = org;
end $$;
