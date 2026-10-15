# Not done (open items with a recorded plan)

Each item below is known, is not fixed in the current branch, and has a plan. Phase 2 must
clear the first two before Phase 2 closes.

## 1. vitest and tinypool advisories (resolved in Phase 2, task 2A)

- Advisories: `vitest` 0.0.95 to 4.1.10 (critical, direct devDependency), `tinypool` 2.1.1 and below
  (critical, transitive, RCE via worker options), `@vitest/mocker` 2.1.0 to 4.1.10 (moderate,
  path traversal in redirect mocks).
- Fix applied: `vitest` upgraded to `^5.0.4` on branch `phase-2-access` (commit `f73d86b`), which is a
  **major version bump** and was therefore held back from Phase 1. `npm audit --audit-level=critical`
  now exits 0 (was 2 critical). CI run 38696591808 green. Only `package.json` and `package-lock.json`
  changed.

## 2. Dependency pin (resolved in Phase 1, recorded here for the audit trail)

- `source-map-js` 1.2.1 had a high-severity event-loop DoS. Pinned to 1.2.2 with an npm override.
  Production audit at high level is clean.

## 3. Per-user passwords in end-to-end tests

- Today the end-to-end setup generates one random password per CI run and sets it on all five
  synthetic test users in `provio-test`. The password is held only in that run's environment
  and is not written to the repo.
- Improvement: give each test user its own random password per run, so one leaked value does not open all five accounts.
- Priority: low. The accounts are synthetic and hold no client data.

## 4. Browser coverage

- CI runs Chromium only. Phase 4 and Phase 9 require Firefox and WebKit in Playwright.

## 5. Hosted test secret carries a trailing newline (owner action)

- `TEST_SUPABASE_DB_URL` still carries a trailing newline. The agent's token has no `secrets:write`
  (403) and no Supabase token exists, so the secret cannot be re-set from the agent environment.
- Until it is re-set, CI step 6 and `supabase/tests/15_ledger_concurrency.sql` strip whitespace.
- Owner: `printf '%s' "$URL" | gh secret set TEST_SUPABASE_DB_URL`, then remove both strips.

## 6. Administration portal covers People and Roles only (Phase 2 scope)

- §23 lists the whole Org Admin portal. Phase 2 built the People and Roles parts (members, roles,
  rights, scopes, reporting lines, invite cap). Organisation settings, structure, controls,
  methodology, the risk model, workflow, SLA and escalation, finding structure, notifications,
  BI parameters, templates and branding, export and retention, and AI remain not built.
- Priority: medium. The remaining parts are Phase 3+ work; each is a separate task.
