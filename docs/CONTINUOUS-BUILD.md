# Provio / Systeligon — continuous-build contract (`feature/systeligon-unified-v1`)

The operative contract for the builder session on the **unified** branch. It supersedes
`docs/SCALE-HARDEN-CONTINUOUS-BUILD.md` (which described the A-side branch and its own queue) by
carrying the same laws and stopping rules onto the merged tree. Everything else carries over.

Read `docs/SYSTELIGON-GAP-REPORT.md` first — the verified built/planned picture — then this.

---

## 0. The contract — read this before anything else

**You do not stop.** Not to ask permission, not to propose a plan, not to confirm a design call, not
to report progress, not to say "shall I continue". You work the queue in §3 from top to bottom and you
keep going until the queue is empty.

**No idle longer than 20 seconds, for any reason.** Polls, waits, retries, backoffs, CI checks,
sleeps: 20 seconds is the hard ceiling. If a wait would exceed it, do not wait — take the next queue
item, retry with a short backoff, or record the result as pending and move on. Never sit still.

**You stop for exactly three reasons, and no others:**

1. **The queue in §3 is empty.** Everything is built, gated, committed and pushed.
2. **A gate cannot be made to pass** after you have genuinely exhausted the fix options, and you have
   recorded the exact command, its exact output, and every fix you attempted.
3. **An owner action is required** — the closed list in §7. Nothing else qualifies.

**If you hit a decision you cannot make**, do not stop and do not ask. Pick the option that satisfies
the laws in §1 and the specification, record the decision and the reasoning in `docs/SCALE-DECISIONS.md`
in the same commit, and continue. A recorded decision is the deliverable; a question is not.

**Never end a turn to report.** The commit message is the report.

---

## 1. The laws — not negotiable, and they outrank speed

- **L1 Deterministic only.** No AI, no model calls, no free-text generation, no embeddings.
  `src/guards/noAi.test.ts` enforces this and fails the build on any AI identifier returning.
- **L2 Data never leaves the tenant.** RLS + `jwt_org_id()` is the only read path for tenant data.
  Only SHA-256 hashes may leave. A new sharing path may *add* restrictions; never relax that equality.
- **L3 Config-as-ledger**, interconnected ledger, population gate — inviolable. Versioned,
  reason-stamped, append-only.
- **L4 Pure functions live under `src/lib/` or `src/data/`.** Components never import the Supabase
  client (rule M8). Time is always an argument; never read the clock inside a pure function.
- Every interactive element carries `data-testid="<screenId>-<element>"`. No blocking modals;
  non-modal chrome is `role="complementary"`. Platform crypto and existing hashing primitives only.
- **Order is bytes → row → ledger**, never the reverse, wherever evidence or an artifact is written.
- **NO PARKING.** An item is `DONE` or it is not. `Partial` is not a status. `DEFERRED (design)` is
  legitimate **only** for §4, and the row stays visible.

Speed never overrides a law. If continuous progress would require breaking L1–L4, the law wins and you
record the decision in `docs/SCALE-DECISIONS.md`.

---

## 2. Your branch

Work on **`feature/systeligon-unified-v1`**. It is the merge of the A-side build
(`feature/scale-harden-v1`) and the B-side build (`feature/systeligon-build-v1`), and it is the only
tree where both halves are present.

- **Never touch `main`. Never force-push.**
- Push after every coherent unit of work — do not accumulate unpushed commits across queue items.
- The migration collision between A and B is **already resolved** on this branch: B's eight migrations
  were renumbered above the collision to `0119`–`0126`, content-preserving. The colliding SQL *test*
  numbers (`101`–`107`, `112`–`117`) were renumbered to `121`–`133` in the same spirit. **New
  migrations take the next free number above the branch head; new SQL tests likewise.** See
  `docs/BRANCH-MAP.md`.

---

## 3. The queue — execute in this order, top to bottom

