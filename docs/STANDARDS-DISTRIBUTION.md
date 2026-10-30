# Standards distribution — Super Admin rollout of rule bases to paying tenants

Owner instruction 2026-10-30: "for all the standards now incorporated, make it so that such updates
can be rolled out through the super admin (for all those that pay :p)".

This is the specification for **D16**. It makes every rule base the product ships — the forensic set,
the control sets, the AAOIFI Shari'ah Standards, the SBP Compendium and SGF overlay, the PwC input
taxonomy — a **versioned, signed, distributable artifact** that the Super Admin rolls out to entitled
tenants, and it answers the scope question at the end.

The governing laws are unchanged: deterministic only (L1), data never leaves the tenant (L2),
config-as-ledger (L3). Distribution **adds** a gate; it never relaxes the tenant's own RLS.

---

## 1. What already exists (verified)

| Piece | Where | State |
|---|---|---|
| Entitlement / plan machinery | `src/data/entitlements.ts`, `SuperAdminFeatures.tsx`, `has_feature` RPC (0051/0052) | **Built** — a feature is switched per org by the Super Admin, enforced server-side by `has_feature`, with price classes `free / included / add_on / custom` and a plain-words refusal |
| Signed rule packs | `src/lib/systeligon/ota.ts` (`signPack`, `verifyPack`, `packContentHash`, `buildAdhocRule`), `src/data/rulePacks.ts`, `0128_rule_pack_release.sql` | **Built** — a pack is content-hashed, signed, verified, released; a refusal log records `content_changed` / `signature_invalid` / `subject_mismatch` |
| Rule versioning | `src/lib/systeligon/versioning.ts` (`RuleRegistry`, `definePack`, `releasedRules`, `packRules`) | **Built** — append-only versions, duplicate `id@version` collapses |
| Rule target vocabulary | `src/lib/systeligon/types.ts` — `RuleTarget` | **Built** — `population \| journal \| document \| minutes \| policy \| config \| ledger`; a rule declares one |
| Super Admin surfaces | `SuperAdminPortal.tsx` (tenants, features, provisioning, migration, hosting) | **Built** — the sole surface knowing the platform role |
| **Rolling out a standards UPDATE** to entitled tenants | — | **Absent** — a pack is released *for the releasing org*; there is no distribution from the platform to tenants |

**The gap in one line:** a rule pack can be signed and released, and a feature can be switched per
tenant, but there is no path that takes a **new standards update** and **rolls it out through the Super
Admin to the tenants that pay for it.** D16 builds that path.

---

## 2. The standards catalogue (the artifacts that get rolled out)

A **standards pack** is a named, versioned, signed bundle of rules plus the sources it cites. The
catalogue the product ships:

| Pack id | Contents | Source | Discipline |
|---|---|---|---|
| `standards.forensic.core` | the numeric/structural/pattern/sequential rules | `analyticsEngine.ts`, S6/S8/S9/S14/S15 | management |
| `standards.icfr.sox` | SOX/ICFR control monitoring | PCAOB AS 2201, COSO ICIF-2013 | management |
| `standards.it.baseline` | IT controls | COBIT 2019, ISO 27001:2022 Annex A, NIST 800-53 | it |
| `standards.shariah.aaoifi` | the 54 AAOIFI Shari'ah Standards structural rules | AAOIFI SS 1–54 | shariah |
| `standards.shariah.sbp-compendium` | the SBP-adopted AAOIFI subset + SBP's own Sharikat ul Milk / Diminishing Musharakah standard | `COMPENDIUM OF SHARIAH STANDARDS ADOPTED BY STATE BANK OF PAKISTAN.pdf` (updated 31 Oct 2024) | shariah |
| `standards.shariah.sgf` | the SGF governance rules (SB, RSBM, SCD, PD, ISA, ESA, FAPC, SB report) | `SHARIAH GOVERNANCE FRAMEWORK.pdf` (effective 1 Jan 2025) | shariah |
| `standards.risk.pwc-taxonomy` | the risk input taxonomy and ERM-theme map defaults | `Risk Assessment, reimagined.pdf` (PwC 2026) | cross |

