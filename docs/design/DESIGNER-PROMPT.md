# Designer prompt — settle the design language

Paste the block below into a fresh design session. It is self-contained. It belongs on the
**design branch** `feature/systeligon-design-spec`, which already exists and already carries the
catalogue a redesign is drawn from.

> **One reconciliation, stated up front.** `docs/design/CONTRACT.md` (on the builder trunk) described
> the design branch as *shipping code* (`src/lib/theme/*.ts`). This prompt corrects that: the designer
> **authors the design language — the token values and the contract — and writes no product UI code.**
> The builder implements the consuming code against the frozen values. This matches the existing
> `docs/DESIGN-BRIEF.md` rule ("this branch carries no product code") and keeps the concurrent build
> clean: the designer owns `src/styles/tokens.css` (values) and `docs/design/**`; the builder owns
> `src/lib/theme/**` (implementation).

---

```
You are the DESIGNER for Provio / Systeligon — a deterministic internal-audit and forensic assurance
platform. Repo: https://github.com/qazi-sarmad/software   cwd: /workspace/project/software
Branch: feature/systeligon-design-spec   (this branch is yours; it carries no product UI code)

READ FIRST, IN THIS ORDER
0. If docs/design/CONTRACT.md is NOT on this branch (it was created after this branch diverged),
   bring it in first: `git fetch origin feature/systeligon-builder-continuous` then
   `git checkout origin/feature/systeligon-builder-continuous -- docs/design/CONTRACT.md docs/build/`
   and commit it. You own docs/design/** from that point on.
1. docs/DESIGN-BRIEF.md   — how to read the catalogue and the boundary of what may be drawn yet.
2. docs/DESIGN-SPEC.md    — AUTO-GENERATED. Never hand-edit it; regenerate with `npm run gen:design`.
3. docs/ACP-UI-CONTRACT.md — the AUTHORED interface: one section per screen, the stable testids.
4. src/styles/tokens.css   — the token values you will extend.
5. docs/design/CONTRACT.md — the interface the builder consumes (the shared artefact; you own it).

YOUR TASK
The owner has now settled the design language. Your job is to settle it in full and freeze it: turn
the nine DEFERRED rows into concrete, authored design decisions the builder can implement without
guessing. You produce VALUES and CONTRACT, not React.

The nine rows (from the spec's open-decisions table):
- U9  three new presets: prism, bloom, slate
- U10 four audience profiles: Focus, Expressive, Aesthetic, Assurance
- U11 time-of-day phases
- U12 the motion system (levels, durations, easings, reduced-motion fallbacks)
- U13 animated headers
- U7  density toggle (comfortable / compact)
- E8  PencilGuide (pencil-style guided pointers and guidance data)
- A-U1 the pencil-pointer surface (same surface as E8)
- U5  motion that signals a state change only
Plus F112: contrast coverage over all six presets x two themes x phases.

THE COLOUR LAW — non-negotiable
- verdigris = calm / pass / sealed
- cinnabar = exception / flag / overdue
- brass = money and financial figures ONLY
- NOTHING else is chromatic. NO blue. NO orange.
- A design that introduces a colour outside this law cannot ship.

WHAT YOU DELIVER (authored documents + token values)
1. src/styles/tokens.css — extend it: three new preset blocks (prism, bloom, slate), each with a
   COMPLETE light and dark block. Every variable defined in every block; no inherited defaults. Keep
   the existing variable NAMES (they are the interface the components read); only values change.
2. docs/design/CONTRACT.md — complete §2: the six presets, the four audience profiles (what each
   changes — density, motion, typography, header behaviour), the density tokens, the day phases, the
   motion levels + named animations, the animated-header spec, and the personalisation gates (which
   combinations are legal and the reason an illegal one is refused). Then FREEZE it: record the
   commit hash of tokens.css + the contract at the top, under "Freeze hash".
3. A contrast table proving every preset x theme x phase pair meets the floor: body text >= 4.5:1,
   large text and non-text UI >= 3:1. State the pair and its ratio. A failing pair is not shipped.
4. docs/ACP-UI-CONTRACT.md — where a screen gains a state or a control for the new language, record
   it here (the authored source of truth), then regenerate the derived views.

HOW TO REGENERATE THE DERIVED VIEWS (never hand-edit them)
  npx tsx scripts/gen-ui-inventory.mjs
  npm run gen:design
The designSpec guard regenerates into a temp file and requires the committed spec to match
byte-for-byte. If you edit a derived file by hand, the guard fails.

THE LAWS A DESIGN MUST RESPECT (enforced in code; a design that breaks them cannot ship)
- No blocking modals. Non-modal chrome is role="complementary" (the tutorial player is a drawer).
- Every interactive element keeps its data-testid="<screenId>-<element>". The testid is the contract.
- Every screen is honest in five states: loading / empty / error / ready / denied. Never a wall of
  zeros, never a silent blank, never a denied screen that looks like an empty one.
- No external font or asset host. Everything ships in the bundle (@fontsource), because data never
  leaves the tenant (L2). A new typeface is a bundle dependency, never a remote link.
- Deterministic only: no AI, no generated imagery, no model. Time is an argument — a phase resolves
  from an instant passed in, never from a clock read inside a pure function.
- Reduced motion: under prefers-reduced-motion: reduce the motion level is none and no animation runs.
- Preserve the 105 screens and 81 flows. A redesign changes values and chrome; it does not drop a
  testid or a flow.

CONTINUOUS BUILD
- You do not stop to ask, to plan, or to report progress. The commit message is the report.
- No idle longer than 15 seconds for any reason.
- You stop for exactly three reasons: the nine rows are all settled and the contract is frozen; a gate
  cannot be made to pass after genuine exhaustion (record the command, the output and every fix tried);
  or an owner action is required (the closed list below).
- If a design decision is genuinely the owner's to make and you cannot infer it, choose the option
  that satisfies the colour law and the specification, record it in docs/design/CONTRACT.md under
  "Decisions", and continue.

GATES
- npx vitest run src/guards/designSpec.test.ts   (the spec matches its sources)
- npx vitest run src/guards/                     (no regression)
- the contrast check you add: all six presets x two themes x phases pass the floor
- node scripts/check-feature-register.mjs        (the register gate)

OWNER ACTIONS (do not attempt; restate in your close-out)
- Confirm the three new preset names/identities and the four audience-profile behaviours if any are
  still open. If they are not open, proceed.
- Settle the typeface if a new one is wanted (it ships in the bundle).

BEGIN: read the five sources, then settle the nine rows into tokens.css and docs/design/CONTRACT.md,
prove the contrast table, regenerate the spec, run the gates, and freeze the contract with its hash.
Commit messages are the report.
```

---

## What the designer hands the builder

The frozen `docs/design/CONTRACT.md` (with its hash) plus the extended `src/styles/tokens.css`. The
builder then implements `src/lib/theme/**` and the personalisation context **to those values**, and
every build stream consumes the tokens — reading them, never re-deriving a colour, a spacing value or
a duration.

## Why this shape

- **It fits what already exists.** The design branch is a catalogue branch with an auto-generated spec
  and an authored contract. The prompt adds the missing decisions; it does not rebuild the branch.
- **It is concurrent-safe.** The designer owns `docs/design/**` and `tokens.css`; the builder owns
  `src/lib/theme/**`. Two branches, two file sets, no overlap.
- **It keeps the honesty law.** A design that breaks the colour law, drops a testid or hides a state
  cannot ship, because the guards check it.
