-- 0007: SQL functions.
-- Identity is read from the JWT only (L2, spec §4.5, §25.2). No function reads an org from a
-- request header or body. All functions are SECURITY DEFINER with a fixed search_path.

-- ---------------------------------------------------------------------------
-- Identity helpers (JWT claims, set by the auth hook — D6).
--   org_id    : the caller's organisation.
--   user_role : the caller's application role (cia, org_admin, ...).
-- `role` is reserved by Supabase for the Postgres role, so the app role uses `user_role`.
-- ---------------------------------------------------------------------------
create or replace function public.jwt_org_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'org_id', '')::uuid
$$;

create or replace function public.jwt_user_role() returns text
language sql stable as $$
  select coalesce(auth.jwt() ->> 'user_role', '')
$$;

create or replace function public.is_cia() returns boolean
language sql stable as $$ select public.jwt_user_role() = 'cia' $$;

create or replace function public.is_org_admin() returns boolean
language sql stable as $$ select public.jwt_user_role() = 'org_admin' $$;

-- A caller with no org claim has no tenant and sees nothing.
create or replace function public.has_org() returns boolean
language sql stable as $$ select public.jwt_org_id() is not null $$;

-- ---------------------------------------------------------------------------
-- Scope helper. SECURITY DEFINER so it can read user_scopes and engagement_members
-- without recursion through their own RLS. This is the only path to a scope check.
-- ---------------------------------------------------------------------------
create or replace function public.has_scope(
  p_universe_id uuid,
  p_entity_id uuid,
  p_engagement_id uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select
    exists (
      select 1 from user_scopes s
      where s.org_id = public.jwt_org_id()
        and s.user_id = auth.uid()
        and (
          (s.universe_id   is not null and s.universe_id   = p_universe_id)
          or (s.entity_id  is not null and s.entity_id     = p_entity_id)
          or (s.engagement_id is not null and s.engagement_id = p_engagement_id)
        )
    )
    or (
      p_engagement_id is not null and exists (
        select 1 from engagement_members m
        where m.org_id = public.jwt_org_id()
          and m.user_id = auth.uid()
          and m.engagement_id = p_engagement_id
      )
    )
$$;

-- ---------------------------------------------------------------------------
-- Rights helper. Reads the caller's role rights from org_members + roles.
-- ---------------------------------------------------------------------------
create or replace function public.caller_has_right(p_right text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(bool_or(coalesce((r.rights ->> p_right)::boolean, false)), false)
  from org_members m
  join roles r on r.id = m.role_id
  where m.org_id = public.jwt_org_id() and m.user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Ledger append. Bypasses RLS by design (the chain trigger computes seq/hash).
-- Application roles have no direct INSERT privilege on ledger_entries.
-- ---------------------------------------------------------------------------
create or replace function public.append_ledger_entry(
  p_org_id uuid,
  p_action text,
  p_payload jsonb,
  p_actor_id uuid default null
) returns ledger_entries
language plpgsql security definer set search_path = public as $$
declare
  e ledger_entries;
begin
  insert into ledger_entries (org_id, prev_hash, hash, payload_hash, actor_id, action, payload)
  values (p_org_id, '', '', '', coalesce(p_actor_id, auth.uid()), p_action, coalesce(p_payload, '{}'::jsonb))
  returning * into e;
  return e;
end $$;

-- ---------------------------------------------------------------------------
-- verify_ledger: null when the chain is intact, else the first broken seq.
-- Checks both the recomputed hash and that prev_hash links to the previous row.
-- ---------------------------------------------------------------------------
create or replace function public.verify_ledger(p_org_id uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_expected_prev text := repeat('0', 64);
  v_canonical text;
  v_payload_hash text;
  v_expected_hash text;
begin
  for r in
    select e.seq, e.prev_hash, e.hash, e.payload_hash, e.payload
    from ledger_entries e where e.org_id = p_org_id order by e.seq asc
  loop
    if r.prev_hash is distinct from v_expected_prev then
      return r.seq;
    end if;
    v_canonical := public.canonical_payload(r.payload);
    v_payload_hash := public.ledger_payload_hash(v_canonical);
    v_expected_hash := public.ledger_entry_hash(r.prev_hash, v_payload_hash, v_canonical);
    if r.payload_hash is distinct from v_payload_hash or r.hash is distinct from v_expected_hash then
      return r.seq;
    end if;
    v_expected_prev := r.hash;
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- reopen_engagement (D2). Requires can_reopen and a >=10-character justification
-- after trimming. Clears the seal inside this transaction, logs to activity_log and
-- writes a ledger row. The sealed-row triggers only allow updates while a reopen
-- grant for this transaction exists.
-- ---------------------------------------------------------------------------
create or replace function public.reopen_engagement(
  p_engagement_id uuid,
  p_justification text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_just text := btrim(coalesce(p_justification, ''));
begin
  if length(v_just) < 10 then
    raise exception 'reopen_engagement: justification must be at least 10 characters'
      using errcode = 'P0001';
  end if;

  if not public.caller_has_right('can_reopen') then
    raise exception 'reopen_engagement: caller lacks the can_reopen right' using errcode = 'P0001';
  end if;

  select org_id into v_org from engagements where id = p_engagement_id;
  if v_org is null then
    raise exception 'reopen_engagement: engagement % not found', p_engagement_id using errcode = 'P0001';
  end if;
  if v_org is distinct from public.jwt_org_id() then
    raise exception 'reopen_engagement: engagement is outside the caller''s organisation' using errcode = 'P0001';
  end if;

  insert into reopen_grants (org_id, engagement_id, txid) values (v_org, p_engagement_id, txid_current());

  update engagements set sealed = false where id = p_engagement_id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'engagement_reopen', 'engagement', p_engagement_id,
          jsonb_build_object('justification', v_just));

  perform public.append_ledger_entry(
    v_org, 'engagement_reopen',
    jsonb_build_object('engagement_id', p_engagement_id::text, 'justification', v_just),
    auth.uid());
end $$;
