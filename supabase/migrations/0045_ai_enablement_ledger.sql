-- 0045 (8C): AI enablement — the org ledger entry. 0031 already created `tenant_settings.ai_enabled`,
-- `tenant_settings.ai_model_endpoint` and `platform_enable_ai`, which writes the platform trail. The
-- task text for 8C also requires the org's ledger to carry the enablement ("writes to platform_trail;
-- writes to the org's ledger"), so this migration extends the function in place.
--
-- D-8C-M1: grep found `platform_enable_ai(uuid, boolean, text)` in 0031_platform_control_plane.sql. The
-- object is extended with CREATE OR REPLACE rather than created again (no duplicate function).
--
-- D-8C-ledger: `append_ledger_entry` (0007) is the only ledger writer and bypasses RLS by design, so the
-- platform RPC can call it as the owner. The actor is the platform administrator's auth.uid().
--
-- The function keeps its 0031 signature, so the grants from 0031 still apply; no grant statement is
-- needed. CREATE OR REPLACE preserves the owner, so `security definer` continues to run as the owner.

create or replace function public.platform_enable_ai(p_org uuid, p_enabled boolean, p_endpoint text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  insert into tenant_settings (org_id, ai_enabled, ai_model_endpoint, updated_at)
  values (p_org, coalesce(p_enabled, false), p_endpoint, now())
  on conflict (org_id) do update
    set ai_enabled = coalesce(p_enabled, false), ai_model_endpoint = p_endpoint, updated_at = now();
  perform public.platform_log('ai_enablement_changed', p_org, 'tenant', p_org,
    jsonb_build_object('ai_enabled', coalesce(p_enabled, false), 'endpoint', p_endpoint));
  -- 8C: the enablement is also recorded in the tenant's own hash-chained ledger.
  perform public.append_ledger_entry(
    p_org, 'ai_enablement_changed',
    jsonb_build_object('ai_enabled', coalesce(p_enabled, false), 'endpoint', p_endpoint), auth.uid());
end $$;
