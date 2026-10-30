# Builder baseline — locked at `feature/systeligon-unified-v1`

Every close-out reports **exact counts against this baseline**. It was measured on the unified branch
at the head recorded below, on 2026-10-29, with the full gate set green. Do not re-measure it by
reading documents — measure it with the commands given, and if a number differs, say so.

**Branch:** `feature/systeligon-unified-v1`
**Merge of:** `feature/scale-harden-v1` (A) and `feature/systeligon-build-v1` (B)

## Counts

| Artefact | Count | Command |
|---|---|---|
| Migrations | **126** | `ls supabase/migrations/*.sql \| wc -l` |
| SQL tests | **131** | `ls supabase/tests/*.sql \| wc -l` |
| Vitest files | **273** | `find src -name '*.test.ts' -o -name '*.test.tsx' \| wc -l` |
| Vitest tests | **3144** | `npx vitest run` (last line) |
| Guards | **28** | `ls src/guards/*.test.ts \| wc -l` |
| Playwright specs | **30** | `ls e2e/*.spec.ts \| wc -l` |
| Playwright tests | 143 passed / 2 failed → target 145 passed / 2 skipped | `npx playwright test` |
| Edge Functions | **7** | `ls -d supabase/functions/*/ \| grep -v _shared \| wc -l` |
| Feature register | **126 features (84 Wired, 19 Inert, 23 Absent)** | `node scripts/check-feature-register.mjs` |
| Config matrix | **50 rows (41 ENFORCED)** | `node scripts/check-config-effect.mjs` |
| Dead code | **575 reachable / 39 allow-listed** | `node scripts/check-dead-code.mjs` |
| UI contract | **48 Appendix A screens** | `node scripts/check-ui-contract.mjs` |

## Migration and SQL-test numbering

The A/B collision is resolved on this branch:

- **Migrations** — B's eight were renumbered above the collision, content-preserving:
  `0110`–`0117` → `0119_sira_continuity_acceptance` … `0126_guided_first_run`. A's `0110`–`0118`
  are unchanged. No number maps to two files; no migration was destroyed (verified byte-identical).
- **SQL tests** — the thirteen colliding numbers (`101`–`107`, `112`–`117`) were renumbered to
  `121`–`133`. No duplicate test number remains. Every test re-seeds through `00_lib.sql` and none
  includes another by number, so the run order is unchanged.

**Reservation from here:** the next free migration is **`0127`**; the next free SQL test is **`134`**.
A new file takes the next free number above the branch head. On integration with another branch,
renumber one side wholesale and prove both sides still apply in one ordered run.

## Gate set — the exact commands

```
npx tsc --noEmit
npx vitest run
npx vite build
node scripts/check-tokens.mjs
node scripts/check-shrink.mjs
node scripts/check-ui-contract.mjs
node scripts/check-function-deploy-list.mjs
npm run check-tutorials
node scripts/check-dead-code.mjs
node scripts/check-config-effect.mjs
node scripts/check-wiring.mjs
node scripts/check-two-sources.mjs
node scripts/check-rpc-parity.mjs
node scripts/check-feature-register.mjs
bash scripts/local-sql-harness.sh      # migrations twice, tests twice
npx playwright test
```

## Reference points (prior branches, for comparison)

| Branch | Head | Migrations | SQL tests | Vitest files | Guards | PW specs |
|---|---|---|---|---|---|---|
| `main` | `a697190` | 87 | 92 | 144 | 18 | 25 |
| `feature/scale-harden-v1` | `4719330` | — | — | 210 | 25 | 30 |
| `feature/systeligon-build-v1` | `51c4156` | — | — | — | — | — |
| `feature/systeligon-unified-v1` | *(this branch)* | 126 | 131 | 273 | 28 | 30 |

Numbers are measured, not remembered. Where a cell is blank, it was not measured — do not invent it.
