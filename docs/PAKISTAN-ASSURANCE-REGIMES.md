# Pakistan assurance regimes — verified reference (client classification)

Verified 2026-10-29. This file records the **regulatory shape** — classification, regulator, governing
law, and whether internal audit and ICFR are mandatory. It is the source of truth for the client
classification property (D10) and for which obligations, rule packs and reporting templates load for a
tenant. Where a claim is verified against a source it says so; where it comes from the owner's brief
and I could not independently reach the source (secp.gov.pk, sbp.org.pk and agp.gov.pk are all behind
Cloudflare or offline to this environment) it is marked **reported**.

Same rule as `docs/iia-standards-reference.md` and `docs/ASSURANCE-RULEBOOKS.md`: encode the structure
and paraphrase. Do not paste licensed text.

---

## 1. Why this exists

A tenant's obligations depend on **what kind of entity it is**. A listed public company, a bank, an SOE
and a single-member company are governed by different regulators, different laws, and different
mandatory internal-audit and ICFR requirements. The product cannot decide what to monitor, what ICFR
evidence to require, or which rule pack to load until it knows the classification. Today `orgs` (0002)
carries only `name`, `is_demo`, `created_at` — there is no classification, no regulator, no jurisdiction.
That is the gap D10 closes.

## 2. The classification matrix

| # | Company classification | Principal regulator | Primary governing law | Mandatory internal audit? | Mandatory ICFR / reporting? | Verified |
|---|---|---|---|---|---|---|
| C1 | Listed public companies | SECP + PSX | Companies Act, 2017; Listed Companies (Code of Corporate Governance) Regulations, 2019 | Yes — dedicated independent IA function reporting to the Audit Committee | Yes — s.227 directors' statement on adequacy of internal financial controls; COSO is the standard framework | **verified** — Companies Act 2017 s.227 obliges directors of public companies to state adequacy of internal financial controls in the directors' report; COCG 2019 confirmed as a SECP instrument |
| C2 | Public unlisted companies | SECP | Companies Act, 2017; Public Sector Companies (Corporate Governance) Rules, 2013 (if state-tied) | No, unless public-sector / SOE | Yes — the board must comment on the adequacy of internal financial controls in the directors' report | **reported** (SECP gated) |
| C3 | Private limited (paid-up > PKR 1m) | SECP | Companies Act, 2017 | No — exempt | Basic — statutory audit under ss.223/226; no formal ICFR declaration | **reported** |
| C4 | Private limited (paid-up ≤ PKR 1m) | SECP | Companies Act, 2017 | No — exempt | Exempt from internal-financial-control disclosure and auditor attestation | **reported** |
| C5 | Single member company (SMC) | SECP | Companies Act, 2017 | No — exempt | Exempt | **reported** |
| C6 | Banking companies & DFIs | State Bank of Pakistan (SBP) | Banking Companies Ordinance, 1962; SBP Guidelines on Internal Controls; SBP ICFR Roadmap | Yes — a rigorous, specialised IA function routing to the Board Audit Committee | Yes, highest rigour — annual management assessment, board endorsement, and a Long Form Report (LFR) by the external auditor | **verified** — SBP BSD Circular No. 7 of 27 May 2004 (*Guidelines on Internal Controls*) and BSD Circular No. 5 of 24 Feb 2009 (the ICFR roadmap, structured as **eight stages**) confirmed from SBP's own document URLs (`sbp.org.pk/bsd/2004/C7.htm`, `dnb.sbp.org.pk/bsrvd/2009/C5.htm`) |
| C7 | State-owned enterprises (SOEs) | Ministry of Finance / AGP | SOE (Governance and Operations) Act, 2023; SOE (Audit Committee, Internal Control and Risk Management) Regulations, 2024 | Yes — independent Chief Internal Auditor; strict reporting separation from executive management | Yes — mandated implementation of **COSO ERM, ISO 31000 and COBIT**; double-audited by external firms and the Auditor General of Pakistan (AGP) | **verified** — the SOE (Audit Committee, Internal Control and Risk Management) Regulations, 2024, issued under the SOE (Ownership and Management) Policy, 2023, name COSO ERM, ISO 31000 and COBIT as the permitted frameworks (Finance Division, finance.gov.pk) |
| C8 | Non-profit organisations (s.42 / NPOs) | SECP | Companies Act, 2017 (s.42); Associations with Charitable and Not-for-Profit Objects Regulations, 2018 | Conditional — strongly encouraged by SECP licence conditions; mandatory if foreign-funded or above specific size tiers | Yes — high accountability; internal financial controls must address AML risk | **verified** (name of the 2018 instrument and the s.42 licence route confirmed; the "mandatory if foreign-funded" threshold is **reported**) |

