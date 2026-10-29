-- 0117: the guided first run (U6).
--
-- "A new org's dashboard should not be a wall of zeros. It should say 'Create your first universe'
-- with one button." (SYSTELIGON.md §11.1c Tier 2 item 7.) Two things are missing for that to be
-- real rather than decorative:
--
--   1. create_universe — there is no way to create a universe anywhere. Every screen that writes
--      reads an EXISTING universe; an org with none is stuck (add_entity requires a universe, and
--      deploy_engagement requires an entity). The 0008 universes_write policy lets a cia/org_admin
--      INSERT directly, but nothing in src/ ever does, so the first-run "Create your first universe"
--      button has no write path behind it. This adds the thin, right-checked, ledger-writing RPC in
--      the shape the repo already uses (jwt_org_id + caller_has_right + append_ledger_entry).
--
--   2. get_org_data_state — the ONE fact the guided empty state needs: does this organisation hold
--      any universe yet? A brand-new org must not read as a wall of zeros. This returns COUNTS and a
--      boolean, never a row of tenant content, so an integrity owner who may already read all scopes
--      can ask it without it widening any read (Law L2).
--
-- Laws: L2 (counts and booleans only), rights not role names, idempotent (applied twice by the
-- harness), additive only, security-definer RPCs with an explicit caller check. Nothing reads the
-- clock.

-- ---------------------------------------------------------------------------
-- create_universe: the first-run action. Requires edit_config (the same right the add-entity form
-- requires), writes the row, the activity_log entry and the ledger entry, and returns the new id.
-- ---------------------------------------------------------------------------
create or replace function public.create_universe(
  p_name text,
  p_domain text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_domain text := nullif(btrim(coalesce(p_domain, '')), '');
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('edit_config'), false) then
    raise exception 'not allowed: caller lacks the edit_config right to create a universe'
      using errcode = 'P0001';
  end if;
  if v_name = '' then
    raise exception 'a universe needs a name' using errcode = 'P0001';
  end if;

  insert into universes (org_id, name, domain)
  values (v_org, v_name, v_domain)
  returning id into v_id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'universe_created', 'universe', v_id,
          jsonb_build_object('name', v_name, 'domain', v_domain));

  perform public.append_ledger_entry(
    v_org, 'config_changed',
    jsonb_build_object('universe_id', v_id::text, 'name', v_name, 'domain', v_domain),
    auth.uid());

  return v_id;
end $$;

comment on function public.create_universe(text, text) is
  'U6: create a universe in the caller''s organisation (the first-run action). Requires edit_config; '
  'writes the row, an activity_log entry and a ledger entry. Returns the new universe id.';

revoke execute on function public.create_universe(text, text) from public, anon;
grant execute on function public.create_universe(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_org_data_state: the one fact the guided empty state needs — is this organisation new? Returns
-- COUNTS and a boolean, never a row of tenant content (Law L2). Available to any signed-in member,
-- because a brand-new org's members hold no audit right yet and must still see the guided state.
-- ---------------------------------------------------------------------------
create or replace function public.get_org_data_state()
returns table (universes int, entities int, engagements int, is_empty boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_universes int := 0;
  v_entities int := 0;
  v_engagements int := 0;
begin
  if v_org is not null then
    select count(*) into v_universes from universes where org_id = v_org;
    select count(*) into v_entities from entities where org_id = v_org;
    select count(*) into v_engagements from engagements where org_id = v_org;
  end if;
  return query select v_universes, v_entities, v_engagements,
                      (v_universes = 0 and v_entities = 0 and v_engagements = 0);
end $$;

comment on function public.get_org_data_state() is
  'U6: whether the caller''s organisation is still empty (no universe, entity or engagement) and the '
  'counts behind that answer. Counts and a boolean only — never a row of tenant content (Law L2).';

revoke execute on function public.get_org_data_state() from public, anon;
grant execute on function public.get_org_data_state() to authenticated;
