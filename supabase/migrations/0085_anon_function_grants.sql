-- 0085 anon function grants (fixes the step-7 SQL failure on the hosted test project).
--
-- The platform's default privileges grant EXECUTE to anon on every function created in `public`.
-- Migration 0062 sweeps those grants away and re-grants only the two verification functions, but
-- every function created AFTER 0062 kept the inherited anon grant: the change-request trigger
-- (0080), the governance RPCs and readers (0082) and the entity gate (0083). The local SQL harness
-- applies the migrations twice, so the second pass of 0062 clears them and the defect is invisible
-- there; the hosted run applies them once, and supabase/tests/72_certificate.sql then sees 16 anon
-- executables where F11 allows exactly two.
--
-- 0080-0084 are already applied on the hosted project, so the correction is a new migration: a final
-- sweep, plus the default-privilege change that stops the inheritance so a future function cannot
-- widen the anonymous surface again. It only revokes; it changes no data and is safe to re-apply.

-- Future functions in `public` no longer inherit an anon EXECUTE grant. 0083 did this for tables and
-- sequences; functions were missed.
alter default privileges in schema public revoke all on functions from anon;

do $$
declare
  fn record;
begin
  -- Every function in `public`, except the two verification functions, loses its anon grant.
  for fn in
    select p.oid, p.proname as name, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
     where n.nspname = 'public'
       and d.objid is null
       and p.prokind = 'f'
       and p.proname not in ('verify_certificate', 'verify_board_pack')
  loop
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
  end loop;

  -- Extension members (dblink and the like) also carry a platform anon grant. The migration role may
  -- not own them, so this is best-effort: a refusal cannot widen the anonymous surface, it only
  -- leaves the grant unchanged.
  for fn in
    select p.oid, p.proname as name, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_depend d on d.objid = p.oid and d.deptype = 'e'
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    begin
      execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    exception when insufficient_privilege then
      null;  -- not the owner of the extension member; nothing we are permitted to change
    end;
  end loop;
end $$;

-- The anonymous surface stays exactly the two verification functions.
grant execute on function public.verify_certificate(uuid) to anon, authenticated, service_role;
grant execute on function public.verify_board_pack(uuid) to anon, authenticated, service_role;
