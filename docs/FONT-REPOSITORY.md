# Font repository — self-hosted, licensed, auto-detecting

Owner requirement (2026-10-28): incorporate free fonts so users have a wide repository to choose
from, and auto-detect their existing formatting.

---

## 1. The problem with what we have now

`index.html:14` loads three families — Inter, Source Serif 4, JetBrains Mono — **from Google's CDN at
runtime**. For a product whose central promise is that a tenant's data never leaves the tenant, having
Google in the request path on every page load is wrong: it leaks every client's IP address to a third
party, it breaks when Google is blocked, and it fails offline. Self-hosting is a privacy and
resilience fix before it is a font feature.

---

## 2. Why "all free fonts" cannot be bundled

Google Fonts alone is roughly 1,900 families; the wider open-source universe (SIL OFL, Apache-2.0,
UFL) is tens of thousands of files. Bundled into a web app that is hundreds of megabytes and the app
becomes unusable to load. The requirement is met by breadth plus adoption, not by bundling everything.

---

## 3. The design

1. **Curated self-hosted set.** A few hundred families across serif, sans, mono, display and
   accessibility-focused categories. Shipped with the app, **lazy-loaded per use**, so a client pays
   only for what they pick.
2. **Subsetting.** Ship only the glyphs reports actually use (Latin, the punctuation and symbols in
   real reports, plus configured extras). This cuts size by an order of magnitude.
3. **Upload your own.** Already half-built: `branding_assets` (migration `0058_branding.sql`) stores
   font bytes per org. A client with a house font uploads it and it is theirs.
4. **Auto-detect from the client's own template — the real prize.** Rather than choosing from a list,
   the app reads the fonts, colours and page setup out of an uploaded `.docx` or `.pptx`. DOCX styles
   and PPTX themes are known XML parts inside the zip; PPTX theme extraction is already referenced in
   the codebase. Deterministic, so it obeys Law L1, and it is a better experience than any list.

---

## 4. Licensing — must not be skipped

Every bundled font carries its own licence, and the obligations differ:

- **SIL OFL** — may be bundled and redistributed, but the licence text must ship with the font and
  the font may not be sold on its own; Reserved Font Names must not be reused in derivatives.
- **Apache-2.0** — bundling permitted, attribution and the licence text required.
- **UFL** — bundling permitted with the licence text.
- **Bespoke licences** — each must be read; some forbid redistribution.

Therefore the repository stores, **per font**: family, files, subset, licence id, licence text,
source URL, and whether redistribution is permitted. The UI shows the licence. A gate (§5, G10)
fails the build if a bundled font has no licence metadata or is marked non-redistributable.

---

## 5. Work packages

| # | Task |
|---|---|
| F1 | Remove the Google Fonts CDN link; self-host the three families already used |
| F2 | `src/lib/fonts/` — catalogue, licence metadata per font, lazy loader |
| F3 | Curate and subset the bundled repository (few hundred families) |
| F4 | Org font upload via `branding_assets`, with licence acknowledgement |
| F5 | Font/colour/theme auto-detection from DOCX and PPTX |
| F6 | Wire detection into the org format (see `docs/SYSTELLIGENCE.md` §9) |
| F7 | Gate **G10 — font licence**: no bundled font without licence metadata and a redistributable flag |

---

## 6. Acceptance

- No request to any external font host at runtime.
- The curated set is browsable, searchable and lazy-loaded; picking a font does not bloat the initial
  bundle.
- An org can upload its own font and see its licence recorded.
- Uploading an existing report detects its fonts and colours and offers to adopt them.
- Gate G10 passes: every bundled font has licence metadata.
