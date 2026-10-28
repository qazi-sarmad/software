> ## ⚠️ STALE — ARCHIVED, DO NOT TRUST
>
> This document predates the code-verified audit of 2026-10-27/28 and is kept for history only.
> Its status claims are **not** reliable: the audit found the app was not database-backed in
> production, the engagement lifecycle was never persisted, several documented-as-Present features
> were dead code, and many "all Present" claims were false.
>
> **Current sources of truth:**
> - `docs/SPEC-v10.md` — the specification (unchanged, still authoritative)
> - `docs/FUNCTIONALITY-AUDIT.md` — what is actually built (code-verified)
> - `docs/REMEDIATION-PLAN.md` — the plan being executed
> - `docs/SCALE-TASKS.md` — live task ledger
>
> Do not cite this file as evidence that anything works.

# UX gap analysis: what is not yet sexy, visual or intuitive

Owner instruction 2026-10-26: make the product Canva-like wherever it is a surface a human reads or
edits; add self-hosted Google Fonts; keep every external-source link at zero operational cost.

This document is the honest audit. It is deliberately blunt: a gap analysis that flatters the product
is useless. Each entry names the surface, what it looks like today, why that is not "sexy, visual or
intuitive", and the concrete fix. Nothing here is parked; the fix list is folded into
`docs/SCALE-PLAN.md` and worked in the priority order given there.

## Method

I read every component under `src/components` (180 `.tsx` files), the renderers under `src/lib/render`,
the design tokens in `src/styles/tokens.css`, and the two guards that constrain presentation
(`scripts/check-tokens.mjs`, `src/guards/sourceGuards.test.ts`). I rated each surface on three axes:

- **Visual** — does the user see the thing they are changing, rendered, or do they read its name?
- **Intuitive** — can a non-technical user act without being told, or does the surface need a manual?
- **Sexy** — does it feel crafted and alive (type, motion, density, colour), or like an admin form?

## The five root causes (every gap below is one of these)

1. **The preview is text, not pixels.** The strongest example is the report format editor: it shows
   "Exec Summary — F3 Balanced · T2 · active" instead of a page. The user never sees their own
   margins, fonts or colours. This is the single biggest visual gap in the product.
2. **Configuration is typed, not shown.** Colours are token *names* (`brand-primary`); the user reads
   a name, not a swatch, and cannot pick one. Fonts are two dropdowns of five web-safe names.
3. **Lists where a picture would speak.** Issues, CAPs, findings, the audit trail, evidence and
   approvals are tables. A table is correct for data but there is rarely a chart, a heat map, a
   timeline or a status strip beside it.
4. **Interaction is buttons, not direct manipulation.** Reordering is Up/Down; there is no drag,
   no inline edit-in-place, no undo. This is what separates a form from a canvas.
5. **Type and motion are flat.** One UI font (Inter, loaded from nowhere — it silently falls back to
   the system font because no `@font-face` exists), one serif, no display face, no motion language
   beyond two pulse animations.

## Area-by-area

