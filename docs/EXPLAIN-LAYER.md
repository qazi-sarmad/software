# The Explain Layer — popouts, drilldown, access filtering, IIA standards

Owner requirement (2026-10-28): every suggested thing — a sampling method, a test, a field, a term,
a status — must have a small popout that says what it is and what it will do. Everything must be
drilldownable. Hovering any text must show a popout of its detail, **filtered on view access**. IIA
standards information must be woven into the same information workflow to a fair level.

This document is the buildable specification for that. It obeys the Laws: pure functions under
`src/lib/`, no AI, no free text generation, no clock reads, components never import the Supabase
client.

---

## 1. The one distinction that makes this safe

There are two kinds of text in a popout, and conflating them would breach Law L2 (data never leaves
the tenant) or leak restricted detail. They are handled by different rules:

| Kind | Example | Access rule |
|---|---|---|
| **Explain content** | "MUS/PPS sampling weights each item by its monetary value, so the sample is biased toward larger items." | Static product documentation. **Not tenant data.** Any signed-in user may read it. |
| **Contextual value** | "This engagement's coverage is 82% of total value." | Tenant data. **Must pass the same view-access filter as the screen that hosts it.** |

So the popout renders from two inputs: a static catalogue entry (safe) and an optional list of
contextual values that the *host screen* has already filtered through `src/lib/access.ts`. The
popout itself never queries anything and never decides access to tenant data — it can only display
values it was handed, and it re-checks the caller's rights before showing a value.

A pure function enforces this:

```
explainFor(user, explainId, context?) -> ExplainView
```

- Resolves the catalogue entry.
- If the entry declares `minRight` and `hasRight(user, minRight)` is false, returns a **redacted**
  entry: title plus a one-line "You do not have access to this detail." Never returns nothing —
  a missing popout looks like a bug.
- Drops any contextual value whose own `minRight` the user fails.
- Returns the same shape every time (loading/empty/error/ready/denied are the screen's concern; the
  function returns `denied` explicitly).

---

## 2. The catalogue is data, not prose in components

New pure module `src/lib/explain/catalogue.ts`. Every explainable thing gets one entry:

```ts
export interface ExplainEntry {
  id: string;              // stable, namespaced: 'method.mus_pps', 'field.engagement.stage'
  kind: 'method' | 'field' | 'term' | 'status' | 'step' | 'screen' | 'standard';
  title: string;           // the label shown in the UI
  summary: string;         // ONE sentence: what it is
  effect: string;          // ONE sentence: what choosing/using it will DO
  detail?: string[];       // paragraphs, optional
  howItWorks?: string[];   // ordered steps, optional
  whenToUse?: string[];    // optional
  whenNotToUse?: string[]; // optional
  iiaStandards?: string[]; // e.g. ['9.2', '10.1'] — see §5
  minRight?: Right;        // view-access gate; omit for public-to-tenant content
  related?: string[];      // ids — powers drilldown between entries
  source?: string;         // where the claim comes from (spec section, standard)
}
```

Rules for the catalogue:

1. **Deterministic.** A pure object graph. No functions that read time, environment or network.
2. **No tenant data.** A test asserts no entry contains a tenant id, a currency amount, a date or an
   org name. This is the L2 guard for this feature.
3. **Complete coverage.** Every method, option, field, status and step that the UI offers must have
   an entry. This is enforced by a new gate (§7, G7).
4. **Every `effect` states a consequence.** "Records the sample size" is not acceptable; "Records the
   sample size and blocks sign-off until every selected row has a result" is.
5. **No AI.** Entries are authored and version-controlled. They are reference text, like a manual.

Initial catalogue scope (the full list is a build task, this is the required coverage):

- **Sampling methods** — the seven the UI already offers (`src/data/sampling.ts`):
  `random`, `systematic`, `mus`, `stratified`, `high_value`, `low_value`, `haphazard`. Each entry
  states what it selects, its bias, and its IIA hooks. Entries for methods not yet implemented say so
  plainly, because a method that is offered but does nothing is exactly the defect this layer exists
  to prevent.
