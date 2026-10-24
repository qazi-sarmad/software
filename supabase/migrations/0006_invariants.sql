-- 0006: database-enforced invariants.
-- Triggers and constraints only; never application code alone (L3, L5, spec §4.4, §11.1, §26).

-- ---------------------------------------------------------------------------
-- Reopen grants (D2). Only reopen_engagement() may insert here, and application
-- roles hold no INSERT grant on this table, so the sealed-row guard cannot be
-- forged by a client setting a session variable.
-- ---------------------------------------------------------------------------
create table if not exists reopen_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  engagement_id uuid not null,
  txid bigint not null,
  granted_at timestamptz not null default now()
);

create or replace function public.reopen_granted(p_engagement_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from reopen_grants g
    where g.engagement_id = p_engagement_id and g.txid = txid_current()
  )
$$;

-- ---------------------------------------------------------------------------
-- 1. Append-only tables (L5). UPDATE and DELETE are refused for every role.
-- ---------------------------------------------------------------------------
create or replace function public.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'append_only_violation: % is append-only (no % allowed)', tg_table_name, tg_op
    using errcode = 'P0001';
end $$;

drop trigger if exists plan_versions_append_only on plan_versions;
create trigger plan_versions_append_only before update or delete on plan_versions
  for each row execute function public.forbid_mutation();

drop trigger if exists ledger_entries_append_only on ledger_entries;
create trigger ledger_entries_append_only before update or delete on ledger_entries
  for each row execute function public.forbid_mutation();

drop trigger if exists activity_log_append_only on activity_log;
create trigger activity_log_append_only before update or delete on activity_log
  for each row execute function public.forbid_mutation();

drop trigger if exists config_versions_append_only on config_versions;
create trigger config_versions_append_only before update or delete on config_versions
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------------------
-- 2. Population gate (L3, spec §11.1).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_population_gate() returns trigger
language plpgsql as $$
declare
  pop_status text;
  pop_sha text;
begin
  select p.status, p.sha256 into pop_status, pop_sha
  from populations p where p.id = new.population_id;

  if pop_status is null then
    raise exception 'population_gate: population % not found', new.population_id using errcode = 'P0001';
  end if;
  if pop_status <> 'verified' then
    raise exception 'population_gate: population % is not verified (status=%)', new.population_id, pop_status
      using errcode = 'P0001';
  end if;
  if pop_sha is distinct from new.population_sha256 then
    raise exception 'population_gate: population_sha256 does not match the verified population hash'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists samples_population_gate on samples;
create trigger samples_population_gate before insert or update on samples
  for each row execute function public.enforce_population_gate();

create or replace function public.enforce_sample_row_gate() returns trigger
language plpgsql as $$
declare
  pop_status text;
  pop_sha text;
  s_sha text;
begin
  select p.status, p.sha256, s.population_sha256 into pop_status, pop_sha, s_sha
  from samples s join populations p on p.id = s.population_id
  where s.id = new.sample_id;

  if pop_status is null then
    raise exception 'population_gate: sample % not found', new.sample_id using errcode = 'P0001';
  end if;
  if pop_status <> 'verified' or pop_sha is distinct from s_sha then
    raise exception 'population_gate: sample % is not backed by a verified population', new.sample_id
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists sample_rows_population_gate on sample_rows;
create trigger sample_rows_population_gate before insert or update on sample_rows
  for each row execute function public.enforce_sample_row_gate();

-- ---------------------------------------------------------------------------
-- 3. Ledger chain (D4, spec §26).
--    canonical payload = JSON, keys sorted, UTF-8, no whitespace.
--    payload_hash = sha256(canonical); hash = sha256(prev_hash || payload_hash || canonical).
--    Genesis prev_hash = 64 zeros. seq/prev_hash/payload_hash/hash are overwritten on insert.
-- ---------------------------------------------------------------------------
create or replace function public.canonical_string(s text) returns text
language sql immutable as $$ select to_jsonb(s)::text $$;

create or replace function public.canonical_value(v jsonb) returns text
language plpgsql immutable as $$
declare
  t text := jsonb_typeof(v);
  out text;
begin
  if t = 'object' then
    select coalesce(
      '{' || string_agg(public.canonical_string(k.key) || ':' || public.canonical_value(k.value), ',' order by k.key collate "C") || '}',
      '{}')
      into out
    from jsonb_each(v) k;
    return out;
  elsif t = 'array' then
    select coalesce(
      '[' || string_agg(public.canonical_value(e.value), ',' order by e.ordinality) || ']',
      '[]')
      into out
    from jsonb_array_elements(v) with ordinality e(value, ordinality);
    return out;
  else
    -- string (quoted and escaped), number, boolean or null.
    return v::text;
  end if;
end $$;

create or replace function public.canonical_payload(payload jsonb) returns text
language sql immutable as $$ select public.canonical_value(coalesce(payload, '{}'::jsonb)) $$;

create or replace function public.ledger_payload_hash(p_canonical text) returns text
language sql immutable as $$
  select encode(extensions.digest(p_canonical, 'sha256'), 'hex')
$$;

create or replace function public.ledger_entry_hash(p_prev text, p_payload_hash text, p_canonical text)
returns text language sql immutable as $$
  select encode(extensions.digest(p_prev || p_payload_hash || p_canonical, 'sha256'), 'hex')
