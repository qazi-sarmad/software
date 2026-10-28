# Branch map — who owns what, and how work is tracked

**Read this before creating a branch, a migration, or a ledger row.** Three sessions work this
repository at once. This page says which branch belongs to whom, which ledger tracks it, and which
numbers are reserved. It is the answer to "where is that work, and is it done?" — so it must stay
true.

---

## The topology

```
main                                   untouched. Nothing merges here without the owner.
 │
 6f47cf8   merge base — Phases 1-2 ALREADY PRESENT (migrations 0100-0106)
 │
 ├── feature/scale-harden-v1            Builder A — Phases 3-6, the C-series, gates G1-G6
 │                                     ledger: docs/SCALE-TASKS.md
 │
 └── feature/systeligon-v1             the SPEC branch — docs, register, gates. Base, not a work tree.
      │                                (branched from 6f47cf8)
      │
      └── feature/systeligon-build-v1  Builder B — E1-E7 + E9-E10, U1-U4 + U6 + U8 + U14, S17-S21, T3-T7, D1-D4, F1-F7, G7-G10
                                       ledger: docs/SYSTELIGON-TASKS.md
```

`feature/systeligon-v1` is the **common ancestor for documents**. Both builders merge *from* it; no
builder pushes *to* it. That is what keeps the two work trees independent.

---

## Ownership

| Branch | Owner | Scope | Ledger | Migration range |
|---|---|---|---|---|
| `feature/scale-harden-v1` | Builder A | Phases 3-6, the C-series, gates G1-G6 | `docs/SCALE-TASKS.md` | `0107`-`0109` |
| `feature/systeligon-build-v1` | Builder B | E1-E7 + E9-E10, U1-U4 + U6 + U8 + U14, S17-S21, T3-T7, D1-D4, F1-F7, G7-G10 | `docs/SYSTELIGON-TASKS.md` | `0110`+ |
| `feature/systeligon-v1` | nobody builds here | specs, register, gates, this map | — | none |
| `main` | the owner | — | — | — |

**One branch owns one ledger.** No two branches edit the same ledger file. That is the whole tracking
mechanism: to know whether something is done, read the ledger for the branch that owns it, and
believe only what the rows say.

---

## The tracking rule

**Work is done when the ledger row says `DONE` in the same commit as the code.** Not when a commit
message says it, not when a document claims it, not when a test passes.

| Status | Means |
|---|---|
| `TODO` | Not started. |
| `DOING` | Started, not finished. |
| `DONE` | Implemented, tested, and the gate set is green. |
| `BLOCKED (owner)` | Needs the owner: a Law change, a spend, a credential. Nothing else qualifies. |

`Partial` is not a status. It is the word that let earlier documents claim completion. An item is
`DONE` or it is not.

**Verify wiring by grepping the call site.** A green test is not proof a feature works — on this
repository the whole suite passed for months while the production build showed empty screens. Use
`node scripts/audit-wiring.mjs`, which resolves the real import graph alias-aware. Name-based greps
lie here: screens import with aliases (`populateSuggestions` is the export
`populate_planning_suggestions`).

---

## Migration reservation

Both work branches share one migration namespace, applied by glob in filename order. A gap is
harmless; a collision is not.

| Range | Owner | Notes |
|---|---|---|
| `0001`-`0106` | shared | Already on every branch. Do not renumber. |
| `0107` | Builder A | Phase 3 workflow enforcement. |
| `0108`-`0109` | Builder A | Reserved for Phases 4-5. |
| `0110` onward | Builder B | Start at `0110`. |

**Never write a migration below your own range.** This is the single most likely way for one builder
to break the other's SQL harness.

---

## Shared registries — the real collision surface

Four files are touched by BOTH builders, because both add screens and both must register them.
Measured: Builder A already modified all four in its current work.

| File | Hand-written or generated? | Rule |
|---|---|---|
| `docs/ACP-UI-CONTRACT.md` | **hand-written — the source of truth** | Edit only your own screen sections. This is the one file where a human edit is correct. |
| `docs/UI-INVENTORY.md` | **generated** by `scripts/gen-ui-inventory.mjs` | NEVER hand-edit. Regenerate after changing the contract. |
| `src/lib/tutorialKeys.json` | **generated** by `scripts/gen-tutorial-steps.mjs` | NEVER hand-edit. Regenerate. |
| `public/tutorials/.ui-hashes.json` | **generated** by `scripts/record-tutorials.mjs` | NEVER hand-edit. Regenerate by recording. |

