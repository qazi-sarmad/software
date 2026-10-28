-- 0103 phase2 report graph — persist the report graph root so verify_report_root has data
-- (SCALE-TASKS 2.6).
--
-- The audit (§2.2) found the graph root was never written: `report_graphs` and `report_claims`
-- (0088) are append-only and `verify_report_root` (0094) reads `report_graphs` to prove
-- tamper-evidence, but `grep -rn "report_graphs" src/ supabase/functions/` was empty. The writing
-- engine computed roots in `src/lib/writing/` and tested them, and the result was thrown away. The
-- verification chain therefore had no data to verify.
--
-- This migration adds the one writer. The database is the authority, so it does not take the caller's
-- word for the root: `report_graph_commit` recomputes every claim hash from the claim's canonical
-- facts and rebuilds the Merkle root from those hashes, and refuses a commit whose recomputed root
-- differs from the one supplied. A caller therefore cannot record a root that does not match its
-- claims. The render hash is recorded as supplied: it covers the rendered words, which are verified
-- client-side by the export bundle (W10.2) and are not part of the fact graph the root covers.
--
-- Reuse (grep first): report_graphs / report_claims / report_claim_versions (0088), report_versions
-- (0036), append_ledger_entry (0073), jwt_org_id / caller_has_right (0007-family), extensions.digest
-- (pgcrypto, the same primitive 0027 uses). Nothing is redefined; the tables take their first writer.
--
-- M2: create or replace; safe to apply repeatedly. M8: one client. Grants: application roles only.

-- ---------------------------------------------------------------------------
-- report_graph_root_of: the Merkle root over an ordered list of claim leaf hashes. Leaves carry the
-- '00' domain prefix and internal nodes '01' (W1.3), and an odd node is promoted unchanged rather
-- than duplicated, so two different claim sets cannot produce the same root. This mirrors
-- `buildMerkleTree` in src/lib/writing/merkle.ts exactly.
-- ---------------------------------------------------------------------------
create or replace function public.report_graph_root_of(p_leaf_hashes text[]) returns text
language plpgsql immutable as $$
declare
  v_level text[] := p_leaf_hashes;
  v_next text[];
  v_n int;
  i int;
begin
  v_n := coalesce(array_length(v_level, 1), 0);
  if v_n = 0 then
    return repeat('0', 64);
  end if;
  while v_n > 1 loop
    v_next := array[]::text[];
    i := 1;
    while i <= v_n loop
      if i + 1 <= v_n then
        v_next := v_next || encode(extensions.digest('01' || v_level[i] || v_level[i + 1], 'sha256'), 'hex');
      else
        v_next := v_next || v_level[i];
      end if;
      i := i + 2;
    end loop;
    v_level := v_next;
    v_n := array_length(v_level, 1);
  end loop;
  return v_level[1];
end $$;

