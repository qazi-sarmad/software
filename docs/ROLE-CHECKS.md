# Role-name check inventory (TASK 2F-2a)

Generated for Phase 2, task 2F-2a. This file is the input to 2F-2b (replace RIGHT and TEAM
checks with rights). It lists every place where the product decides something by comparing a
**role name** (`cia`, `org_admin`, `audit_manager`, `preparer`, `reviewer`, `observer`,
`auditee`, `platform_admin`) or a **team role name** (`lead`, `preparer`, `reviewer`,
`observer`).

Scope: `src/**` (production paths, `.ts`/`.tsx` that are not `*.test.*`) and
`supabase/migrations/**`. Test files and SQL fixtures are listed separately under
"Test and seed occurrences" — they pin the contract and must stay green, but they are not
enforcement.

## Categories

| Category | Meaning | Action in 2F-2b |
|---|---|---|
| **RIGHT** | A permission decision made by comparing a role name. | **Replace** with a rights check (`caller_has_right` in SQL, `hasRight` in the app). |
| **TEAM** | A permission decision made by comparing a team role name. | **Replace** with a rights check. |
| **SCOPE** | A decision about *which rows/records* a user may see, driven by `user_scopes`/scope ids. Not a permission. | Keep. May consult a right for the "all scopes" shortcut (`view_all_scopes`). |
| **DISPLAY** | A label, ledger metadata, seed value or config data. Not enforcement. | Keep unchanged. |

## Classification table

### App — `src/lib/access.ts`

| Line | Code | Category | Note |
|---|---|---|---|
| 25 | `canAccessUniverse`: `user.role === 'org_admin'` → false | RIGHT | org_admin has no audit-content right. |
| 26 | `user.role === 'cia' \|\| 'observer'` → all universes | RIGHT | `view_all_scopes`. |
| 44 | `canAccessEntity`: `user.role === 'org_admin'` → false | RIGHT | as line 25. |
| 48 | `user.role === 'cia' \|\| 'observer'` → all entities | RIGHT | `view_all_scopes`. |
| 60 | `filterUniverses`: `user.role === 'org_admin'` → `[]` | RIGHT | as line 25. |
| 73 | `filterEntities`: `user.role === 'org_admin'` → `[]` | RIGHT | as line 25. |
| 91 | `filterEngagements`: `user.role === 'org_admin'` → `[]` | RIGHT | as line 25. |
| 107 | `filterControls`: `org_admin \|\| observer` → `[]` | RIGHT | observer = `read_only`. |
| 120 | `filterWorkpapers`: `org_admin \|\| observer` → `[]` | RIGHT | as line 107. |
| 136 | `filterObservations`: `org_admin \|\| observer` → `[]` | RIGHT | as line 107. |
| 153 | `filterIssues`: `user.role === 'org_admin'` → `[]` | RIGHT | as line 25. |
| 157 | `filterIssues`: `user.role === 'observer'` → issued only | RIGHT | observer = `read_only`. |
| 173 | `filterComments`: `org_admin \|\| observer` → `[]` | RIGHT | as line 107. |
| 207 | `canPerformAction`: `user.role === 'org_admin'` → denied | RIGHT | org_admin has no audit-content right. |
| 226 | `create_workpaper`/`edit_workpaper`: `observer` → denied | RIGHT | observer = `read_only`. |
| 229 | same: `auditee` → denied | RIGHT | auditee = `read_only`. |
| 237 | `run_test`/`finalize_test`: `observer` → denied | RIGHT | as line 226. |
| 240 | same: `auditee` → denied | RIGHT | as line 226. |
| 248 | `raise_finding`/`raise_observation`: `observer` → denied | RIGHT | as line 226. |
| 251 | same: `auditee` → denied | RIGHT | as line 226. |
| 259 | `review_sign_off`/`sign_off`: `observer` → denied | RIGHT | as line 226. |
| 262 | same: `auditee` → denied | RIGHT | as line 226. |
| 265 | same: `preparer` → denied | RIGHT | preparer lacks `review_and_approve`. |
| 269 | same: four-eyes `preparerId === user.id` | RIGHT | Four-eyes invariant (§4.4) — keep as invariant, expressed over ids. |
| 279 | `close_issue`: `observer` → denied | RIGHT | as line 226. |
| 282 | same: `auditee` → denied | RIGHT | as line 226. |
| 285 | same: `preparer` → denied | RIGHT | preparer lacks `review_and_approve`. |
| 292 | `audit_sign_off`: `observer\|auditee\|preparer` → denied | RIGHT | needs `review_and_approve`+ (manager). |
| 295 | same: `reviewer` → denied | RIGHT | reviewer lacks the manager-level right. |
| 302 | `propose_ad_hoc`: `observer\|auditee\|preparer\|reviewer` → denied | RIGHT | needs `manage_engagements`. |
| 309 | `approve_plan`: `role !== 'cia'` → denied | RIGHT | `approve_plan`. |
| 316 | `approve`: `preparer\|auditee\|observer` → denied | RIGHT | `review_and_approve`. |
| 323 | `issue_report`: `role !== 'cia'` → denied | RIGHT | `approve_plan` (CIA-level). |
| 330 | `reopen`: `auditee` → denied | RIGHT | `can_reopen`. |
| 333 | `reopen`: `preparer\|observer` → denied | RIGHT | `can_reopen`. |
| 336 | `reopen`: `role !== 'cia'` → denied | RIGHT | `can_reopen`. |
| 368 | `canChangeCapDueDate(role)`: `audit_manager\|cia` | RIGHT | maps to the `cap_change_due_date` capability. |

