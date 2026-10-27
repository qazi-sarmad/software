# Provio commercial model (WP18, SECURITY-PLAN item J)

How Provio is priced, what each tier costs to serve, and the exact free-tier-to-paid path. This is a
decision record, not a forecast: every number is a planning figure the operator can change in one
ledger write. No tenant data is involved.

## Cost drivers (monthly, per environment)

| Driver | Free-tier cost | Paid cost | Notes |
|---|---|---|---|
| Database (Postgres) | $0 | from $25 | Row volume grows with engagements, not seats |
| Auth (MAU) | included to 50k | included | SSO/SAML is a paid-tier feature |
| Storage | 1 GB free | $0.021/GB | Report bundles, board packs, archives |
| Edge Functions | 500k invocations free | $2/million | Email dispatch, doc extract, hosting test |
| Email (Resend) | 3k/month free | $20 / 50k | Escalations and notifications |
| Realtime | included | included | Pop-out sync, notification delivery |

The free tier serves a single small tenant. The first paid cost is the database plan, then storage as
sealed bundles accumulate.

## Packaging

Three meters, billed annually:

1. **Platform fee** — per tenant per year. Covers the control plane, RLS, ledger, sealing, DR.
2. **Per-seat** — active members per month (invite cap is the quota).
3. **Per-engagement** — engagements opened per year, above a bundled allowance.

| Tier | Platform fee/yr | Seats included | Engagements included | Adds |
|---|---|---|---|---|
| Starter | $6,000 | 5 | 10 | — |
| Growth | $18,000 | 25 | 60 | SSO, PITR, custom residency |
| Enterprise | $60,000 | 100 | unlimited | Dedicated region, support SLA, key custody |

## ACV bands

- Starter: $6k–$12k ACV.
- Growth: $18k–$45k ACV.
- Enterprise: $60k+ ACV.

## Free-tier → paid path

1. A tenant starts on Starter with the default invite cap and feature flags.
2. When the invite cap is hit, `platform_set_invite_cap` raises it (a platform RPC, reason-stamped).
3. When SSO or PITR is requested, `platform_set_entitlement` flips the flag; both are Growth features
   and the DR ledger (`platform_dr_settings`) records the posture change.
4. Billing is out of band: the platform records entitlement, the invoice is issued separately.

## What is enforced in code

- Invite cap: `invite_cap_settings` + the invite RPC refusal when the cap is reached.
- Feature flags / entitlements: `tenant_entitlements`, read by the entitlement gate.
- SSO: `org_sso_settings` (config-as-ledger) and the access-token hook.
- Residency: `org_settings_extra.data_residency_region` against the platform allow-list.
- DR posture: `platform_dr_settings`.

None of these is a soft upsell: each is a row the database enforces.
