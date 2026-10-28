> ## ⚠️ STALE — ARCHIVED, DO NOT TRUST
>
> This document predates the code-verified audit of 2026-10-27/28 and is kept for history only.
> Its status claims are **not** reliable: the audit found the app was not database-backed in
> production, the engagement lifecycle was never persisted, several documented-as-Present features
> were dead code, and many "all Present" claims were false.
>
> **Current sources of truth:**
> - `docs/SPEC-v10.md` — the specification (unchanged, still authoritative)
> - `docs/FUNCTIONALITY-AUDIT.md` — what is actually built (code-verified)
> - `docs/REMEDIATION-PLAN.md` — the plan being executed
> - `docs/SCALE-TASKS.md` — live task ledger
>
> Do not cite this file as evidence that anything works.

# Phase 3 — decisions

Decision order for every choice in Phase 3: the specification first; then the Laws (§1); then the
simplest option that obeys the Laws; then product value. Anything that may not be decided here goes
to `docs/PHASE-3-BLOCKERS.md`.

## D1 — Next free migration and test numbers

- Migrations `0001`–`0017` exist on `phase-2-access`. Phase 3 starts at **`0018`**.
- SQL tests `00`–`24` exist. Phase 3 starts at **`25`**.
- Vitest and Playwright counts are reported per task; the Phase 2 baseline is 30 vitest files /
  289 tests and 24 Playwright tests.

## D2 — One migration per spec area, one test file per migration

Each Phase 3 area gets one migration and one SQL test file, so a red run names the area. A later
migration may `alter table ... add column if not exists` an earlier one rather than create a second
table (grep first, prefer ALTER).

## D3 — Rights only

Every new function checks `public.caller_has_right(...)`. No new function compares a role name or a
team-role name. Every new table carries `org_id`, has RLS on, has a select policy
`org_id = public.jwt_org_id()` (widened by `can_read_all_scopes()` or `has_scope(...)` where the
existing pattern does), and has **no direct write policy** — writes go through a function.

## D4 — Hash chains reuse the existing ledger

Anything the spec calls hash-chained (SIRA publication, plan versions, deployment outcomes, ethics
acknowledgements) is written through `public.append_ledger_entry(...)`, which runs the existing
`chain_ledger_entry()` trigger. No second chain and no second hash function is introduced. The
`ledger_entries` append-only trigger still applies.

## D5 — Deterministic engines only (L1)

The SIRA engine and any scoring is plain deterministic code in the database
(`public.sira_compute(...)`) and mirrored in `src/lib/siraEngine.ts`, with a parity test of at least
20 fixtures. No `Math.random`, no AI, in any scoring path.

## D6 — The application data layer

The app reads and writes only through `src/data/*.ts`. Components never import the Supabase client.
New Phase 3 modules: `src/data/universe.ts`, `src/data/sira.ts`, `src/data/plan.ts`,
`src/data/deployment.ts`, each with mocked unit tests.

## D7 — No modals; the inspector is the interaction

Any new UI uses the sliding inspector (`InspectorPanel`), inline states, and a confirmation panel on
save (§23, §27.5). No blocking modal, no native dialog. Tokens only (no raw hex or px).

## D8 — Where the spec is silent

Recorded as they arise in the tasks below and mirrored in the per-task commit message.

## D9 — One Supabase client for the whole browser (rule M8)

`src/data/client.ts` is the single place that calls `createClient(...)` and it exports `getClient()`.
Every data module imports `getClient` from there (`src/data/db.ts` re-exports it for the Phase 3
modules; `src/data/admin.ts` imports it directly). Three clients on one stored session each refresh
the token independently, and refresh-token rotation can sign one of them out; one client removes that
class of bug. The guard `src/guards/singleClient.test.ts` fails if any file under `src` other than
`src/data/client.ts` (and the guard itself) imports `@supabase/supabase-js` or calls `createClient(`.

## Migration Safety Rules — additions

- **M8.** The browser has exactly ONE Supabase client. `src/data/client.ts` creates it and exports
  `getClient()`. Every data module imports `getClient` from there. No other file in `src` calls
  `createClient` or imports `@supabase/supabase-js`.

## D10 — 3J panels are presentational, wired at the tab

The Phase 3 inspector panels (`SiraModelEditor`, `SiraCyclePanel`, `PlanItemsPanel`,
`DeploymentGatePanel`, `EthicsPanel`) render from the payload the tab passes to `openInspector`.
The two interactive flows that write (`EntityApprovalPanel`, `CombinedApprovalPanel`) call the Phase 3
data modules directly (`src/data/universe.ts`, `src/data/deployment.ts`), whose writes go through the
RPCs. This keeps the panels unit-testable without a database and keeps the e2e run deterministic
(nothing seeds a SIRA model, a cycle or a plan item yet). When tabs gain real reads they pass the
loaded rows straight in; no panel needs to change.
