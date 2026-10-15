-- 2D: seed roles cannot be deleted; an in-use role cannot be deleted; every role change is logged in a hash chain.
create or replace function public.roles_delete_guard() returns trigger
language plpgsql as $$
begin
  if old.is_seed then
    raise exception 'seed roles cannot be deleted';
  end if;
  if exists (select 1 from org_members om where om.role_id = old.id) then
    raise exception 'role is in use; reassign its members first';
  end if;
  return old;
end $$;


drop trigger if exists roles_delete_guard on roles;
create trigger roles_delete_guard before delete on roles
for each row execute function public.roles_delete_guard();


create table if not exists role_config_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references orgs(id),
  entity text not null,
  entity_id uuid,
  action text not null check (action in ('insert','update','delete')),
  payload jsonb not null,
  actor uuid,
  prev_hash text,
  row_hash text not null,
  created_at timestamptz not null default now()
);


alter table role_config_log enable row level security;
drop policy if exists rcl_select on role_config_log;
create policy rcl_select on role_config_log for select using (org_id = public.jwt_org_id());


create or replace function public.role_config_log_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'role_config_log is append-only';
end $$;


drop trigger if exists role_config_log_no_change on role_config_log;
create trigger role_config_log_no_change before update or delete on role_config_log
for each row execute function public.role_config_log_append_only();


create or replace function public.roles_config_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_entity_id uuid;
  v_payload jsonb;
  v_action text;
  v_prev text;
  v_body text;
begin
  if tg_op = 'DELETE' then
    v_org := old.org_id; v_entity_id := old.id; v_payload := to_jsonb(old); v_action := 'delete';
  else
    v_org := new.org_id; v_entity_id := new.id; v_payload := to_jsonb(new); v_action := lower(tg_op);
  end if;
  perform pg_advisory_xact_lock(hashtext(v_org::text));
  select rcl.row_hash into v_prev from role_config_log rcl where rcl.org_id = v_org order by rcl.id desc limit 1;
  v_body := coalesce(v_prev, '') || '|' || v_action || '|' || v_payload::text;
  insert into role_config_log (org_id, entity, entity_id, action, payload, actor, prev_hash, row_hash)
  values (v_org, 'role', v_entity_id, v_action, v_payload, auth.uid(), v_prev,
          encode(sha256(convert_to(v_body, 'UTF8')), 'hex'));
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;


drop trigger if exists roles_config_log on roles;
create trigger roles_config_log after insert or update or delete on roles
for each row execute function public.roles_config_log();
