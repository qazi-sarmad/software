# Assurance rule books — verified source reference (D5 / D7 / D8 / D9 / D11 / D14 / D15)

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

## 5. Shari'ah assurance — the AAOIFI Shari'ah Standards (the spine of D11's Shari'ah pack)

Source in this repository: `docs/Shariah Standards-AAOIFI.pdf` (the AAOIFI Shari'ah Standards, English
edition, 2015, 1,262 pp, 54 standards). Verified 2026-10-29. Cite **SS (n)** with the standard's title;
never paraphrase a ruling, encode the **structural requirement** the standard imposes and let the
Shari'ah reviewer judge the substance.

The 54 standards (SS 1–54). The ones that carry an auditable structural requirement for an Islamic
financial institution are marked **[audit]**:

| # | Title | # | Title |
|---|---|---|---|
| SS 1 | Trading in Currencies **[audit]** | SS 28 | Banking Services in Islamic Banks **[audit]** |
| SS 2 | Debit Card, Charge Card and Credit Card **[audit]** | SS 29 | Stipulations and Ethics of Fatwa in the Institutional Framework |
| SS 3 | Procrastinating Debtor **[audit]** | SS 30 | Monetization (Tawarruq) **[audit]** |
| SS 4 | Settlement of Debt by Set-Off | SS 31 | Controls on Gharar in Financial Transactions **[audit]** |
| SS 5 | Guarantees **[audit]** | SS 32 | Arbitration |
| SS 6 | Conversion of a Conventional Bank to an Islamic Bank **[audit]** | SS 33 | Waqf **[audit]** |
| SS 7 | Hawalah **[audit]** | SS 34 | Hiring of Persons **[audit]** |
| SS 8 | Murabahah **[audit]** | SS 35 | Zakah **[audit]** |
| SS 9 | Ijarah and Ijarah Muntahia Bittamleek **[audit]** | SS 36 | Impact of Contingent Incidents on Commitments |
| SS 10 | Salam and Parallel Salam **[audit]** | SS 37 | Credit Agreement **[audit]** |
| SS 11 | Istisna'a and Parallel Istisna'a **[audit]** | SS 38 | Online Financial Dealings **[audit]** |
| SS 12 | Sharikah (Musharakah) and Modern Corporations **[audit]** | SS 39 | Mortgage and its Contemporary Applications **[audit]** |
| SS 13 | Mudarabah **[audit]** | SS 40 | Distribution of Profit in Mudarabah-Based Investment Accounts **[audit]** |
| SS 14 | Documentary Credit **[audit]** | SS 41 | Islamic Reinsurance **[audit]** |
| SS 15 | Ju'alah **[audit]** | SS 42 | Financial Rights and How They Are Exercised and Transferred |
| SS 16 | Commercial Papers **[audit]** | SS 43 | Insolvency **[audit]** |
| SS 17 | Investment Sukuk **[audit]** | SS 44 | Obtaining and Deploying Liquidity **[audit]** |
| SS 18 | Possession (Qabd) **[audit]** | SS 45 | Protection of Capital and Investments **[audit]** |
| SS 19 | Loan (Qard) **[audit]** | SS 46 | Al-Wakalah Bi Al-Istithmar (Investment Agency) **[audit]** |
| SS 20 | Sale of Commodities in Organized Markets **[audit]** | SS 47 | Rules for Calculating Profit in Financial Transactions **[audit]** |
| SS 21 | Financial Paper (Shares and Bonds) **[audit]** | SS 48 | Options to Terminate Due to Breach of Trust **[audit]** |
| SS 22 | Concession Contracts **[audit]** | SS 49 | Unilateral and Bilateral Promise **[audit]** |
| SS 23 | Agency and the Act of an Uncommissioned Agent (Fodooli) **[audit]** | SS 50 | Irrigation Partnership (Musaqat) |
| SS 24 | Syndicated Financing **[audit]** | SS 51 | Options to Revoke Contracts Due to Incomplete Performance |
| SS 25 | Combination of Contracts **[audit]** | SS 52 | Options to Reconsider (Cooling-Off, Either-Or, Non-Payment) |
| SS 26 | Islamic Insurance **[audit]** | SS 53 | 'Arboun (Earnest Money) |
| SS 27 | Indices **[audit]** | SS 54 | Revocation of Contracts by Exercise of a Cooling-Off Option |

**The structural requirements a Shari'ah audit tests** (encode these; each cites its SS):

1. **Prohibition of Riba** — no interest in any contract. Applies across SS 1 (currency trading),
   SS 3 (a procrastinating debtor may not be charged), SS 19 (a loan must return exactly the principal).
   A structural rule: no profit or increase on a loan; no penalty income booked to the institution's
   own account (it must go to charity).
