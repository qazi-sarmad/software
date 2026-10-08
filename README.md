# Provio

Enterprise internal-audit platform for banks and corporates.

A bounded authenticated procurement pilot plus the existing synthetic UI demonstration. Supabase commands enforce scoped population testing, independent review, immutable report issuance and validated remediation. AI transmission is disabled; reports use templates. See docs/IMPLEMENTATION_PLAN.md for verified scope and remaining enterprise requirements.

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

## Authenticated procurement pilot

Copy `.env.example` to `.env.local`. Set `VITE_DATA_MODE=supabase`, `VITE_SUPABASE_URL`, and the **publishable/anon** key (never service_role). Apply `supabase/migrations/202610080001_trust.sql` to a development Supabase project. Use Supabase Auth to create users; a trusted operator inserts organization, entity, membership and entity_access assignments. No production project is created by these steps.

`VITE_DATA_MODE=demo` explicitly selects synthetic browser-only records. An unconfigured production build displays a configuration error. No network failure falls back to a demo CIA identity. Restart Vite after environment changes.

Import `docs/fixtures/procurement.csv` using USD and control total **19600.00**. Attach synthetic evidence, test both rows and document any exceptions as five-part findings. Submit, sign in as a different reviewer and seal, then sign in as CIA to issue. Remediation requires evidence and an independent retest before closure. Download the frozen text report and complete JSON history/evidence export.

Database tests: `psql "$PROVIO_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/trust.sql` against a **disposable migrated database**. The test wraps fixtures in a rolled-back transaction. For plain local PostgreSQL only, apply `supabase/tests/bootstrap.sql` before the migration to provide test Auth roles; do not run bootstrap in Supabase. Authentication and API integration need separate real Supabase checks.

API: `POST /rest/v1/rpc/audit_command` with `{p_case,p_expected,p_key,p_action,p_data}`. Supported actions and types live in `src/lib/data/contracts.ts`; gates live in the migration. Reuse an identical UUID/payload on uncertain network outcomes. `issued_audits` is the scoped issued-only projection; `read_audit_evidence` returns authorized original bytes. Raw table writes are denied to clients. These pilot contracts are versioned through migrations, not yet a supported third-party stable API.
