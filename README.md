# Provio

Enterprise internal-audit platform for banks and corporates.

Cryptographically sealed workpapers, deterministic testing, verifiable populations, and an immutable hash-chained ledger. Core audit logic is deterministic; AI is off by default for findings and reports.

## Run locally

**Prerequisite:** Node.js 20+

```bash
npm install --legacy-peer-deps
npm run dev          # http://localhost:3000 (or the port Vite prints)
```

## Checks

```bash
npx tsc --noEmit
npx vitest run
npx vite build
node scripts/check-tokens.mjs
node scripts/check-shrink.mjs
npx playwright test   # e2e
```

## Rules of the codebase

- Three lifecycle stages only: planning, testing, conclusion.
- Colours come only from `src/styles/tokens.css`; icons only from `src/components/common/Icons.tsx`.
- Components read data only through `useScopedData()`.
- No `Math.random` in audit logic; no blocking modals.

Spec: `docs/` and the project instruction guide (v7).
