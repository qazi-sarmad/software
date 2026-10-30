# Scale programme — 50,000 users, 5,000 entities, every path

Owner instruction 2026-10-30: *"50,000 users with 5,000 entities testing rigorously covered."*

This is the specification for the scale work (**S17**). It states the target, what the target implies,
how it is generated, how it is proven, and — the part most test suites get wrong — the **bad paths**.
Every flow is exercised on its happy path **and** its refusal path.

The scale target is not a benchmark for its own sake. It is the condition under which the tenant
boundary (L2), the population gate (L3) and the deterministic engine (L1) must still hold.

---

## 1. The target

| Dimension | Target |
|---|---|
| Users | **50,000** accounts across tenants |
| Entities (auditable) | **5,000** in the largest tenant, summed across universes |
| Organisations | a large-tenant shape (one org with 5,000 entities) + a long-tail shape (many small orgs) |
| Population rows | ≥ 1,000,000 rows in one population for the forensic run |
| Concurrent sessions | ≥ 200 simultaneous sessions across tenants |
| Engagements | ≥ 2,000 live engagements |
| Evidence files | ≥ 100,000 rows (metadata), buckets RLS-guarded |
| Ledger entries | ≥ 5,000,000 (the hash chain at volume) |

## 2. What the target implies (and the laws it must not break)

1. **RLS is the only read path (L2).** At 50k users the identity resolution (`jwt_org_id()`) is on every
   row of every query. The programme proves **zero** cross-tenant leakage under concurrency, not just in
   serial tests.
2. **The population gate holds at volume (L3).** A 1,000,000-row population must hash and gate in bounded
   time, and the hash must be stable.
3. **The engine is deterministic at volume (L1).** The same population and rule set produce the
   byte-identical result at 1M rows as at 10.
4. **Config-as-ledger holds at volume.** Version history and the append-only guarantees must not degrade
   into "skip the version row under load".
5. **The app is a static SPA.** The scale is the **database's** and the **RLS's**, not a server's — so the
   load is driven at the database and at the browser, not through an app server.

## 3. The existing harness (extend, do not rebuild)

| File | What it already proves | Extend to |
|---|---|---|
| `supabase/tests/15_ledger_concurrency.sql` | the hash chain under concurrent appends (dblink) | 5M-entry volume; concurrent append while verifying |
| `supabase/tests/118_phase6_concurrency_isolation.sql` | N orgs × N sessions, own/other reads, cross-write refusal | N ≥ 200 sessions |
| `supabase/tests/123_scale_isolation.sql` | three concurrent orgs, share/invite/feature/support paths | the long-tail shape |
| `supabase/tests/100_scale_harden.sql` | grace period, pre-flight store, cross-universe sharing | fold the D-capabilities' RLS in |
| `src/lib/writing/scale.test.ts` | the composer at volume | 1,200 cells at volume |
| `src/lib/writing/concurrency.test.ts` | concurrent composition | unchanged |