- **Engagement stages** — planning, testing, conclusion, and every gate between them.
- **Statuses** — engagement, workpaper, observation, issue, CAP statuses, alert states.
- **Fields** — every input on every form, including `testing_mode`, `signoff_role_*`,
  `approval_chain`, `grace_hours`, `invite_cap`, feature flags.
- **Terms** — population, coverage, precision, upper error limit, materiality, risk rating,
  exception, finding, observation, root cause, action plan, sealed, graph root, Merkle leaf.
- **Screens** — one entry per screen id, summarising purpose and what the user can do there.
- **Standards** — see §5.

---

## 3. The popout — three surfaces, never blocking

Built on the existing `HoverPreview` portal chrome (`src/components/common/HoverPreview.tsx`) and the
existing non-blocking rule: **no backdrop scrim, no `aria-modal`, no blocking modal** (Law).

New component `src/components/explain/ExplainPopout.tsx`:

| Surface | Trigger | Content | Dismissal |
|---|---|---|---|
| **Hover card** | pointer rest (~400ms) or focus | title, summary, effect, IIA tags, "Open detail" | pointer leave, Esc |
| **Detail panel** | click the card, or keyboard Enter on the trigger | full entry: detail, how it works, when to use / not, related entries, source | Esc, close, or click away |
| **Pinned** | a pin control on the detail panel | same, but stays open beside the work | unpin |

Accessibility and correctness:

- Trigger elements are focusable and carry `aria-describedby` pointing at the card.
- The card is `role="tooltip"`; the detail panel is `role="complementary"` (matching the tutorial
  drawer convention, never `dialog`).
- Reduced-motion is respected; the pencil styling degrades to a plain bordered card.
- Keyboard reachable end to end: Tab to trigger, Enter to open detail, Esc to close.
- Positioned to stay in the viewport; never covers the control it explains.
- Every trigger carries `data-testid="<screenId>-explain-<explainId>"`.

A hook, `useExplain(explainId, context?)`, returns `{ view, open, pinned }` and is the only way a
component touches the layer. It calls `explainFor` with the current user and the already-filtered
context.

---

## 4. Drilldown everywhere

"Everything must be drilldownable" means: from any summary the user can reach the underlying records
without losing their place, and never via a blocking modal.

- **Record drilldown** already exists: `RecordView` + `FloatingWindowManager` (full-page or floating
  window, several open at once, minimisable, draggable, pop-out). Every list row, chip, count and
  aggregate becomes a trigger that opens the record.
- **Aggregate drilldown**: every number that summarises records (coverage %, exception count,
  overdue CAPs, alerts) must open the exact filtered list that produced it. A count with no drill is
  a defect.
- **Explain drilldown**: every term inside a popout links to its own entry, and every entry links to
  related entries and to the standards it satisfies. This is the `related` graph in §2.
- **Standard drilldown**: a standard links to where it is implemented, and from there to the
  evidence that satisfies it (§5).
- **Deep-linkable**: opening a drilldown updates the URL so a state can be shared and re-opened.
  Full-page mode is a real route (`/view/:recordType/:id`), which already exists.

Test for this: a walk test that starts at a dashboard, drills through every aggregate to a record and
back, asserting no blocking modal appears at any step.

---

## 5. IIA standards in the same information workflow

There are currently **zero** IIA references in the codebase. This section adds them as data, not as
decoration.

### 5.1 Source and honesty

The catalogue is authored against the **IIA Global Internal Audit Standards (2024)**, which use
`Domain.Standard` numbering — for example `13.2 Engagement Risk Assessment`, `14.4 Recommendations
and Action Plans`, `15.1 Final Engagement Communication`. The numbering below was verified against
the IIA's own condensed 2024 text, not recalled.

The five domains are:

| Domain | Title | Product relevance |
|---|---|---|
| I | Purpose of Internal Auditing | Organisation-level, not product-level |
| II | Ethics and Professionalism | Partial — objectivity, confidentiality, due care |
| III | Governing the Internal Audit Function | Partial — independence, charter, quality |
| IV | Managing the Internal Audit Function | High — planning, resources, communication, quality |
| V | Performing Internal Audit Services | Highest — the engagement lifecycle itself |

