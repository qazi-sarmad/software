/**
 * The hosting requirements the hosting-test Edge Function checks (C2.1, S11, F16).
 *
 * The platform asks a tenant's self-hosted Postgres whether it can host Provio. The answer depends
 * on two things the migrations require: the extensions they create, and the roles the application
 * expects. Both lists are derived from supabase/migrations and asserted against them by
 * src/lib/requiredHostingSpec.test.ts, so this file cannot drift from the migrations without a red
 * test.
 */

/** Every `create extension` the migrations perform. */
export const REQUIRED_EXTENSIONS = ['pgcrypto', 'pg_cron', 'pg_net'] as const;

/**
 * The extensions the application cannot run without. pg_cron and pg_net are scheduling extras: the
 * migrations guard their creation and the app works without them, so they are reported separately
 * rather than as a hard failure.
 */
export const CORE_EXTENSIONS = ['pgcrypto'] as const;
export const OPTIONAL_EXTENSIONS = ['pg_cron', 'pg_net'] as const;

/**
 * The roles the migrations create. The application connects as a superuser or a role with these
 * granted; without `platform_admin` the platform-control policies cannot be evaluated.
 */
export const REQUIRED_ROLES = ['platform_admin'] as const;

/**
 * A conservative floor for a single-tenant installation: the database plus room for the ledger and
 * the audit files. It is an estimate, never a promise, and the function says so in plain language.
 */
export const MIN_FREE_SPACE_BYTES = 2 * 1024 * 1024 * 1024;

/** The Postgres version floor. The migrations use `gen_random_uuid`, `jsonb` and `pg_cron` v1.5+. */
export const MIN_SERVER_VERSION_NUM = 140000;
