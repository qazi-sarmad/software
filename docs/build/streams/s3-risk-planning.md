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
