# SCALE-TASKS — the live task ledger

**This file is the single place that records what is done.** Update it in the same commit as the work.
Anything not marked `DONE` here is not done, regardless of what any other document says.

Status values: `TODO` · `DOING` · `DONE` · `BLOCKED (owner)`.

Last updated: 2026-10-28.

---

## Truth policy

`docs/archive/` holds 63 documents written before the code-verified audit. **None of them may be
cited as evidence that anything works.** They each carry a stale banner. The reliable sources are:

| Document | What it is |
|---|---|
| `docs/SPEC-v10.md` | The specification. Authoritative, unchanged. |
| `docs/FUNCTIONALITY-AUDIT.md` | What is actually built, verified against code. |
| `docs/REMEDIATION-PLAN.md` | The plan being executed. |
| `docs/SCALE-TASKS.md` | This file. Live status. |

Rule for every future session: **verify wiring by grepping the call site. Never trust a doc or a
green test as proof that a feature works.**

---

## Decisions locked by the owner (2026-10-28)

1. Enforce the settings that currently do nothing (do not remove them).
2. Tests must run against the real built app (production build), not the dev server.
3. Test steps / methodology must be client-configurable data, not hardcoded.
4. Replace the old CI with a new one that includes the six anti-theatre gates.
5. No demo today; the owner is handling the explanation personally.

---

## WP0 — Pre-flight & inventory

| # | Task | Status |
|---|---|---|
| 0.1 | Branch `feature/scale-harden-v1` from `f2aaa5b` | DONE |
| 0.2 | Baseline counts recorded | DONE |
| 0.3 | Archive stale docs with banners; write this ledger | DONE |
| 0.4 | Docker-based local SQL harness (real Postgres 17) | DONE |

### Baseline counts (locked at branch point)

| Metric | Baseline |
|---|---|
| Migrations | 99 |
| SQL test files | 103 |
| Vitest files | 202 |
| Playwright specs | 29 |
| Guards | 21 |

---

## Phase 1 — Make the app read its own database

Nothing else is verifiable until this is done. The app currently renders from an in-memory seed that
is empty in production (`src/App.tsx:204`).

| # | Task | Status |
|---|---|---|
| 1.1 | `src/data/tenant.ts` — session-scoped tenant loader (RPC-only, no direct table reads) | TODO |
| 1.2 | `TenantDataProvider` replacing the seed as the shell's source | TODO |
| 1.3 | Keep `EMPTY_SEED` only for genuinely tenant-less routes (`/e/:token`) | TODO |
| 1.4 | Kill the parallel in-memory mutations (sign-off, CAP, ledger, test steps) or point them at RPCs | TODO |
| 1.5 | Production-build E2E that proves data loads (the anti-theatre test) | TODO |

## Phase 2 — Make the lifecycle real

| # | Task | Status |
|---|---|---|
| 2.1 | `set_engagement_stage` RPC + transition log; wire planning→testing→conclusion in the UI | TODO |
| 2.2 | Enforce `signoff_role_*` in `sign_planning` / `sign_conclusion` | TODO |
| 2.3 | Enforce `testing_mode` (one-stage vs two-stage) | TODO |
| 2.4 | Enforce `approval_chain` when an approval is decided | TODO |
| 2.5 | Wire `runPreflight` into `freeze_report`; gate on `preflight_acks` | TODO |
| 2.6 | Persist the report graph root (`report_graphs` writer) | TODO |
| 2.7 | Seed `workpaper_rows` from `lock_sample`; link sample to tested rows | TODO |
| 2.8 | Method-aware sampling (MUS/PPS, systematic, stratified) + Clopper-Pearson | TODO |
| 2.9 | Value-coverage check (top-value items included or waived with a reason) | TODO |

## Phase 3 — Make the configuration honest

| # | Task | Status |
|---|---|---|
| 3.1 | `approval_chain` enforced (or hidden) | TODO |
| 3.2 | `signoff_role_*` enforced | TODO |
| 3.3 | `testing_mode` enforced | TODO |
| 3.4 | `report_templates` enforced (or hidden) | TODO |
| 3.5 | `anchoring_settings` setters wired (`admin_save_trust_anchor`, `admin_save_timestamp_authority`) | TODO |
| 3.6 | `docs/CONFIG-EFFECT-MATRIX.md` — every configurable field with its proving test | TODO |

## Phase 4 — Methodology & test steps as data

| # | Task | Status |
|---|---|---|
| 4.1 | `procedure_templates`, `test_step_templates` (+ versions), in the config registry | TODO |
| 4.2 | Test steps become data; row-testing panel driven by the template | TODO |
| 4.3 | Methodology library screen (create / edit / publish) | TODO |
| 4.4 | Provisioning seeds a default template | TODO |

## Phase 5 — Monitors & connectors reachable

| # | Task | Status |
|---|---|---|
| 5.1 | Runner wiring `rule_engine_process`, `staged_record_ingest`, `connector_run_start/finish`, `alert_record` | TODO |
| 5.2 | Fired alerts land in the Work Queue | TODO |
| 5.3 | 22 adapters either wired or clearly labelled "catalogue only, not live" | TODO |

## Phase 6 — Proof & demo script

| # | Task | Status |
|---|---|---|
| 6.1 | Full system suite against a production build | TODO |
| 6.2 | Multi-org isolation under concurrency | TODO |
| 6.3 | `docs/DEMO-SCRIPT.md` using only tested flows | TODO |

## Six anti-theatre CI gates

| # | Gate | Status |
|---|---|---|
| G1 | Production-build E2E (`npm run preview`, not `dev`) | TODO |
| G2 | No-dead-code (every `public` fn has a production caller or is allow-listed) | TODO |
| G3 | Config-effect (every configurable field has a proving test) | TODO |
| G4 | Wiring (every `src/data/*.ts` export imported by a component or allow-listed) | TODO |
| G5 | Two-sources (no component reads both the seed and the database) | TODO |
| G6 | RPC parity (every RPC the app calls exists in the final schema) | TODO |

## UI / UX

| # | Task | Status |
|---|---|---|
| U1 | Pencil-style guided pointers (hand-drawn feel) on every flow | TODO |
| U2 | Complete every screen's functional states (loading/empty/error/ready/denied) | TODO |
| U3 | Guided first-run: zero → first sealed report with no further code | TODO |

---

## Environment facts (for the next session)

- The sandbox has **no host Postgres** and **no Docker socket for the user**, but
  `sudo -n docker` works. `scripts/local-sql-harness-docker.sh` runs a real Postgres 17 in Docker
  and applies the shim, migrations twice, tests twice.
- **Container readiness gotcha:** the official Postgres entrypoint runs a *temporary socket-only*
  server during initdb. A socket `pg_isready` probe succeeds against it and then it shuts down,
  causing a false "ready". The harness probes over **TCP** (`-h 127.0.0.1`) to avoid this.
- `@electric-sql/pglite` is installed `--no-save` and can apply all migrations in-process for schema
  introspection (used by the audit). It is not the gate; Docker Postgres is.
- Playwright's `webServer` is `npm run dev` — this is the reason the suite never saw the production
  defect, and changing it is gate G1.
