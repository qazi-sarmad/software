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

# Config control plane — progress

Branch `feature/config-control-plane`, base `phase-4-onwards` tip (`b8a7dd3`, 5A green).
Owner intent: by Monday the product has a real Super Admin control plane and Org Admin settings for
approvals, SIRA, sampling and email provider shape — configuration in portals, not SQL — and the git
tree carries the owner's name only (C3).

Every line carries the commit hash and the CI run ID, not only "green".

## Numbering LOCK (C0)

- Migrations: highest used on the base is `0030`. **Next free is `0031`.** This build uses `0031` upward.
- SQL tests: highest used is `39`. **Next free is `40`.** This build uses `40` upward.
- No parallel task may take a number without updating this line first.

## Gate baseline (start of this build, `b8a7dd3`)

- tsc exit 0; vitest 47 files / 424 tests; build exit 0; tokens PASS (68 files); shrink PASS (58 files).
- SQL: 39 test files (`00`–`39`) green, migrations and tests each applied/run twice (local harness +
  CI step 6).
- Playwright: green (CI step 7).

## C3 ownership

- New commits on this branch use the owner identity `Qazi Sarmad Ali Mahesar <qazisarmadalimahesar@gmail.com>`.
- No `Co-Authored-By` trailer, no session-URL trailer, no agent or model-vendor names in tracked content.
- Historical commit messages already on `main` / earlier branches are **not** rewritten (no force-push).

## Tasks

| Task | Status | Commit | CI run | Notes |
|---|---|---|---|---|
| C0 preflight + inventory | done | aae1b81 | 38917977436 | branch created; numbers locked; docs seeded; CI green |
| C0b ownership scrub | done | 23d915a | _with C1_ | stray agent-authored patch removed; provenance words stripped; `.openhands/` untracked |
| C1 platform DB + RPCs | done | 45d705c | 38919258533 | `0031_platform_control_plane.sql`, test `40` |
| C2 org settings DB | done | 639f1b7 | 38920609007 | `0032_org_admin_settings.sql`, test `41` |
| C3 data modules | done | 5b201b7 | 38920982962 | `src/data/platform.ts`, `src/data/orgSettings.ts` (+ sampling writes) |
| C4 Super Admin portal UI | done | 9653feb | 38938542085 | `/superadmin` route, `src/components/superadmin/*`, migration `0033`, test `42`; sign-in fix `12f9a31` |
| C4-FIX platform sign-in | done | 12f9a31 | 38938542085 | platform staff carry no org, so `loadCurrentUser` throws; ask `platform_whoami()` instead |
| C5 Org Admin settings UI | done | 8722e35 | 38938542085 | `OrgSettingsPanel` (`org_settings` inspector), profile-menu entry gated by `edit_config` |
| C6 docs + PR | done | _this commit_ | _see CI_ | inventory, PARITY §24, NOT-DONE, report; PR opened |

## CI notes

- Run `38922600512` (C4+C5, `8722e35`) was **red** at step 7: the platform-staff Playwright test timed
  out waiting for the tenant navigation strip. Root cause: `AuthContext.signInWithPassword` returned
  `{ok:false}` for a platform account because `loadCurrentUser()` throws when there is no org member
  row. Fix `61e36d8`/`12f9a31`. Run `38938542085` is green (all 7 steps).
- Both `61e36d8` and `12f9a31` are the same fix; `61e36d8` still threw because the throw happened
  inside the `try` before the platform probe. `12f9a31` wraps `loadCurrentUser()` in `.catch(() => null)`.