### App — other production files

| File | Line | Code | Category | Note |
|---|---|---|---|---|
| `src/lib/orgCapabilities.ts` | 79 | `ROLE_TO_DESIGNATION[user.role]` | RIGHT | role→designation fallback used for capability lookup. |
| `src/lib/orgCapabilities.ts` | 100 | `user.role === 'org_admin'` → denied | RIGHT | as access.ts line 25. |
| `src/context/AppContext.tsx` | 265 | `addEntity`: `role !== 'cia' && !== 'org_admin'` | RIGHT | `edit_config`. |
| `src/context/AppContext.tsx` | 236,283,314,378,418,453,493,537,574 | `actorRole: currentUser.role` | DISPLAY | ledger/comment metadata. |
| `src/context/AppContext.tsx` | 609 | `actorRole: 'auditee'` (external evidence) | DISPLAY | ledger metadata for the external uploader. |
| `src/hooks/useScopedData.ts` | 110 | `currentUser.role === 'org_admin'` → `[]` | RIGHT | as access.ts line 25. |
| `src/hooks/useScopedData.ts` | 112 | `currentUser.role === 'cia'` → all CAPs | RIGHT | `view_all_scopes`. |
| `src/hooks/useScopedData.ts` | 271 | `currentUser.role === 'org_admin'` → `[]` (ledger) | RIGHT | as access.ts line 25. |
| `src/hooks/useScopedData.ts` | 273 | `currentUser.role === 'cia'` → all ledger | RIGHT | `view_all_scopes`. |
| `src/components/common/NavStrip.tsx` | 35 | `org_admin` → no tabs | RIGHT | org_admin has no audit-content right. |
| `src/components/common/NavStrip.tsx` | 37 | `observer` → Executive + Issues only | RIGHT | `read_only`. |
| `src/components/common/NavStrip.tsx` | 41 | `auditee` → Executive + Universe + Issues | RIGHT | `read_only`. |
| `src/components/universe/AuditUniverseTab.tsx` | 11 | `canAdd = role === 'cia' \|\| 'org_admin'` | RIGHT | `edit_config`. |
| `src/components/glassbox/GlassBoxPublicRoute.tsx` | 114 | `actorRole: 'auditee'` | DISPLAY | ledger metadata. |
| `src/App.tsx` | 214 | `role: 'auditee'` on the zero-scope token holder | DISPLAY | label of the anonymous public principal. |
| `src/data/client.ts` | 6 | `ROLE_SLUGS` allow-list of the seven slugs | RIGHT | the role registry used to validate a session's slug. |

### Database — `supabase/migrations`

