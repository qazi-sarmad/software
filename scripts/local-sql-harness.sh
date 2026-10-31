#!/usr/bin/env bash
# Local SQL harness (M6). Installs nothing; assumes a PostgreSQL cluster is up (any 15+; the suite
# needs only security_invoker). Start it with `sudo pg_ctlcluster <ver> main start`.
# Recreates the database, applies the Supabase shim, applies every migration TWICE, then runs every
# SQL test TWICE. Exits non-zero on the first failure. db name is provio_local (test 15 hardcodes it).
set -u
DB=provio_local
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
run() { sudo -n -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

sudo -n -u postgres dropdb --if-exists "$DB" >/dev/null 2>&1
sudo -n -u postgres createdb "$DB" || exit 1
# Feed the shim on stdin, like every other file below. `psql -f <path>` runs as user postgres,
# which cannot read a path under the caller's home (CI: /home/runner/work/...) and fails with
# "Permission denied"; reading the file as the invoking user and piping it in sidesteps that.
run < "$ROOT/scripts/local-sql-shim.sql" >/dev/null || { echo "shim failed"; exit 1; }

for pass in 1 2; do
  for f in "$ROOT"/supabase/migrations/*.sql; do
    if ! run < "$f" > /tmp/h-mig.log 2>&1; then
      echo "MIGRATION FAILED (pass $pass): $f"; tail -20 /tmp/h-mig.log; exit 1
    fi
  done
done
echo "migrations applied twice"

fail=0
for pass in 1 2; do
  for f in "$ROOT"/supabase/tests/*.sql; do
    if ! run < "$f" > /tmp/h-test.log 2>&1; then
      echo "TEST FAILED (pass $pass): $(basename "$f")"; grep -E "ERROR|FAIL" /tmp/h-test.log | head -5; fail=1
    fi
  done
done
[ "$fail" = 0 ] && echo "all SQL tests passed twice"
exit $fail
