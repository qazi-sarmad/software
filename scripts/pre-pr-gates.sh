#!/usr/bin/env bash
# D22 pre-PR gates. Runs every gate the release checklist names, in order, and stops at the first
# failure. This is the same set CI runs (steps 1-5 plus the guard tests), so a green local run means
# CI's fast steps will be green too. The SQL and Playwright steps need the hosted test project and
# are not run here.
set -u
cd "$(dirname "$0")/.." || exit 1

step () { printf '\n== %s ==\n' "$1"; }

step "1. Type check (tsc --noEmit)"
npx tsc --noEmit -p . || { echo "FAIL: tsc"; exit 1; }

step "2. Unit tests (vitest run)"
npx vitest run || { echo "FAIL: vitest"; exit 1; }

step "3. Build (vite build)"
npm run build || { echo "FAIL: build"; exit 1; }

step "4. Token check"
node scripts/check-tokens.mjs || { echo "FAIL: tokens"; exit 1; }

step "5. Shrink check"
node scripts/check-shrink.mjs || { echo "FAIL: shrink"; exit 1; }

step "6. Tutorial check (every Appendix A key has a GIF)"
npm run check-tutorials || { echo "FAIL: check-tutorials"; exit 1; }

step "6b. Edge Function deploy list"
node scripts/check-function-deploy-list.mjs || { echo "FAIL: check-function-deploy-list"; exit 1; }

step "6c. UI contract"
node scripts/check-ui-contract.mjs || { echo "FAIL: check-ui-contract"; exit 1; }

step "7. Source guards (single client, no blocking modals, no demo ids, no Math.random)"
npx vitest run src/guards || { echo "FAIL: guards"; exit 1; }

printf '\nPRE-PR GATES GREEN\n'