2. **Gharar (excessive uncertainty)** — SS 31 sets the controls; a contract whose subject, price or
   delivery is indeterminate fails. Structural rule: required fields present and determinate.
3. **Maysir (gambling) and prohibited object** — the subject of the sale must be permissible and
   owned; SS 18 (possession) requires ownership before sale.
4. **Sequence of contract and ownership** — SS 8 (Murabahah) requires the institution to own the asset
   before selling it on; a Murabahah booking with no prior acquisition is a structural breach.
5. **Profit-and-loss sharing integrity** — SS 12 (Musharakah), SS 13 (Mudarabah) and SS 40
   (profit distribution) require the profit ratio to be agreed **before** the investment and the loss
   to fall on the capital provider (Mudarabah) — a structural rule over the account data.
6. **Zakah** — SS 35 sets the basis, the nisab and the rate; the institution's obligation to compute
   and, where it acts as agent, to disclose is testable against the ledger.
7. **Shari'ah governance** — SS 29 governs the fatwa function; the institution must have a
   **Shari'ah Supervisory Board (SSB)**, its fatwas must be recorded, and the audit must test that
   transactions follow the fatwas. The **Shari'ah review** is performed by the institution's own
   Shari'ah-compliance function and reported to the SSB.

> **The verification gate (unchanged, and the reason the Shari'ah pack is honest).** The AAOIFI
> standards above ARE verified from the PDF in this repo. The **SBP Shari'ah Governance Framework**
> for Pakistan's Islamic banks was NOT reachable from the build environment (sbp.org.pk returns 403).
> So the Shari'ah pack may be built from AAOIFI **SS 1–54** as verified here, but the Pakistan-specific
> SGF overlay must be verified by the owner or the builder against the primary SBP source before any
> Pakistan-specific Shari'ah rule is asserted. Do not invent an SGF requirement. A guessed Shari'ah
> rule is a religious-compliance claim the product has no right to make.

---

## 6. Risk-assessment inputs — the PwC dynamic-risk model (the spine of D15)

Source: `docs/Risk Assessment, reimagined.pdf` (PwC, 2026 survey, 16 pp). Verified 2026-10-29. This is
a **professional-practice survey**, not a standard — so it shapes the **model and the defaults**, not a
rule that produces a finding. Cite it as the source of the input taxonomy and the refresh cadence, and
keep the deterministic rules in §1–§4 as the finding-producers.

Five themes, each a build requirement for D15:

1. **Dynamic risk-assessment inputs.** Standardise signals across **ERM, incidents, strategy,
   performance and external indicators**; establish a **common taxonomy** for trending; define
   **risk appetite and tolerance**; link the signals to the risk universe. (Survey: 16% refresh
   quarterly-or-continuously; 25% use KRIs/KPIs; 85% still rely on interviews; 87% use external
   thought leadership.)
2. **Alignment to ERM.** Share a **common risk taxonomy and language** between IA and ERM; map audit
   topics and auditable entities to **enterprise risk themes**; use the mapping to show **coverage,
   overlap and gaps**. The PwC worked example maps each of the top 7 ERM risks to a coverage verdict
   (direct / limited / monitoring), an audit project and its **KRIs** — that mapping is the model.
3. **Continuous audit planning.** Move from annual to **trigger-based** refresh: a KRI breach, an
   incident, a management request or a strategic change reshapes coverage; plan changes are recorded
   with rationale (track / defer / cancel / rescope).
4. **Translating risk into coverage.** A decision-ready narrative: what changed, the drivers, the
   affected people/process/technology, and the **tradeoffs** (what moved up, what moved down).
5. **Use of AI.** PwC frames AI as summarisation, tagging and signal monitoring. **This product does
   not use AI** (owner decision, and `src/guards/noAi.test.ts` enforces it). Encode the *deterministic*
   equivalent: rules that flag a changed signal, a KRI breach or an emerging theme from data — the same
   outcome without a model.

The concrete input taxonomy to encode (all deterministic): prior audit results, SIRA score and band,
open findings and their age, control-test failures, incident counts, KRI values against tolerance,
management-request count, days since last audit, materiality, regulatory changes, and the ERM theme
map. These are the **auto-adjustment factors** in D14.

---

## 7. The rule-citation law (applies to every rule in D5 / D7 / D8 / D9 / D11)

1. Every rule carries a **named source** — a standard number, a framework id, or a statute.
2. The rule id is **versioned**; a released rule is immutable; a change is a new version.
3. A finding names the rule id, the rule version and the source rows it flagged.
4. Where a source is licensed, encode the structure and paraphrase the intent. Never paste the text.
5. **No model.** No embedding, classifier, learned threshold or opaque score. Where a practice uses a
   model, encode the rule the practitioner applies and cite the source. `src/guards/noAi.test.ts`
   enforces this and fails the build.
