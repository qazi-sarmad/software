# Not done (open items with a recorded plan)

Each item below is known, is not fixed in the current branch, and has a plan. Phase 2 must
clear the first two before Phase 2 closes.

## 1. Critical: vitest and tinypool (devDependencies)

- Advisories: `vitest` 0.0.95 to 4.1.10 (critical, direct devDependency), `tinypool` 2.1.1 and below
  (critical, transitive, RCE via worker options), `@vitest/mocker` 2.1.0 to 4.1.10 (moderate,
  path traversal in redirect mocks).
- Fix: `vitest` 5.0.4. This is a **major version bump**, so it was not applied in Phase 1 (rule: stop on major bumps).
- Exposure: devDependency only. It runs in tests and CI, not in the production bundle. The tinypool
  RCE needs attacker-controlled worker options, which this repo does not take from outside.
- Plan for Phase 2 (one commit): upgrade `vitest` to 5.x, fix any test breakage, then re-run
  `npm audit` and CI. Do not merge Phase 2 until `npm audit` shows no critical advisories.

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
