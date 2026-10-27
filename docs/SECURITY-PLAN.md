# Security & enterprise-readiness plan (WP9–WP18)

This plan closes the security gaps that block enterprise procurement. Every item is implemented,
tested and closed here — none is parked. The whole workstream obeys the four project laws: L1
deterministic (no AI, no model calls), tenant data never leaves the tenant (RLS + `jwt_org_id()`),
config-as-ledger (every setting is a versioned, reason-stamped, append-only ledger row), and pure
functions under `src/lib/` or `src/data/` (components never import the Supabase client).

## Scope and decisions

| Item | Gap | Implementation | Where |
|---|---|---|---|
| A | No MFA on the platform admin; `/superadmin` is a guessable path with no second factor | Supabase Auth TOTP enrolment/verification in the app; `platform_security_settings.require_platform_mfa`; `require_platform_admin()` refuses every platform RPC until the session is `aal2`; the portal route becomes a configurable unlisted path (`platform_admin_path`) with no nav entry, `noindex` and `robots.txt` disallow | `0100_platform_security.sql`, `src/data/mfa.ts`, `src/components/auth/Mfa*.tsx` |
| B | No security headers / CSP | `<meta http-equiv="Content-Security-Policy">` in `index.html` (strict, no external origins — fonts are self-hosted), `public/_headers` (HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) for CDN hosts, and the same headers on the Vite dev/preview server, `public/robots.txt` | `index.html`, `public/_headers`, `public/robots.txt`, `vite.config.ts` |
| C | No SSO/SAML/OIDC | `sso_providers` registry + per-org `org_sso_settings` (config-as-ledger); the access-token hook withholds `org_id`/`user_role` when an org enforces SSO and the session was not SSO-authenticated, so RLS hides everything; sign-in screen routes a known SSO domain; org-admin UI | `0100_platform_security.sql`, `src/data/sso.ts`, `src/components/admin/SsoPanel.tsx` |
| D | No automated accessibility testing; no live regions | `@axe-core/playwright` gate over the contract screens; a global `role="status"`/`aria-live` announcer for sealed / notification / error state changes | `e2e/a11y.spec.ts`, `src/components/common/LiveAnnouncer.tsx` |
| E | No threat model / pen-test doc | `docs/SECURITY-THREAT-MODEL.md` — STRIDE per trust boundary, each threat mapped to the exact code or RLS control that mitigates it, plus a guard that fails if a mapped control disappears | `docs/SECURITY-THREAT-MODEL.md`, `src/guards/threatModel.test.ts` |
| F | No backup/PITR/DR runbook | `docs/DR-RUNBOOK.md` + `platform_dr_settings` (config-as-ledger) + `platform_record_restore_test`; the runbook states the free-tier baseline and the exact upgrade path | `0100_platform_security.sql`, `docs/DR-RUNBOOK.md` |
| G | No load test | `scripts/load-test.mjs` — deterministic concurrent-org soak against the local stack (N orgs × M sessions), reports p50/p95 and asserts zero cross-tenant reads | `scripts/load-test.mjs` |
| H | No right-to-erasure or configurable residency | `data_erasure_requests` + append-only `data_erasure_events`; `erasure_execute` pseudonymises subject PII and refuses under legal hold; `org_settings_extra.data_residency_region` + a platform allow-list | `0101_data_lifecycle_crypto.sql`, `src/data/erasure.ts` |
| I | Crypto agility / key rotation | `signing_algorithms` registry (Ed25519 active, Ed448 active, ES256 deprecated, ML-DSA-65 planned); `signing_keys.key_version`; `rotate_signing_key`; `rotate_due_signing_keys(p_now)` for constant rotation; verification resolves the key by the `key_id` stored on every signature | `0101_data_lifecycle_crypto.sql`, `src/lib/anchoring.ts` |
| J | No commercial model | `docs/COMMERCIAL-MODEL.md` — cost model, ACV bands, packaging (platform fee + per-seat + per-engagement), and the free-tier→paid upgrade path | `docs/COMMERCIAL-MODEL.md` |

## Design laws for this workstream

1. **No new anonymous surface.** The anon grant allow-list stays at exactly three verification
   functions (`src/guards/anonGrantAllowList.test.ts`). SSO domain lookup and MFA status are read
   after authentication, never before.
2. **One choke point per control.** MFA is enforced inside `require_platform_admin()` (every
   platform RPC calls it). SSO is enforced inside `custom_access_token_hook` (the only writer of
   `org_id`). Neither is spread across call sites.
3. **Config-as-ledger.** Every security setting is a row with a `reason`, an append-only
   hash-chained `*_versions` table, and a definer RPC that stamps actor and time. The ledger is the
   record; nothing is hard-coded.
4. **Time is an argument.** `rotate_due_signing_keys(p_now)`, `erasure` timestamps and every pure
   helper take time in, never read a clock.
5. **Immutability is preserved.** Erasure pseudonymises personal columns and appends an erasure
   event; it never rewrites a sealed hash. Key rotation retires a key and mints a new `key_version`;
   it never deletes or re-signs a historic root.
