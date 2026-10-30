#!/usr/bin/env bash
# Completion-build gates (D22, extended in C5). Runs every gate the release checklist names, in
# order, and stops at the first failure. This is the same set CI runs (steps 1-6c plus the guard
# tests), so a green local run means CI's fast steps will be green too. The SQL, Playwright and
# screenshot steps need the hosted test project and a seeded database, and are not run here.
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

step "6. Tutorial check, strict (no placeholder, 8..15 frames, <= 400 KB, ui_hash current)"
npm run check-tutorials -- --strict || { echo "FAIL: check-tutorials --strict"; exit 1; }

step "6b. Edge Function deploy list"
node scripts/check-function-deploy-list.mjs || { echo "FAIL: check-function-deploy-list"; exit 1; }

step "6c. UI contract"
node scripts/check-ui-contract.mjs || { echo "FAIL: check-ui-contract"; exit 1; }
node scripts/check-feature-register.mjs || { echo "FAIL: check-feature-register"; exit 1; }

  step "6d. Anti-theatre gates G2/G3/G4/G5/G6 (dead code, config-effect, wiring, two-sources, RPC parity)"
node scripts/check-dead-code.mjs || { echo "FAIL: check-dead-code (G2)"; exit 1; }
node scripts/check-config-effect.mjs || { echo "FAIL: check-config-effect (G3)"; exit 1; }
node scripts/check-wiring.mjs || { echo "FAIL: check-wiring (G4)"; exit 1; }
node scripts/check-two-sources.mjs || { echo "FAIL: check-two-sources (G5)"; exit 1; }
node scripts/check-rpc-parity.mjs || { echo "FAIL: check-rpc-parity (G6)"; exit 1; }

step "7. Source guards (single client, no blocking modals, no demo ids, no Math.random)"
npx vitest run src/guards || { echo "FAIL: guards"; exit 1; }

printf '\nPRE-PR GATES GREEN\n'
