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
| `feature/scale-harden-v1` | Builder A | Phases 3-6, the C-series, gates G1-G6 | `docs/SCALE-TASKS.md` | `0107`-`0113` |
| `feature/systeligon-build-v1` | Builder B | E1-E7 + E9-E10, U1-U4 + U6 + U8 + U14, S17-S21, T3-T7, D1-D4, F1-F7, G7-G10 | `docs/SYSTELIGON-TASKS.md` | `0114`+ |
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

## Task labels are branch-scoped, not a shared namespace

**`U1` on Builder A's branch is not `U1` on Builder B's.** They are different tasks that happen to
share a label:

| Label | Builder A's meaning | Builder B's meaning |
|---|---|---|
| `U1` | pencil-style guided pointers | dashboard numbers drill to their records (DONE) |
| `U2` | every screen's functional states | command palette, Cmd/Ctrl-K |
| `U3` | guided first-run, zero to first sealed report | work queue as the front door (DONE) |

So "U2 is done" is meaningless without naming the branch. Write the branch in every cross-builder
report: "B's `U2`" or "A's `U2`". `G1`-`G6` are A's; `G7`-`G10` are B's; those do not overlap, but
they are the exception, not the rule. **Before you report a label as done or as yours, check it
against the other ledger.**

---

## Migration reservation

Both work branches share one migration namespace, applied by glob in filename order. A gap is
harmless; a collision is not.

| Range | Owner | Notes |
|---|---|---|
| `0001`-`0106` | shared | Already on every branch. Do not renumber. |
| `0107`-`0117` | Builder A | **Consumed and collided.** Phase 3 workflow enforcement, report templates, config effects, Phase 4 methodology, Phase 5 (`0111`-`0114`), tenant suspension (`0115`), Phase 6 (`0116`-`0117`). When this table was first written it said `0114`+ was Builder B's; Builder A had already carried Phase 5 and Phase 6 into that range, and the two branches' `0110`-`0117` filenames differ. A real merge therefore lands two different files on each path (`0110`, `0111`, … `0117`) and a plain `git merge` resolves it **silently**, keeping one side and dropping the other. That is the exact failure this table exists to prevent; it is recorded here in full rather than hidden by a tidy reservation. |
| `0118` onward | Builder B / this session | Start at `0118`. Builder B's Phase 5-6 work is currently at `0110`-`0117` on `feature/systeligon-build-v1`; those seven carry-over files keep their numbers (the work is committed and its ledger and SQL tests reference them by name), but **every new migration from here on takes `0118`+**. Builder A's `0110`-`0117` will be renumbered to `0118`+ at integration time, or A's branch is abandoned in favour of B's — either way no two distinct migrations share a path after the merge. |

**Never write a migration below your own range.** This is the single most likely way for one builder
to break the other's SQL harness. The `0110`-`0117` collision is the live example: the harness applies
files by glob in filename order and a gap is harmless, but **two files with the same leading number and
different names is not** — one overwrites the other in a merge and the loss is silent while the run
stays green. Before integrating any two branches, diff the two migration lists and prove no number
maps to two files.

---

## Shared registries — the real collision surface

Four files are touched by BOTH builders, because both add screens and both must register them.
Measured: Builder A already modified all four in its current work.

| File | Hand-written or generated? | Rule |
|---|---|---|
| `docs/ACP-UI-CONTRACT.md` | **hand-written — the source of truth** | Edit only your own screen sections. This is the one file where a human edit is correct. |
| `docs/UI-INVENTORY.md` | **generated** by `scripts/gen-ui-inventory.mjs` | NEVER hand-edit. Regenerate after changing the contract. |
| `src/lib/tutorialKeys.json` | **generated** by `scripts/gen-tutorial-steps.mjs` | NEVER hand-edit. Regenerate. |
| `supabase/migrations/0081_tutorial_steps.sql` | **generated** by the same `scripts/gen-tutorial-steps.mjs` | NEVER hand-edit. Regenerate. **This is the file that actually conflicts** when A merges the spec branch — measured: a real `git merge` of the guidance into A aborts with a conflict here, while B merges clean. Both sides regenerated it from the contract at different times. Delete your copy, regenerate, commit. |
| `public/tutorials/.ui-hashes.json` | **generated** by `scripts/record-tutorials.mjs` | NEVER hand-edit. Regenerate by recording. |

