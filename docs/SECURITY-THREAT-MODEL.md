# Provio security threat model (WP12, SECURITY-PLAN item E)

A STRIDE pass over every trust boundary, each threat mapped to the exact control in the code or the
database that mitigates it. The mapping is not prose that can drift: `src/guards/threatModel.test.ts`
fails if a named control file, RPC or test disappears. This document is the source the guard reads.

## Trust boundaries

| # | Boundary | Between |
|---|---|---|
| B1 | Browser ↔ Supabase | the SPA (anon/authenticated JWT) and PostgREST/Realtime/Storage |
| B2 | Tenant ↔ Tenant | two organisations sharing one database |
| B3 | Member ↔ Member | two users in one organisation with different roles |
| B4 | Tenant ↔ Platform | an org admin and the platform operator |
| B5 | Signed-in ↔ Anonymous | an authenticated session and the public verification/upload routes |
| B6 | Client ↔ Edge Function | the SPA and the deployed Deno functions |
| B7 | Grantee ↔ Grantor | a cross-universe view-only share |

## STRIDE per boundary

### B1 — Browser ↔ Supabase

| Threat | Control |
|---|---|
| Spoofing: a forged JWT | Supabase Auth signs the token; PostgREST verifies the signature. The app never trusts a client-supplied `org_id`. |
| Tampering: a client rewrites a row it can read | Every tenant table is RLS-protected and writes go through `security definer` RPCs that re-check the role. |
| Repudiation: a member denies an action | Every mutating RPC appends to a hash-chained ledger (`*_versions`, `audit_events`). |
| Information disclosure: an error leaks a row | RPCs return a typed refusal, never a row from another org. |
| DoS: an unbounded list | List RPCs are bounded and paged. |
| Elevation: a member calls a platform RPC | `require_platform_admin()` gates every `platform_*` RPC. |

### B2 — Tenant ↔ Tenant

| Threat | Control |
|---|---|
| A query returns another org's rows | `jwt_org_id()` is the only read path; every tenant policy is `org_id = jwt_org_id()`. Guard: `src/guards/rlsOrgEquality.test.ts`. |
| A shared universe leaks the whole tenant | The share path is a narrow projection (`shared_universe_view`), never a widening of `jwt_org_id()`. See `docs/SCALE-DECISIONS.md`. |
| A grantee writes into the grantor | The projection is `security definer` and `stable`; it returns rows, it never writes. |

### B3 — Member ↔ Member

| Threat | Control |
|---|---|
| A preparer reads a manager-only surface | Every screen checks a right; the RPC re-checks it server-side (`has_right`). |
| A member reads another member's notification | `notifications` is RLS-scoped to `recipient = auth.uid()`; sql test proves it. |

### B4 — Tenant ↔ Platform

| Threat | Control |
|---|---|
| An org admin reaches `/superadmin` | The path is configurable and unlisted; `platform_security_settings.admin_path`; the portal route checks `is_platform_admin()`. |
| A platform action is unlogged | Every `platform_*` RPC writes a reason-stamped ledger row. |
| A stolen platform session is reused | `platform_security_settings.require_platform_mfa` forces `aal2`; `require_platform_admin()` refuses until MFA is satisfied. |
| A second platform admin reads or changes the control plane | The console is the owner's alone: `require_platform_admin()` additionally requires the `platform_owners` row, so a non-owner admin gets the tenant-facing refusal from every platform RPC. Ownership is claimed once through `platform_owner_claim`; after that the bootstrap is closed. Sql test 108 proves both. |
| An org member reaches the tenant with a password when the org requires a factor | `custom_access_token_hook` withholds `org_id`/`user_role` (stamping `mfa_required`) for any session below `aal2` when `org_security_settings.require_mfa` is set, so RLS shows that session nothing. Sql test 108 proves it. |

### B5 — Signed-in ↔ Anonymous

| Threat | Control |
|---|---|
| An anonymous caller reads tenant data | The anon grant allow-list is exactly three verification functions. Guard: `src/guards/anonGrantAllowList.test.ts`. |
| A public route enumerates ids | The verify route returns a sealed certificate or "not found", never a row. |

### B6 — Client ↔ Edge Function

| Threat | Control |
|---|---|
| A function is called with a spoofed tenant | The function re-derives the tenant from the caller's JWT. |
| A secret is echoed back | The secrets function stores AES-GCM ciphertext and never returns plaintext. |
| A webhook replays | The `state` parameter is HMAC-signed and single-use. |

### B7 — Grantee ↔ Grantor

| Threat | Control |
|---|---|
| A non-Head grants a share | `share_grant` requires a Level-1/Level-2 Head attribute or Org Admin. |
| A revoked share stays visible | The projection filters `revoked_at is null and expires_at > p_now`. |
| A share outlives its expiry | Every read passes `p_now`; time is an argument. |

## Guard

`src/guards/threatModel.test.ts` asserts that every control file, RPC name and test file named in the
tables above still exists in the repository, so a control cannot be deleted without this document
failing.
