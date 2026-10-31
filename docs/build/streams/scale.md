# Stream S17 — scale programme (cross-cutting; the generator is the integrator's)

Read `docs/build/SCALE-PROGRAMME.md` in full. This doc is the per-stream assignment.

## The generator (integrator)
`supabase/tests/99_scale_seed.sql` + `scripts/scale-seed.mjs` — Shapes A (large tenant: 5,000 entities,
1M-row population, 5M ledger entries), B (long tail: 500 orgs, 50,000 users), C (adversarial mix).
Deterministic; idempotent; cleans up its own fixtures first.

## Per-stream assignment (the flow → owner map, SCALE-PROGRAMME §5)
| Flow | Owner stream |
|---|---|
| 1 sign-in / session | S6 |
| 2 create engagement, 3 stage transition, 4 seal/sign-off | S6 |
| 5 population upload, 6 population gate | S1 |
| 7 rule run (each scope) | S1 (population) + S7 (document/minutes/policy) |
| 8 evidence attach, 9 evidence verify | S1 |
| 10 SIRA score, 11 SIRA override, 12 two-key, 13 emergent risk | S3 |
| 14 classification | S3 |
| 15 standards rollout | S1 |
| 16 monitor run, 17 connector run | S5 |
| 18 report compose, 19 report seal + verify | S1 (composer is read-only to all) |
| 20 traffic signal, 21 complaint, 22 self-diagnostic | S4 |
| 23 config save, 24 entitlement switch, 25 support access | S6 |

## Cross-cutting (every stream, on every flow it owns)
- Cross-tenant read → 0 rows; cross-tenant write → 0 rows; under ≥ 200 concurrent sessions.
- A concurrent duplicate is rejected by the constraint, not by luck; a partial failure leaves no
  partial write.

## Acceptance
- The thresholds in SCALE-PROGRAMME §6 are met or a note here names the miss and why.
- The harness runs twice on the same database and passes both times; CI green without a flake.

## Status
| Flow | Owner | Happy | Bad | Concurrency | Threshold | Commit |
|---|---|---|---|---|---|---|