The engine is built; its surfaces are not. The remainder is the last mile: mounting the built
deterministic engine on screens a user can reach, plus the orchestration and honesty rows. The guard
is always the same — **find the call site.** If nothing calls it, it is dead code and you must say so.

**Blocking first — the branch must be green before anything else lands.**

0. **Green the branch.** CI run `40896566545` had steps 1–14 green and step 8 (Playwright) at
   143 passed / 2 failed. The two failures are fixed (`e2e/c2-member-invite.spec.ts` budget;
   `scripts/record-tutorials.mjs` navigation budget + one retry). Confirm the fixing run passes
   end-to-end before building on it. **A red branch is the first queue item, always.**

**Then the last mile, in this order:**

1. **L1 — the rule-run screen (S1–S16 mounted; highest value).** The engine runs; nothing on screen
   runs it. Build the surface that picks a population, picks a rule pack (S10), runs it (S1 runner),
   shows each finding with its rule id, version, severity and the source rows it flagged, and calls
   `recordSysteligonFindings` (`src/data/systeligon.ts`) so findings are recorded to the ledger and
   re-rooted into the report graph (S13). Removes the `a-own-unwired` allow-list entry; turns
   F127–F129 Inert → Wired. **This is the screen the whole engine exists to feed.**
2. **L2 — the rule-pack management UI (S10/S11).** `src/data/rulePacks.ts` (`listRulePacks`,
   `saveSignedRulePack`) has no screen caller. Build the surface that lists packs, shows a pack's rules
   and versions, and saves a signed pack (verified server-side in `rule_pack_save`; an unverifiable
   save is refused and logged). F137 Inert → Wired. The ad-hoc rule builder (source, condition,
   threshold → a versioned artifact) is part of this surface.
3. **L3 — extraction in the audit-file UI (S7).** Tier 1 is wired (`extractDocument` → `doc-extract`)
   but thin. Mount the full three-tier flow: recognise (S17), extract, show the source hash so a
   finding traces to the exact bytes, surface the OCR seam's coverage report. Ship the bundled OCR
   engine as a build artifact — a permissively licensed, bundled, local implementation — record the
   decision, keep the "refuse a remote engine" guarantee (L2).
4. **L4 — S13 remainder, org-format editor adoption.** Provenance is done. What remains: the editor
   adopts an uploaded report's structure and typography at every stage, and formatting stays editable
   without altering a fact. Font/colour auto-detect (F5/F6) already exists to feed it.
5. **L5 — C7, anomaly to SIRA.** A resolved alert proposes an emergent risk carrying the alert id, the
   rule version and the affected rows. It was BLOCKED (S18); S18 is now built, so the blocker is gone.
   Build C7 on the S18 two-key acceptance channel; record it in the ledger with that cross-reference.
6. **L6 — A-U2, every screen's functional states.** loading / empty / error / ready / denied.
   Functional, not visual. Every screen must be honest in each state — never a wall of zeros, never a
   silent blank, never a denied screen that looks like an empty one.
7. **L7 — A-U3, guided first-run to a sealed report, by reconciliation.** B built
   `GuidedFirstRun.tsx` and `create_universe`. **Reconcile** rather than build a second
   implementation — this repo's two-UIs problem is exactly that. Take what exists, close the gap to
   "zero → first sealed report", delete any duplicate.

**Continuous, not a queue item:**

- **Reachability audit of both engines.** Grep every export of `src/lib/writing/` and every
  audit-engine module for a production call site. Run it after every queue item that adds a module.
  `node scripts/check-wiring.mjs` resolves the real import graph, alias-aware. Name-based greps lie.
- **Re-record tutorial media** when a screen's testids change. `check-tutorials` reports current vs
  stale; the committed GIFs are placeholders. Build work, not an owner action.

---

## 4. The one thing you must not build — the design language

**Held for the owner. Building now means rebuilding.** The test: *if the owner changed their mind
about how it should look, would the work be thrown away?*