**Method:** the SQL harness uses `dblink` (already the project's tool) so statements really race — all
`send_query` calls issued before any `get_result`. The browser tier uses Playwright against the
**production build**, never the dev server (the audit's rule).

## 4. The data generator

A single deterministic generator (`supabase/tests/99_scale_seed.sql` + `scripts/scale-seed.mjs`) builds
the shapes. **Deterministic**: a fixed seed produces the same data every run, so a failure is
reproducible.

- **Shape A — the large tenant.** one org, 5,000 entities, 200 universes, 2,000 engagements, a
  1,000,000-row population, 100,000 evidence rows, 5,000,000 ledger entries.
- **Shape B — the long tail.** 500 orgs of 10–200 entities, 50,000 users spread across them.
- **Shape C — the adversarial mix.** Shape A plus hostile rows: duplicate ids, near-duplicate names,
  sequence gaps, weekend postings, just-below-threshold amounts, out-of-hours entries, a row whose
  `org_id` is another org's (must be invisible).

The generator is **idempotent** and **cleans up its own fixtures first**, so the harness can run twice
against the same database (the pattern `123` already uses).

## 5. Every flow, both paths

Each row is exercised on the **happy** path (the operation succeeds) and the **bad** path (it is
refused, with the right reason, and **no partial write**). The refusal is paired with a legitimate read,
so a fix that blocks everything fails the test.

| # | Flow | Happy path | Bad path (must refuse, named reason) |
|---|---|---|---|
| 1 | Sign in / session | valid user reads own org | wrong org, expired token, no token |
| 2 | Create engagement | created, staged `planning` | missing right, sealed parent, over-cap |
| 3 | Stage transition | planning → testing → conclusion | illegal transition, locked stage, out of order |
| 4 | Seal / sign-off | sealed with signature | seal twice, sign without right, sign after lock |
| 5 | Population upload | rows ingested, hash recorded | hash mismatch, over size, malformed row |
| 6 | Population gate | gate verifies | population changed after gate, gate re-used |
| 7 | Rule run (each scope) | findings with rule id + version + scope | draft rule not run, unsubscribed pack, empty scope |
| 8 | Evidence attach | bytes → row → ledger | bytes missing, hash mismatch, wrong org prefix, over size |
| 9 | Evidence verify | re-derived, matches | stored bytes gone → `no_stored_bytes`, mismatch → alert |
| 10 | SIRA score | computed, banded | unknown factor, model version drift, missing scale |
| 11 | SIRA override | recorded with reason | empty reason refused, no right, revert recorded |
| 12 | Two-key acceptance | second auditor endorses | same auditor twice, outstanding proposal blocks publish |
| 13 | Emergent risk | proposed from findings | publish with proposal outstanding → blocked |
| 14 | Classification set (D10) | saved, versioned | unsupported class, obligation without citation |
| 15 | Standards rollout (D16) | entitled tenant applied | **non-entitled skipped + recorded**, bad signature refused |
| 16 | Monitor run (C1) | rule fires, alert persisted | loop guard, rate limit > 20/hr auto-pause |
| 17 | Connector run | start → ingest → finish | ingest without start, double finish, bad credentials |
| 18 | Report compose | 1,200 cells, one graph root | missing phrase, undeclared invariant, graph mutation |
| 19 | Report seal + verify | root verifies | mutated root, missing graph row, render-hash drift |
| 20 | Traffic signal (D12) | green/amber/red with reason | un-evaluated → **amber, never green** |
| 21 | Complaint (D12) | code minted, bundle + email | email fails → complaint still recorded, retried |
| 22 | Self-diagnostic (D12) | one signal in isolation, recorded | diagnostic never mutates state |
| 23 | Config save (R3) | saved, versioned, reason | save a setting no code reads → **flagged, not silently accepted** |
| 24 | Entitlement switch | feature on for a paying tenant | non-paying tenant → `FEATURE_REFUSAL`, no data leak |
| 25 | Support access | time-boxed grant, logged | expired grant, unlogged read → **refused** |

**The cross-cutting bad paths, tested on every flow above:** a cross-tenant read returns 0 rows; a
cross-tenant write affects 0 rows; a concurrent duplicate is rejected by the unique constraint, not by
luck; a partial failure leaves no partial write (transaction integrity).

## 6. The acceptance thresholds

| Measure | Threshold |
|---|---|
| Cross-tenant leakage | **0 rows**, under ≥ 200 concurrent sessions |
| p50 query latency (own-org read) | ≤ 750 ms at the large-tenant shape |
| p95 query latency | ≤ 2,000 ms |
| Population hash (1M rows) | completes in bounded time; hash stable across runs |
| Rule run (1M rows) | deterministic: byte-identical across two runs |
| Ledger verify (5M entries) | completes; a mutated entry is caught |
| Evidence verify | mismatch raises an alert; missing bytes → `no_stored_bytes` |
| Concurrent seal race | exactly one seal wins; the loser gets a named refusal |
| Composer | 1,200 cells, one graph root per fixed claim set + pack version |

The latency figures are the ones the project already reported (p50 741 ms, zero leakage at 8 orgs × 4);
the programme scales the **concurrency and the volume**, not the target latency.

## 7. Acceptance

- The generator builds Shapes A, B and C deterministically and cleans up.
- Every flow in §5 has a happy and a bad path, each with a named refusal reason and no partial write.
- Zero cross-tenant leakage at ≥ 200 concurrent sessions; the isolation tests run **twice** on the same
  database and pass both times.
- The 1M-row population gates, hashes and runs deterministically.
- The 5M-entry ledger verifies and catches a mutation.
- The thresholds in §6 are met or a recorded `docs/build/streams/scale.md` note says exactly which is
  missed and why.
- The harness runs in CI (the existing SQL step) without a flake — sequential with vitest, never
  concurrent with Playwright (the known 5,000 ms timeout flake).
