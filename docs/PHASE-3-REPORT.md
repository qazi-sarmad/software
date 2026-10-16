# Phase 3 — report

Branch `phase-3-universe-plan`, base `origin/phase-2-access` (head `61fb320`).
Latest CI run on this branch: **38856439388** — conclusion **success**, all 7 gate steps green.

Phase 3 built the universes and entity-approval model, the SIRA (Strategic Internal Risk
Assessment) model and deterministic engine, SIRA cycles with a publish freeze and an emergent-risk
queue, the audit plan with hash-chained versions, the deployment gate with ethics
acknowledgements, and the combined (plan-change plus deployment) approval. Every permission
decision is a rights test; no role name is compared anywhere in SQL or application code.

## What was built, by task

| Task | Deliverable | Commit | CI run | Result |
|---|---|---|---|---|
| 3A | plan, decisions, blockers, progress (docs) | `bb55d24` | 38820041986 | green |
| 3B | entity approval: `submit_entity` / `decide_entity`, status guard, history | `a2e4ad6` | 38821318496 | green |
| 3C | SIRA risk library, per-org model, deterministic `sira_compute` + `src/lib/siraEngine.ts` | `ff20c3d`, fix `8f285e3` | 38847291428 | fixed, green |
| 3D | SIRA cycle per universe/year, publish freeze + ledger entry, emergent-risk queue | `2bccbdb` | 38848164526 | green |
| 3E | audit plan per universe/period, hash-chained versions, plan items | `c69e549` | 38848625680 | green |
| 3F | deployment gate (`deploy_engagement`, §7 steps 1–5), ethics acknowledgements | `a71f2cf` | 38849481615 | green |
| 3G | combined approval (plan change + deployment), revalidation, SLA, escalation | `008be40` | 38850118794 | green |
| 3H | adversarial SQL for 3B–3G (cross-org, unauth, missing right, chain, atomicity, concurrency, platform-blind) | `289b79e` | 38850672810 | green |
| 3I | application data layer `src/data/{universe,sira,plan,deployment}.ts` + mocked unit tests | `4504399` | 38851378534 | green |
| 3I-FIX1 | one Supabase client for the whole browser (rule M8) + guard test | `cb49b5f` | 38854450279 | green |
| 3J | UI: approval, SIRA, plan, gate and ethics panels in the sliding inspector | `7295a99`, fix `725b8fc` | 38855410781 (red), 38856439388 (green) | fixed, green |
| 3K | docs, honest counts, PR | this commit | 38856439388 | green |

## Migrations and SQL tests

- Migrations added: `0018_universes_entities.sql`, `0019_sira_model.sql`, `0020_sira_cycles.sql`,
  `0021_audit_plan.sql`, `0022_deployment_gate.sql`, `0023_combined_approval.sql`.
  Next free number is `0024`.
- SQL tests added: `25`–`31`. Next free number is `32`.
- The whole set (`00`–`31`) applies twice cleanly (M6) and runs twice (M5) against the hosted
  `provio-test` project.

## Real final counts (CI run 38856439388)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | **41 files, 371 tests passed** |
| `npx vite build` | exit 0 |
| `node scripts/check-tokens.mjs` | passed (64 files scanned, 0 violations) |
| `node scripts/check-shrink.mjs` | passed (59 files, no >10% shrink) |
| Migrations + SQL tests (real `provio-test`) | all migrations applied, all test files green; 535 `ok` notices across 31 test files |
| `npx playwright test` | **30 passed** |

Phase 2 close baseline for comparison: 30 vitest files / 289 tests, 25 SQL test files, 24 Playwright
tests.

## Laws and rules honoured

- **Rights only.** Every new function calls `public.caller_has_right(...)`; the UI uses `hasRight`.
  `src/guards/noRoleStrings.test.ts` stays green. No role name or team-role name is compared.
- **Tenancy.** Every new table carries `org_id`, has RLS on, and has a select policy
  `org_id = public.jwt_org_id()` (widened where the existing pattern does). No table has a direct
  write policy; writes go through a function. `supabase/tests/13_rls_enabled.sql` stays green.
- **Hash chains** reuse `public.append_ledger_entry(...)` and its `chain_ledger_entry()` trigger.
  No second chain, no second hash function; the `ledger_entries` append-only trigger still applies.
- **Deterministic engines only (L1).** The SIRA engine is plain deterministic SQL mirrored in
  `src/lib/siraEngine.ts` with a parity test of 22 fixtures. No `Math.random` in any scoring path.
- **No modals.** Every new flow is a sliding inspector panel; no native dialog. Tokens only.

## NOT DONE (recorded honestly)

- `escalate_overdue_requests` is a function, but the scheduler that would call it on a timer is out
  of scope for this environment; it must be invoked by a scheduler the deployment provides (§7, §22).
- The `/e/:token` public route still cannot validate tokens without a backend; unchanged from
  Phase 1.
- No screenshots were captured (owner-deferred, §29).
- The hosted `TEST_SUPABASE_DB_URL` secret still carries a trailing newline; CI step 6 and test 15
  strip whitespace until the owner re-sets the secret.

See `docs/NOT-DONE.md` for the full open list and `docs/PHASE-3-BLOCKERS.md` for items that may not
be decided inside Phase 3.