**Measured conflict: `supabase/migrations/0081_tutorial_steps.sql`.** Merging the guidance into
Builder A conflicts on this file and nowhere else. It is generated, so the resolution is not a text
merge — it is `node scripts/gen-tutorial-steps.mjs` after the contract is settled. Builder B merges
the same guidance with zero conflicts, so this is an A-side stale regeneration, not a real divergence.

**On conflict in a generated file, do not merge the text — regenerate it.** Delete your version,
regenerate from `docs/ACP-UI-CONTRACT.md`, and commit the result. A text merge of a generated file
produces a document that no longer matches its source, and the next generator run silently reverts
half of it.

Verified: `gen-ui-inventory.mjs` is deterministic (regenerating produces byte-identical output), and
`gen-tutorial-steps.mjs` is idempotent (a second run changes nothing). The committed
`tutorialKeys.json` was merely **stale** — one regeneration brings it current. Stale generated files
are exactly what turns a two-builder merge into a phantom conflict, so regenerate before you commit
a screen change, every time.

**Screen-id ranges are the partition.** Both branches currently end at `WK-11`. The contract carries
fourteen families; every one is assigned, so no builder has to guess:

| Family | Count | Owner | Why |
|---|---|---|---|
| `SA-*` | 15 | Builder A | its Phases 3-6 are all platform surfaces |
| `OA-*` | 24 | Builder A | org-admin config; A's 3.4/3.5 add `OA-22b`, `OA-22` |
| `GL-*`, `TUT-*` | 3 | Builder A | chrome and the tutorial drawer |
| `AF-*` | 14 | Builder B | E4/E6 affordances, S20 evidence, S21 comments |
| `AP-*` | 5 | Builder B | E4/E6 on the plan and SIRA surfaces |
| `AU-*`, `AX-*` | 4 | Builder B | E4/E6 on the universe and auth surfaces |
| `CH-*` | 6 | Builder B | U2 is the command palette (`CH-03`) |
| `DB-*` | 1 | Builder B | U1 dashboard numbers |
| `IR-*` | 5 | Builder B | E4/E6 on the issues and CAP register |
| `SR-*` | 3 | Builder B | S18/S19 SIRA continuity |
| `WK-*` | 9 | Builder B | E10, T5, the report builder |
| `WQ-*` | 1 | Builder B | U3 work queue front door |

**This table was incomplete when first written** — it named only `SA-*`, `OA-*`, `WK-*`, `EX-*`, `GL-*`
and `TUT-*`, leaving `AF-*`, `AP-*`, `AU-*`, `AX-*`, `CH-*`, `DB-*`, `IR-*`, `SR-*` and `WQ-*`
unassigned. Builder B was already working on `U2` (the command palette, `CH-03`) against a map that
did not mention `CH-*`. A missing row is a collision waiting for the other builder to arrive, so every
family is now listed.

**If your row needs a screen in a family you do not own, STOP and report it.** Do not take the next
free id and do not reuse a retired id (`SA-06`, `OA-06`, `OA-07`, `WK-07` are retired and stay
retired).

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
   Measured: this auto-merges both ledgers with no conflict, because the two sides' edits land in
   different regions. Verified by a real `git merge --no-ff` into B's head: exit 0, zero conflicts.

   **`git fetch origin` alone is not enough, and the obvious check is a false positive.** Two
   builders have now reported "Already up to date" while the guidance was not in their branch. The
   reason: they tested `git merge-base --is-ancestor <pre-split-sha> HEAD`. A pre-split commit is an
   ancestor of *everything* you build on, so that test returns true whether or not the merge landed.

   **Test the right sha, and test it after fetching:**
   ```bash
   git fetch origin
   git merge origin/feature/systeligon-v1
   git merge-base --is-ancestor f387e61 HEAD && echo GUIDANCE LANDED || echo NOT LANDED
   ```
   `f387e61` is the first guidance commit. If the echo says `NOT LANDED`, the merge did not happen —
   do not proceed on the assumption that it did.

   **Do not use `git merge-tree` to predict conflicts on this branch pair.** It echoes the guidance
   text *about* conflict markers, so its output contains `+<<<<<<<` even when the merge is clean.
   Run the real `git merge --no-ff` and read `git diff --name-only --diff-filter=U`.
5. **If a builder needs something in the other's scope, it stops and reports it** rather than building
   it. Two agents editing one subsystem is how this repository got a two-UIs problem.

---

## Status snapshot

