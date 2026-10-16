# Phases 4–8 — decisions

Decision order: (a) `docs/SPEC-v10.md`; (b) the Laws; (c) the simplest option that obeys the Laws;
(d) best for multi-tenant, auditable, configuration-not-code, deterministic. Never an option that
weakens RLS, the population gate, the ledger, the hash chains or a test.

Entry format: number, task, unclear point, options, choice, reason, how to reverse.

---

## D-PLATFORM-RIGHTS (first use: 8A)

The platform portal (Phase 8) is the sole place that may read `user_role` from the JWT (for example
`user_role = 'platform_admin'`). All org-product RPCs and application code continue to use only
`caller_has_right` / `hasRight`. Platform checks must not leak into org RPCs.
Reason: §24 requires a platform role with no tenant business access; the tenant boundary is rights,
so the one exception is scoped to platform-only functions and platform-only tables.
Reverse: remove the `platform_admin` branch from the Phase 8 functions; nothing in Phases 4–7 reads it.

## D-H0-USERS

`e2e/global-setup.ts` already creates `ayesha.khan@provio-test.invalid` (Org A `org_admin`) and
`bilal.ahmed@provio-test.invalid` (Org A `preparer`). No new users are created for this build; the
Playwright tests use these two. Reason: they already exist and the setup is idempotent.
Reverse: revert the `e2e/` changes of this build.