Each pack carries: `id`, `version`, `released_at`, `sources[]` (document + edition + page/standard
number), the rules, the content hash, and the signature. **A rule is immutable once released** — a
change is a new pack version. This is the existing `ota.ts` contract, extended with a **source
provenance block** so a finding can name the document and edition it came from.

---

## 3. The distribution model — platform → tenants, gated by entitlement

```
        PLATFORM (Super Admin)                         TENANT (org)
  ┌───────────────────────────────┐            ┌───────────────────────────────┐
  │  standards_catalogue           │            │  org_standards_subscriptions   │
  │   pack_id @ version, sources   │──rollout──▶│   which packs, which version,  │
  │   signed, immutable            │            │   when applied, by whom        │
  └───────────────────────────────┘            └───────────────────────────────┘
             │                                            │
             │  rollout is REFUSED unless                 │  the tenant's rule run reads
             │  the tenant is ENTITLED to the pack         │  the SUBSCRIBED version
             ▼                                            ▼
      has_feature(org, 'standards.shariah.sbp-compendium')   RuleRunTab loads that pack
```

### 3.1 The tables

- `standards_packs` — the platform catalogue: `pack_id`, `version`, `title`, `discipline`, `sources`
  jsonb, `rules` jsonb, `content_hash`, `signature`, `released_at`, `released_by`. Append-only (L5):
  a new version is a new row; an old row is never edited.
- `org_standards_subscriptions` — per tenant: `org_id`, `pack_id`, `subscribed_version`,
  `applied_at`, `applied_by`, `reason`. Append-only; moving to a new version appends a row.
- `standards_rollout_log` — who rolled which pack version to which tenants, when, and the outcome per
  tenant (applied / skipped-not-entitled / skipped-pinned / failed). The ledger of distribution.

### 3.2 The rollout (Super Admin action)

`standards_rollout(pack_id, version, org_ids[])`:
1. Verify the pack's signature (`verifyPack`); refuse an unsigned or content-changed pack.
2. For each org: check `has_feature(org, pack_id)`. **Not entitled → skipped, recorded, never applied.**
3. For each entitled org: append a subscription row to the new version, record the rollout, and — if
   the tenant has *not* pinned a version — switch its effective pack version.
4. Return the per-tenant outcome; the Super Admin surface shows it.

**The paying rule.** Entitlement is the existing `has_feature` gate. A standards pack is a **feature**;
its price class is `add_on` or `custom`; a tenant that does not pay for it never receives it, and the
attempt is recorded as `skipped-not-entitled` (visible, not silent). A `free`/`included` pack (the
forensic core, the ICFR baseline) rolls to everyone.

### 3.3 The tenant side

- The rule-run screen loads the **subscribed** version of each pack, not "the latest". A tenant that
  has not been rolled forward keeps running the version it was sealed against — **a sealed report must
  still re-derive on the version it used** (the existing re-derivation law).
- A tenant with the right may **pin** a version (stay on it) or **request** the latest; a pin is
  recorded with a reason. Pinning is how a bank under audit stays frozen mid-engagement.
- The tenant **sees** which standards version it is on and what is available (a "standards" section),
  but only the Super Admin can roll forward an entitled pack.

### 3.4 Super Admin surface

A "Standards" tab on `SuperAdminPortal.tsx`:
- the catalogue (pack id, version, discipline, sources, released date);
- per-pack rollout: pick a version, pick entitled tenants (or all), roll out, read the per-tenant
  outcome;
- a tenant's view: which packs, which versions, pinned or following, and the rollout history;
- **honest states**: a pack with no entitlement anywhere shows "no entitled tenants"; a failed rollout
  shows the reason, never a green tick.

---

## 4. How a standards update is made (the authoring path)

1. A new document edition arrives (e.g. SBP re-issues the Compendium). The authoring path diffs the
   new edition against the pack's `sources`, drafts the changed rules as `draft`, and produces a new
   **pack version** — never an edit to the released one.
