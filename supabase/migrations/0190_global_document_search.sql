-- 0190 (S7): the global, access-based full-text document search.
--
-- The owner's requirement: ONE box that full-text-searches extracted document content across the
-- WHOLE tenant, returning only the documents the caller's rights let them see. `search_documents`
-- (0035) is engagement-scoped (§17.2 stage awareness); it cannot answer "where in this organisation
-- does the phrase 'REGULATION 12' appear?". This migration adds that reader.
--
-- The search reads `document_extractions.extracted_text` (0035), written by the doc-extract Edge
-- Function (0078). It joins the file to its engagement, entity and universe and applies the SAME
-- access predicate the `engagements` RLS policy uses (migration 0042_scope_rls.sql):
--     can_read_all_scopes() OR has_scope(universe_id, entity_id, engagement_id)
-- so a document is returned only when its engagement is inside the caller's scope, and a tenant's
-- documents are never returned to another tenant. It reads nothing else and writes nothing.
--
-- L2: the only read path is RLS + `jwt_org_id()` + `has_scope()`. The function is security definer
-- because it reads the tables on the caller's behalf, but every row is filtered by the caller's org
-- and the caller's scope, so a cross-tenant or out-of-scope document is simply absent — never a
-- distinguishable refusal that would confirm it exists.
--
-- M1: grepped migrations and tests for `global_document_search`; new, not redefined.
-- M2: create or replace; no table changes shape. M6: applied twice and all SQL tests run twice.

-- ---------------------------------------------------------------------------
-- global_document_search(p_query text, p_limit int) -> jsonb
--   {ok:true, count, results:[{file_id, filename, stage, engagement_id, engagement_title,
--    entity_id, entity_name, universe_id, universe_name, headline, rank}]}
--   when the caller holds a read right; {ok:false, reason} otherwise. An empty query is refused by
--   name (a search with no term is not a search), never widened to "return everything".
-- ---------------------------------------------------------------------------
create or replace function public.global_document_search(p_query text, p_limit int default 25)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_limit int := greatest(1, least(coalesce(p_limit, 25), 100));
  v_tsq tsquery;
  v_count int;
  v_results jsonb;
begin
  if v_org is null then
    return jsonb_build_object('ok', false, 'reason', 'not signed in');
  end if;
  if not coalesce(public.caller_has_right('perform_work') or public.caller_has_right('review_and_approve')
                  or public.caller_has_right('read_only') or public.caller_has_right('view_all_scopes'), false) then
    return jsonb_build_object('ok', false, 'reason', 'not permitted: a read right is required');
  end if;
  if coalesce(btrim(p_query), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'a search term is required');
  end if;

  v_tsq := plainto_tsquery('english', p_query);

  with hits as (
    select f.id as file_id,
           f.filename as filename,
           f.stage as stage,
           e.id as engagement_id,
           e.title as engagement_title,
           en.id as entity_id,
           en.name as entity_name,
           u.id as universe_id,
           u.name as universe_name,
           ts_headline('english', coalesce(d.extracted_text, ''), v_tsq,
                       'MaxWords=24, MinWords=6, StartSel=<mark>, StopSel=</mark>') as headline,
           ts_rank(to_tsvector('english', coalesce(d.extracted_text, '')), v_tsq) as rank
      from document_extractions d
      join evidence_files f on f.id = d.file_id
      join engagements e on e.id = f.engagement_id
      join entities en on en.id = e.entity_id
      join universes u on u.id = e.universe_id
     where d.org_id = v_org
       and f.org_id = v_org
       and e.org_id = v_org
       and d.extraction_status = 'done'
       and coalesce(btrim(d.extracted_text), '') <> ''
       and to_tsvector('english', coalesce(d.extracted_text, '')) @@ v_tsq
       -- The whole of the access decision: the caller sees the org, or sees this engagement's scope.
       and (public.can_read_all_scopes()
            or public.has_scope(e.universe_id, e.entity_id, e.id))
  ),
  top_hits as (
    select * from hits order by rank desc, filename asc, file_id asc limit v_limit
  )
  select count(*),
         coalesce(jsonb_agg(jsonb_build_object(
           'file_id', file_id, 'filename', filename, 'stage', stage,
           'engagement_id', engagement_id, 'engagement_title', engagement_title,
           'entity_id', entity_id, 'entity_name', entity_name,
           'universe_id', universe_id, 'universe_name', universe_name,
           'headline', headline, 'rank', rank
         ) order by rank desc, filename asc, file_id asc), '[]'::jsonb)
    into v_count, v_results
    from top_hits;

  return jsonb_build_object('ok', true, 'count', v_count, 'results', v_results);
end $$;

comment on function public.global_document_search(text, int) is
  'S7: global full-text search over the caller''s organisation''s extracted document text, filtered by the caller''s scope (can_read_all_scopes or has_scope). The only read path is RLS + jwt_org_id() + has_scope(); an out-of-scope or cross-tenant document is simply absent.';

-- ---------------------------------------------------------------------------
-- Grants. Application roles only; anon may not search.
-- ---------------------------------------------------------------------------
revoke execute on function public.global_document_search(text, int) from public, anon;
grant execute on function public.global_document_search(text, int) to authenticated;
