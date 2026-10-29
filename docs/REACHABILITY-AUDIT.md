# Reachability audit — both engines, 2026-10-29

**Queue item 8. Recorded, not summarised.** The audit's original finding was a class of defect: a
function that exists, is unit-tested, is documented as done, and is never called by anything the
product runs. `report_graphs` was never written; `rule_engine_process` had zero callers. This document
re-runs that check over both engines on `feature/scale-harden-v1` and records the method, so the next
session can repeat it rather than trust it.

## Method

A name-based grep is not enough here — the original audit found that screens import with aliases, so
the check resolves the **import graph**, not names:

1. Read every `.ts`/`.tsx` under `src/` (tests excluded).
2. Parse each `import … from './x'` and resolve the relative specifier to a real file
   (`.ts`, `.tsx`, `/index.ts`).
3. Seed reachability from **screens** — anything under `src/components/`, plus `src/App.tsx` — and
   follow imports transitively.
4. For each engine module, ask: is it reachable from any screen? Then, for each export, which
   reachable non-test file imports it?

Command: a throwaway resolver (the pattern is the one `scripts/audit-wiring.mjs` uses; that script's
per-export output is coarser because it also flags internal helpers, so this run is at **module
level** to answer "is the engine reachable at all").

**Scope:** `src/lib/writing/` (the Writing Engine, all 41 modules) plus `auditEngines`, `siraEngine`,
`analyticsEngine`, `automationRules`, `auditFile`, `workQueue`, `monitors`. **49 modules examined.**

## Result — modules unreachable from any screen

| Module | Reachable from a screen? | Who imports it (non-test) |
|---|---|---|
| `src/lib/writing/bundle.ts` | **No** | nothing — test-only (`bundle.test.ts`, `offlineTamper.test.ts`) |
| `src/lib/writing/issue.ts` | **No** | nothing — test-only; imports `planner` |
| `src/lib/writing/lint.ts` | **No** | nothing — test-only |
| `src/lib/writing/planner.ts` | **No** | `issue.ts`, `seal.ts` (both unreachable) |
| `src/lib/writing/seal.ts` | **No** | nothing — test-only; imports `planner` |
| `src/lib/writing/workbook.ts` | **No** | nothing — test-only |
| `src/lib/siraEngine.ts` | **No** | nothing |
| `src/lib/analyticsEngine.ts` | **No** | nothing (only a *comment* names it) |

**Interpretation, split by kind:**

- **The four writing-engine leaf modules (`bundle`, `issue`, `lint`, `workbook`) and the `planner` /
  `seal` pair are a self-contained test-only cluster.** They compute seals, issues, lint results, the
  report plan and the workbook — the report *writer*'s machinery. The app composes reports
  (`ReportEditorPanel`, `report_graph_commit`) but does not drive these. This is the Systeligon S13
  remainder ("report writer under Systeligon — partial"), not a regression: they were never wired.
  Honest status: **Inert**, same class the register uses.

- **`src/lib/siraEngine.ts` and `src/lib/analyticsEngine.ts` are the load-bearing finding.** Both are
  the deterministic engines the product's own comments say it runs, and **no screen reaches either.**

## The two engines, in detail — this is the defect

Both are "documented as wired, actually inert", the precise class the audit produced.

### `siraEngine.ts` — SIRA scoring

`src/data/sira.ts:6` says:

> *"…the deterministic scoring engine itself lives in `src/lib/siraEngine.ts`."*

But `src/data/sira.ts` imports only `{ callRpc, getClient } from './db'` — **no import of
`siraEngine`.** Every SIRA scoring call goes to the SQL function `public.sira_compute` via RPC. The
TypeScript engine is a **parity mirror**: `siraEngine.ts` exists so `siraEngine.test.ts` can prove the
TS maths matches the SQL maths. That is a legitimate and useful test — but it means the TS engine has
**no production caller**, and the comment implies it does.

**Verdict:** correctly in sync by construction, incorrectly described. Either the comment is wrong, or
the intent was for the engine to run client-side and the wiring never happened. The parity test proves
the two agree; it does not prove the engine is used.

### `analyticsEngine.ts` — the 14 forensic checks

`src/data/analytics.ts:4` says:

> *"The check maths lives in `src/lib/analyticsEngine.ts` (pure functions). This module is the only…"*