**E8** `PencilGuide` + guidance data · **U5** motion signalling state change only · **U7** density
toggle · **U9** three themes (`prism`, `bloom`, `slate`) · **U10** four audience profiles · **U11**
time-of-day phases · **U12** motion system · **U13** animated headers · **A-U1** pencil-pointer
surface. Register F105–F113.

Note the collision: A's `U1`/`U3` overlap B's deferred `E8` on `src/lib/guidance/`. **Share one
module rather than writing a parallel one — one owner, one module.**

The designer branch (`design/language-v1`) and its spec file are where these are settled.
Do not start them here.

---

## 5. Gates — after every queue item, no exceptions

`npx tsc --noEmit` · `npx vitest run` · `npx vite build` · `node scripts/check-tokens.mjs` ·
`node scripts/check-shrink.mjs` · `node scripts/check-ui-contract.mjs` ·
`node scripts/check-function-deploy-list.mjs` · `npm run check-tutorials` · the anti-theatre gates
(`check-dead-code.mjs`, `check-config-effect.mjs`, `check-wiring.mjs`, `check-two-sources.mjs`,
`check-rpc-parity.mjs`, `check-feature-register.mjs`) · `bash scripts/local-sql-harness.sh` (or the
docker variant) · `npx playwright test`.

**A gate that fails stops that queue item — not the build.** Fix it, or if you cannot, record the exact
command and output in `docs/SCALE-DECISIONS.md`, mark the item blocked in the ledger, and **move to the
next queue item.** Never idle on a red gate. Never skip a gate silently.

The locked baseline is in `docs/BUILDER-BASELINE.md`. Report exact counts against it.

---

## 6. Commit protocol

- **One conventional commit per queue item.** Not one per file, not one per session.
- **Push after every commit.** Do not accumulate unpushed work.
- The commit message carries the report: what changed, the gate results, any decision taken.
- **Update the ledger in the same commit as the work.** If you wire something, its register row moves
  in that commit or `check-feature-register.mjs` fails.
- **Do not open a PR** unless the token has `pull_requests:write`.

---

## 7. Owner actions — the complete closed list

Nothing outside this list justifies stopping.

- Make the repository private (the patent-disclosure clock is running; the repo is public).
- Add a proprietary licence.
- Engage patent counsel if a filing is wanted.
- Run a trademark search on the final name.
- Supply connector credentials via the wizard.
- Deploy the Edge Functions.
- **Settle the design language in §4.**

If you believe you are blocked and the blocker is not on this list, **you are not blocked** — pick the
law-abiding option, record the decision, and continue.

---

## 8. The two engines — never treat them as "a feature"

Both were found **built, tested, and attached to nothing.** Any session that treats them as ordinary
modules repeats the original defect. Before you add anything to either, **grep for a production call
site.**

**Writing Engine — `src/lib/writing/`.** An audit report is a **directed graph**: each node a *claim*
(typed references, bound figure, phrase id + version, rule id + version); each edge evidence,
dependency, or structure. **Two hashes — the graph root over the facts, the render hash over the
words.** The defining property: **the root is identical across every formality, tone, voice and
locale.** Proved by exhaustion: 100 cells × 12 models = 1,200 compositions, 0 missing phrases.

**Audit Engine — the auto-configuring audit.** SIRA pre-fill with per-suggestion decision rows;
`siraEngine.ts` mirroring SQL `sira_compute` with a parity test; `analyticsEngine.ts` with 14
deterministic checks; `createDeterministicPrng` (seeded Mulberry32, no unseeded randomness in any
sampling) and `verifyPopulationGate`; `automationRules.ts` + `0056` with a loop guard and a
>20 events/rule/hour auto-pause; monitor rules — six kinds, pure, window and time as arguments.

**The defect that matters most:** `grep -rn "report_graphs" src/` → **empty.** The engine computed the
roots, the tests verified them, and nothing persisted them. **Verify the call site. Always.**
