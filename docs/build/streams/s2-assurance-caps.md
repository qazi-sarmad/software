# Stream S2 — assurance capabilities D5/D7/D8/D9 (`feature/build-assurance-caps`)

Cut from the trunk after the mount points. Owns `src/lib/assurance/**`, `src/data/assurance*.ts`,
`src/components/assurance/**`, and the `assurance-` / `icfr-` / `forensic-` / `gapanalysis-` testids.
Migrations `0139`–`0148`.

## Scope
The four owner-approved assurance capabilities, grounded in `docs/ASSURANCE-RULEBOOKS.md`.

## Rows
F121 (D5 SOX/ICFR continuous control monitoring), F123 (D7 population-level forensic analytics),
F124 (D8 policy-to-control gap analysis), F125 (D9 assurance-over-assurance).

## Queue
1. Baseline + tree whole.
2. D5: control monitoring rules over COSO ICIF-2013 / PCAOB AS 2201; a configured control is monitored,
   a breach opens a finding with the control id + the rule id/version.
3. D7: population-level forensics over the existing `analyticsEngine` checks, wrapped as named,
   versioned rules (Benford, AS 2401 journal-entry testing, ISA 530 sampling).
4. D8: policy-to-control gap analysis — every gap cites the policy clause and the control; an unparsed
   clause is not reported as covered.
5. D9: assurance-over-assurance — measure the audit function against the quality standards
   (`0131_self_diagnostic.sql`, the `assuranceOps` family, `sira_vs_planning`, `controls_vs_tests`).
6. Scale: D7 over the 1M-row population (SCALE-PROGRAMME §5 flow 7).

## Flows (happy + bad)
- D5 monitor: happy — a breach opens a finding; bad — no control configured → the panel says so, never
  a silent green.
- D7 forensics: happy — findings cite the flagged rows; bad — an empty population is not "clean".
- D8 gap: happy — a gap names policy + control; bad — a clause that cannot be interpreted is reported
  as could-not-interpret, never as compliant.
- D9: happy — a metric with its evidence; bad — a missing input is "unknown", never 0.

## Acceptance
- Each of F121/F123/F124/F125 has a call site, a test, and a named source per rule.
- No model anywhere; the no-AI guard passes.

## Status
| Row | Was | Now | Call site | Test | Migration | Commit |
|---|---|---|---|---|---|---|