**Do not reproduce the standards' text.** The IIA holds copyright and the free document is marked
"for individual personal use only". Each entry paraphrases the standard in one sentence, in our own
words, and cites the reference number. A test asserts that no entry contains a verbatim quotation
longer than a short phrase. Legacy IPPF codes (`2200`, `2300`, `2500`) are recorded **only** where a
reliable published mapping is available; they are never guessed.

### 5.2 Module

New pure module `src/lib/explain/iia.ts`:

```ts
export interface IiaStandard {
  id: string;          // '13.2'
  legacyId?: string;   // '2200' — only when reliably mapped, never guessed
  domain: 'I' | 'II' | 'III' | 'IV' | 'V';
  title: string;       // our own short title
  paraphrase: string;  // ONE sentence, our words
  implementedBy: string[];  // screen ids / RPC names where Provio addresses it
  evidence: string[];  // what artifact proves it (workpaper, report section, CAP, log)
  explainIds: string[];     // catalogue entries that carry this standard
}
```

### 5.3 Required coverage

Roughly thirty-five entries, weighted to the domains the product actually serves:

- **Domain V — Performing Internal Audit Services (the engagement lifecycle).**
  `13.1` Engagement Communication · `13.2` Engagement Risk Assessment · `13.3` Engagement Objectives
  and Scope · `13.4` Evaluation Criteria · `13.5` Engagement Resources · `13.6` Work Program ·
  `14.1` Gathering Information for Analyses and Evaluation · `14.2` Analyses and Potential Engagement
  Findings · `14.3` Evaluation of Findings · `14.4` Recommendations and Action Plans ·
  `14.5` Engagement Conclusions · `14.6` Engagement Documentation · `15.1` Final Engagement
  Communication · `15.2` Confirming the Implementation of Recommendations or Action Plans.
- **Domain IV — Managing the Internal Audit Function.** `9.1`–`9.5` (governance/risk/control
  understanding, strategy, methodologies, plan, coordination) · `10.1`–`10.3` (financial, human,
  technological resources) · `11.1`–`11.5` (relationships, effective communication, communicating
  results, errors and omissions, communicating acceptance of risks) · `12.1`–`12.3` (internal quality
  assessment, performance measurement, overseeing engagement performance).
- **Domain III — Governing the Function (partial).** `6.1`–`6.3` (mandate, charter, board support) ·
  `7.1`–`7.2` (independence, CAE qualifications) · `8.1`–`8.4` (board interaction, resources,
  quality, external quality assessment).
- **Domain II — Ethics and Professionalism (partial).** `1.1`–`1.3` (integrity) · `2.1`–`2.3`
  (objectivity) · `3.1`–`3.2` (competency) · `4.1`–`4.3` (due professional care, skepticism) ·
  `5.1`–`5.2` (use and protection of information — these map directly to Law L2 and the RLS model).

Each entry must point at real screens and real RPCs, or be marked `not yet implemented` — and that
marking is itself shown honestly in the UI. Domain I is out of scope and is stated as such.

### 5.4 How it appears in the workflow

Not a separate tab people never open. It appears where the work happens:

1. **On the thing itself.** A sampling method, a workpaper field, a CAP status carries its standard
   tags. The hover card shows small `IIA 9.2` chips; the detail panel explains the link.
2. **On the step.** Each lifecycle step and each pre-flight check shows which standards it satisfies,
   so "why am I doing this" has an answer in the interface.
3. **On the screen.** A screen-level "Standards" affordance lists the standards this screen
   addresses and links to where each is implemented.
4. **A Standards view** — the full catalogue, drilldown from a standard to its implementation and its
   evidence. Reachable from the explain layer and from the screen affordance.
5. **In the report and the board pack.** Report sections are tagged with the standards they satisfy,
   so a sealed report can state its basis. This also gives the Writing Engine a deterministic mapping
   to render.