| File | Line | Code | Category | Note |
|---|---|---|---|---|
| `0007_functions.sql` | 22 | `is_cia()` = `jwt_user_role() = 'cia'` | RIGHT | role-name predicate. |
| `0007_functions.sql` | 25 | `is_org_admin()` = `jwt_user_role() = 'org_admin'` | RIGHT | role-name predicate. |
| `0008_rls.sql` | 60 | `orgs` select: `jwt_user_role() = 'platform_admin'` | RIGHT | platform detection (no org). |
| `0008_rls.sql` | 67–88 | `roles`/`org_members`/`user_scopes`/`config_versions` policies via `is_org_admin()`/`is_cia()` | RIGHT | RLS enforcement by role name. |
| `0008_rls.sql` | 95–104 | `universes`/`entities` policies via `is_cia()`/`is_org_admin()` | RIGHT | as above. |
| `0008_rls.sql` | 111–120 | `engagements`/`engagement_members` policies via `is_cia()` | RIGHT | as above. |
| `0008_rls.sql` | 126–147 | SIRA/plans policies via `is_cia()`/`is_org_admin()` | RIGHT | as above. |
| `0008_rls.sql` | 233–246 | `risks_library`/`sira_*` policies | RIGHT | as above. |
| `0008_rls.sql` | 252,254 | `platform_trail` policy `jwt_user_role() = 'platform_admin'` | RIGHT | platform detection. |
| `0008_rls.sql` | 274,318 | `create role platform_admin` / grants | RIGHT | Postgres role, not app role. |
| `0010_auth_hook.sql` | 45 | stamps `user_role = 'platform_admin'` | RIGHT | platform claim. |
| `0012_rights_closed.sql` | 34–38 | seed rights matrix keyed by `slug` | RIGHT | role→rights seed data; this is the mapping that makes rights work. Keep as data. |
| `0013_engagement_team.sql` | 3 | `team_role in ('lead','preparer','reviewer','observer')` | TEAM | team-role vocabulary. |
| `0013_engagement_team.sql` | 9–12 | `team_role_rights` seed per team role | TEAM | team-role→rights mapping. Keep as data. |
| `0013_engagement_team.sql` | 49 | `m.team_role = 'lead'` in `assign_team_role` | TEAM | lead-based assignment permission. |

## Totals

| Category | Count |
|---|---|
| RIGHT | 66 |
| TEAM | 3 |
| SCOPE | 0 (scope decisions use `user_scopes`/scope ids, not role names) |
| DISPLAY | 12 |

Totals by area: app production files **48** RIGHT (41 in `access.ts`, 7 elsewhere), **0** TEAM,
**12** DISPLAY. Database migrations **18** RIGHT, **3** TEAM.

## Test and seed occurrences (not enforcement)

These files compare or list role names, but they are tests or fixtures that pin the contract.
They are out of scope for replacement and must stay green through 2F-2b.

| File | What it does |
|---|---|
| `supabase/tests/00_lib.sql` (86–99) | Seeds the seven roles per org with the 0012 rights matrix. |
| `supabase/tests/19_rights_closed.sql` | Asserts the rights matrix per slug. |
| `supabase/tests/20_engagement_team.sql` | Asserts `team_role_rights` and `assign_team_role`. |
| `supabase/tests/21_roles_config.sql` | Asserts the role-config guard and history. |
| `supabase/tests/16_auth_hook.sql` | Asserts the hook stamps `user_role` = `cia` / `platform_admin`. |
| `supabase/tests/01–18` | Use `provio_test.as_user(..., '<slug>')` to assume an identity. |
| `src/lib/access.test.ts` | Pins `canPerformAction` behaviour per role. |
| `src/test/testUsers.ts` | Test helper that looks up a demo user by role. |
| `src/data/demoSeed.ts`, `src/data/initialData.ts` | Demo-tenant seed (dev only; not in the production bundle). |
| `src/types/index.ts` | The `Role` union type. |

## Unclassified

None. Every role-name or team-role-name occurrence in scope was classified as RIGHT, TEAM,
SCOPE or DISPLAY, or listed under "Test and seed occurrences".

## Notes for 2F-2b

- `src/lib/access.ts` is the single largest concentration of RIGHT checks. 2F-2b replaces the
  `user.role === '<name>'` comparisons with `hasRight(user, '<right>')` against the rights from
  the session, and keeps the four-eyes rule (an id comparison, not a role name).
- SQL RIGHT checks in `0007`/`0008` become `caller_has_right('<right>')`. `is_cia()`/`is_org_admin()`
  are removed once no policy calls them.
- SQL TEAM checks in `0013` stay keyed by team role, but the *permission* to assign becomes a
  rights check (`manage_engagements` / `manage_team`), which the function already consults.
- `platform_admin` is not a tenant role: it carries no `org_id` and reads no tenant table. Its
  detection stays a role-name check and is recorded as a decision.
