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

# Configuration inventory

Product law C1: every setting meant to be configurable must be changeable from the Super Admin portal
and/or the Org Admin portal (forms, dropdowns, toggles, tables) — not by editing SQL, env files or code —
except deploy secrets and connection strings.

Classes:
- **super_admin** — set by QSCorp platform staff in the Super Admin portal (`/superadmin`).
- **org_admin** — set by a tenant Org Admin in the Org Admin portal (People & Roles + Settings shell).
- **work_ui** — ordinary tenant work surfaces (not portals); listed for completeness.
- **deploy_secret** — never cleartext in any portal; shown only as "configured / missing".

Portal column: **Y** = screen shipped this build, **partial** = present but incomplete, **N** = deferred
(see NOT-DONE).

## Super Admin

| Key | Description | Class | Storage | RPC / table today | Portal screen? | Notes |
|---|---|---|---|---|---|---|
| tenant status | active / suspended | super_admin | `tenant_settings.status` | `platform_set_tenant_status` (C1) | Y (C4) | suspend is hold-to-confirm |
| feature_flags | per-tenant feature toggles | super_admin | `tenant_settings.feature_flags` jsonb | `platform_set_feature_flag` (C1) | Y (C4) | |
| ai_enabled | optional advisory features flag (product config, not provenance) | super_admin | `tenant_settings.ai_enabled` bool | `platform_enable_ai` (C1) | Y (C4) | default false |
| ai_model_endpoint | non-secret advisory endpoint | super_admin | `tenant_settings.ai_model_endpoint` text | `platform_enable_ai` (C1) | Y (C4) | if it embeds a key it is deploy_secret |
| invite cap override | per-user daily invite cap (1..100) | super_admin | `invite_cap_settings.per_user_daily` | `platform_set_invite_cap` (C1) | Y (C4) | org admin sets its own via `admin_set_invite_cap` |
| support_access_grants | time-boxed support grants (metadata only) | super_admin | `support_access_grants` | `platform_grant/revoke_support_access` (C1) | Y (C4) | ceiling 48h; no tenant business data |
| platform_trail | platform action log | super_admin | `platform_trail` | `platform_list_trail` (C1) | Y (C4) | read-only |
| email provider defaults | provider enum only | super_admin | `email_settings.provider` | (C2/C5 shape) | partial (C5) | secrets are deploy_secret |

## Org Admin

| Key | Description | Class | Storage | RPC / table today | Portal screen? | Notes |
|---|---|---|---|---|---|---|
| roles + rights bags | role definitions and right sets | org_admin | `roles.rights` | `admin_create_role`, `admin_update_role_rights`, `admin_delete_role` | Y (People & Roles, existing) | |
| scopes | per-user universe/entity/engagement scopes | org_admin | `user_scopes` | `admin_grant_scope`, `admin_revoke_scope` | Y (People & Roles, existing) | |
| reporting lines | manager links | org_admin | `org_members` | `admin_set_member_manager` | Y (People & Roles, existing) | |
| members + invite | provision members, invite cap | org_admin | `org_members`, `invite_cap_settings` | `admin_provision_member`, `admin_set_invite_cap` | Y (People & Roles, existing) | |
| entity approval rights | initiate / approve rights + required fields | org_admin | `entity_approval_settings` | `admin_set_entity_approval` | Y (C5) | closed rights keys only |
| plan approval rights | create / approve rights | org_admin | `plan_approval_settings` | `admin_set_plan_approval` | Y (C5) | |
| deployment gate rights | deploy / approve rights, SLA, escalation | org_admin | `engagement_gate_settings` | `admin_set_engagement_gate` | Y (C5) | ALTER adds SLA/escalation if missing |
| SIRA model | factors, scales, bands, aggregation | org_admin | `sira_factors`, `sira_scales`, `sira_bands`, `sira_models` | `admin_upsert_sira_factor`, `admin_set_sira_band`, `admin_set_sira_aggregation`, `admin_snapshot_sira_model` | Y (C5) | versioned snapshot |
| org sampling table | control_type / frequency / pop_band / method | org_admin | `org_sampling_table` | `seed_org_sampling_table`; CRUD `admin_upsert_sampling_row` / `admin_delete_sampling_row` (C2) | Y (C5) | method dropdown from enum |
| severity levels | name, color_token, rank | org_admin | `severity_levels` | (C2 CRUD) | Y (C5) | colour is a design token |
| methodology required_sections | optional observation tags the org requires | org_admin | `config_versions` key `methodology.required_sections` | `admin_set_org_setting` | partial (C5) | |
| email_settings (non-secret) | provider name | org_admin | `email_settings.provider` | (C2/C5 shape) | partial (C5) | provider_config secrets never shown |
| invite cap (own) | per-user daily invite cap | org_admin | `invite_cap_settings` | `admin_set_invite_cap` | Y (People & Roles, existing) | |

## Work UI (not portals — listed for completeness)

| Key | Description | Class | Storage | RPC / table today | Portal screen? | Notes |
|---|---|---|---|---|---|---|
| universes / entities CRUD | universe and entity management + approval workflow | work_ui | `universes`, `entities` | entity RPCs | work screens | |
| SIRA cycles | cycle create / publish | work_ui | `sira_cycles` | cycle RPCs | work screens | |
| plans + deployment requests | audit plan, approval, deployment gate | work_ui | `plans`, `deployment_requests` | plan RPCs | work screens | |
| populations / samples / workpapers | testing work surfaces | work_ui | `populations`, `samples`, `workpapers` | Phase 4 RPCs | work screens | |
| observations / findings / issues | findings work surface | work_ui | `observations`, `findings`, `issues` | Phase 5A RPCs | work screens | |
| reports / CAPs | reporting and corrective actions | work_ui | (Phase 6) | Phase 6 RPCs | work screens | |

## Deploy secret (never cleartext in any portal)

| Key | Description | Class | Storage | RPC / table today | Portal screen? | Notes |
|---|---|---|---|---|---|---|
| SUPABASE_URL / anon key | front-end connection | deploy_secret | env | — | "configured / missing" only | |
| service role key | server key | deploy_secret | env / Vault | — | "configured / missing" only | |
| DB URL | database connection string | deploy_secret | env / Vault | — | "configured / missing" only | |
| provider API keys | Resend / Graph credentials | deploy_secret | Vault | `email_settings.provider_config` | "configured / missing" only | Vault integration deferred |
| auth hook configuration | JWT org claim hook | deploy_secret | Supabase config | `0010_auth_hook.sql` | "configured / missing" only | |
