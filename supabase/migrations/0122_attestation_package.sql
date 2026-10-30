-- 0113: T3/T4 — the portable attestation package's data supply.
--
-- The cryptographic spine already exists (0096: signing_keys, signatures, timestamp_requests,
-- timestamp_tokens; 0103: report_graphs, report_claims and the Merkle root). What was missing is the
-- one read that gathers a subject's facts into the shape the package (src/lib/attestation.ts) and the
-- standalone verifier (scripts/verify-attestation.mjs) need — roots, signatures, public keys,
-- timestamps, the rule versions that scored it, and the Merkle LEAVES.
--
-- The leaves are the gap. `report_graph_commit` computes each leaf as sha256('00' || canonical) and
-- folds them to the root, but it stored only `claim_hash` (sha256(canonical)) and the canonical text
-- itself is not kept. A leaf cannot be recovered from a claim hash, so a verifier could never re-fold
-- the root. This migration stores `leaf_hash` on report_claims at commit time and redefines
-- report_graph_commit to write it. The leaf hash reveals nothing: it is a hash of a hash's pre-image
-- with a domain prefix, and the package carries leaves only, never claim text (Law L2).
--
-- Laws: L1 (deterministic, no AI), L2 (only hashes, signatures, public keys, timestamps and version
-- ids leave), rights not role names, idempotent (applied twice by the harness), additive only.

-- ---------------------------------------------------------------------------
-- 1. report_claims.leaf_hash — the domain-separated leaf, so the root can be re-folded off-database.
-- ---------------------------------------------------------------------------
alter table report_claims add column if not exists leaf_hash text not null default '';

-- ---------------------------------------------------------------------------
-- 2. report_graph_commit, redefined to record each claim's leaf hash. The signature is unchanged, so
--    the existing caller (src/data/reportGraph.ts) needs no change. Everything else is identical to
--    0103; only the claim INSERT gains the leaf hash it already computes for the root.
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
  v_leaf text;
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

  -- Insert the claims (the trigger writes report_claim_versions, hash-chained). The leaf hash is
  -- recorded so the root can be re-folded by a third party from the package alone (T3/T4).
  for v_claim in select value from jsonb_array_elements(coalesce(p_claims, '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    v_leaf := encode(extensions.digest('00' || (v_claim ->> 'canonical'), 'sha256'), 'hex');
    insert into report_claims (
      org_id, report_version_id, claim_id, section_id, position, kind, claim_level, slots,
      phrase_id, phrase_version, rule_id, rule_version, references_json, figures, approval,
      auditor_text, claim_hash, leaf_hash)
    values (
      v_org, p_report_version_id, v_claim ->> 'claim_id', coalesce(v_claim ->> 'section_id', ''),
      coalesce(nullif(v_claim ->> 'position', '')::int, v_pos), coalesce(v_claim ->> 'kind', 'calculated'),
      coalesce(v_claim ->> 'claim_level', 'calculated'), coalesce(v_claim -> 'slots', '[]'::jsonb),
      v_claim ->> 'phrase_id', nullif(v_claim ->> 'phrase_version', '')::int,
      v_claim ->> 'rule_id', nullif(v_claim ->> 'rule_version', '')::int,
      coalesce(v_claim -> 'references', '[]'::jsonb), coalesce(v_claim -> 'figures', '[]'::jsonb),
      v_claim -> 'approval', v_claim ->> 'auditor_text', v_claim ->> 'claim_hash', v_leaf);
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
-- 3. attestation_input_get — the one read that gathers a subject's facts for the package.
--
--    kind 'report_graph_root':  subject_id is the report_version_id. Returns the primary variant's
--      graph_root and render_hash, the engine/template/phrase versions, the rule packs (distinct
--      rule_id/rule_version over the claims), the Merkle leaves, the signatures, the public keys, the
--      timestamp tokens and the ledger sequence.
--    kind 'engagement_certificate': subject_id is the certificate id. Returns the cert_hash as the
--      single root, no leaves, the signatures and the timestamps.
--    kind 'board_pack_data_hash': subject_id is the board pack id. Returns data_hash as the root.
--
--    Rights: an integrity owner (review_and_approve, edit_config or a Head) — the same set the alarm
--    uses. The result carries only hashes, ids, public keys, timestamps and version strings.
-- ---------------------------------------------------------------------------
create or replace function public.attestation_input_get(p_kind text, p_subject_id text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_result jsonb;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not (public.caller_has_right('review_and_approve')
          or public.caller_has_right('edit_config')
          or public.caller_head_level() >= 1
          or public.is_platform_admin()) then
    raise exception 'not permitted: an integrity owner is required' using errcode = 'P0001';
  end if;

  if p_kind = 'report_graph_root' then
    select jsonb_build_object(
      'label', coalesce(rv.version_number::text, '') || ' · ' || coalesce(g.model_id, ''),
      'roots', jsonb_build_array(
        jsonb_build_object('name', 'graph_root', 'hash', g.graph_root),
        jsonb_build_object('name', 'render_hash', 'hash', g.render_hash)),
      'versions', jsonb_build_object(
        'engine', g.engine_version, 'template', g.template_version,
        'phraseLibrary', g.phrase_library_version,
        'rulePacks', coalesce((
          select jsonb_agg(jsonb_build_object('id', rp.rule_id, 'version', rp.rule_version)
                           order by rp.rule_id, rp.rule_version)
            from (select distinct c.rule_id, c.rule_version from report_claims c
                   where c.org_id = v_org and c.report_version_id = g.report_version_id
                     and c.rule_id is not null) rp), '[]'::jsonb)),
      'leaves', coalesce((
        select jsonb_agg(jsonb_build_object('claimId', c.claim_id, 'leafHash', c.leaf_hash)
                         order by c.position, c.claim_id)
          from report_claims c
         where c.org_id = v_org and c.report_version_id = g.report_version_id
           and c.leaf_hash <> ''), '[]'::jsonb),
      'ledgerSeq', case when g.ledger_seq is null then null else g.ledger_seq::text end)
      into v_result
      from report_graphs g
      left join report_versions rv on rv.id = g.report_version_id
     where g.org_id = v_org and g.report_version_id = p_subject_id::uuid
     order by g.model_id, g.formality, g.tone, g.voice, g.locale
     limit 1;

  elsif p_kind = 'engagement_certificate' then
    select jsonb_build_object(
      'label', 'Certificate v' || coalesce(c.version::text, ''),
      'roots', jsonb_build_array(jsonb_build_object('name', 'cert_hash', 'hash', c.cert_hash)),
      'versions', jsonb_build_object('engine', '', 'template', '', 'phraseLibrary', '',
                                     'rulePacks', '[]'::jsonb),
      'leaves', '[]'::jsonb,
      'ledgerSeq', null)
      into v_result
      from engagement_certificates c
     where c.org_id = v_org and c.id = p_subject_id::uuid
     limit 1;

  elsif p_kind = 'board_pack_data_hash' then
    select jsonb_build_object(
      'label', 'Board pack',
      'roots', jsonb_build_array(jsonb_build_object('name', 'data_hash', 'hash', h.data_hash)),
      'versions', jsonb_build_object('engine', '', 'template', '', 'phraseLibrary', '',
                                     'rulePacks', '[]'::jsonb),
      'leaves', '[]'::jsonb,
      'ledgerSeq', null)
      into v_result
      from board_pack_history h
     where h.org_id = v_org and h.id = p_subject_id::uuid
     limit 1;
  else
    raise exception 'unknown attestation subject kind: %', p_kind using errcode = 'P0001';
  end if;

  if v_result is null then
    raise exception 'no such subject in this organisation' using errcode = 'P0001';
  end if;

  -- The signatures, public keys and timestamp tokens on this subject (shared across kinds).
  v_result := v_result || jsonb_build_object(
    'signatures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', s.kind, 'subjectId', s.subject_id, 'rootHash', s.root_hash,
        'keyId', s.key_id, 'algorithm', 'Ed25519', 'signature', s.signature,
        'signedAt', s.signed_at) order by s.signed_at desc)
        from signatures s
       where s.org_id = v_org and s.kind = p_kind and s.subject_id = p_subject_id), '[]'::jsonb),
    'keys', coalesce((
      select jsonb_agg(jsonb_build_object(
        'keyId', k.key_id, 'algorithm', 'Ed25519', 'publicKey', k.public_key)
        order by k.created_at desc)
        from signing_keys k
       where k.org_id = v_org and k.scope = 'org'), '[]'::jsonb),
    'timestamps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'authority', tt.authority_name, 'genTime', tt.gen_time, 'tokenDer', tt.token_der)
        order by tt.gen_time)
        from timestamp_tokens tt
        join timestamp_requests tr on tr.id = tt.request_id
       where tr.org_id = v_org and tr.subject_kind = p_kind and tr.subject_id = p_subject_id),
      '[]'::jsonb));

  return v_result;
