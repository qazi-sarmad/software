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

## D-S2-JOINT-AUDIT-RLS — the corrected §2 model (group / joint-audit sharing)

**Decision.** §2 is **group / joint-audit** sharing, not intra-tenant view-only sharing. Two
*associated* group companies (a platform-recorded association) share one **engagement** with **edit
rights to both parties**. The superseded `universe_shares` view-only model (D-S1-SHARE-RLS) is removed
in `0102_group_joint_audit_sharing.sql`; intra-tenant access is rights-driven (`view_all_scopes` or a
scope grant) and no dormant share path remains.

**The shape (migration `0102_group_joint_audit_sharing.sql`).**

- `engagement_joint_shares(id, engagement_id, owner_org_id, counterparty_org_id, rights, granted_by,
  granted_at, expires_at, revoked_at, revoke_reason)`, RLS on. `rights` is constrained to `'edit'`;
  the two orgs must differ; an expiry must be in the future. The select policy keeps
  `owner_org_id = jwt_org_id() or counterparty_org_id = jwt_org_id()`.
- The projection is **additive, never a relaxation**. `engagements_joint_select` is
  `public.joint_share_active(id) and org_id = any(public.associated_org_ids())`; `entities_joint_select`
  reaches the entity only through an engagement covered by a live share; the working-paper tables
  (`workpapers`, `observations`, `caps`, `cap_items`, `conclusion_records`, `plan_items`,
  `populations`, `analysis_results`, `evidence_files`, `preflight_acks`, `report_blocks`,
  `report_versions`) get `*_joint_select` / `*_joint_insert` / `*_joint_update` policies gated on the
  same predicate. Every pre-existing policy is left in place and Postgres ORs them, so normal tenant
  data still requires `org_id = jwt_org_id()`.
- `joint_share_active(p_engagement_id)` is `security definer` and org-scoped: it matches the caller's
  org as owner or counterparty, `revoked_at is null`, and `(expires_at is null or expires_at > now())`.
  The guard `src/guards/rlsOrgEquality.test.ts` lists it as an approved helper and asserts its own
  definition carries `jwt_org_id()`.
- **Rights checks.** `joint_share_grant(p_engagement_id, p_counterparty_org_id, p_expires_at)` requires
  `caller_has_right('manage_engagements')`, requires the engagement to belong to the caller's org, and
  requires `are_associated(v_org, p_counterparty_org_id)`. `joint_share_revoke(p_share_id, p_reason)`
  records the reason. Both are `security definer` and append to the ledger.

**What it constrains.** The `org_id = jwt_org_id()` equality is untouched for normal tenant data; a
joint share only adds visibility for an *associated* org, on the *shared* engagement and its working
papers. `e2e/rls.spec.ts` keeps an absolute "own org only" bound on the tables with no crossing path
(`org_members`, `universes`, `roles`, `user_scopes`, `orgs`) and bounds `entities` to own-or-associated,
so a row from a third org is still a failure.
