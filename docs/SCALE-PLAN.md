# SCALE-PLAN — the plan of record for `feature/scale-harden-v1`

This is the document WP0 of the original brief required and that no branch carried. `SCALE-TASKS.md`
is the ledger — what is done, with evidence. This file is the **plan**: what the branch sets out to
achieve, in what order, under which laws, and how each phase is judged finished. Where the two
disagree, the ledger wins for status and this file wins for intent, and the disagreement is recorded
here rather than smoothed over.

Owner: Builder A's branch, now worked continuously. Branch: `feature/scale-harden-v1`.
Written 2026-10-29. It deliberately states the non-technical framing first, because the owner is
non-technical and should be able to read the plan.

---

## 1. The problem this branch exists to solve

A code-verified audit (`docs/FUNCTIONALITY-AUDIT.md`) found the product was two half-products: a
well-tested database that enforced rules nobody triggered, and well-tested screens that rendered from
an in-memory seed. In a production build every array was empty, because the only thing that hydrated
the app was a dev-only import of 1,387 lines of fixture data (`src/App.tsx:204`). The suite was green
the whole time, because it ran the dev server — the one mode where the product worked.

So the branch's goal is not "add features". It is to **close the distance between what the repository
claims and what the running product does**, and to leave machinery that keeps that distance from
reopening. Every phase below is a class of that distance:

| Class | Example found by the audit | Phase that closes it |
|---|---|---|
| The app does not read its own database | production build mounts no data | Phase 1 |
| The lifecycle is not persisted | engagement stage never written; report graph root never written | Phase 2 |
| Configuration is saved but never read | sign-off roles stored, never enforced | Phase 3 |
| Methodology is prose, not data | sampling accepted 7 methods, implemented 1 | Phase 4 |
| Built machinery has no runner | monitor rules exist, nothing runs them; `verify_ledger` uncalled | Phase 5 |
| No proof the product works as a product | demo relied on the dev server | Phase 6 |
| The claims themselves cannot be trusted | 15 built-as-dead functions, 63 "all Present" docs | the G-gates |

---

## 2. The laws — not negotiable, and not restated loosely

- **L1 Deterministic only.** No AI, no model calls, no generated free text, no embeddings. A report is
  a graph of typed facts, not prose a model wrote.
- **L2 Data never leaves the tenant.** `RLS` plus `jwt_org_id()` is the only read path for tenant
  data. A sharing path may *add* restrictions; it may never relax that equality.
- **L3 Config-as-ledger, the interconnected ledger, and the population gate are inviolable.** A
  configured value that no code reads is a defect, not a feature.
- **L4 Pure functions live under `src/lib/` or `src/data/`.** Components never import the Supabase
  client. **Time is always an argument**; a pure function never reads the clock.
- Every interactive element carries `data-testid="<screenId>-<element>"`. No blocking modals. Platform
  crypto and existing hashing primitives only.
- **No parking.** An item is `DONE` or it is not. `Partial` is not a status. `DEFERRED (design)` is
  legitimate only for work genuinely blocked on an owner decision, and the row stays visible.

The last law is the one that keeps the others honest. The audit's finding was not a bug; it was that
the documents describing the code were wrong, and the word that let them stay wrong was `Partial`.

---

## 3. Order of work, and why this order

The phases are not a backlog to be worked in any order. Each depends on the one before it:

```
Phase 1  the app reads its own database          <- nothing below is real until this is true
  │
Phase 2  the lifecycle is persisted              <- needs real reads to persist against
  │
Phase 3  configuration becomes honest            <- needs a lifecycle to configure
  │
Phase 4  methodology & test steps as data        <- needs configuration to bind to
  │
Phase 5  monitors & connectors reachable         <- the C-series; needs the data model above
  │
Phase 6  proof & demo script                     <- only meaningful once 1-5 run on a built bundle
  │
G1-G6    the anti-theatre gates                  <- run over 1-6 and refuse to let them regress
```

A phase is finished when **every gate passes on a clean checkout and the ledger rows say DONE in the
same commit as the code.** A green test is not the finish line — on this repository the whole suite
passed for months while the production build was empty. The finish line is: *grep the call site, and
the call site is a screen the product serves.*

---

## 4. Phase 1 — make the app read its own database

**Goal.** In a production build, every screen shows real tenant rows from Supabase; the demo seed is
dev-only and nothing depends on it for a shipped path.

**Done means:** `AppContext` calls the Supabase client for every collection it exposes; the G1 gate
(the suite against `vite preview`, not `dev`) passes; no component reads both the seed and the
database (G5).

**Verify with:** G1, G5, and a manual production build showing a signed-in org's own data.

---

## 5. Phase 2 — make the lifecycle real

**Goal.** An engagement moves through its stages, each move persisted and each persisted.