2. The pack is content-hashed and signed with the platform key (`signPack`).
3. The Super Admin rolls it out to entitled tenants (3.2).
4. Each tenant's next rule run uses the new version; a sealed report keeps its old version.

**The verification gate still applies at authoring.** The SBP SGF and Compendium are now verified (in
this repo). A *future* edition must be verified against its primary source before it becomes a pack
version — never assumed. The pack records the edition it was built from.

---

## 5. The scope question — population, or any other scope?

Owner question 2026-10-30: *"the rules mean that if the audit is conducted through my engine on
population right? Or any other scope?"*

**Answer: the rules are not tied to population. A rule declares its own scope, and the engine runs
whichever rules match the scope it is given.** This is already built:

- `RuleTarget = population | journal | document | minutes | policy | config | ledger` — a rule declares
  exactly one, and `runRules(rules, input, { target })` runs only the rules whose target matches.
- So a **population** run (the current `RuleRunTab`) runs the `population` and `journal` rules over
  `input.rows`; a **document** run runs the `document` rules over `input.documents`; a **minutes** run
  runs the `minutes` rules; a **policy** run runs the `policy` rules; and so on.
- The same rule base therefore serves **any scope**: population (transaction testing), journal
  (journal-entry testing, AS 2401), documents (contracts, minutes, policies), config (system settings),
  and the ledger (the hash-chained audit trail).

**What this means for the D16 rollout:** a standards pack declares the **scopes it covers**
(`scopes: RuleTarget[]`), so a tenant can see "this pack applies to population + journal + document".
The rule-run screen offers the scopes the subscribed packs cover. Nothing about distribution is
population-specific; the population run is simply the one scope currently mounted.

**The one thing to build for full multi-scope:** today only the population scope has a mounted screen
(`RuleRunTab`). The document/minutes/policy/config/ledger scopes have rules (F133–F136) but **no
mounted run surface** — that is the F130–F136 Inert work. D16 adds a **scope selector** to the run
surface so a subscribed pack's non-population rules are reachable, and the rollout's pack metadata
names the scopes it carries.

**The sealing rule across scopes (important):** a report seals the rule id + version **and the scope**
that produced each finding. A finding from a population run and a finding from a document run are
different findings with different provenance, even if they cite the same rule. The graph root already
commits the rule id + version per claim; D16 adds the scope to that commitment so two scopes can never
be conflated in a sealed report.

---

## 6. Report writing — the 1,200 combinations are untouched

Owner instruction 2026-10-30: *"Report writing to still use all 1200 combinations for generation."*

Verified, and unchanged by D16: the composer's matrix is **5 formality × 5 tone × 2 voice × 2 locale =
100 cells** (`src/lib/writing/registers.ts`, `locale.ts`, `matrix.test.ts`), extended across the
**12 report models** (`src/lib/writing/models.ts`) = **1,200 compositions**. D16 does **not** touch the
composer, the register dimensions, the locale set or the model set.

What D16 adds is orthogonal and must not disturb the invariant: the composer's **graph root is
identical across all 100 cells** (the facts do not change when the wording does). A standards pack
changes *which rules ran* — i.e. it changes the **facts** the report asserts — so it changes the graph
root legitimately, and it must do so **consistently across all 1,200 combinations** of the report that
cites it. The acceptance is: for a fixed pack version and a fixed claim set, all 1,200 combinations
still share **one** graph root and only the render hash varies.

---

## 7. Acceptance

- Every shipped rule base is a signed, versioned **standards pack** with a source-provenance block.
- The Super Admin can roll a pack version out to entitled tenants; a non-entitled tenant is **skipped
  and recorded**, never silently applied; a signed-pack failure is refused.
- A tenant runs the **subscribed** version; a sealed report re-derives on the version it sealed with;
  a tenant may pin a version with a reason.
- A pack declares the **scopes** it covers; the run surface offers those scopes; a finding seals its
  scope alongside the rule id and version.
- The composer still produces **1,200 combinations** with **one graph root** per fixed claim set and
  pack version; the matrix test still passes unchanged.
- No model is used; `src/guards/noAi.test.ts` passes; the rollout adds a gate and relaxes no RLS.
