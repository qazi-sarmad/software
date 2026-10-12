-- Test-only Supabase Auth contract for a disposable plain Postgres database.
-- Never apply to a Supabase project; Supabase owns these objects there.
create schema auth;
create table auth.users (id uuid primary key);
create role anon nologin;
create role authenticated nologin;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
