# SCALE-1 decisions

One record per decision that changed the build, in the order taken. Format: what was decided, why,
and what it constrains later. These are durable; the working notes live in the daily log.

## D-S1-FONTS-OFL — the dependency-licence exception for self-hosted Google Fonts (WP-F)

**Decision.** The self-hosted report and UI fonts are the `@fontsource/*` packages, which redistribute
Google Fonts. Every family in the catalogue is licensed under the SIL Open Font Licence 1.1 (OFL-1.1).
This is a **recorded exception** to the standing rule that dependencies must be MIT, Apache-2.0 or BSD.

**Why OFL is acceptable here.** OFL-1.1 permits use, modification, embedding and redistribution of the
font software, including embedding the font inside a document (a PDF) and shipping it inside an
application bundle. It requires only that the font is not sold on its own and that the licence notice
travels with the font files. `@fontsource` ships the OFL notice in each package (`LICENSE`), so the
notice travels with the bundle. The fonts are not modified. Nothing in the product relicenses the font.

**What it constrains.**
- Only families listed in `src/lib/render/fonts.ts` may be used, and each must be OFL (or otherwise
  recorded here). Adding a non-OFL family is a new decision, not a silent change.
- The font files are shipped as-is; the build must not strip the package `LICENSE`.
- This exception is for *fonts only*. It does not widen the rule for any other dependency.

**Families covered (all OFL-1.1).** Inter, IBM Plex Sans, Source Serif 4, Lora, Merriweather,
Libre Baskerville.

## D-S1-FONTS-PIN — exact font versions are pinned

**Decision.** The font packages are pinned to exact versions in `package.json` (no `^`), and the
lockfile records the exact resolution. Font bytes enter the report's render hash, so an unpinned font
could change a rendered report without a code change.

**Why.** A report must render byte-identically twice, and the same format must render the same bytes
after a redeploy. A floating font version breaks that. Pinning makes the bytes a function of the
format, not of when the build ran.

**What it constrains.** A font upgrade is a deliberate, reviewed change that re-baselines the render
hashes, never an automatic patch bump.

## D-S1-FONTS-EMBED — fonts are embedded, not referenced

**Decision.** The renderer embeds the font program in the PDF (`embedCustomFont` in
`src/lib/render/pdf.ts`), with a subset attempt, a full-embed fallback (WOFF2 needs this: pdf-lib's
subsetter only reads raw TrueType), and a standard-font fallback that never fails the render.

**Why.** An embedded face makes the PDF self-contained: it renders the same everywhere, offline, and
never phones a font CDN. It is also what makes the "zero operational cost" claim true — there is no
font server to run.

## D-S1-FONTS-FREE — every external link is zero operational cost

**Decision.** Anything in this build that could touch an external source is chosen to cost nothing to
operate, or to be the tenant's own cost, never a platform fee.

| Need | Choice | Cost basis |
|---|---|---|
| Report + UI fonts | `@fontsource/*`, self-hosted, embedded | Bundled. No font service, no API key, no per-render fee |
| Email delivery | **Microsoft Graph** (the existing `graph-oauth` path) | The tenant's own Microsoft 365. See the correction below |
| SSO | **Microsoft Graph OAuth** | The tenant's own Microsoft 365 tenancy |
| Charts | D3 (already bundled) | No charting SaaS |
| Icons | in-house SVG (`src/components/common/Icons.tsx`) | No icon CDN |
| Connectors | local mock servers in tests; credentials via the wizard only | No live paid API in the build or the tests |

**Correction to `docs/UX-GAP-ANALYSIS.md`.** That document's table named an "existing SMTP path" for
email. That is wrong and is corrected here and in the document: **email goes through Microsoft Graph**,
never basic-auth SMTP (which Microsoft is retiring). The build must not add or rely on an SMTP path.

**Zero-cost precision.** "No per-seat fee" for Graph SSO and Graph mail holds **only if the tenant
already has Microsoft 365**. Where it does not, the cost is the tenant's to acquire, not the platform's
to absorb. The platform itself adds no per-seat or per-render charge for any of the above.

## D-S1-SHARE-RLS — the cross-universe share RLS shape (WP2, §2)

