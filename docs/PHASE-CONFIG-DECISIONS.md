# Config control plane — decisions

Every entry: number, task, unclear point, options, choice, reason, how to reverse.

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