$$;

create or replace function public.chain_ledger_entry() returns trigger
language plpgsql as $$
declare
  v_prev text;
  v_seq bigint;
  v_canonical text;
  v_payload_hash text;
begin
  -- Ledger-copy bypass (F16). A migration runner preserves the source sequence, timestamps and
  -- hashes, and may bypass this trigger ONLY as the provio_migrator role with provio.migration_mode
  -- on. An ordinary role setting the setting changes nothing. The check is inlined so this trigger
  -- never depends on a function defined later in the migration order.
  if current_user = 'provio_migrator'
     and coalesce(current_setting('provio.migration_mode', true), '') = 'on' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.org_id::text));

  select e.hash, e.seq into v_prev, v_seq
  from ledger_entries e
  where e.org_id = new.org_id
  order by e.seq desc
  limit 1;

  v_prev := coalesce(v_prev, repeat('0', 64));
  v_seq := coalesce(v_seq, 0) + 1;

  v_canonical := public.canonical_payload(coalesce(new.payload, '{}'::jsonb));
  v_payload_hash := public.ledger_payload_hash(v_canonical);

  new.seq := v_seq;
  new.prev_hash := v_prev;
  new.payload_hash := v_payload_hash;
  new.hash := public.ledger_entry_hash(v_prev, v_payload_hash, v_canonical);
  new.ts := now();
  return new;
end $$;

drop trigger if exists ledger_entries_chain on ledger_entries;
create trigger ledger_entries_chain before insert on ledger_entries
  for each row execute function public.chain_ledger_entry();

-- ---------------------------------------------------------------------------
-- 4. Sealed engagements (D2, spec §4.4, §10.4).
-- ---------------------------------------------------------------------------
create or replace function public.is_engagement_sealed(p_engagement_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select sealed from engagements where id = p_engagement_id), false)
$$;

create or replace function public.assert_engagement_writable(p_engagement_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_engagement_id is null then
    return;
  end if;
  if public.is_engagement_sealed(p_engagement_id) and not public.reopen_granted(p_engagement_id) then
    raise exception 'sealed_engagement: engagement % is sealed and read-only', p_engagement_id
      using errcode = 'P0001';
  end if;
end $$;

create or replace function public.guard_engagement_rows() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform public.assert_engagement_writable(old.engagement_id);
    return old;
  end if;
  perform public.assert_engagement_writable(new.engagement_id);
  return new;
end $$;

drop trigger if exists workpapers_sealed_guard on workpapers;
create trigger workpapers_sealed_guard before update or delete on workpapers
  for each row execute function public.guard_engagement_rows();

drop trigger if exists observations_sealed_guard on observations;
create trigger observations_sealed_guard before update or delete on observations
  for each row execute function public.guard_engagement_rows();

create or replace function public.guard_population_child_rows() returns trigger
language plpgsql as $$
declare
  eng uuid;
begin
  select p.engagement_id into eng from populations p where p.id = coalesce(new.population_id, old.population_id);
  perform public.assert_engagement_writable(eng);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists populations_sealed_guard on populations;
create trigger populations_sealed_guard before update or delete on populations
  for each row execute function public.guard_engagement_rows();

drop trigger if exists population_rows_sealed_guard on population_rows;
create trigger population_rows_sealed_guard before update or delete on population_rows
  for each row execute function public.guard_population_child_rows();

drop trigger if exists samples_sealed_guard on samples;
create trigger samples_sealed_guard before update or delete on samples
  for each row execute function public.guard_population_child_rows();

-- sample_rows carry sample_id, which carries population_id, which carries engagement_id.
create or replace function public.guard_sample_child_rows() returns trigger
language plpgsql as $$
declare
  eng uuid;
begin
  select p.engagement_id into eng
  from samples s join populations p on p.id = s.population_id
  where s.id = coalesce(new.sample_id, old.sample_id);
  perform public.assert_engagement_writable(eng);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists sample_rows_sealed_guard on sample_rows;
create trigger sample_rows_sealed_guard before update or delete on sample_rows
  for each row execute function public.guard_sample_child_rows();

create or replace function public.guard_workpaper_child_rows() returns trigger
language plpgsql as $$
declare
  eng uuid;
begin
  select w.engagement_id into eng from workpapers w where w.id = coalesce(new.workpaper_id, old.workpaper_id);
  perform public.assert_engagement_writable(eng);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists test_rows_sealed_guard on test_rows;
create trigger test_rows_sealed_guard before update or delete on test_rows
  for each row execute function public.guard_workpaper_child_rows();

drop trigger if exists sign_offs_sealed_guard on sign_offs;
create trigger sign_offs_sealed_guard before update or delete on sign_offs
  for each row execute function public.guard_workpaper_child_rows();

-- A sealed engagement cannot be unsealed directly; only reopen_engagement() may.
create or replace function public.guard_engagement_seal() returns trigger
language plpgsql as $$
begin
  if old.sealed and not new.sealed and not public.reopen_granted(old.id) then
    raise exception 'sealed_engagement: cannot unseal engagement % outside reopen_engagement()', old.id
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists engagements_seal_guard on engagements;
create trigger engagements_seal_guard before update on engagements
  for each row execute function public.guard_engagement_seal();