**Decision.** Cross-universe view-only sharing is **intra-organisation**. A share moves read access
between two *universes of the same tenant*, for a grantee who is already a member of that tenant. The
law "data never leaves the tenant" is untouched: the share is never a cross-*org* read path.

**The shape (migration `0095_scale_harden_sharing_preflight.sql`).**

- `universe_shares(id, org_id, universe_id, grantee_user_id, granted_by, expires_at, revoked_at,
  revoke_reason, created_at)`, org-scoped, RLS on. The select policy keeps `org_id = jwt_org_id()`
  **and** the row must belong to the caller (`grantee_user_id = auth.uid()` or `granted_by = auth.uid()`).
- The existing read policies (`universes_select`, `entities_select`, `engagements_select`) keep their
  `org_id = jwt_org_id()` clause **verbatim** and add one disjunct:
  `or public.has_active_share(<universe_id>)`. Because the org equality is still required, the share
  is an *additional restriction* on which same-tenant rows are visible, never a relaxation of the
  tenant boundary. `has_active_share` is `security definer`, checks `revoked_at is null` and
  `(expires_at is null or expires_at > now())`, and matches `grantee_user_id = auth.uid()`.
- **No write policy is touched.** A share is view-only by construction: the grantee gains no insert,
  update or delete path. Verified by sql `100_scale_harden.sql` (a grantee's update changes 0 rows and
  raises nothing).
- **Rights checks.** `share_grant(p_universe_id, p_grantee_user_id, p_expires_at)` requires
  `is_head(1)` (a Level-1 or Level-2 Head, since `is_head(1)` is satisfied by Level-2 too) **or** an
  Org Admin, requires the grantee to be an active member of the same org, and refuses self-sharing.
  `share_revoke(p_share_id, p_reason)` requires the granting Head, a higher Head, or an Org Admin.
  Both are `security definer`, both append a ledger entry and an `activity_log` row.

**What it constrains.** A future cross-*org* share is a new decision, not a tweak: it would break the
`org_id = jwt_org_id()` equality that every policy relies on and must be designed as a separate,
explicitly-scoped read path with its own audit. The `shared_universe_read(p_universe_id)` projection
is the only tenant-content read that is not keyed on `jwt_org_id()` equality, and it is itself
`security definer` and checks `jwt_org_id()` equality plus a live share row for `auth.uid()`.

## D-S1-CI-JOB-TIMEOUT — the job limit, not the step limit, cancelled the sweep

**Decision.** The `gates` job limit is 75 minutes (was 45). The screenshot sweep keeps its own
15-minute limit.

**Why.** Run 40485222778 reached steps 1–14 all green, then cancelled step 15 (the screenshot sweep)
at 14.1m. The step's own limit never fired: the *job* limit did. Measured from the run's step
timestamps, step 13 (migrations and SQL tests against the hosted test project) takes **23.2m** of the
budget, so only ~14m remained when the sweep began. A per-step limit cannot save a step whose job has
already run out of time, so the fix belongs on the job. 75m gives the sweep its full 15m even when the
SQL step is slow.

**What it constrains.** The sweep is `continue-on-error`, so it must never be the reason a run is
cancelled; a future step that adds several minutes of network work must re-check that the job limit
still covers the sweep.

## D-S1-PANEL-DOUBLE-LOAD — the report editor loads twice; tests must settle both

**Decision.** A test that drives the report editor's pre-flight form waits for both loads
(`listCaps` is each load's last call) before interacting.

**Why.** CI run 40491675102 failed `phase6Panels.test.tsx:167` with
`Unable to find an element by: [data-testid="report-preflight-ack-item"]` while `report-loading` was
on screen. `ReportEditorPanel`'s `load` effect depends on `activeId`: it runs once with no version
selected, then again once it selects the first version, and the second run sets `loading=true` and
briefly unmounts the form. The §11.4 tests interacted after the *first* paint, so on a slow runner the
change event landed on the unmounted form and the item value was lost. The "issues the report" test
already documents this and waits; the §11.4 tests did not. Reproduced deterministically by delaying
the second `listCaps` call: the old pattern fails with the exact CI error, the waiting pattern passes.

**What it constrains.** Any new test that drives a panel whose effect depends on a state it sets
inside the same effect must wait for the load to settle, not merely for the first paint.
