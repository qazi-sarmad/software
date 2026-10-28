> ## ⚠️ STALE — ARCHIVED, DO NOT TRUST
>
> This document predates the code-verified audit of 2026-10-27/28 and is kept for history only.
> Its status claims are **not** reliable: the audit found the app was not database-backed in
> production, the engagement lifecycle was never persisted, several documented-as-Present features
> were dead code, and many "all Present" claims were false.
>
> **Current sources of truth:**
> - `docs/SPEC-v10.md` — the specification (unchanged, still authoritative)
> - `docs/FUNCTIONALITY-AUDIT.md` — what is actually built (code-verified)
> - `docs/REMEDIATION-PLAN.md` — the plan being executed
> - `docs/SCALE-TASKS.md` — live task ledger
>
> Do not cite this file as evidence that anything works.

# Tutorial target audit (T1)

Every frozen tutorial target checked against the screen its key belongs to, and against the
component that actually declares the testid. Method: read the **Testids:** line of each screen
section in `docs/ACP-UI-CONTRACT.md`, and independently scan every non-test `.ts`/`.tsx` file under
`src/` for the testid literal. A target is a mismatch when the key's own screen does not document
it, or when only another portal's component declares it.

Reproduce: `node artifacts/audit-targets2.mjs` (mismatches by contract) and
`npx vitest run src/guards/tutorialTargets.test.ts` (mismatches by renderer).

## Result

85 keys, 1 change made, 2 mismatches reported.

| Key | Screen | Target | Declared by | Status |
|---|---|---|---|---|
| `oa.tutorials` | OA-18 | `superadmin-tutorials` | `src/components/superadmin/SuperAdminTutorials.tsx` only | **changed** to `org-tutorials` (OA-18's own testid, added in this commit) |
| `oa.templates` | OA-08 | `template-save` | `src/components/superadmin/SuperAdminAutomation.tsx` only | **reported**, not changed |
| `oa.templates` | OA-08 | `template-list` | `src/components/superadmin/SuperAdminAutomation.tsx` only | **reported**, not changed |
| `oa.governance` | OA-22 | `org-control-tab-governance` | `src/components/admin/OrgControlPanel.tsx` (renders `org-control-tab-${t.id}`) | contract documentation gap only; the testid renders, the contract lists it under another section |

### oa.tutorials (changed)

OA-18 is the Org Admin tutorial library. It rendered the super-admin component
`SuperAdminTutorials` directly with `audience="org_admin"`, so it had no testid of its own and the
key targeted another portal's. OA-18 now wraps the component in its own `org-tutorials` element,
matching the convention every other Org Admin tab already follows (`org-features`, `org-setup`,
`org-consultation`). The key's step now targets `org-tutorials`.

Diff, before and after:

```
       {
         "text": "Read Tutorials in OA-18.",
-        "testid": "superadmin-tutorials"
+        "testid": "org-tutorials"
       },
```

`sa.tutorials` (SA-13) is unchanged: SA-13 is the super-admin library and `superadmin-tutorials` is
correctly its own testid.

### oa.templates (reported, awaiting owner approval)

`oa.templates` is OA-08, the Org Admin templates hub. Its steps target `template-save` and
`template-list`, which only `SuperAdminAutomation.tsx` declares. Its first step targets
`org-template-list`, which is the Org Admin panel's own id — so the key mixes two portals. The
likely fix is to retarget both steps at the Org Admin panel's ids, but T1 says to change only
`oa.tutorials` without approval, so this is left as is and the guard records it in
`REPORTED_PENDING_APPROVAL` with the key name. The guard still fails for any key not listed.

### oa.governance (contract gap)

`org-control-tab-governance` is rendered by `OrgControlPanel.tsx` as
`data-testid={`org-control-tab-${t.id}`}`, so the target is correct and the recording works. The
OA-22 contract section does not list the tab button ids on its **Testids:** line, so the target
looks undocumented. `scripts/check-ui-contract.mjs` passes because it only checks the reverse
direction (every contract testid exists in src). Reported as a documentation gap; no code change.
