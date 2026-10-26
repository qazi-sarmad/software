-- 0094 verify_report_root — the third and last anonymous function (WRITE-1, W10.3).
--
-- The deterministic writing engine commits every report graph to report_graphs with a graph root, a
-- render hash and the engine, template and phrase-library versions. W10.3 lets a third party holding
-- a graph root confirm it exists, when it was issued and which versions produced it, without a
-- session and without any tenant content. Decision D-W-PUBLIC-ROOT: this is the ONE deliberate
-- addition to the anonymous surface; the allow-list guard and supabase/tests/72_certificate.sql are
-- updated in the same commit so nothing else became anonymous-callable.
--
-- It returns only: the existence status, the issuance (fixed) timestamp and the four version
-- identifiers. No organisation name, no title, no claim, no figure, no tenant identifier. The
-- organisation name appears only when the tenant turned public_verify_show_title on, exactly as
-- verify_certificate does, and never the root itself.
--
-- M1: no function of this name exists (grep verify_report_root: only a forward reference in 0091's
--     comment). M2: create or replace; safe to apply repeatedly. M3: no existing table changes shape.
--     M8: one client. The function is security definer with a pinned search_path, and it is granted
--     to anon, authenticated and service_role only.

create or replace function public.verify_report_root(p_root text)
returns table (status text, issued_at timestamptz, engine_version text, template_version text,
               phrase_library_version text, model_id text, organisation text)
language plpgsql security definer set search_path = public as $$
declare
  v_row report_graphs;
  v_show boolean;
begin
  -- Reuse the certificate rate limiter. p_root is hashed to a uuid so the bucket key is the same
  -- shape as the other two calls; no root text is ever stored.
  if not public.verify_rate_ok('report_root', md5(coalesce(p_root, ''))::uuid) then
    return query select 'rate_limited'::text, null::timestamptz, null::text, null::text, null::text,
                        null::text, null::text;
    return;
  end if;
  if p_root is null or length(p_root) < 16 then
    return query select 'not_found'::text, null::timestamptz, null::text, null::text, null::text,
                        null::text, null::text;
    return;
  end if;
  select g.* into v_row from report_graphs g where g.graph_root = p_root limit 1;
  if not found then
    return query select 'not_found'::text, null::timestamptz, null::text, null::text, null::text,
                        null::text, null::text;
    return;
  end if;
  -- The internal check, not has_feature: has_feature refuses a signed-in caller asking about another
  -- org, and an anonymous caller has no org at all. 0084 points the two existing verification
  -- functions at the same internal helper for the same reason.
  if not public.feature_enabled_internal(v_row.org_id, 'public_verification') then
    return query select 'not_found'::text, null::timestamptz, null::text, null::text, null::text,
                        null::text, null::text;
    return;
  end if;
  select coalesce(e.public_verify_show_title, false) into v_show
    from org_settings_extra e where e.org_id = v_row.org_id;
  return query select
    'valid'::text,
    v_row.fixed_timestamp,
    v_row.engine_version,
    v_row.template_version,
    v_row.phrase_library_version,
    v_row.model_id,
    case when coalesce(v_show, false) then (select o.name from orgs o where o.id = v_row.org_id) end;
end $$;

-- The anonymous grant is the deliberate third one. Nothing else in this migration is callable by anon.
revoke execute on function public.verify_report_root(text) from public;
grant execute on function public.verify_report_root(text) to anon, authenticated, service_role;
