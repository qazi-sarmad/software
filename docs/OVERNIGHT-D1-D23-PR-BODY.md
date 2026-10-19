## Provio v1 — complete, ready for testing

Phases 1–8 complete. All screens functional, all workflows wired end to end.

### What changed (D1–D23)

Security, production path, demo clock, workflows, UI fixes, keyboard accessibility, copy cleanup,
irreversible-action guards and admin entry points:

- **D1** XLSX dependency pinned to 0.20.3 from the vendor CDN; `npm audit` reports 0 vulnerabilities.
- **D2–D3** `team_role_rights` RLS and superadmin blindness (migrations 0046 + tests 59–60).
- **D4** No-tenant fallback: a real production path instead of seeded demo data.
- **D5** Demo clock injection (`src/lib/demoTime.ts`) so audit timestamps are deterministic.
- **D6–D10** Ethics acknowledgement wiring, combined-approval entity picker, deploy action in the
  gate flow, persisted plan date changes (migration 0047 + test 61), CAP register in the Issues tab.
- **D11–D12** Retest workflow removed; Work Queue made user-specific (`src/lib/workQueue.ts`).
- **D13–D16** Keyboard-operable hover previews, readable disabled reasons (`src/lib/rightLabels.ts`),
  responsive mobile widths, hold-to-confirm on irreversible actions.
- **D17–D19** Observation / Finding / Issue kept distinct, "sealed" as the final state,
  plain-language screen copy — each enforced by a source guard.
- **D20** Email-based admin invite (migration 0048 + test 62): `invite_user_capped(email, role)`
  records the invite and queues the email atomically.
- **D21** Clear next actions on every dead-end screen (migration 0049 + test 63): planning
  reconciliation names the mismatching risks and routes to the fix; the deployment gate names the
  next action per outcome and routes to the universe, the plan or a combined request; a pending
  combined request says who decides and when it escalates.
- **D22** Pre-PR gates as one script (`scripts/pre-pr-gates.sh`) plus the existing guard tests.
- **D23** This PR body.

### CI

Latest dispatch: run **39175545943** (pull_request) — **green**, all 7 steps.

### Tests

- SQL: **63 test files**, **49 migrations**, **790+ assertions** (applied twice against the shared
  test project, matching how CI runs them).
- Vitest: **75 files**, **791 tests**, all passing.
- Playwright (chromium): **12 spec files**, **49 tests**, all passing.

### Gates

- `npx tsc --noEmit` → exit 0
- `npx vitest run` → 791 passed
- `npm run build` → exit 0
- `node scripts/check-tokens.mjs` → PASS (105 files, 0 violations)
- `node scripts/check-shrink.mjs` → PASS (58 files, no >10% shrink)
- Guards: one Supabase client, no blocking modals outside the allow-list, no demo tenant ids, no
  `Math.random` in audit logic.

Ready for QA testing starting 2026-10-19.

Do not merge yet. Owner will merge after review.

---
_This PR body was written by an AI agent (OpenHands) on behalf of the repository owner._