> **Note on the SOE Act.** The owner's brief cites the *State-Owned Enterprises (Governance and
> Operations) Act, 2023*. The 2024 Regulations were issued under a *State-Owned Enterprises (Ownership
> and Management) Policy, 2023*. The two are related but not identical instruments; record both and let
> the classification map to the regime, not to a single act number. Do not guess a section number.

## 3. What the product must derive from the classification

The classification is not a label; it is a switch. For each classification the product must know:

1. **Is internal audit mandatory?** → does the tenant get an IA-function conformance view (D9)?
2. **Is ICFR mandatory, and at what rigour?** → does the tenant get the ICFR control set (D5), and is
   it the basic directors'-statement form or the SBP-roadmap / SOE-COSO-ERM form?
3. **Which frameworks are permitted or mandated?** → COSO ICIF, COSO ERM, ISO 31000, COBIT, ISO 27001,
   NIST 800-53 (see `docs/ASSURANCE-RULEBOOKS.md`).
4. **Which reporting artifacts are required?** → directors' statement, LFR, ICFR annual assessment,
   SoA, board report.
5. **Which regulator's numbering is cited?** → SECP/Companies Act, SBP circular, SOE Regulations, AGP.
6. **Is the entity Islamic / does it carry a Shari'ah obligation?** → does a Shari'ah rule pack and a
   Shari'ah governance view load (see §4)?

## 4. The audit-type axis (management / IT / Shari'ah)

Separate from *what the client is* is *what the engagement audits*. The product names these in
`docs/SPEC-v10.md` §universe: "IT Audit, Shari'ah Audit, Management Audit" as examples of universe
domains. `universes.domain` exists (0003) but no screen reads or sets it, and no rule pack is keyed to
it. Three audit types, three honest states:

- **Management audit** — this is the product. Risk universe, SIRA, engagements, findings, CAPs,
  board pack, the IIA mapping, the writing engine. Aligned and built.
- **IT audit** — the *container* exists (`universes.domain = 'IT Audit'` is nameable) but there is **no
  IT rule base**: no change-management, access-control, backup/DR, SDLC, privileged-access or
  patch-management rules, and no COBIT / ISO 27001 / NIST control set wired to a universe. The taxonomy
  is in `docs/ASSURANCE-RULEBOOKS.md`; the rules are not built.
- **Shari'ah audit** — the *container* exists (nameable as a domain) but there is **no Shari'ah rule
  base** and **no Shari'ah governance mapping**. In Pakistan a Shari'ah audit is grounded in the SBP
  Shari'ah Governance Framework for Islamic banking, the institution's Shari'ah Supervisory Board, and
  AAOIFI Shari'ah standards (GSIFI). **Not verified in this environment** (SBP is 403 to curl and the
  search engines returned no usable snippet); the builder must verify the current SBP SGF and the
  applicable AAOIFI standards before encoding any Shari'ah rule, and must cite the exact standard —
  never invent a rule or a standard number.

The honest summary: **management audit is built; IT audit and Shari'ah audit are containers with no
rule base** — the same "built container, no reachable rule" defect the programme exists to catch.

## 5. Verification method and limits

- Verified via: SBP document URLs surfaced by Brave Search; the Finance Division SOE Regulations 2024;
  the Companies Act 2017 s.227 obligation via ICAP's Companies Act 2017 memorandum and Business
  Recorder; the 2018 NPO Regulations name and the s.42 route.
- Not reachable from this environment: secp.gov.pk (Cloudflare), sbp.org.pk (403), agp.gov.pk (offline),
  and all mainstream search engines except Brave. Rows marked **reported** come from the owner's brief
  and must be confirmed against the primary instrument before the product asserts them.
- Never assert a section number, a stage count or a framework name in the product without a citation in
  this file or `docs/ASSURANCE-RULEBOOKS.md`.
