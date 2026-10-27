# Consolidated job report — Provio Phases 4 to 8

Build: OVERNIGHT mode, Phases 4–8 plus the Config Control Plane (C0–C6) work that preceded them.
Branch: `feature/config-control-plane`. Pull request: [#10](https://github.com/qazi-sarmad/software/pull/10),
base `main` (`c7e9e7b`, the merge commit of Phase 3 PR #9), state OPEN, **not merged**.
Final head: `654af61`. Final CI run: **39031928297 — success**, all 7 gate steps green
(a second green run, 39032854815, was triggered by the pull-request event on the same head).

## 1. Headline status

| Item | Value |
|---|---|
| Tasks completed | 8G, 4J, 5H, 6I, 7H (this session); 4A–4I, 5A–5G, 6A–6H, 7A–7G, 8A–8F, H0–H3c (earlier) |
| Tasks blocked | 0 |
| Tasks deferred (NOT DONE) | 27 recorded items (`docs/NOT-DONE.md`) |
| Open owner decisions | 2 (`docs/PHASE-48-BLOCKERS.md`) |
| Decisions recorded | 89 (`docs/PHASE-48-DECISIONS.md`) |
| CI runs on the branch | 24 (20 green, 4 red — all reds were fixed forward and are green at head) |
| Commits on the branch | 59 |

## 2. Per-task table

Every row carries the commit hash, the CI run ID and the result, as the brief requires.

| Task | Commit | CI run | Result | Notes |
|---|---|---|---|---|
| H0 preflight + docs | `48a329a` | — (docs only, pushed with H1) | done | branch from main; numbering locked at migration 0024 / test 32 |
| H1 provenance housekeeping | `244bb3e` | 38891659906 | green | PR #9 desc retargeted; singleClient guard green (3 tests) |
| H2 nav labels | `8500602` | 38892526322 | green | labels aligned to SPEC-v10 §5 (D-H2) |
| H3a preferences + guard | `ae92f3b` | 38894103600 | green | migration 0024, `src/data/preferences.ts`, guard skeleton, SQL test 32 |
| H3b RecordView + routing | `97b1c3e` | 38895012166 | green | RecordView + `/view` route (D-H3b) |
| H3c abolish InspectorPanel | `22f2d15` | 38895012166 | green | panel deleted; spec §27.5/§17.1 updated |
| 4A plan docs | `0e5bfee` | 38975709496 (cumulative) | green | `docs/PHASE-4-PLAN.md` |
| 4B planning DB | `f772dba` | 38895859440 | green | migration 0025, test 33 |
| 4C population gate DB | `c0ebd01` | 38896760916 | green | migration 0026, test 34 |
| 4D sampling engine DB | `d54165e` | 38897513403 | fixed | migration 0027, test 35; first run 38897205611 red on a cross-run race (D-4D-CI-RACE) |
| 4E row testing DB | `e2dc0bf` | 38897513403 | green | migration 0028, test 36 |
| 4F analyst engine | `81dadff` | 38898749540 | green | migration 0029, test 37, `src/lib/analyticsEngine.ts` |
| 4G Phase 4 tests | `d1ed656` | 38899789331 | green | test 38 acceptance + engine unit tests |
| 4H Phase 4 data module | `29d473b` | 38900814033 | green | `src/data/{planning,population,sampling,rowTesting,analytics}.ts` |
| 4I Phase 4 UI | `811b2f1` | 39019375260 → 39023767418 | fixed | Playwright red on e2e scope/principal; fixed in `c4206a7` (D-E2E-SCOPE, D-E2E-PRINCIPAL) |
| 4J Phase 4 docs | `304551f` | 39028105480 | green | PARITY §10/§10.4/§11/§12; NOT-DONE 14–15; `PHASE-4-REPORT.md` |
| 5A findings DB | `b8a7dd3` | 38975709496 (cumulative) | green | migration 0030, test 39; 4F stub retired (D-5A-STUB) |
| 5B conclusion DB | `ec4e96a` | 38975709496 (cumulative) | green | migration 0034, test 43 |
| 5C floating window | `c818f00` | 39020135451 (cumulative) | green | `FloatingWindowManager.tsx` (dock, multi-window, pop-out) |
| 5D document viewer DB | `135ebd2` | 38954437967 → 38956498574 | fixed | migrations 0035 (FTS, `search_documents`), test 44; first run red at SQL step 6 |
| 5E Phase 5 tests | `882eb69` | 38975709496 | green | test 54 acceptance |
| 5F Phase 5 data module | `13b8ce2` | 38975709496 (cumulative) | green | `src/data/{observations,conclusion,documents}.ts` |
| 5G Phase 5 UI | `389a1e1` | 39019926702 → 39023767418 | fixed | panels + `e2e/phase5.spec.ts` (4) |
| 5H Phase 5 docs | `fec256e` | 39029143063 | green | PARITY §14/§15/§17; NOT-DONE 16–18; `PHASE-5-REPORT.md` |
| 6A report drafting DB | `46ee36c` | 38954769628 | green | migration 0036, test 45 |
| 6B management comments DB | `a25cab4` | 38956498574 | green | migration 0037, test 46 |
| 6C freeze/issuance DB | `3c55c7b` | 38956498574 | green | migration 0040, test 49 |
| 6D CAP register DB | `646c722` | 38956498574 | green | migration 0038, test 47 |
| 6E email queue DB | `838f935` | 38956498574 | green | migration 0039, test 48 |
| 6F Phase 6 tests | `cc18f65` | 38975709496 | green | test 55 acceptance |
| 6G Phase 6 data module | `dd05ad3` | 38975709496 (cumulative) | green | `src/data/{reports,caps,email}.ts` |
| 6H Phase 6 UI | `bc08485` | 39020135451 → 39023767418 | fixed | panels + `e2e/phase6.spec.ts` (4) |
| 6I Phase 6 docs | `6f7e59c` | 39030135433 | green | PARITY §15/§16; NOT-DONE 19–22; D-6E recorded |
| 7A exports DB | `4f16408` | 38975709496 (cumulative) | green | migration 0041, test 50 |
| 7B imports DB | `efc4073` | 38975709496 (cumulative) | green | migration 0042, test 51 |
| 7C activity archival DB | `fc08a1e` | 38975709496 (cumulative) | green | migration 0043, test 52 |
| 7D prior-year import DB | `2c2b78b` | 38975709496 (cumulative) | green | migration 0044, test 53 |
| 7E Phase 7 tests | `502e838` | 38975709496 | green | test 56 acceptance |
| 7F Phase 7 data module | `18beb52` | 38975709496 (cumulative) | green | `src/data/{exports,imports,archival}.ts` |
| 7G Phase 7 UI | `1a2f70b` | 39026062113 | green | panels + `e2e/phase7.spec.ts` (5) |
| 7H Phase 7 docs | `3942da5` | 39027169825 | green | PARITY §9.1/§18/§19/§26; NOT-DONE 10–13 |
| 8A platform portal DB | `45d705c` (0031) | 38956498574 | green | `tenant_settings`, `platform_trail`, platform RPCs; test 40 |
| 8B support access DB | `45d705c` (0031) | 38956498574 | green | `support_access_grants`, grant/revoke; test 40 |
| 8C AI enablement DB | `92ba68f` | 38975709496 | green | migration 0045 adds the org ledger write |
| 8D invite-cap control DB | `45d705c` (0031) | 38956498574 | green | `platform_set_invite_cap`; test 40 |
| 8E Phase 8 tests | `92ba68f` | 38975709496 | green | test 57 acceptance (74 assertions) |
| 8F Phase 8 data module | `5b201b7` | 38956498574 | green | `src/data/platform.ts` + `platform.test.ts` |
| 8G Phase 8 docs | `9f5b6ba` | 39030963918 | green | PARITY §24; NOT-DONE 23–27; `PHASE-8-REPORT.md` |
| final report | `654af61` | 39031928297 | green | `docs/PHASE-48-REPORT.md` |

## 3. CI history on the branch

24 runs total; 20 green, 4 red. Every red was fixed forward (no force-push, no revert needed):

| Red run | Head | Failing step | Resolution |
|---|---|---|---|
| 38954437967 | `135ebd2` | 6. Migrations and SQL tests | fixed forward; green in 38956498574 |
| 39019375260 | `811b2f1` | 7. Playwright | e2e scope/principal fix in `c4206a7`; green in 39023767418 |
| 39019926702 | `389a1e1` | 7. Playwright | same fix; green in 39023767418 |
| 39020135451 | `bc08485` | 7. Playwright | same fix; green in 39023767418 |

(Earlier Config Control Plane reds 38922600512 `8722e35` and 38924273602 `61e36d8` were also Playwright
and were fixed forward in `61e36d8`/`12f9a31`.)

## 4. Real test counts (measured on the head commit, in CI)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | **61 test files, 561 tests passed** |
| `npm run build` (vite) | exit 0 |
| `node scripts/check-tokens.mjs` | PASS — 97 files under `src/components`, 0 violations |
| `node scripts/check-shrink.mjs` | PASS — 58 files, no >10% shrink |
| SQL migrations + tests (step 6) | **45 migrations, 58 test files, 1099 `ok` notices** |
| `npx playwright test` | **51 passed** (2.6m) |

Baseline at the start of the build (main `c7e9e7b`): vitest 41 files / 371 tests; Playwright 30;
SQL 31 test files; tokens 64 files; shrink 59 files.
Delta: +20 vitest files / +190 tests; +21 Playwright tests; +27 SQL test files; +22 migrations.

### SQL assertions per phase

| Phase | Test files | Assertions (`ok`) |
|---|---|---|
| 4 | 32–38 | 130 |
| 5 | 39, 43, 44, 54 | 61 |
| 6 | 45–49, 55 | 65 |
| 7 | 50–53, 56 | 78 |
| 8 | 40–42, 57 | 170 |
| **Total (Phases 4–8)** | **24 files** | **504** |

(The full 58-file SQL suite, including the 31 Phase 1–3 files, reports 1099 `ok` notices.)

### Unit tests per phase (new phase files)

| Phase | Files | Tests |
|---|---|---|
| 4 | `phase4.test.ts`, `phase4Panels.test.tsx`, `analyticsEngine.test.ts` | 14 + 9 + 17 = 40 |
| 5 | `phase5.test.ts`, `phase5Panels.test.tsx`, `FloatingWindowManager.test.tsx` | 9 + 12 + 5 = 26 |
| 6 | `phase6.test.ts`, `phase6Panels.test.tsx` | 8 + 11 = 19 |
| 7 | `phase7.test.ts`, `phase7Panels.test.tsx` | 9 + 15 = 24 |
| 8 | `platform.test.ts` | 2 |

### Playwright specs per phase

`phase4.spec.ts` 4 · `phase5.spec.ts` 4 · `phase6.spec.ts` 4 · `phase7.spec.ts` 5.
(Phase 8 has no UI, so no spec.)

## 5. Migrations and SQL tests added (Phases 4–8)

Migrations 0024–0045 (22 files); SQL tests 32–57 (26 files).

| Migration | Purpose |
|---|---|
| 0024 | user preferences (record_view_mode) |
| 0025 | planning sections, SIRA pre-fill, reconciliation gate, `sign_planning` |
| 0026 | population gate (verification trigger, lock/replace) |
| 0027 | sampling engine (`get_sample_size`, deterministic `compute_sample`) |
| 0028 | row testing (`workpapers`, `workpaper_rows`, sign-off/reopen) |
| 0029 | analyst engine persistence + `create_observation_stub` |
| 0030 | findings/observations/issues, readability gate, severity levels |
| 0031 | platform control plane, support access |
| 0032 | org admin settings (incl. `email_settings`) |
| 0033 | platform read APIs |
| 0034 | conclusion (exception pull, sign, seal) |
| 0035 | document viewer (evidence files, FTS, `search_documents`) |
| 0036 | report drafting |
| 0037 | management comments |
| 0038 | CAP register |
| 0039 | email queue |
| 0040 | freeze and issuance |
| 0041 | exports |
| 0042 | imports |
| 0043 | activity archival |
| 0044 | prior-year import |
| 0045 | AI enablement writes the org ledger |

## 6. Decisions (89 total)

Full detail in `docs/PHASE-48-DECISIONS.md`. Added or completed in this session:

- **D-6E** — the email provider supports `stub`, `resend`, `graph`; the provider choice is the owner's.
- **D-6I-D6E** — D-6E was required by task 6E but not committed with it; recorded in the 6I docs commit
  rather than rewriting history.

Key decisions from earlier sessions: D-PLATFORM-RIGHTS (the platform portal is the only reader of
`user_role` from the JWT); D-4B/4C/4D/4E-* (planning, population gate, sampling, row testing);
D-4F-stub → D-5A-STUB (temporary stub replaced and retired); D-5C-manager (generalised floating
window); D-6C-6D-order (6D built before 6C); D-6D-CAP (one CAP status vocabulary with a
`capStatusToDb`/`capStatusFromDb` boundary); D-7C-append-only (L5 outranks the archival delete step);
D-7C-right; D-8C-ledger; D-E2E-SCOPE / D-E2E-PRINCIPAL (Playwright scope and principal fixes).

## 7. Blockers (full text of docs/PHASE-48-BLOCKERS.md)

### B-5B-signoff-role-config (owner decision)

Which team role may sign off each stage (Planning, Testing, Conclusion) is configurable per
organisation and per engagement (owner clarification, 2026-10-16). The DB today gates every stage
sign-off on the `review_and_approve` right only (four-eyes enforced by CHECK). Building the
per-engagement role configuration is a product decision (which roles, default, UI) that touches
money-adjacent policy, so it is recorded and deferred rather than guessed. Recommendation: add a
`stage_sign_off_roles` jsonb on `engagements` (stage → role slug), defaulting to "any role holding
`review_and_approve`", enforced in `sign_planning` / `sign_off_workpaper` / `sign_conclusion`.
Reverse: the config only narrows signers, so leaving it absent preserves today's behaviour.

### B-6E-provider (owner decision)

Which email provider each tenant uses is pending the owner (decision D-6E). `email_settings.provider`
supports `stub`, `resend` and `graph`; the default is `stub` and no message is dispatched. Both
providers can send from a client's own domain: Graph uses a per-tenant OAuth consent flow
(self-service), Resend requires QSCorp to verify each client's domain by hand. Recommendation: offer
Graph first (self-service onboarding, no per-client manual step) and keep Resend for clients who
prefer it. Reverse: nothing to reverse; the default stays `stub` until the owner decides.

## 8. NOT DONE

`docs/NOT-DONE.md` holds 27 items. The Phase 4–8 ones:

| # | Item | Scope |
|---|---|---|
| 10 | Activity-log archival Storage-upload edge function | Phase 7 |
| 11 | PDF/DOCX generation for exports | Phase 7 |
| 12 | Import parsers cover CSV only | Phase 7 |
| 13 | Screenshots owner-deferred | Phase 7 |
| 14 | One-stage vs two-stage testing selection UI | Phase 4 |
| 15 | Per-organisation BI parameter admin UI | Phase 4 |
| 16 | Document extraction edge function | Phase 5 |
| 17 | One-stage vs two-stage testing mode UI | Phase 5 |
| 18 | Screenshots owner-deferred | Phase 5 |
| 19 | Email dispatch edge function | Phase 6 |
| 20 | Graph or Resend provider wiring | Phase 6 |
| 21 | PDF/DOCX report generation and branding templates | Phase 6 |
| 22 | Screenshots owner-deferred | Phase 6 |
| 23 | Superadmin UI (Phase 8.1, owner-designed) | Phase 8 |
| 24 | Support-session authentication | Phase 8 |
| 25 | Tenant-side per-org email configuration UI | Phase 8 |
| 26 | AI advisory summaries | Phase 8 |
| 27 | Screenshots owner-deferred | Phase 8 |

Pre-existing items 1–9 (Phase 1–3 scope) remain as recorded.

## 9. Laws and hard rules — compliance

| Rule | Status |
|---|---|
| L1 engines are plain functions | Held — `src/lib/analyticsEngine.ts` is pure TypeScript with unit tests |
| L2 tenant boundary | Held — RLS from `jwt_org_id()` only; cross-org reads/writes refused (acceptance tests) |
| L3 DB-enforced gates | Held — population gate, sign-off gates, freeze/CAP gates are DB constraints |
| L4 hash-chained ledger | Held — every sign-off, freeze, issuance, export and archival writes a ledger entry |
| L5 append-only | Held — the archival does not physically delete activity rows (D-7C-append-only) |
| Rights, never role names | Held — `caller_has_right` / `hasRight` everywhere; sole exception is the platform portal (D-PLATFORM-RIGHTS) |
| No blocking modals | Held — `noBlockingModal.test.ts` green; allow-list is AuditFileModal, ConfirmPanel, floating-window chrome |
| One Supabase client | Held — `singleClient.test.ts` green |
| No weakened/skipped/deleted tests | Held — every red was fixed forward; no test removed |
| No major dependency bumps | Held — no dependency changed in Phases 4–8 |
| No secrets or `.openhands/` committed | Held — verified |
| One commit per task, with trailers | Held — 59 commits, standard trailers |
| No merge, no force-push | Held — PR #10 open; history linear |

## 10. Next steps for the owner

1. Review and merge PR #10 (or request changes). The agent will not merge.
2. Decide B-6E-provider (email provider) and B-5B-signoff-role-config (stage sign-off roles).
3. Schedule the deferred edge functions and UI items in `docs/NOT-DONE.md` as Phase 9+ work.
4. Optionally capture the owner-deferred screenshots.

_This report was created by an AI agent (OpenHands) on behalf of the user._
