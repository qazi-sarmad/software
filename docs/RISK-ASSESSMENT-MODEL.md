# Risk assessment model — the risk library, auto-adjusted factors, and manual override

Owner instruction 2026-10-29: "ensure the risk libraries, and auto-adjusted factors (with manual
override) is present and is elaborate." This file is the specification for D14. It states what exists
today, what is missing, and exactly what to build. It is grounded in the verified sources in
`docs/ASSURANCE-RULEBOOKS.md` §1, §6 and in `docs/PAKISTAN-ASSURANCE-REGIMES.md`.

The governing ethic, unchanged: **the engine proposes, the auditor disposes, the ledger keeps both.**
Every automatic adjustment is visible, every manual override is recorded with a reason, and an unknown
is never silently converted to a zero.

---

## 1. What exists today (verified)

| Piece | Where | State |
|---|---|---|
| Universal risk library | `risks_library` (`0003`), extended in `0019` with `code`, `category`, `is_universal` | Table exists; the columns are there; **no seeded content** — a new tenant's library is empty |
| Per-org model (factors, scales, weights, bands, aggregation) | `sira_models`, `sira_factors`, `sira_scales`, `sira_bands` (`0019`) | Exists. Seeded with a **6-factor default** (`inherent_risk`, `complexity`, `regulatory_exposure`, `prior_findings`, `time_since_audit`, `materiality`), a 1–5 scale, four bands, `weighted_sum` |
| Compute | `public.sira_compute` + `src/lib/siraEngine.ts` | Deterministic, four aggregations, parity test. **No auto-adjustment step, no override** |
| Risk selection per entity | `sira_risk_selection` (`0019`) | Exists |
| Suggestions | `populate_planning_suggestions` (`0025`) | Derives risk, inherent rating, band, prior findings from the last published SIRA cycle. Carries `suggested_controls: []` — **always empty** |
| Emergent risks | `sira_emergent_risks` (`0020`), `sira_acceptances` (`0119`) | Exists; two-key acceptance |
| KRI / ERM theme map / appetite | — | **Absent** |
| Auto-adjustment of factors from signals | — | **Absent** |
| Manual override of an auto-adjusted factor | — | **Absent** |

**The gap in one line:** the model can be *scored*, but it cannot be *fed*. There is no library to draw
risks from, no signal that adjusts a factor, and no way for an auditor to override an adjustment and
say why. D14 closes all three.

---

## 2. The risk library (elaborate, seeded, per discipline)

A **risk library** is the reusable catalogue of risks. Three layers, one of which exists:

1. **The universal library** (`risks_library`, `is_universal = true`) — risks every organisation shares.
2. **The org library** (`risks_library` scoped by `org_id`) — the organisation's own risks.
3. **The discipline packs** (new) — the risks a *discipline* brings, loaded when a universe is of that
   discipline (Management / IT / Shari'ah — see `docs/AUDIT-DOMAINS-MODEL.md`). A discipline pack is a
   named, versioned set of library rows tagged with its discipline, so selecting "IT Audit" for a
   universe offers the IT risks without the tenant hand-entering them.

Each risk row carries, beyond today's `name`/`description`/`code`/`category`:

- `discipline` — management / it / shariah / cross (null = universal).
- `source` — the citation (e.g. `COSO ICIF-2013 5.3`, `ISO 27001:2022 A.8.8`, `AAOIFI SS 8`, `PwC-2026`).
- `risk_type` — inherent / control / fraud / compliance / strategic / operational / financial /
  technology / shari'ah.
- `is_emerging` boolean — for the emerging-risk view.
- Default `inherent_rating`, default `residual_rating`, default `appetite` and `tolerance`.

**Seeded content** — the library ships populated, because an empty library is the same defect as an
empty rule set:

- **Management (cross-cutting)** — drawn from the COSO ICIF-2013 five components and the IIA 2024
  standards; fraud risk (PCAOB AS 2401), financial-reporting risk (AS 2201), the classic operational
  set (the seven ERM themes in the PwC worked example: cybersecurity and data privacy, regulatory and
  compliance change, strategic execution, operational resilience/BCP, third-party/supply chain, talent
  and workforce, financial performance and liquidity).
- **IT** — drawn from COBIT 2019, ISO/IEC 27001:2022 Annex A (93 controls, 4 themes) and NIST SP
  800-53 Rev. 5 (see `docs/ASSURANCE-RULEBOOKS.md` §1): access and privileged access, change
  management, SDLC, backup and DR, patch management, logging and monitoring, third-party technology.
- **Shari'ah** — drawn from AAOIFI SS 1–54 (see `docs/ASSURANCE-RULEBOOKS.md` §5): riba, gharar,
  maysir, ownership sequence (SS 8/18), profit-distribution integrity (SS 12/13/40), zakah (SS 35),
  Shari'ah governance (SS 29).

A library row is **versioned and reason-stamped** like every other config item (L5). Editing a
library risk appends a version; a SIRA cycle that used an old version keeps that version.

---

## 3. Auto-adjusted factors (the automatic step)

Today a SIRA score is `sira_compute(factor_values, weights, aggregation)` with the factor values typed
by hand. D14 adds an **auto-derivation** step: each factor's value is *proposed* from data, then shown,
then confirmed or overridden. The factor value is never silently written — it is proposed with its
inputs named.

**The auto-adjustment input taxonomy** (all deterministic, all from existing tables — see
`docs/ASSURANCE-RULEBOOKS.md` §6):

| Factor | Auto-derived from | Rule |
|---|---|---|
| `inherent_risk` | library default for the selected risk | seeded value |
| `complexity` | entity attributes + number of linked processes | banded count |
| `regulatory_exposure` | classification (D10) + the regimes that bind it | C1–C8 → exposure level |
| `prior_findings` | open findings for the entity, by severity | count, banded |
| `time_since_audit` | days since the last sealed engagement | banded by days |
| `materiality` | the entity's materiality figure if set | pass-through or unknown |
| **`kri_breach`** (new) | KRI values vs tolerance | count of breaches in the window |
| **`incident_rate`** (new) | incidents linked to the entity | count vs a banded threshold |
| **`control_test_failure`** (new) | failed control tests for the entity | count, banded |
| **`change_velocity`** (new) | change records / open CAPs added in the window | banded |

Each auto-derived value is a **proposal object**: `{ factor_key, proposed_value, inputs: [...], rule_id,
rule_version, source }`. The SIRA screen shows the proposal with its inputs and the rule that produced
it. **An unknown input yields "unknown", never 0** (the shared ethic). The engine proposes; the auditor
confirms.

The auto-adjustment rules are **named and versioned** (`rule_id`, `rule_version`, `source`) exactly like
the D5/D7/D8 rules, and follow the rule-citation law in `docs/ASSURANCE-RULEBOOKS.md` §7.

---

## 4. Manual override (elaborate, and recorded)

Every auto-derived factor may be overridden by a human with the right. An override is **not** a silent
edit; it is a first-class, recorded act:

- `override_value` — the value the human sets.
- `override_reason` — **mandatory**; an empty reason is refused (the same rule as `decideSuggestion`).
- `override_by`, `override_at`.
- `auto_value_at_override` — what the engine proposed, kept so the divergence is visible.
- `rule_id` / `rule_version` — the rule that was overridden.

Rules:

1. **An override is visible at every stage it touches.** The S12 override-visibility machinery already
   exists (`carriedOverrides` in `flows.ts`); the SIRA override reuses that vocabulary so a reviewer at
   the next stage sees that a value was overridden, by whom, and why — not just the final number.
2. **An override never destroys the automatic value.** Both are stored; the score records which was
   used.
3. **An override can be reverted**, and the revert is itself recorded.
4. **A band change caused by an override is flagged** — moving a risk from Medium to Low by hand is
   exactly the event an assurance-over-assurance check (D9) should see.
5. **No override without a right.** Overriding a SIRA factor needs `edit_config` or the SIRA-specific
   right the org configures; a read-only user sees the override but cannot make one.

The score row (`sira_scores`) already stores `factor_values` jsonb; extend it with `auto_values`,
`overrides` and `method`, so a score is fully reconstructible — which value was auto, which was
overridden, by whom, why, and under which rule version.

---

## 5. Dynamic risk assessment (D15, the PwC five themes made real)

The PwC survey (`docs/Risk Assessment, reimagined.pdf`) is the model for the *process* around the
library. Five build requirements, all deterministic:

1. **Standardised inputs, common taxonomy.** One risk taxonomy shared by the library, the SIRA model,
   ERM and the rule packs, so a risk can be trended across cycles and compared to the ERM register.
   Ship a seeded taxonomy; a tenant may extend it, versioned.
2. **ERM mapping.** A table mapping each **enterprise risk theme** to the **audit coverage** that
   addresses it, with a coverage verdict (direct / limited / monitoring / none), the linked engagement
   or plan item, and the KRIs. This is the PwC worked example as data: top ERM risks × IA coverage ×
   KRIs, with **coverage gaps surfaced** — a top ERM risk with no direct coverage is a finding.
3. **Trigger-based refresh.** A deterministic trigger set: a KRI breaches tolerance; a new incident
   above a band; a control test fails; a strategic change is recorded; a management request arrives.
   Each trigger produces a **plan-change proposal** (track / defer / cancel / rescope) with rationale,
   which a human accepts — never an automatic plan rewrite.
4. **Risk-to-coverage narrative.** A decision-ready view: what changed since the last cycle, the
   drivers, the affected people/process/technology, and the tradeoffs (what moved up, what moved down).
   Deterministic text from data, rendered by the existing writing engine — no model.
5. **KRI and appetite/tolerance.** A KRI is a named measure with a threshold and a tolerance band, its
   value derived from data or entered, and a deterministic breach verdict. **Risk appetite** and
   **tolerance** are org settings (versioned, reason-stamped) against which the KRIs and the SIRA bands
   are compared. A risk outside appetite is flagged.

**No AI.** The PwC theme 5 frames AI; this product encodes the deterministic equivalent — a rule that
flags a changed signal, a KRI breach or an emerging theme from data. `src/guards/noAi.test.ts` enforces
it.

---

## 6. Acceptance

- The library is **seeded** and non-empty for a new tenant; selecting a discipline offers that
  discipline's risks.
- A SIRA factor is **auto-proposed** with its inputs and its rule id/version named; an unknown input
  yields "unknown", never 0.
- An **override** requires a reason, records the auto value alongside, is visible at every later stage,
  and is revertible.
- A band change caused by an override is **flagged** for D9.
- The **ERM map** surfaces a top enterprise risk with no coverage as a gap.
- A **KRI breach** produces a plan-change proposal with rationale; it never rewrites the plan.
- No model is used; the no-AI guard passes.