**On conflict in a generated file, do not merge the text — regenerate it.** Delete your version,
regenerate from `docs/ACP-UI-CONTRACT.md`, and commit the result. A text merge of a generated file
produces a document that no longer matches its source, and the next generator run silently reverts
half of it.

Verified: `gen-ui-inventory.mjs` is deterministic (regenerating produces byte-identical output), and
`gen-tutorial-steps.mjs` is idempotent (a second run changes nothing). The committed
`tutorialKeys.json` was merely **stale** — one regeneration brings it current. Stale generated files
are exactly what turns a two-builder merge into a phantom conflict, so regenerate before you commit
a screen change, every time.

**Screen-id ranges are the partition.** Both branches currently end at `WK-11`. New screens take the
next free id in the range you own:

| Range | Owner |
|---|---|
| `SA-*` (Super Admin) | Builder A — its Phases 3-6 are all platform surfaces |
| `OA-*`, `WK-*`, `EX-*` | Builder B — E10, S21, T5 and the explain surfaces |
| `GL-*`, `TUT-*` | Builder A (chrome) |

If you need a screen id outside your range, STOP and report it.

## Inert-function resolution — assigned, not implicit

The wiring audit (`node scripts/audit-wiring.mjs`) reports **529 exports with no reachable caller**.
Do NOT treat that number as a to-do list. Measured on this branch: **402 of the 529 are referenced
by a `.test.ts`** — they are legitimate test-only exports, not dead code. Only **127** have no test
reference at all, and those are the ones that need triage.

| Situation | Owner |
|---|---|
| The export is named in a row of YOUR ledger | you resolve it, in that row's commit |
| The export sits in `src/lib/writing/**` or `src/lib/render/**` | Builder A |
| The export sits in `src/data/**` or `src/lib/explain/**` | Builder B |
| Anything else | report it in your ledger; do not silently delete |

**Named and assigned today** (all Builder B's, because they sit in its S/T rows):
`listIntegrityAlerts` (T7), `createSiraCycle`, `publishSiraCycle`, `recordSiraScore`,
`submitEmergentRisk`, `decideEmergentRisk` (S18/S19).

**A test-only export is not dead.** Before deleting anything, check whether a `.test.ts` calls it. If
it does, it is a tested unit that the UI has not reached yet — that is a wiring gap to record, not
code to delete. Deleting a tested export to make the audit number go down destroys coverage and
hides the real defect.

**Neither builder was told this before now.** Both were silently carrying the same 529-export list.
That is the gap this section closes.

## Merge rules

1. **Never force-push any branch.**
2. **Never push to another builder's branch.** It is a live working tree.
3. **Never merge to `main`.** The owner does that.
4. **A builder merges `feature/systeligon-v1`** to pick up new specs, the register, or gate changes.
   Measured: this auto-merges `docs/SCALE-TASKS.md` with no conflict, because the two sides' edits
   land in different regions.
5. **If a builder needs something in the other's scope, it stops and reports it** rather than building
   it. Two agents editing one subsystem is how this repository got a two-UIs problem.

---

## Status snapshot

| Item | State |
|---|---|
| Phases 1-2 | **DONE** on the merge base (`0100`-`0106`). Both builders inherit them. |
| Builder A | Active on Phase 3. `3.1`-`3.4` DONE (workflow settings, `report_templates`). `3.5`-`3.6` and Phases 4-6 TODO. |
| Builder B | Branch created, not yet started. |
| The spec branch | Complete. Holds every document both builders read. |

### Known gap — Builder A is missing the specs

Builder A's branch was cut before the specs were written, so it **does not contain**
`docs/SYSTELIGON.md`, `docs/FEATURE-REGISTER.md`, `docs/FONT-REPOSITORY.md`,
`docs/SYSTELIGON-TASKS.md`, `docs/BUILDER-PROMPT.md`, `scripts/audit-wiring.mjs` or
`scripts/check-feature-register.mjs`.

This matters because Builder A's **Phase 5 is the C-series** (the monitor and connector runner), and
`docs/SYSTELIGON.md` is the document that defines it. Builder A will reach Phase 5 without the spec
for the work.

**Fix, when Builder A's current work is reviewed:** Builder A merges `feature/systeligon-v1`. Verified
clean — no conflicts, and the merge brings in the specs, the register, the gates, the E-series ledger
rows, and the C/S/T/D sections. Do not do this while Builder A is mid-commit; do it at a review
boundary.

---

## Why the branch split exists

The earlier structure had one builder and one ledger, and it worked. With two builders it fails in a
specific way: if both edit one ledger, every merge is a manual reconciliation, and neither can tell
from the file alone which rows are theirs. Splitting the ledger by branch removes that failure mode
instead of relying on the two sessions never touching the same region.