| Area | Surface | Today | Gap | Fix |
|---|---|---|---|---|
| Report format editor | `writing/ReportFormatPanel.tsx` | Form with blocks/layout/audiences/version panes; text preview | **Not Canva-like.** No canvas, no drag, no colour picker, no typography, no undo | Live A4 canvas + drag-drop + colour pickers + typography + undo/redo (WP-C) |
| Typography | whole app | `'Inter'` referenced, never loaded; web-safe PDF fonts | Fonts silently fall back; no display face; report fonts are 1990s-safe | Self-host a curated Google Fonts set via `@fontsource/*` (WP-F) |
| Executive dashboard | `dashboard/ExecutiveDashboardTab.tsx` | KPI cards + D3 sunburst + radial tracker + Gantt | The visuals that exist are strong; the rest is card grids | Add a status strip and sparkline density; unify the card chrome (WP-V) |
| Issues register | `issues/IssuesRegisterTab.tsx` | Filterable table + drilldown | No severity heat map, no age/aging visual, no trend | Add a severity × age matrix and a trend sparkline beside the table (WP-V) |
| CAP register | `audit/CapRegisterPanel.tsx` | Table + radial tracker | The radial is good; the register is a list | Aging bars per row, owner avatars, overdue in cinnabar (WP-V) |
| Analytics | `audit/AnalyticsTab.tsx` | Rule dropdowns + numeric results | Results are numbers, not charts | Chart the variance/TB/anomaly outputs (WP-V) |
| SIRA | `sira/SiraModelEditor.tsx` | Factor/band tables with weights | Weights and bands are numbers; no visual scale | Weighted bar + band slider visual (WP-V) |
| Planning | `plan/PlanningPanel.tsx` | Suggestion list + reconciliation table | Reconciliation is a table of discrepancies | Diff-style visual of prior vs current plan (WP-V) |
| Report builder | `writing/ReportBuilderPanel.tsx` | Block list editor | No live document preview | Share the Canva canvas with the format editor (WP-C) |
| Work Queue | `pending/PendingTasksTab.tsx` | Cards | Reasonable; no urgency visual | Urgency gradient + due-in visual (WP-V) |
| Audit trail | `admin/ActivityLogPanel.tsx` | Table of events | A ledger is inherently a list, but a timeline reads faster | Timeline rail with grouped days (WP-V) |
| Super Admin | `superadmin/*` | 16 tab panels, mostly forms | The provisioning path is a form, not a guided flow with progress | Stepper with visible progress and a done-state (WP3 + WP-V) |
| Evidence / documents | `audit/EvidenceTab.tsx`, `DocumentViewerPanel.tsx` | List + viewer | No thumbnails, no preview grid | Thumbnail grid with inline preview (WP-V) |
| Empty / loading / error | everywhere | Text lines ("Loading…", "No X yet") | Not designed states | Illustrated empty states, skeletons, inline retry (WP-V) |
| Navigation | `common/NavStrip.tsx` | Text tabs | Flat; no current-location cue beyond colour | Active rail, section icons, breadcrumb (WP-V) |

## What "Canva-like" means for the report format editor

A concrete definition, so it is testable rather than a vibe:

1. A **live A4 page** rendered from the same layout the PDF renderer consumes, updating as controls
   change. The user sees their margins, fonts and colours, not their names.
2. **Drag-and-drop** block reordering on that page, with a keyboard-accessible fallback.
3. **Colour pickers** that write real values (still token-based, still deterministic), with swatches.
4. **Typography controls**: font family (from the self-hosted Google Fonts set), size, weight,
   line height, heading scale — all added to `FormatLayout`, validated, and honoured by the renderer.
5. **Undo / redo** on the draft, with a visible history.
6. **One screen**: the block list beside the live page, not split across panes.

Hard boundary (a law, not a preference): the format is presentation only. The **graph root must be
identical whatever the format**, and only the render hash moves. "Canva-like" here means a rich
WYSIWYG over a bounded, deterministic page model — never arbitrary design freedom, never a fact
change. Every new layout field must be validated and must not alter a claim, a figure or a hash.

## Free external links (zero operational cost)

The owner asked that anything currently out of scope that touches an external source be free to run.
The map, all self-hosted or free-tier:

| Need | Free, zero-op-cost choice | Note |
|---|---|---|
| Report fonts | `@fontsource/*` (Google Fonts, SIL OFL-1.1) | Self-hosted and embedded in the PDF; no Google request, no key, no per-render fee. Licence exception recorded in `SCALE-DECISIONS.md` |
| UI font | `@fontsource/inter`, `@fontsource/source-serif-4` | Fixes the silent fallback today |
| Email | Microsoft Graph (the existing `graph-oauth` path) | The tenant's own Microsoft 365. **Never basic-auth SMTP** (retired) |
| SSO | Microsoft Graph OAuth | Uses the tenant's own Microsoft 365; the platform adds no per-seat fee. Where the tenant has no Microsoft 365, that cost is the tenant's |
| Charts | D3 (already bundled) | No charting SaaS |
| Icons | `common/Icons.tsx` (in-house SVG) | No icon CDN |
| Connectors | local mock servers in tests; wizard-only creds | No live calls, no paid API in the build |

## The re-prioritised backlog

The SCALE-1 work packages and the new presentation work, sorted so the highest-visibility, highest-
leverage items land first and nothing is left partial. The order is in `docs/SCALE-PLAN.md`.
