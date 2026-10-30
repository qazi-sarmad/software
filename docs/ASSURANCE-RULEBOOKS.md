# Assurance rule books — verified source reference (D5 / D7 / D8 / D9)

Numbering and structure verified 2026-10-29. This file records **structure, identifiers and titles
only**. COSO, ISO, PCAOB, ISACA, IFAC and the IIA hold copyright on their texts; the product encodes
the *shape* (control ids, themes, counts, standard numbers) and paraphrases in our own words with a
citation. Never paste the licensed wording into the product, a UI string or a rule description.

This is the source of truth for the four adjacent capability products the owner has now put in scope.
It mirrors `docs/iia-standards-reference.md` in method: verify against the source, record what is
verifiable, never guess a number.

---

## 1. Control taxonomies (the spine of D5)

### COSO Internal Control — Integrated Framework

- Originally issued **1992**; refreshed **2013** (referred to as **ICIF-2013**). Issued by the
  Committee of Sponsoring Organizations of the Treadway Commission (COSO).
- **Five components:** Control Environment, Risk Assessment, Control Activities, Information and
  Communication, Monitoring Activities.
- **Subdivided into 17 principles.** An effective system requires each component and relevant
  principle to be *present and functioning*, and the five components to operate *together*.
- A 2023 supplement extends the framework to internal control over sustainability reporting (ICSR).
- **What we encode:** the five components and the 17 principles as a versioned control taxonomy. Each
  control row carries its component, its principle, the assertion it supports, a test procedure and an
  owner. We encode the structure; the wording is paraphrased.

### PCAOB AS 2201 — the ICFR audit standard

- Title: *An Audit of Internal Control Over Financial Reporting That Is Integrated with An Audit of
  Financial Statements.* This is the standard an auditor applies to opine on ICFR.
- Statutory driver: **Sarbanes–Oxley Act 2002, §404** (management's and the auditor's ICFR reporting).
- **What we encode:** the assertion mapping (existence/occurrence, completeness, accuracy/valuation,
  cutoff, classification, presentation) and the deficiency-severity ladder below. AS 2201 is
  Cloudflare-gated on pcaobus.org; the title and role are recorded from the standard's own citation in
  PCAOB materials, and the severity ladder is the standard's three-way split. Where exact wording is
  needed, cite the standard number and paraphrase.

### ISO/IEC 27001:2022 — Annex A

- **Third edition, October 2022.** Aligned with the harmonized structure for ISO management-system
  standards and with **ISO/IEC 27002:2022**.
- **Annex A contains 93 information-security controls in four themes: organizational, people, physical
  and technological.** (The 2013 edition listed 114 controls in 14 clauses; 11 of the 2022 controls are
  new, 24 merged, 58 updated.)
- The **Statement of Applicability (SoA)** is the artifact: it records the controls determined
  necessary, the justification for including them, whether they are implemented, and the justification
  for excluding any Annex A control. Annex A is a *reference set*, not a mandatory checklist.
- **What we encode:** the four themes and the control count as the taxonomy for the ISO subset, and the
  SoA as the export shape for D8. We do **not** reproduce the 93 control statements.

### NIST SP 800-53 Rev. 5

- *Security and Privacy Controls for Information Systems and Organizations*, **Rev. 5, 2020-09-23**.
- Control **catalog** organised into families (AC access control, AU audit and accountability, CA
  assessment/authorization/monitoring, CM configuration management, and others), with low/moderate/high
  **baselines**.
- **SP 800-53A** supplies the assessment procedures (how each control is tested).
- **What we encode:** the family identifiers and the baseline concept, so a NIST-shaped control set can
  be loaded as a rule pack. Public-domain (US Government work) — still cite the family id.

### COBIT 2019 (ISACA)

- Governance and management **objectives** for enterprise IT. Used only for the IT-control subset
  where an audit is IT-scoped.
- **What we encode:** the objective identifiers as an alternate control taxonomy for the IT subset.

### Deficiency severity — the deterministic ladder

A control test that fails is classified by a **rule**, never a model:

| Severity | Deterministic test |
|---|---|
| Deficiency | A control operated with a deviation below the significance threshold, or a compensating control exists |
| Significant deficiency | A deficiency, or combination, that is less severe than a material weakness yet important enough to merit attention by those charged with governance |
| Material weakness | A deficiency, or combination, such that there is a reasonable possibility a material misstatement would not be prevented or detected on a timely basis |

