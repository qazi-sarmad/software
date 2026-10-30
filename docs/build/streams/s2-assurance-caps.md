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
   (`0120_self_diagnostic.sql`, the `assuranceOps` family, `sira_vs_planning`, `controls_vs_tests`).
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
| F121 | `Absent` | `Wired` | `monitorControls` (`src/lib/assurance/controlMonitoring.ts`) classifies a control by the PCAOB AS 2201 ladder over COSO ICIF-2013; the panel calls `runIcfrMonitoring` (`src/data/assurance.ts:83`) from the `Monitor controls` button (`AssuranceCapabilitiesPanel.tsx:195`) and `saveIcfrControl`/`saveIcfrRule`/`saveIcfrEvidence` from the D5 config form | `src/lib/assurance/controlMonitoring.test.ts` (18), `src/components/assurance/AssuranceCapabilitiesPanel.test.tsx` (9), `supabase/tests/141_assurance_capabilities.sql` | 0139 | this commit |
| F123 | `Absent` | `Wired` | the named versioned rules in `FORENSIC_RULES` (`src/lib/assurance/forensicAnalytics.ts`) run over a whole population; the panel calls `runForensicAnalytics` (`src/data/assurance.ts:171`) from the D7 tab | `src/lib/assurance/forensicAnalytics.test.ts`, `src/components/assurance/AssuranceCapabilitiesPanel.test.tsx` (9) | 0139 | this commit |
| F124 | `Absent` | `Wired` | `analyseGaps` (`src/lib/assurance/gapAnalysis.ts`) maps each obligation to its controls and reports every gap by its clause; the panel calls `runGapAnalysis` (`src/data/assurance.ts:214`) from the D8 tab | `src/lib/assurance/gapAnalysis.test.ts`, `src/components/assurance/AssuranceCapabilitiesPanel.test.tsx` (9) | 0139 | this commit |
| F125 | `Absent` | `Wired` | `assuranceOverAssurance` (`src/lib/assurance/assuranceOverAssurance.ts`) measures the function against the IIA Global Internal Audit Standards (2024), a missing input being `unknown`, never 0; the panel calls `runAssuranceOverAssurance` (`src/data/assurance.ts:243`) and `saveAssuranceMetric` (`src/data/assurance.ts:252`) from the D9 tab | `src/lib/assurance/assuranceOverAssurance.test.ts`, `src/components/assurance/AssuranceCapabilitiesPanel.test.tsx` (9) | 0139 | this commit |

### Notes
- OA-34 (`src/components/assurance/AssuranceCapabilitiesPanel.tsx`) is now `mounted` in
  `src/nav/registry.ts`; it renders through the `assurance_caps` inspector (`src/context/AppContext.tsx`,
  `src/components/common/RecordContent.tsx`) and the command palette action `action.assurance_caps`.
- 0139 seeds four catalogue features (`icfr_monitoring`, `forensic_analytics`, `policy_gap_analysis`,
  `assurance_over_assurance`, all `addon`/not-default) and adds the RLS-scoped tables
  `icfr_controls`/`icfr_rules`/`icfr_evidence`/`assurance_metrics` plus the writers
  `icfr_control_save`/`icfr_rule_save`/`icfr_evidence_save`/`assurance_metric_save` and the three
  finding writers `icfr_finding_record`/`forensic_finding_record`/`gap_finding_record`. The three
  finding writers gate on `has_feature(...)` and are mapped in `src/lib/featureMap.ts` (F25 rule 5).
- Both paths are tested: D5 shows a breach with its severity + basis and a control with no evidence is
  "no evidence" (never a pass); a run with no `perform_work` right is disabled and refused; a load
  failure shows the error with a retry; a writer refusal (`feature_off: …`) is an inline error, not a
  silent success; a blank D9 metric value is saved as NULL (`unknown`), never 0; the D5 config form is
  hidden without `edit_config`.
- Trap fixed: `/**` inside a `--` SQL comment breaks `check-dead-code`'s comment stripper
  (`/*[\s\S]*?\*/` swallows the rest of the concatenated migrations). Never write `/*` in a migration
  comment.
