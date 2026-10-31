# Deployment runbook — the three layers (D13)

Provio is a static single-page app; the **environment** is three separate deployments, and a static
host deploys only one of them. This runbook reproduces a clean deploy end to end, and it is the
document the SA-20 readiness panel points at for the two layers the database cannot see (the static
host and the build-time environment variables).

The Super Admin does **not** deploy. It says, after the fact, whether each layer is ready — see the
readiness signals in `docs/ACP-UI-CONTRACT.md` §SA-20 and `supabase/migrations/0160_readiness_signals.sql`.

---

## The three layers

| Layer | What it is | Deployed by | Readable from the database? |
|---|---|---|---|
| 1. The app | the static SPA built to `dist/`, served with a catch-all rewrite to `/index.html` | the static host (Vercel / Netlify / Cloudflare Pages / S3 + CDN) | no — verify at the host |
| 2. The Supabase side | migrations, the four storage buckets and the Edge Functions | `supabase db push` and `supabase functions deploy` (the host does **not** do this) | yes — this is the readiness signal set |
| 3. The environment variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, present at **build** time | the host's environment settings, before the build | no — verify at the host |

Without layer 3 the production shell renders empty: `src/data/client.ts` reads exactly those two
variables and every data module is inert when they are absent.

---

## Order of operations

1. **Supabase side first.** The app's build is independent, but a deploy that points at an
   un-migrated database is not ready.
2. **Environment variables second.** Set them in the host before the build runs.
3. **The app last.** Build and publish the SPA.
4. **Verify** with the SA-20 readiness panel (`/superadmin`, tab *Readiness*).

---

## Layer 2 — the Supabase side

```bash
# 1. Apply every migration. The repository ships 168+ migrations under supabase/migrations/.
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
npx supabase db push

# 2. Create the four private storage buckets (evidence, reports, archives, org-branding) with the
#    org-scoped RLS on storage.objects keyed to jwt_org_id() by path prefix (0111 / 0120). The
#    migration creates the policies; create the buckets in the project's Storage settings, or:
#    Dashboard -> Storage -> New bucket, each private.

# 3. Deploy the Edge Functions. These are NOT deployed by the static host.
npx supabase functions deploy doc-extract invite-user email-dispatch graph-oauth \
  archive-upload secrets-put hosting-test

# 4. Register the platform signing key and configure the platform email sender.
#    Both are readiness signals; the SA-20 panel shows them red until they are set.
```

The SA-20 panel's **environment** signals (`storage_buckets`, `edge_functions`) read the database's
own view where it can, and say "not evaluated" in amber where it cannot — never green by default.

---

## Layer 3 — the environment variables

Set these in the host's environment **before** the build:

| Variable | Where it comes from | If missing |
|---|---|---|
| `VITE_SUPABASE_URL` | the Supabase project's API URL | every data module is inert; the shell renders empty |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the Supabase project's publishable (anon) key | same |

Only the publishable key is used. No service-role key is ever shipped to the browser.

---

## Layer 1 — the app

```bash
npm ci
npm run build            # produces dist/
```

`vercel.json` (committed) declares `framework: vite`, `outputDirectory: dist` and the catch-all
rewrite `/(.*) -> /index.html` that the SPA router needs. On any other host, reproduce that rewrite:
every unmatched path must serve `index.html`.

---

## Verify

1. Sign in as a platform administrator and open `/superadmin`, tab **Readiness**.
2. Choose the organisation and read the three layer verdicts (platform / environment / organisation).
3. Every non-green signal carries its fix: **Fix this** deep-links to the screen that resolves it,
   **Re-check** re-runs that one signal in isolation and records the result, and **Contact Super
   Admin** raises a coded complaint with the whole issue attached.
4. A signal that reads "not evaluated" is amber by design — the panel never claims green on something
   it cannot see. Confirm the host and the build variables at the host, as this runbook describes.

## What this runbook does not cover

- The host's own account and DNS configuration.
- Backups / DR, which the deployment's database provider configures; the readiness set names them as a
  signal where the database can read them.
