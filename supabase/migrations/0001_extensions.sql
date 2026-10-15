-- 0001: extensions.
-- Supabase ships an `extensions` schema; create it when absent so the same SQL runs on a plain Postgres.
create schema if not exists extensions;

-- pgcrypto provides digest() (gen_random_uuid is core since PG13). digest() is used by the ledger.
create extension if not exists pgcrypto with schema extensions;
