#!/usr/bin/env bash
# Concurrency probe: run the tenant read path from many parallel clients, each acting as a
# DIFFERENT organisation, and assert no client ever reads a row belonging to another org.
#
# 01_isolation.sql proves no leak sequentially. This proves the same under PARALLEL load, where a
# pooled connection reuses a role and a leak would appear as a foreign-org row. It also measures
# latency at concurrency, which the org_id index fix (0118) is what makes viable.
#
# The assertion is a real `raise exception`: each DO block raises if the foreign-org row count is
# non-zero, so pgbench aborts the run and the failure is visible, not silently averaged. A constant
# `1/0` inside a CASE would NOT work - the planner folds it and raises unconditionally.
#
#   supabase/scale/06_concurrency.sh [clients] [transactions-per-client]
set -u
CLIENTS="${1:-50}"
TXNS="${2:-20}"
CONT="${CONT:-provio-scale}"
DB="${DB:-provio_local}"
DOCKER="sudo -n docker"

SCRIPT=$(mktemp)
cat > "$SCRIPT" <<'SQL'
\set org random(1, 1000)
select set_config('request.jwt.claims',
  jsonb_build_object('sub', md5('user' || :org || '-1'),
                     'org_id', md5('org' || :org)::text,
                     'user_role', 'cia', 'aal', 'aal1')::text, false);
set role authenticated;
-- Each DO block raises if any row from another org is visible: a cross-tenant leak.
do $$ begin if (select count(*) from universes      where org_id <> public.jwt_org_id()) > 0 then raise exception 'LEAK universes'; end if; end $$;
do $$ begin if (select count(*) from entities       where org_id <> public.jwt_org_id()) > 0 then raise exception 'LEAK entities'; end if; end $$;
do $$ begin if (select count(*) from engagements    where org_id <> public.jwt_org_id()) > 0 then raise exception 'LEAK engagements'; end if; end $$;
do $$ begin if (select count(*) from org_members    where org_id <> public.jwt_org_id()) > 0 then raise exception 'LEAK org_members'; end if; end $$;
do $$ begin if (select count(*) from ledger_entries where org_id <> public.jwt_org_id()) > 0 then raise exception 'LEAK ledger_entries'; end if; end $$;
SQL

$DOCKER cp "$SCRIPT" "$CONT":/tmp/06_concurrency.pgbench >/dev/null
rm -f "$SCRIPT"

$DOCKER exec "$CONT" pgbench -n -c "$CLIENTS" -j "$CLIENTS" -t "$TXNS" \
  -f /tmp/06_concurrency.pgbench -U postgres "$DB"