Same shape: `src/lib/analytics.ts` (the older variance/TB module) is what `AnalyticsTab.tsx` and
`DocumentReviewTab.tsx` import; `src/data/analytics.ts` is RPC-based and imports only `callRpc`. So the
14 checks in `analyticsEngine.ts` — duplicates, near-duplicates, sequence gaps, IQR/z outliers,
Benford, round numbers, weekend postings, same-user-create-approve, missing attributes, period
variance, GL-to-TB, SIRA-vs-planning, controls-vs-tests — plus `raiseFindingIntent` and
`createObservationStub`, are reachable only from their tests.

**Verdict:** **Inert.** The register already records the numeric forensics as real and tested; this
audit adds the part that matters: *they are not driven by any screen.* An auditor clicking the
Analytics surface gets the RPC path (whose SQL may or may not run these checks), not this engine.

### `monitors.ts` — partially reachable

`ConnectorMonitorPanel.tsx` imports only `MONITOR_KINDS` (the enum, for a dropdown). `evaluateMonitor`
and `runMonitors` have **no screen caller** — consistent with C1, whose runner is a `pg_cron` job on
the SQL side. The rule library is reachable as *labels*; the rule *evaluation* is not exercised from
the UI.

## Still-inert features the register already names (re-verified)

| Feature | Register status | Re-verified |
|---|---|---|
| F34 pre-flight engine | `Inert` | `runPreflight` (`src/lib/preflight.ts:77`) has no caller outside its own test |
| F40 evidence upload control | `Inert` | wrapper writes React state only |
| F41 evidence bytes stored | `Absent` | `evidence_files` read at `documents.ts:100` but no `storage.from(...).upload` for evidence |
| F43 document extraction | `Inert` | `extractDocument` (`src/data/documents.ts:78`) — no screen calls it |

## Register rows corrected in this session

The register's own gate (`check-feature-register.mjs`) passes, but two rows were stale because its
"deadness" rule has a blind spot (below).

| Row | Was | Now | Evidence |
|---|---|---|---|
| F35 report templates | `Inert` — "readers never called" | `Wired` | `listReportTemplates` called at `ReportTemplatePanel.tsx:49` |
| F37 report graph root | `Inert` — "No writer for `report_graphs`" | `Wired` | writer `report_graph_commit` (`0103_phase2_report_graph.sql:70`) called at `ReportEditorPanel.tsx:177`; read via `report_graph_get` |

Counts corrected 52/29/44 → **54 Wired, 27 Inert, 44 Absent.**

## The gate's blind spot (a finding about the checker, not the code)

`check-feature-register.mjs` rule (6) is meant to catch a stale `Inert` row. It fires only when the
evidence cell contains one of a fixed phrase list — `0 caller|no screen calls|zero caller|never
called|0 production refs` — **and** the token names an export of `src/data`/**`src/lib`** that a screen
calls. So:

- An `Inert` row whose evidence names a **table or RPC** (F37 named `report_graphs`, a table) escapes
  both the phrase test and the `callables` set. That is why F37 survived as `Inert` while `0103` had
  already added the writer.
- F35 escaped because its evidence said "readers never called" — `readers` is not a `src/` export
  token, and the phrase "never called" **is** in the list but the token check then finds no callable,
  so nothing fires.

**Fix applied:** the register gate is now run by CI (step 6d), so any future `Wired` row whose screen
caller disappears fails the build. The phrase-list blind spot is recorded here rather than widened
silently — widening it would need a table/RPC call-site check, which is its own work package.

## What this changes for the plan

The two engines being inert does **not** contradict `SCALE-PLAN.md`; it sharpens its Phase 4–5. The
numeric forensics and the SIRA maths are correct and parity-tested — the remaining work is not "write
the engine" but "decide whether the TS engine or the SQL function is the one the product runs, and
wire that one to a screen." Until then, `src/data/sira.ts` and `src/data/analytics.ts` should not
carry comments claiming a pure engine the module does not import.

## Reproduce this

```
node scripts/audit-wiring.mjs        # per-export, screens + tests; the coarse view
node scripts/check-feature-register.mjs   # the register rule set (now in CI)
```

Both exit 0 on this branch at the audit date. This document records the **module-level** pass that
`audit-wiring.mjs` does not isolate; re-run the resolver pattern above to reproduce the table.
