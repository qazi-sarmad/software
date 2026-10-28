#!/usr/bin/env bash
# ci-local.sh — the local replacement for .github/workflows/ci.yml.
#
# The GitHub workflow is paused, so its steps are run here, in the same order, and the script stops
# at the first failure. Nothing in this file prints a secret or writes one to disk: the Supabase
# credentials are read from the environment only, and the SQL step uses a local PostgreSQL cluster
# instead of the hosted project.
#
# Exit codes, so a skip can never be mistaken for a pass:
#   0  every step that could run passed
#   1  a step failed (the failing step is named on the last line)
#   2  the Node major version is not 22
#   3  Playwright was skipped because no Supabase credentials are in the environment
#
# Usage: bash scripts/ci-local.sh [--no-install]
#   --no-install  skip step 1 (npm ci); useful while iterating, never for a final run.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

STEP=0
FAILED=""

step() {
  STEP=$((STEP + 1))
  echo ""
  echo "=== step $STEP: $1 ==="
}

fail() {
  FAILED="$1"
  echo ""
  echo "FAIL: $1"
}

# ---------------------------------------------------------------------------
# Node 22. The workflow pins node-version 22; a different major version is not the same test run.
# ---------------------------------------------------------------------------
if [ -x "$HOME/.local/node22/bin/node" ]; then
  PATH="$HOME/.local/node22/bin:$PATH"
fi
export PATH

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo none)"
echo "node -v: $(node -v 2>/dev/null || echo 'node not found')"
if [ "$NODE_MAJOR" != "22" ]; then
  echo "FAIL: the workflow pins Node 22, this shell has major version $NODE_MAJOR."
  echo "      Install Node 22 (the repo expects it at \$HOME/.local/node22) and re-run."
  exit 2
fi

DO_INSTALL=1
if [ "${1:-}" = "--no-install" ]; then DO_INSTALL=0; fi

# ---------------------------------------------------------------------------
# 1. Install dependencies.
# ---------------------------------------------------------------------------
if [ "$DO_INSTALL" = 1 ]; then
  step "1. Install dependencies (npm ci --legacy-peer-deps)"
  if ! npm ci --legacy-peer-deps; then fail "1. Install dependencies"; else echo "PASS: 1. Install dependencies"; fi
else
  step "1. Install dependencies (SKIPPED: --no-install)"
  echo "PASS: 1. Install dependencies (skipped on request)"
fi

# ---------------------------------------------------------------------------
# 2-8. The static and unit gates, in workflow order.
# ---------------------------------------------------------------------------
if [ -z "$FAILED" ]; then
  step "2. Type check (npx tsc --noEmit)"
  if npx tsc --noEmit; then echo "PASS: 2. Type check"; else fail "2. Type check"; fi
fi

if [ -z "$FAILED" ]; then
  step "3. Unit tests (npx vitest run)"
  if npx vitest run; then echo "PASS: 3. Unit tests"; else fail "3. Unit tests"; fi
fi

if [ -z "$FAILED" ]; then
  step "4. Build (npx vite build)"
  if npx vite build; then echo "PASS: 4. Build"; else fail "4. Build"; fi
fi

if [ -z "$FAILED" ]; then
  step "5. Token check (node scripts/check-tokens.mjs)"
  if node scripts/check-tokens.mjs; then echo "PASS: 5. Token check"; else fail "5. Token check"; fi
fi

if [ -z "$FAILED" ]; then
  step "6. Shrink check (node scripts/check-shrink.mjs)"
  if node scripts/check-shrink.mjs; then echo "PASS: 6. Shrink check"; else fail "6. Shrink check"; fi
fi

if [ -z "$FAILED" ]; then
  step "7. Tutorial check (npm run check-tutorials)"
  # Matches .github/workflows/ci.yml step 6: CI records nothing live, so the committed GIFs are
  # placeholders and are allowed here only with this flag (the count is printed). The pre-PR gate
  # scripts/pre-pr-gates.sh runs --strict instead.
  if TUTORIALS_ALLOW_PLACEHOLDER=1 npm run check-tutorials; then echo "PASS: 7. Tutorial check"; else fail "7. Tutorial check"; fi
fi

if [ -z "$FAILED" ]; then
  step "8. Edge Function deploy list (node scripts/check-function-deploy-list.mjs)"
  if node scripts/check-function-deploy-list.mjs; then echo "PASS: 8. Edge Function deploy list"; else fail "8. Edge Function deploy list"; fi
fi

if [ -z "$FAILED" ]; then
  step "8b. UI contract (node scripts/check-ui-contract.mjs)"
  if node scripts/check-ui-contract.mjs; then echo "PASS: 8b. UI contract"; else fail "8b. UI contract"; fi
  step "8c. Feature register (node scripts/check-feature-register.mjs)"
  if node scripts/check-feature-register.mjs; then echo "PASS: 8c. Feature register"; else fail "8c. Feature register"; fi
fi

# ---------------------------------------------------------------------------
# 9. Migrations and SQL tests, locally. The workflow applies them to the hosted test project with
#    psql and TEST_SUPABASE_DB_URL; that project is not reachable from here, so the local harness
#    applies every migration TWICE and runs every SQL test TWICE against PostgreSQL 17 with the
#    Supabase shim. The result is a LOCAL result and is reported as such.
# ---------------------------------------------------------------------------
if [ -z "$FAILED" ]; then
  step "9. Migrations and SQL tests (bash scripts/local-sql-harness.sh) [LOCAL PostgreSQL 17]"
  if bash scripts/local-sql-harness.sh; then echo "PASS: 9. Migrations and SQL tests (local PostgreSQL 17, shim)"; else fail "9. Migrations and SQL tests (local)"; fi
fi

if [ -n "$FAILED" ]; then
  echo ""
  echo "STOPPED at $FAILED"
  exit 1
fi

# ---------------------------------------------------------------------------
# 10. Playwright. Only when the Supabase credentials are in the environment; the suite signs in
#     against the hosted test project, so without them it cannot run and must not look like a pass.
# ---------------------------------------------------------------------------
step "10. Playwright (npx playwright test --project=chromium)"
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SECRET_KEY:-}" ]; then
  echo "PLAYWRIGHT SKIPPED: no Supabase credentials in environment"
  echo "STOPPED before Playwright (exit 3)"
  exit 3
fi

if ! npx playwright install chromium; then fail "10. Playwright browser install"; fi
if [ -z "$FAILED" ]; then
  if npx playwright test --project=chromium; then echo "PASS: 10. Playwright"; else fail "10. Playwright"; fi
fi

if [ -n "$FAILED" ]; then
  echo ""
  echo "STOPPED at $FAILED"
  exit 1
fi

echo ""
echo "ALL STEPS PASSED"
