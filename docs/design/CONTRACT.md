# Design contract — the frozen interface between the design branch and every build branch

Owner instruction 2026-10-30: *"specify the design branch, and what it includes. That should be
perfect for concurrent build as well. Don't give them shared documents."*

This file is the **only shared artefact** between the design branch and the build branches. It is
written **once** by the design branch, then **frozen**. Build branches **read it and never edit it.**
If a build branch needs a change here, it records a request in its own `docs/build/streams/<stream>.md`
and continues on the frozen contract — it does not edit this file, because two branches editing one file
is exactly the merge conflict the concurrent build must avoid.

Status: **DRAFT — to be frozen by the design branch at the end of its first pass.**
Freeze hash: _(filled by the design branch)_

---

## 1. What the design branch is

- **Branch:** `feature/systeligon-design-spec`, cut from the build trunk
  `feature/systeligon-builder-continuous`.
- **Owner:** the design agent, and only the design agent. No build branch commits here.
- **Why separate:** the design rows (E8, U5, U7, U9–U13, A-U1; register `F105`–`F113`) were DEFERRED
  because the owner had not settled the design language. Building a visual row against an unsettled
  contract means building it twice. The design branch settles the language once; the build branches then
  consume a frozen contract.
- **It ships a product, not a document.** The design branch produces the **design system in code**
  (`src/styles/tokens.css`, `src/lib/theme/*`, the motion module, the preset registry) plus this
  contract. A build branch consumes the code, not a prose description of it.

## 2. What it includes (the deliverable)

1. **The preset registry — all six presets, each fully specified.** Today `tokens.css` defines three
   (Ledger [default], Porcelain, Bone) and each has light + dark. The contract adds the three named in
   the spec §12.2 (`F105`): **Prism, Bloom, Slate**. Every preset × {light, dark} block defines
   **every** variable — no inherited defaults — and every pair passes the contrast floor (§4 below).
2. **The colour law, restated and enforced.** Verdigris = calm/pass/sealed; cinnabar = exception/flag/
   overdue; brass = money and financial figures **only**. Nothing else is chromatic — **no blue, no
   orange**. `src/guards/` must gain a check that no component introduces a chromatic value outside the
   token set.
3. **Audience profiles** (`F106`, spec §12.1): **Focus, Expressive, Aesthetic, Assurance.** A profile is
   a named bundle of density + motion + typography + header behaviour. It is a **pure function** of the
   profile id; a screen reads the resolved profile, never a global.
4. **Density** (`F111`, spec §11.1c): a **Comfortable / Compact** toggle. Density is a set of spacing
   tokens, not per-component overrides; every list, table and form reads the density tokens.
5. **Time-of-day phases** (`F107`, spec §12.3): `resolveDayPhase(instant)` — a **pure function of the
   time argument**, never a clock read (LAW: time is always an argument). Phases shift only the
   *presentation* (warmth/contrast), never the semantic colours.
6. **Motion system** (`F108`, spec §12.4): named levels (`none / subtle / standard / expressive`) as
   tokens, named animations, and an **honour-reduced-motion** rule — `prefers-reduced-motion` forces the
   `none` level everywhere. Today two keyframes exist and one component honours reduced-motion; the
   contract makes it universal.
7. **Animated headers** (`F109`, spec §12.5): the header motion, tied to the motion level, off at
   `none` and under reduced-motion.
8. **The personalisation gates** (`F113`, spec §12.7): which combinations are legal (e.g. an Assurance
   audience profile forbids the Expressive motion level; a Compact density pairs with a defined type
   scale). A **pure validator** `validatePersonalisation(profile, density, phase, motion)` returns the
   legal set and the reason a combination is refused. The UI offers only legal combinations.
9. **Contrast coverage** (`F112`): the contrast test must cover **all six presets at every phase and
   both themes** — 6 presets × 2 themes × phases. Today it covers three.

## 3. The interface the build branches consume

The design branch commits **code with a stable surface**. A build branch may rely on exactly this and
nothing else:

| Symbol | Module | Contract |
|---|---|---|
| `PRESETS` | `src/lib/theme/presets.ts` | the six preset ids |
| `AUDIENCE_PROFILES` | `src/lib/theme/audience.ts` | the four profile ids |
| `DENSITIES` | `src/lib/theme/density.ts` | `['comfortable', 'compact']` |
| `MOTION_LEVELS` | `src/lib/theme/motion.ts` | `['none', 'subtle', 'standard', 'expressive']` |
| `resolveDayPhase(instant)` | `src/lib/theme/phase.ts` | pure; returns the phase for an ISO instant |
| `validatePersonalisation(...)` | `src/lib/theme/personalisation.ts` | pure; returns `{ legal, refused: [{combination, reason}] }` |
| `usePersonalisation()` | `src/context/PersonalisationContext.tsx` | the resolved profile/density/phase/motion for the session |
| `data-testid` conventions | this file §5 | every new control carries `<screenId>-<element>` |

**A build branch never re-derives a token.** If it needs a colour, a spacing value, a motion duration or
a phase, it reads the token or the module. Hard-coded visual values in a build branch are a contract
violation.

## 4. The non-negotiables the contract must satisfy

- **Determinism.** Every function here is pure. `resolveDayPhase` takes the instant as an argument; no
  module reads a clock, `Date.now()` or `Math.random()`.
- **Contrast floor.** Body text ≥ 4.5:1, large text and non-text UI ≥ 3:1, against its own surface, in
  **every** preset × theme × phase. The contrast test asserts all of them.
- **Reduced motion.** With `prefers-reduced-motion: reduce`, the resolved motion level is `none` and no
  animation runs. A test asserts it for every animated surface.
- **No colour outside the law.** No blue, no orange; brass only for money. A guard enforces it.
- **No design regression in the build.** A build branch may not change a token or a preset; it consumes
  them.

## 5. `data-testid` convention (so the two branches' tests never collide)

`<screenId>-<element>` — e.g. `orgcontrol-density-toggle`, `superadmin-standards-rollout-button`.
The design branch owns `data-testid`s beginning `theme-`, `personalisation-`, `motion-`; every other
prefix belongs to whichever build stream owns that screen (see `docs/build/OWNERSHIP.md`).

## 6. Freeze and change control

1. The design branch completes §2, runs the contrast/reduced-motion/no-colour guards, and **freezes**
   the contract: it records the commit hash of the frozen `src/lib/theme/*` + `tokens.css` at the top of
   this file.
2. Build branches then consume it. A build branch that needs a change **requests it in its own stream
   doc**; the design agent makes the change on the design branch and bumps the freeze hash. Build
   branches rebase onto the new freeze — they never edit the design files themselves.
3. Until the freeze hash is present, the design rows stay `DEFERRED` and the build branches must not
   start a design-row task. Everything else in the build does not depend on the design branch and may
   proceed in parallel immediately.