end $$;

comment on function public.attestation_input_get(text, text) is
  'T3: gather a subject''s roots, versions, Merkle leaves, signatures, public keys and timestamp '
  'tokens for the portable attestation package. Only hashes, ids, public keys and version strings.';

-- ---------------------------------------------------------------------------
-- 4. attestation_subjects_list — the signed subjects an integrity owner can build a package for.
--    One row per (kind, subject_id) that carries at least one signature, newest first.
-- ---------------------------------------------------------------------------
create or replace function public.attestation_subjects_list()
returns table (kind text, subject_id text, root_hash text, key_id text, signed_at timestamptz,
               has_timestamp boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not (public.caller_has_right('review_and_approve')
          or public.caller_has_right('edit_config')
          or public.caller_head_level() >= 1
          or public.is_platform_admin()) then
    raise exception 'not permitted: an integrity owner is required' using errcode = 'P0001';
  end if;

  return query
    select s.kind, s.subject_id, s.root_hash, s.key_id, s.signed_at,
           exists (select 1 from timestamp_requests t
                    where t.org_id = v_org and t.subject_kind = s.kind and t.subject_id = s.subject_id
                      and t.status = 'stamped')
      from signatures s
     where s.org_id = v_org
     order by s.signed_at desc
     limit 200;
end $$;

comment on function public.attestation_subjects_list() is
  'T5: the signed subjects an integrity owner can build an attestation package for.';

-- ---------------------------------------------------------------------------
-- 5. Grants.
-- ---------------------------------------------------------------------------
revoke execute on function public.attestation_input_get(text, text) from public, anon;
grant execute on function public.attestation_input_get(text, text) to authenticated;

revoke execute on function public.attestation_subjects_list() from public, anon;
grant execute on function public.attestation_subjects_list() to authenticated;
