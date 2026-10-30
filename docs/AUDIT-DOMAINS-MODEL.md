# Audit domains model — the three universes (Management / Shari'ah / IT)

Owner question 2026-10-29: *"explain what the current plan would derive in: three default universes
(selectable and configurable per organisation) Management, Shari'ah, and IT? Then all have their
separate rule bases for the analysis engines etc. Or some other way?"*

Short answer: **yes — three default universes, selectable and configurable, each with its own rule
base — and that is the clean model.** This file states the model precisely, says what the current
code already supports, and names the one design choice that matters (is the audit type a *universe* or
a *tag*?).

---

## 1. The model

An **audit domain** (the product's word for a discipline) is a first-class concept with three parts:
a **universe type**, a **rule base**, and a **control set**. Three ship by default:

```
Organisation (tenant)
│  classification C1–C8  (D10) ── decides which domains are OFFERED
│
├── Universe: Management Audit   (discipline = management)   [default, always offered]
│     rule base:  numeric + structural + pattern + sequential  (S6/S8/S9/S14/S15)
│     control set: COSO ICIF-2013, PCAOB AS 2201, the IIA 2024 standards
│     reports:     M1–M12 (the 12 writing-engine models)
│
├── Universe: Shari'ah Audit      (discipline = shariah)      [offered when is_islamic]
│     rule base:  AAOIFI SS 1–54 structural rules (D11)
│     control set: AAOIFI Shari'ah Standards; SBP Shari'ah Governance Framework (verify first)
│     reports:     a Shari'ah review report + the SSB reporting pack
│
└── Universe: IT Audit            (discipline = it)           [offered when the tenant has IT scope]
      rule base:  IT controls rules (D11)
      control set: COBIT 2019, ISO/IEC 27001:2022 Annex A, NIST SP 800-53 Rev. 5
      reports:     an IT assurance report + the IT findings pack
```

Each universe is **selectable and configurable per organisation**: the org chooses which of the three
to use, may rename them, and may add its own. Each carries its **own rule base**, so the rule-run
screen loads the rules for the discipline the universe is in.

## 2. What the current code already supports — and the one gap

| Piece | State |
|---|---|
| `universes` table (`0003`) with a `domain text` column | **Exists** — the field for the discipline is already there |
| A screen that sets or reads `domain` | **Absent** — no screen reads or sets it; `AuditUniverseTab.tsx` uses `useScopedData` and never touches `domain` |
| Rule packs keyed to a discipline | **Absent** — `src/lib/systeligon/packs.ts` and `RulePackPanel.tsx` build packs but key them to nothing discipline-specific |
| Discipline control sets | **Absent** — the taxonomies are written in `docs/ASSURANCE-RULEBOOKS.md`; no table holds them per discipline |

So the **column is there; the wiring is not.** D11 is the wiring.

## 3. The design choice: a universe *type*, not a per-org universe, and why

Two ways to model it:

- **Option A — one universe per discipline per org.** Three universes (`Management`, `Shari'ah`, `IT`),
  each an ordinary `universes` row with `domain` set. The rule base is chosen by the universe.
- **Option B — a discipline *tag* on the risk/engagement.** The discipline lives on the risk, the
  engagement or the finding, not on the universe.

**Recommendation: Option A, with the discipline also carried on the risk library rows** (see
`docs/RISK-ASSESSMENT-MODEL.md` §2) so a single universe can still contain cross-discipline risks when
the org wants that. The reasons:

1. **The rule base is the unit of selection.** An auditor running an IT audit wants the IT rules and
   not the Shari'ah rules. A universe is the natural carrier of "which rule base".
2. **It matches the specification.** `docs/SPEC-v10.md` already names "IT Audit, Shari'ah Audit,
   Management Audit" as universe domains. Option A is what the spec assumed.
3. **It matches the SIRA model.** SIRA scores are per universe (`sira_cycles.universe_id`), so a
   discipline's risks score in that discipline's universe with that discipline's factors.
4. **It is configurable.** A tenant that does only management audit uses one universe; a bank uses all
   three. The default set is a *seed*, not a constraint — the org edits it.

The one risk to avoid: **hard-coding exactly three.** The three are *defaults*; the model must allow an
org to add a fourth discipline (e.g. "Compliance Audit", "Forensic Audit") by defining a universe with
a new domain and pointing it at a rule pack. So the discipline is a **closed-but-extensible set**: the
three defaults plus org-defined domains, each mapped to a rule pack and a control set.

## 4. What this derives for each discipline

### Management audit (built)
- Rule base: the existing `analyticsEngine` checks wrapped as named, versioned Systeligon rules
  (`numeric`, `threshold`, `documents`, `patterns`, `minutes`, `policydiff`) — built, UI partly wired.
- Control set: COSO ICIF-2013 (5 components / 17 principles), PCAOB AS 2201, the IIA 2024 standards.
- Reports: the 12 writing-engine models (M1–M12) — built.

### IT audit (container only — D11 builds it)
- Rule base: change management, access and privileged access, backup/DR, SDLC, patch management,
  logging and monitoring — each a named rule citing its control id.
- Control set: COBIT 2019 (the governance/management objectives), ISO/IEC 27001:2022 Annex A (93
  controls across 4 themes), NIST SP 800-53 Rev. 5 (the control families).
- Reports: an IT assurance report; the IT findings pack.

### Shari'ah audit (container only — D11 builds it)
- Rule base: the AAOIFI SS 1–54 **structural** rules (riba, gharar, maysir, ownership sequence,
  profit-distribution integrity, zakah, Shari'ah governance) — see `docs/ASSURANCE-RULEBOOKS.md` §5.
- Control set: the AAOIFI Shari'ah Standards (verified, in this repo); the **SBP Shari'ah Governance
  Framework** (NOT verified — the builder must verify against the primary SBP source before asserting
  any Pakistan-specific requirement).
- Reports: a Shari'ah review report and the SSB reporting pack.
- **The honesty rule stands**: a Shari'ah rule is asserted only against a verified standard, and the
  substantive Shari'ah judgment is always the SSB's, never the product's.

## 5. How a tenant ends up with the right universes

The classification (D10) drives which domains are **offered**:

- C1–C5, C8 (non-Islamic) → **Management** by default; **IT** offered if the tenant has technology
  scope; **Shari'ah** not offered.
- C6–C7 (banks, SOEs) → all three offered; **Shari'ah** offered where the institution has an Islamic
  window or is Islamic; **IT** offered (banks and SOEs have heavy IT scope).
- `is_islamic = true` → **Shari'ah** offered regardless of classification.

The org then **selects and configures**: rename, add, or remove a universe, and point each at a rule
pack. The default is a starting point an admin can change — never a hard constraint.

## 6. Acceptance

- `universes.domain` (or a new `audit_type`) is set and read by a screen.
- A universe of each discipline loads its own rule base in the rule-run screen.
- The three defaults are seeded; an org can add a fourth and point it at a rule pack.
- A Shari'ah universe runs only verified AAOIFI-based rules, or is honestly blocked pending SGF
  verification.
- Every rule in every pack names its control id and source.
