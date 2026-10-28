#!/usr/bin/env bash
# Local SQL harness that runs against a real PostgreSQL 17 in Docker, for environments with no
# host postgres and no Docker socket for the invoking user (sudo -n docker is used).
#
# It reproduces scripts/local-sql-harness.sh exactly: apply the shim, apply every migration TWICE,
# then run every SQL test TWICE. Migrations are run twice to prove they are idempotent, and tests
# twice to prove they leave no residue. Exits non-zero on the first failure.
#
#   scripts/local-sql-harness-docker.sh            # full run
#   scripts/local-sql-harness-docker.sh --keep     # keep the container for inspection
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB=provio_local
CONT=provio-sql-harness
IMAGE=postgres:17-alpine
PORT=55432

DOCKER="sudo -n docker"
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

cleanup() { [ "$KEEP" = 0 ] && $DOCKER rm -f "$CONT" >/dev/null 2>&1; }
trap cleanup EXIT

$DOCKER rm -f "$CONT" >/dev/null 2>&1
$DOCKER run -d --name "$CONT" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB="$DB" \
  -p "$PORT:5432" "$IMAGE" >/dev/null || { echo "could not start container"; exit 1; }

# Wait for readiness. The official entrypoint runs a TEMPORARY socket-only server during initdb,
# which answers a socket probe and then shuts down; probing over TCP avoids that race and only
# succeeds against the final server. First run may extract layers, so allow up to 90s.
ready=0
for i in $(seq 1 90); do
  if $DOCKER exec "$CONT" pg_isready -h 127.0.0.1 -p 5432 -U postgres -d "$DB" >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || { echo "postgres not ready"; $DOCKER logs "$CONT" 2>&1 | tail -5; exit 1; }

run() { $DOCKER exec -i "$CONT" psql -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" "$@"; }

run -f - < "$ROOT/scripts/local-sql-shim.sql" >/dev/null || { echo "shim failed"; exit 1; }

for pass in 1 2; do
  for f in "$ROOT"/supabase/migrations/*.sql; do
    if ! run < "$f" > /tmp/h-mig.log 2>&1; then
      echo "MIGRATION FAILED (pass $pass): $(basename "$f")"; tail -20 /tmp/h-mig.log; exit 1
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
