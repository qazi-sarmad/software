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
| C0 preflight + inventory | in_progress | _this commit_ | _see CI_ | branch created; numbers locked; docs seeded |
| C0b ownership scrub | todo | | | |
| C1 platform DB + RPCs | todo | | | |
| C2 org settings DB | todo | | | |
| C3 data modules | todo | | | |
| C4 Super Admin portal UI | todo | | | |
| C5 Org Admin settings UI | todo | | | |
| C6 docs + PR | todo | | | |
