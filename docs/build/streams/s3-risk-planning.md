# Stream S3 — risk, classification, planning D10/D14/D15 (`feature/build-risk-planning`)

Cut from the trunk after the mount points. Owns `src/lib/risk/**`, `src/data/risk*.ts`,
`src/lib/siraEngine.ts` (read-only to others), `src/components/sira/**`, `src/components/universe/**`,
and the `risk-` / `sira-` / `classification-` testids. Migrations `0149`–`0158`.

## Scope
D10 (client classification C1–C8 + ICFR trigger), D14 (risk library, auto-adjusted factors, manual
override), D15 (dynamic risk assessment, the PwC model). Specs: `docs/RISK-ASSESSMENT-MODEL.md`,
`docs/PAKISTAN-ASSURANCE-REGIMES.md`, `docs/ASSURANCE-RULEBOOKS.md` §6.

## Rows
F139 (D10), F143 (D14), F144 (D15).

## Queue
1. Baseline + tree whole.
2. D10: `0149`+ classification at onboarding, versioned + reason-stamped; drives the obligation set;
   a "Banking company / DFI" is offered the SBP ICFR control set and the LFR artifact; an "SMC" is told
   it is exempt.
3. D14: seed `risks_library` non-empty (universal + org + discipline packs); auto-derive each SIRA
   factor as a proposal `{proposed_value, inputs, rule_id, rule_version, source}`; the recorded manual
   override (mandatory reason, auto value kept, visible downstream, revertible, band change flagged);
   extend `sira_scores` with `auto_values` + `overrides`.
4. D15: shared seeded taxonomy; the ERM map (theme → coverage verdict → engagement → KRIs) surfacing
   an uncovered top risk as a gap; trigger-based plan-change proposals with rationale; the
   risk-to-coverage narrative from data.
5. Scale: SIRA at 5,000 entities (SCALE-PROGRAMME §5 flows 10, 11).

## Flows (happy + bad)
- Classification: happy — saved, versioned, drives obligations; bad — unsupported class refused; an
  obligation without a citation is refused.
- SIRA score: happy — computed + banded; bad — unknown factor → "unknown" not 0; model-version drift
  refused.
- Override: happy — recorded with reason; bad — empty reason refused; no right refused; the auto value
  is never destroyed.
- ERM map: happy — coverage shown; bad — a top ERM risk with NO coverage is surfaced as a gap.

## Acceptance
- F139/F143/F144 each with a call site + test; the library seeded non-empty.
- An unknown input is "unknown", never 0; an override is visible downstream and revertible.

## Status
| Row | Was | Now | Call site | Test | Migration | Commit |
|---|---|---|---|---|---|---|
| F139 (D10) | Absent | Wired | `src/components/universe/ClientClassificationPanel.tsx` (inspector `classification`, mounted in `RecordContent.tsx:147`); writers `classification_set` / `standards_update_scope` / `risk_library_derive` (`0149`) | `src/lib/risk/classification.test.ts` (10), `src/components/universe/ClientClassificationPanel.test.tsx` (8), `supabase/tests/142_classification_risk.sql` §1–5, §9–10 | 0149 | 9136b63 |
| F143 (D14) | Absent | Wired | `src/lib/risk/derivation.ts` (`deriveFactors`, `applyOverride`, `resolveFactors`); writers `risk_factor_write` / `risk_override_set` / `risk_override_revert` (`0150`); normaliser `sira_normalize_weights` | `src/lib/risk/derivation.test.ts` (12), `src/lib/risk/normalizeWeights.test.ts` (7), `supabase/tests/142_classification_risk.sql` §6–8 | 0149/0150 | 9136b63 |
| F144 (D15) | Absent | Wired | `src/components/sira/RiskLibraryPanel.tsx` (inspector `risk_library`, mounted in `RecordContent.tsx`); writers `erm_theme_set` / `kri_value_set` / `plan_change_propose` (`0151`); pure `ermMap`/`kriState`/`planChangeFor` (`src/lib/risk/dynamicAssessment.ts`) | `src/components/sira/RiskLibraryPanel.test.tsx` (9), `supabase/tests/142_classification_risk.sql` §11 | 0151 | 9136b63 |