| Item | State |
|---|---|
| Phases 1-2 | **DONE** on the merge base (`0100`-`0106`). Both builders inherit them. |
| Builder A | Active. Phases 1-4 DONE (`3.1`-`3.6`, `4.1`-`4.4`; highest migration `0110`). Phases 5-6 (`5.1`-`5.3`, the `C1`-`C7` block, `6.1`-`6.3`), `G1`-`G6`, `U1`-`U3` TODO — plus the `E1`-`E10` block, which is **not A's** (see the known gap below). |
| Builder B | Active. `E1`-`E7`, `E9`, `E10`, `U1`, `U3`, `U14`, `G7`-`G9` DONE; 26 TODO (`S17`-`S21`, `T3`-`T7`, `D1`-`D4`, `U2`/`U4`/`U6`/`U8`, `F1`-`F7`, `G10`). Highest migration `0106`; range `0114+` reserved (moved up — see the migration table). |
| The spec branch | Complete. Holds every document both builders read. **Neither builder has merged it yet** — both reported a false "already up to date". See *Merge rules* rule 4. |

### Known gap — Builder A's ledger still claims the E-series

Builder A's `docs/SCALE-TASKS.md` lists **`E1`-`E10` as its own TODO** (catalogue, popout, `iia.ts`,
wiring, drilldown, standards affordance, standards view, gates G7-G9, E10 inventory). **All ten are
already `DONE` on Builder B's branch**, and A's branch carries neither `src/lib/explain/` nor the
explain guards.

A specified the explain layer (`21ee32f`) before the split, and the split then assigned the E-series
to Builder B — but A never learned that, because A has no `BRANCH-MAP.md`, no builder prompt and no
guidance. If A works the E-series it re-implements about 4,900 lines of B's work in parallel, and the
merge is a rewrite rather than a merge.

**Fix, at A's next review boundary: A merges `feature/systeligon-v1`, then strikes the E-series block
from its ledger with a one-line note** — "moved to Builder B; see `BRANCH-MAP.md`" — rather than
marking it DONE (A did not do it) or leaving it TODO (it is not outstanding work).

**A's `U3` ("guided first-run, zero to first sealed report") is real A work and is not B's `U3`**
(work queue front door, DONE). Same for `U2`. See *Task labels are branch-scoped* above.

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

---

## Current topology (2026-10-30) — the answer to "which branch merges?"

The trunk is **`feature/systeligon-builder-continuous`**. It carries the whole product, and it is the
**only** branch that merges to `main` (`main` is its ancestor — a fast-forward, no conflict).

The seven concurrent build streams cut from it and are **already folded back in** (each is 0 commits
ahead): `feature/build-core-engine`, `feature/build-assurance-caps`, `feature/build-risk-planning`,
`feature/build-platform-control`, `feature/build-monitor-runtime`, `feature/build-config-honesty`,
`feature/build-extraction`.

**The designer's catalogue lives on the trunk, not on a side branch.** `docs/DESIGN-SPEC.md` (every
screen with its route, rights, data functions, RPCs, tables, testids and states; every flow; every
token) is generated by `scripts/gen-design-spec.mjs` (`npm run gen:design`) from the trunk's own
sources, and guarded by `src/guards/designSpec.test.ts`. The first draft on
`feature/systeligon-design-spec` was cut at 105 screens; the trunk copy is regenerated against the
current 122. `feature/design-language-v1` does not exist — the design language (rows E8, U5, U7,
U9–U13, A-U1) stays DEFERRED until the owner settles it and `docs/design/CONTRACT.md` is frozen.

### Long-lived branches that are NOT merged, and why

Every one of these was cut early and is **hundreds of files behind** the trunk (it *deletes* screens
the trunk now has). None may be merged wholesale — a merge would regress the trunk. Each carries only
a small unique delta; take that delta, if the owner wants it, by hand.

| Branch | Unique delta | Disposition |
|---|---|---|
| `feature/systeligon-build-v1` | `DiagnosticPanel` + population-rows writer + a SIRA inspector | The register already builds the diagnostic on the trunk (`runDiagnostic`, SA-20/OA-42); no merge |
| `feature/security-harden-v1` | MFA/SSO/withheld screens + a few `tokens.css` utilities | Not a concurrent-build stream; owner decision |
| `feature/cap-due-date-change` | `docs/reference/v1/**` (an archived v1 tree) | Reference only |
| `feature/writing-engine` | one extra writing test | Content already equal on the trunk |
| `feature/audit-file-v1`, `radial-hover-fix`, `cap-*`, `phase-*`, `docs/*`, `coderabbit/*`, `merge/*` | none on the trunk's paths | Superseded |
