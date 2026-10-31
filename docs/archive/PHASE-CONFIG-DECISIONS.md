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

# Config control plane — decisions

Every entry: number, task, unclear point, options, choice, reason, how to reverse.

## D-C4 — Super Admin portal route and identity probe

Task C4. Unclear point: spec §24 says the portal is "separate login with mandatory MFA" and
"data-blind", but the app has one sign-in and one `/` shell. Options: (a) build a second auth
stack/MFA flow; (b) a `/superadmin` route that reuses the existing session, shows the sign-in
screen for an unauthenticated visitor, and re-checks the platform role in the database.
Choice: (b). Reason: MFA is an auth-provider setting (recorded as owner-deferred in
PHASE-CONFIG-BLOCKERS.md); the security property that matters now — data-blindness and refusal of
tenant sessions — is enforced by the platform RPCs (`require_platform_admin`), proven by SQL test 42
and by the Playwright denial test. `platform_whoami()` is the one read that is safe for a tenant
(it returns `false`, not an error). How to reverse: delete the `/superadmin` route and the
`SuperAdminPortal` component; nothing else references them.

## D-C5 — Org Admin settings entry point

Task C5. Unclear point: the settings must be changeable from the Org Admin portal, but the existing
admin surface is the People & Roles inspector. Options: (a) a new inspector type; (b) a new route.
Choice: (a) `org_settings` inspector type, reached from the profile menu and gated by
`hasRight(currentUser, 'edit_config')`. Reason: consistent with People & Roles (an InspectorType the
record view already renders), and the record view is non-blocking. The DB re-checks `edit_config`.
How to reverse: remove the `org_settings` InspectorType and the menu entry.

## D-C5-SAMPLING-SIGNATURE

Task C5. Unclear point: `listSamplingRules(orgId)` required an org id the caller does not know (RLS
already scopes rows to the JWT org). Options: (a) pass the org from context; (b) make the argument
optional. Choice: (b) — optional argument; when omitted the RLS policy scopes to `jwt_org_id()`.
Reason: fewer ways to pass the wrong tenant. How to reverse: restore the required argument.


## D-C3 — AI provenance stripped; owner sole author

The repository is the owner's work and property. All AI-agent authorship, co-author and session
provenance is stripped from tracked files on this branch (C0b), and no new commits carry agent,
co-author or session trailers. New commits on this branch use the owner identity
`Qazi Sarmad Ali Mahesar <qazisarmadalimahesar@gmail.com>` only. Historical commit messages already on
`main` or earlier branches are NOT rewritten (no force-push, no history rewrite). Product flags such as
`ai_enabled` are configuration, not provenance, and are retained.
Verification: `rg -i 'co-authored-by:|claude-session|openhands|all-hands\.dev|created by an ai|ai agent|noreply@anthropic|chatgpt|openai\.com/codex' --glob '!.git/*'` must return no hits in tracked
content except this decision line.

How to reverse: not applicable (owner policy).

## D-C1 — platform control-plane shape

Task C1. Unclear point: spec §24 lists platform functions but no table shapes; the existing
`platform_trail` (0005) has `tenant_id/object_type/object_id/ts` and no `payload`.
Options: (a) create a new trail table; (b) ALTER `platform_trail` to add `payload`.
Choice: (b) — extend in place (M1). Reason: one trail table, no duplicate; M1's prohibition on
duplicate objects without a preceding DROP still holds. How to reverse: `alter table platform_trail
drop column payload`.

Choice: `tenant_settings` holds `status`, `feature_flags`, `usage_quota`, `ai_enabled`,
`ai_model_endpoint`. Reason: one row per tenant; RLS is platform-only. How to reverse: drop the table.

Choice: platform helper functions `is_platform_admin()` / `require_platform_admin()` read
`user_role` from the JWT — this is the sole platform exception to "rights, never role names"
(D-PLATFORM-RIGHTS). Reason: the platform has no org and no rights bag. How to reverse: drop the
helpers and route through a rights bag if the platform ever gains one.

Choice: internal helpers `support_access_create` and `platform_log` are NOT granted to
`authenticated`; only the security-definer RPCs reach them. Reason: a direct grant on
`support_access_create` would bypass every guard. How to reverse: re-grant execute.

Choice: the platform admin may read `invite_cap_settings` and `tenant_metadata` (quotas and
metadata, not tenant business content). Reason: the Super Admin portal must display the cap/quota
it set. How to reverse: drop the `icap_settings_platform_select` policy.

Choice: support-grant duration ceiling read from `platform_settings.support_grant_max_hours`
(default 48). Reason: config-not-code. How to reverse: `update platform_settings ...`.

## D-C2 — org settings surfaces

Task C2. Unclear point: which org settings lacked a portal-editable path.
Options: (a) leave sampling/severity/email to SQL; (b) add CRUD RPCs.
Choice: (b). Added `admin_upsert_sampling_row`, `admin_delete_sampling_row`,
`admin_upsert_severity_level`, `admin_delete_severity_level`, `admin_set_email_provider`. Reason: the
product law — configuration in portals, not SQL. How to reverse: drop the functions.

Choice: `email_settings` created here (it did not exist). `provider_config` is a secret: tenant roles
read only the non-secret columns (`org_id, provider, from_address, updated_at`) via column grants,
never `provider_config`; the platform admin reads the row for metadata. Reason: no secret in a tenant
surface. How to reverse: drop the table.

Choice: writes are logged to the org's hash-chained configuration log via `admin_log_change`; no
direct INSERT/UPDATE/DELETE policy on `org_sampling_table`, `severity_levels` or `email_settings` for
tenant roles. Reason: auditable, RPC-only writes. How to reverse: add a policy.

## D-C3 — data-module layout

Task C3. Unclear point: `src/data/sampling.ts` already had `listSamplingRules`; C2 adds sampling
writes. Options: (a) duplicate them in a new `orgSettings.ts`; (b) put the sampling writes in
`sampling.ts` and keep `orgSettings.ts` for severity and email only.
Choice: (b). Reason: one home per table; M1 in the app layer too. How to reverse: move the two
functions. Modules are inert without Supabase env vars: reads return empty, writes report the
module is not configured (tested in `src/data/*.test.ts`).