The thresholds (materiality, significance) are **configuration**, versioned and reason-stamped. The
engine proposes a severity and names the rule and the figures; the auditor disposes. An unknown is
never converted to a zero and a missing figure is reported as missing, not as a pass.

---

## 2. Forensic analytics (the spine of D7)

### Benford's Law

- First- and second-digit expected distributions for naturally occurring financial datasets. Encoded as
  a named rule with the chi-square / MAD conformity test and the digit distribution as data.

### PCAOB AS 2401 / AU-C 240 — fraud and journal-entry testing

- The fraud standard (AS 2401; the AICPA equivalent is AU-C 240). It directs the auditor to test
  **journal entries and other adjustments**, with attention to entries that are: made to unusual or
  unrelated accounts; made by individuals who do not normally make entries; made at unusual times
  (weekends, holidays, period-end); round numbers; back-dated or posted to a closed period; or lacking
  a description.
- **What we encode:** each of those as a named, versioned rule over a population, each citing AS 2401.

### ISA 530 / AU-C 530 — audit sampling

- Sampling risk, tolerable misstatement, and the population-completeness rule: **a sample can never
  exceed its population**, and the population must be complete before a sample is drawn. This is
  already enforced by the `population_gate`; D7 depends on it holding.

### The classic forensic set (already in `analyticsEngine.ts`)

Duplicates, near-duplicates, sequence gaps, z-score and IQR outliers, Benford first digit, round
numbers, weekend postings, same-user create-approve, missing attributes, period variance, GL-to-TB,
SIRA-vs-planning, controls-vs-tests. D7 runs these **over a whole population**, not a sample, and adds
the AS 2401 journal-entry family and Benford second digit.

---

## 3. Policy and regulatory mapping (the spine of D8)

- **ISO/IEC 27001:2022 Statement of Applicability** — the canonical shape: obligation → control →
  included/excluded, with justification. D8 generalises this to any regulation.
- **Regulatory obligation model:** a regulation is encoded as a set of *obligations*, each with an id,
  the source clause, and the subject. Coverage is computed as obligation × control → covered /
  partially covered / gap. A gap is a finding, with the clause named.
- **Version drift:** a policy aligned to an older regulation version is a finding (the existing
  `gov.regulatory` capability already computes this); D8 names the clauses that moved.

---

## 4. Quality and assurance-over-assurance (the spine of D9)

IIA **Global Internal Audit Standards (2024)** — numbering from
`docs/iia-standards-reference.md` (verified against the IIA's own condensed 2024 text). Use the
numbers; never paraphrase the wording.

| Standard | Title | What it grounds in D9 |
|---|---|---|
| 8.3 | Quality | The function's quality framework |
| 8.4 | External Quality Assessment | The EQA pack an outside reviewer asks for |
| 12.1 | Internal Quality Assessment | Engagement-level QA conformance |
| 12.2 | Performance Measurement | Metrics that prove the function performs |
| 12.3 | Oversee and Improve Engagement Performance | Review, sign-off, approval-chain conformance |
| 13.1–13.6 | Engagement communication, risk assessment, objectives/scope, criteria, resources, work program | Engagement-conformance ratios |
| 14.1–14.6 | Gathering information, analyses, evaluation of findings, recommendations, conclusions, documentation | Evidence and documentation conformance |
| 15.1–15.2 | Final communication; confirming implementation | Report freeze/issue and CAP follow-up conformance |

D9 measures the audit function against these numbers and produces the evidence an EQA reviewer would
request. It reuses B's self-diagnostic (`0120_self_diagnostic.sql`), the `assuranceOps` capability
family, the analytics-of-the-analytics checks (`sira_vs_planning`, `controls_vs_tests`) and the
hash-chained ledger.

---

## 5. The rule-citation law (applies to every rule in D5 / D7 / D8 / D9)

1. Every rule carries a **named source** — a standard number, a framework id, or a statute.
2. The rule id is **versioned**; a released rule is immutable; a change is a new version.
3. A finding names the rule id, the rule version and the source rows it flagged.
4. Where a source is licensed, encode the structure and paraphrase the intent. Never paste the text.
5. **No model.** No embedding, classifier, learned threshold or opaque score. Where a practice uses a
   model, encode the rule the practitioner applies and cite the source. `src/guards/noAi.test.ts`
   enforces this and fails the build.