**Done means:** the stage transition is an RPC, not a local setter; the report graph root is written
when a report is composed (it is what `verify_report_root` reads to prove tamper-evidence); pre-flight
runs before a seal; sign-off roles and testing mode are read by the sign-off RPCs that enforce them;
sampling is connected to row testing.

**Verify with:** the ledger's Phase 2 rows 2.1–2.9, the SQL tests `100`–`107`, and G3.

---

## 6. Phase 3 — make the configuration honest

**Goal.** Every configurable field has a reader and a proving test, or it is removed. Nothing saves a
value that no code reads.

**Done means:** `CONFIG-EFFECT-MATRIX.md` lists every configurable field with its reader and its
proving test; G3 passes with zero allow-listed rows.

**Verify with:** G3 and the matrix. This is the phase that answers the audit's harshest sentence — a
config screen that saves a value nothing reads is a lie told to the user's face.

---

## 7. Phase 4 — methodology and test steps as data

**Goal.** The audit methodology is data the engine executes, not prose a person follows. Sampling
methods the schema accepts are methods the engine implements.

**Done means:** the methods the schema names all exist in the engine, each with a test; test steps are
rows, versioned like everything else.

**Verify with:** the Phase 4 rows (`0110_phase4_methodology.sql`, SQL test `111`).

---

## 8. Phase 5 — monitors and connectors reachable (the C-series)

**Goal.** The monitor runtime and the connector catalogue stop being data with no runner. The rules
already exist and are pure; what is missing is the engine that drives them.

**Done means:** a scheduled runner evaluates monitor rules, persists fired alerts, and emits the
watcher signal; a connector run is recorded start-to-finish; the ledger that was written in memory is
verified against the database (`verify_ledger`).

**Verify with:** the C1–C7 rows (`0111`–`0114`), and a call-site grep for each previously-dead
function named in the audit's "fifteen functions" table.

---

## 9. Phase 6 — proof and demo script

**Goal.** A person can watch the product work without the development server, and the demo uses only
flows a test exercises.

**Done means:** the full suite passes against a production build; a multi-org isolation run under real
concurrency shows no cross-tenant leakage; `docs/DEMO-SCRIPT.md` names only tested flows; the
workpaper-creation path the product was missing exists and is reachable.

**Verify with:** the Task 6.1–6.3 rows and the G1 gate in CI.

---

## 10. The anti-theatre gates

The gates are the branch's immune system; each exists because a specific way of lying went undetected.

| Gate | It refuses to let this happen |
|---|---|
| G1 | code passing on the dev server and failing on the built bundle |
| G2 | a `public` function that no production path ever calls |
| G3 | a configurable field no code reads |
| G4 | a `src/data` export no component imports |
| G5 | one component reading both the seed and the database |
| G6 | an RPC the app calls that the shipped schema does not have |

G1–G6 are this branch's; G7–G10 belong to Builder B (the explain layer travels with the explain
layer). `docs/BRANCH-MAP.md` is authoritative on the split.

**A gate is only a gate when CI runs it.** G1's row was `DONE` in one table and `TODO` in another, and
no CI step ever set `E2E_PROD`, so the gate had only ever run by hand (decision D3, `SCALE-DECISIONS.md`).

---

## 11. What is explicitly out of scope

- **The design language.** Held for the owner. This branch does not build it, and the rows that wait
  on it are `DEFERRED (design)` — visible, not parked.
- **Owner actions.** Making the repo private (the patent-disclosure clock), adding a proprietary
  licence, deploying the Edge Functions, supplying connector credentials, and re-recording the
  tutorial GIFs against the final UI. The committed GIFs are placeholders.

---

## 12. The reporting contract

- Every figure is marked **verified** (reproduced against the repository, with the command) or
  **reported** (copied from a ledger and not reproduced). The distinction is the whole point of this
  document set.
- Counts are compared against a locked baseline, never quoted from memory: `main` at branch point —
  87 migrations, 92 SQL test files, 144 vitest files, 25 Playwright specs, 18 guards. The branch's
  baseline is recorded in `SCALE-TASKS.md` and grows as phases land.
- An honest "these three remain, here is why" beats a clean table. Do not claim zero `Partial` unless
  it is true.

---

## 13. Where the other documents sit

| Document | Role |
|---|---|
| `SCALE-PLAN.md` | this file — intent and order |
| `SCALE-TASKS.md` | the ledger — status and evidence, one row per item |
| `SCALE-DECISIONS.md` | decisions taken without the owner, each with its evidence |
| `BRANCH-MAP.md` | ownership, ledgers, and the migration-number reservation |
| `FUNCTIONALITY-AUDIT.md` | the code-verified audit that motivates the branch |
| `REMEDIATION-PLAN.md` | the commercial framing of what was wrong |
| `SYSTELIGON-GAP-REPORT.md` | the Systeligon remainder, planned not built (S1–S16) |