Coverage target ("fair level"): every standard that maps to a behaviour the product has. The
required set is roughly the planning, evidence, analysis, conclusion, communication, monitoring and
quality standards — around twenty-five entries — not the governance and purpose domains, which are
organisation-level rather than product-level. Each must point at real screens and real RPCs, or be
marked `not yet implemented` (and that marking is itself shown honestly in the UI).

---

## 6. Pencil-style guided pointers

Owner requirement: guidance should feel hand-drawn, premium and intuitive — "pencil style".

New component `src/components/guidance/PencilGuide.tsx`:

- Renders an SVG hand-drawn arrow or underline plus a handwritten-style annotation bubble, pointing
  at a target element by `data-testid`.
- **Non-blocking**: it overlays, it never traps focus, it is dismissible, and the underlying control
  stays usable while it is shown.
- **Deterministic**: the guide for a screen is pure data —
  `{ step, targetTestId, text, explainId?, placement }[]` — under `src/lib/guidance/`. No AI, no
  generated copy.
- **Accessible**: annotations are text in the DOM (not baked into the SVG), readable by a screen
  reader; reduced-motion shows the arrow without the draw animation; a "skip guidance" control is
  always present.
- **Reusable**: the same component powers the guided first-run (zero → first sealed report) and an
  on-demand "show me" mode per screen.

Visual language: graphite stroke, slight rotation, hand-drawn double-line on the arrowhead,
paper-toned bubble, a small pencil glyph on the pointer. It must look deliberate, not sketchy — a
single accent, consistent stroke weight, consistent angle, and no more than one pointer on screen at
a time.

---

## 7. Enforcement — the gates

Three new gates join the six in the remediation plan. All are deterministic and run in CI.

| Gate | Rule | Catches |
|---|---|---|
| **G7 — Explain coverage** | Every method/option/field/status the UI offers resolves to a catalogue entry; every entry is referenced by something. | A new dropdown option shipped with no explanation. |
| **G8 — Drilldown** | Every rendered aggregate (count, percentage, total) has a drilldown target. | A dashboard number with no way to reach its records. |
| **G9 — IIA honesty** | Every standard entry points at a screen or RPC that exists, or is explicitly marked `not yet implemented`; no verbatim standard text. | Standards shown as covered when they are not, or copyright trouble. |

G3 (config-effect) already covers "every configurable field has a proving test". G7 extends it to
"every configurable field also explains itself".

---

## 8. Work packages

| # | Task | Depends on |
|---|---|---|
| E1 | `src/lib/explain/catalogue.ts` — schema, `explainFor`, redaction, L2 guard test | — |
| E2 | `ExplainPopout` + `useExplain`, built on `HoverPreview`, non-blocking, a11y | E1 |
| E3 | `src/lib/explain/iia.ts` — ~25 standards, paraphrased, mapped to screens/RPCs | E1 |
| E4 | Hover cards + detail panels wired across sampling, fields, statuses, terms | E2 |
| E5 | Drilldown from every aggregate; deep-linkable; no blocking modal (walk test) | — |
| E6 | Standards affordance on screens, steps and report sections | E3 |
| E7 | Standards view (catalogue → implementation → evidence) | E3 |
| E8 | `PencilGuide` + guidance data for the guided first-run and "show me" mode | — |
| E9 | Gates G7, G8, G9 + tests | E1–E8 |
| E10 | Update `UI-INVENTORY.md` with explain ids, standards, drilldown targets per screen | E1–E8 |

---

## 9. Acceptance

- Hovering any method, field, status or term shows a popout with a one-sentence "what it is" and a
  one-sentence "what it will do".
- The popout is filtered on view access: a user without the right sees a redacted entry, not a
  broken one and not the restricted detail.
- No popout ever contains tenant data that the hosting screen had not already filtered.
- Every aggregate drills to its records without a blocking modal, and the state is deep-linkable.
- Every product behaviour that maps to an IIA standard shows that mapping where the work happens,
  and the mapping points at real screens and real RPCs or says it is not yet implemented.
- Guidance is hand-drawn in feel, one pointer at a time, keyboard-reachable, and dismissible.
- Gates G7, G8 and G9 pass, and the explain layer contains no AI and no clock reads.
