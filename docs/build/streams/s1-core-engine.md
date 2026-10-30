# Stream S1 — core engine, scopes, rule packs, standards distribution (`feature/build-core-engine`)

Cut from the trunk after the mount points. Owns `src/lib/systeligon/**` (types, runner, versioning,
packs, ota, rules, flows, minutes, policydiff — NOT `extract/**`, which is S7's),
`src/components/audit/RuleRunTab.tsx`, `src/components/admin/RulePackPanel.tsx`,
`src/data/{rulePacks,population}.ts`, and the `rulerun-` / `rulepack-` / `standards-` testids.
Migrations `0129`–`0138`.

## Scope
D16 (standards distribution), the remaining S1–S16 engine surfaces (F128–F136), and the SCOPE
answer: make the run surface multi-scope and seal the scope with each finding.

## Rows
F128 (rule versioning/packs — wire `RuleRegistry`, `packRules`), F130 (structured extraction tier 3),
F131 (OCR seam tier 2), F132 (accepted/declined flows + Mode A/B), F133 (structural document rules),
F134 (pattern rules), F135 (minutes action register), F136 (policy/procedure comparison), F145 (D16).

## Queue
1. Baseline + tree whole.
2. `0129`–`0132`: `standards_packs`, `org_standards_subscriptions`, `standards_rollout_log`; extend
   `ota.ts` packs with a source-provenance block and `scopes: RuleTarget[]`; `standards_rollout()`
   reusing `has_feature`.
3. Scope selector on `RuleRunTab`; seal the scope with each finding.
4. Wire F128–F136 to reachable call sites (each with a test through the path).
5. The Super Admin "Standards" tab is S4's screen — coordinate via the mount-point slot, do not edit
   S4's files. S1 provides the data module; S4 renders it.
6. Scale: the rule run at 1M rows deterministic (SCALE-PROGRAMME §5 flow 7).

## Flows (happy + bad)
- Rule run per scope: happy — findings name rule id + version + scope; bad — a draft rule is not run,
  an unsubscribed pack is refused, an empty scope yields no findings and says so.
- Standards rollout: happy — an entitled tenant is applied; bad — a NON-entitled tenant is skipped and
  recorded, an unsigned/content-changed pack is refused (SCALE-PROGRAMME §5 flow 15).
- Accepted/declined flow: happy — required rows → evidence → verify → revert; bad — `applyFloor` is a
  minimum never a ceiling; a verification mismatch refuses.
- Extraction: happy — a parse reports its coverage; bad — an unparsed clause is NOT reported clean.

## Acceptance
- A standards pack is signed + versioned with provenance + scopes; rollout skips non-entitled and
  records it; a tenant runs the subscribed version; a pin is recorded with a reason.
- The run surface offers a pack's scopes; each finding seals its scope.
- F128–F136 each have a call site and a test.
- The composer is untouched; the matrix test passes unchanged.

## Status
| Row | Was | Now | Call site | Test | Migration | Commit |
|---|---|---|---|---|---|---|
| F128 | Inert | Wired | `src/components/admin/RulePackPanel.tsx:95` (RuleRegistry holds the shipped base), `:130` (packRules assembles the run set the pack signs) | `src/components/admin/RulePackPanel.test.tsx` (9: 'reports the shipped rule base from the append-only RuleRegistry', 'saves the shipped pack assembled by packRules over the registry') | — | pending |
| F134 | Inert | Wired | `src/components/audit/RuleRunTab.tsx:196` (config scope reads `listConfigSources`), `:283` (`runRules(..., { target: 'config' })`) | `src/components/audit/RuleRunTab.test.tsx` (8: 'runs the config scope over the org config and seals the scope on the finding', 'reports an empty config honestly') | — | pending |
