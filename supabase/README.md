# Provio — Supabase backend

One Supabase project hosts all tenants. Isolation is by `org_id` plus row-level security (spec §3, §25.2).

## Migrations

Run in order. CI (`ci.yml`, step 6) applies every file in `supabase/migrations/` and then every file in
`supabase/tests/` to the `provio-test` project on each run. Migrations are idempotent so re-application is safe.

| File | Purpose |
|---|---|
| `0001_extensions.sql` | `extensions` schema, `pgcrypto` for `digest()` |
| `0002_identity.sql` | orgs, platform_admins, roles (with `slug`), org_members, user_scopes |
| `0003_structure.sql` | universes, entities |
| `0004_testing.sql` | engagements, populations and the testing fixtures |
| `0005_logging.sql` | ledger, activity log, config versions, notifications, outbox |
| `0006_invariants.sql` | append-only triggers, ledger-chain enforcement, sealed-read-only guards, four-eyes |
| `0007_functions.sql` | `canonical_payload`, `append_ledger_entry`, `verify_ledger`, `reopen_engagement`, scope helpers |
| `0008_rls.sql` | RLS on every table, policies, application role grants |
| `0009_jwt_pinning.sql` | `org_id_from_header` (always null), `pin_org_id` trigger |
| `0010_auth_hook.sql` | `custom_access_token_hook` — stamps `org_id` and `user_role` into the JWT |

## Access-token hook

`org_id` and `user_role` are custom JWT claims. Only the database sets them, through
`public.custom_access_token_hook`, wired to Supabase Auth:

```
alter database postgres set "supabase.auth.hook" = 'public.custom_access_token_hook';
```

or in the dashboard under Authentication → Hooks → Customize Access Token. A user with no
`org_members` row gets neither claim and therefore sees nothing: there is no default role and no
fallback org (spec §4.5). `pin_org_id` refuses any insert whose `org_id` is not the session claim, so
no request header or body can change which organisation a write lands in.

## Extensions

`pgcrypto` is required (hashing). The concurrency test (`tests/15`) uses `dblink`, created
`if not exists` by the test. Both are in Supabase's supported extension set.

## Running the SQL tests locally

```
createdb provio_local
# apply the auth shim once as a superuser, then the migrations
psql -d provio_local -v ON_ERROR_STOP=1 -f /path/to/local-shim.sql   # provides the `auth` schema
for f in supabase/migrations/*.sql; do psql -d provio_local -v ON_ERROR_STOP=1 -f "$f"; done
for f in supabase/tests/*.sql; do psql -d provio_local -v ON_ERROR_STOP=1 -f "$f"; done
```

`tests/15` reads `TEST_SUPABASE_DB_URL` (the URL CI passes); it falls back to the local database when unset.

## Decisions where the spec was silent

- **Org claim source.** The spec requires RLS derived from the JWT (§25.2) but does not name the
  claim. Chosen: `org_id`, set only by the access-token hook. `org_id_from_header` exists solely to
  prove a header can never supply an org.
- **Platform staff.** They are not tenant members: `platform_admins` carries the user id and no
  `org_id`, and the hook stamps `user_role = 'platform_admin'` with no org. The platform role reads
  no tenant business table (spec §24, test 3).
- **Role machine name.** Roles carry a `slug` alongside the display `name`; the slug is what goes in
  the JWT claim and in policies, so a rename in the admin portal cannot break enforcement.