-- ---------------------------------------------------------------------------
-- report_graph_commit: the writer. Records the graph root, the render hash and the four version
-- identifiers in report_graphs, and every claim in report_claims (whose trigger writes the
-- hash-chained report_claim_versions). Verifies the root before writing, and is idempotent: a second
-- call for the same (version, model, register, locale) returns the committed row unchanged.
--
-- p_claims is a jsonb array; each element is
--   { claim_id, section_id, position, kind, claim_level, slots, phrase_id, phrase_version,
--     rule_id, rule_version, references, figures, approval, auditor_text, canonical, claim_hash }
-- where `canonical` is the canonical text of the claim's facts (claimCanonical) and `claim_hash` is
-- its SHA-256. Both are recomputed here and must agree.
-- ---------------------------------------------------------------------------
create or replace function public.report_graph_commit(
  p_report_version_id uuid,
  p_model_id text,
  p_formality int,
  p_tone int,
  p_voice text,
  p_locale text,
  p_engine_version text,
  p_template_version text,
  p_phrase_library_version text,
  p_fixed_timestamp timestamptz,
  p_graph_root text,
  p_render_hash text,
  p_claims jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_rec report_versions;
  v_existing uuid;
  v_id uuid;
  v_leaf_hashes text[] := array[]::text[];
  v_claim jsonb;
  v_recomputed text;
  v_expected_root text;
  v_ledger ledger_entries;
  v_count int := 0;
  v_pos int := 0;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  if p_model_id is null or length(btrim(p_model_id)) = 0 then
    raise exception 'a model id is required' using errcode = 'P0001';
  end if;
  if p_voice not in ('active', 'passive') then
    raise exception 'unknown voice: %', p_voice using errcode = 'P0001';
  end if;
  if p_locale not in ('en-GB', 'en-US') then
    raise exception 'unknown locale: %', p_locale using errcode = 'P0001';
  end if;

  select * into v_rec from report_versions r where r.id = p_report_version_id and r.org_id = v_org;
  if v_rec.id is null then
    raise exception 'report version not found in this organisation' using errcode = 'P0001';
  end if;

  -- Idempotent: the same variant is committed once.
  select id into v_existing from report_graphs
   where org_id = v_org and report_version_id = p_report_version_id and model_id = p_model_id
     and formality = p_formality and tone = p_tone and voice = p_voice and locale = p_locale;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Verify every claim hash and collect the leaf hashes for the root.
  for v_claim in select value from jsonb_array_elements(coalesce(p_claims, '[]'::jsonb)) loop
    v_count := v_count + 1;
    if coalesce(v_claim ->> 'canonical', '') = '' or coalesce(v_claim ->> 'claim_hash', '') = '' then
      raise exception 'claim % is missing its canonical form or hash', v_claim ->> 'claim_id'
        using errcode = 'P0001';
    end if;
    v_recomputed := encode(extensions.digest(v_claim ->> 'canonical', 'sha256'), 'hex');
    if v_recomputed <> (v_claim ->> 'claim_hash') then
      raise exception 'claim_hash_mismatch: claim % does not hash to its recorded claim_hash',
        v_claim ->> 'claim_id' using errcode = 'P0001';
    end if;
    v_leaf_hashes := v_leaf_hashes
      || encode(extensions.digest('00' || (v_claim ->> 'canonical'), 'sha256'), 'hex');
  end loop;

  v_expected_root := public.report_graph_root_of(v_leaf_hashes);
  if v_expected_root <> p_graph_root then
    raise exception 'graph_root_mismatch: the claims hash to % but % was supplied',
      v_expected_root, p_graph_root using errcode = 'P0001';
  end if;

  -- Insert the claims (the trigger writes report_claim_versions, hash-chained).
  for v_claim in select value from jsonb_array_elements(coalesce(p_claims, '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into report_claims (
      org_id, report_version_id, claim_id, section_id, position, kind, claim_level, slots,
      phrase_id, phrase_version, rule_id, rule_version, references_json, figures, approval,
      auditor_text, claim_hash)
    values (
      v_org, p_report_version_id, v_claim ->> 'claim_id', coalesce(v_claim ->> 'section_id', ''),
      coalesce(nullif(v_claim ->> 'position', '')::int, v_pos), coalesce(v_claim ->> 'kind', 'calculated'),
      coalesce(v_claim ->> 'claim_level', 'calculated'), coalesce(v_claim -> 'slots', '[]'::jsonb),
      v_claim ->> 'phrase_id', nullif(v_claim ->> 'phrase_version', '')::int,
      v_claim ->> 'rule_id', nullif(v_claim ->> 'rule_version', '')::int,
      coalesce(v_claim -> 'references', '[]'::jsonb), coalesce(v_claim -> 'figures', '[]'::jsonb),
      v_claim -> 'approval', v_claim ->> 'auditor_text', v_claim ->> 'claim_hash');
  end loop;

  -- The ledger entry, so the root is anchored with its versions (spec §15.6).
  v_ledger := public.append_ledger_entry(
    v_org, 'report_graph_committed',
    jsonb_build_object('report_version_id', p_report_version_id::text, 'model_id', p_model_id,
                       'graph_root', p_graph_root, 'render_hash', p_render_hash,
                       'engine_version', p_engine_version, 'template_version', p_template_version,
                       'phrase_library_version', p_phrase_library_version, 'claim_count', v_count),
    auth.uid());

  insert into report_graphs (
    org_id, report_version_id, model_id, formality, tone, voice, locale, graph_root, render_hash,
    engine_version, template_version, phrase_library_version, fixed_timestamp, claim_count,
    ledger_seq, created_by)
  values (
    v_org, p_report_version_id, p_model_id, p_formality, p_tone, p_voice, p_locale, p_graph_root,
    p_render_hash, coalesce(p_engine_version, ''), coalesce(p_template_version, ''),
    coalesce(p_phrase_library_version, ''), coalesce(p_fixed_timestamp, now()), v_count,
    v_ledger.seq, auth.uid())
  returning id into v_id;

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- report_graph_get: the committed graph for one report version, for the screen's drilldown. Returns
-- the graph rows and the claim rows, so the UI shows exactly what the database holds.
-- ---------------------------------------------------------------------------
create or replace function public.report_graph_get(p_report_version_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'graphs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'model_id', g.model_id, 'formality', g.formality, 'tone', g.tone,
        'voice', g.voice, 'locale', g.locale, 'graph_root', g.graph_root,
        'render_hash', g.render_hash, 'engine_version', g.engine_version,
        'template_version', g.template_version, 'phrase_library_version', g.phrase_library_version,
        'fixed_timestamp', g.fixed_timestamp, 'claim_count', g.claim_count, 'ledger_seq', g.ledger_seq)
        order by g.model_id, g.formality, g.tone, g.voice, g.locale)
      from report_graphs g
     where g.org_id = public.jwt_org_id() and g.report_version_id = p_report_version_id), '[]'::jsonb),
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'claim_id', c.claim_id, 'section_id', c.section_id, 'position', c.position, 'kind', c.kind,
        'claim_level', c.claim_level, 'phrase_id', c.phrase_id, 'phrase_version', c.phrase_version,
        'claim_hash', c.claim_hash) order by c.position, c.claim_id)
      from report_claims c
     where c.org_id = public.jwt_org_id() and c.report_version_id = p_report_version_id), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.report_graph_root_of(text[]) from public, anon, authenticated;
revoke execute on function public.report_graph_commit(uuid, text, int, int, text, text, text, text, text, timestamptz, text, text, jsonb) from public, anon;
revoke execute on function public.report_graph_get(uuid) from public, anon;

grant execute on function public.report_graph_commit(uuid, text, int, int, text, text, text, text, text, timestamptz, text, text, jsonb) to authenticated;
grant execute on function public.report_graph_get(uuid) to authenticated;
