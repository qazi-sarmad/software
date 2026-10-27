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
