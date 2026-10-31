# Stream DESIGN — the design language (`design/language-v1`)

Cut from the trunk after the integrator's mount points (OWNERSHIP.md §4). Owns `docs/design/**`,
`src/styles/tokens.css` (token **values**) and the `theme-` / `personalisation-` / `motion-` testid
prefixes. **Writes no product UI code.** `src/lib/theme/**` (the implementation that reads the frozen
tokens) and `src/context/PersonalisationContext.tsx` are the **integrator's** — see OWNERSHIP.md §2.

## What this branch is, and why it is separate

The design rows (E8, U5, U7, U9–U13, A-U1; register `F105`–`F113`) were DEFERRED because the owner had
not settled the design language; building a visual row against an unsettled contract means building it
twice. This branch settles the language once and freezes it. It ships **values and a contract**, not
React: `src/styles/tokens.css` (the token values) and `docs/design/**`. A build stream then consumes
the frozen contract without reading any other stream's files.

## The rule that keeps it independent

**Two branches never write the same file.** The design branch's files are `docs/design/**` and
`src/styles/tokens.css`. It edits nothing else — in particular it does not touch `src/lib/theme/**`,
`src/context/PersonalisationContext.tsx`, `package.json`, `src/App.tsx` or any shared ledger. That is
why a design session can run at the same time as every build stream and never conflict.

## Scope
Fill `docs/design/CONTRACT.md` §2 and FREEZE it: the six presets (add Prism, Bloom, Slate), the four
audience profiles, the density toggle, the day phases, the motion system, the animated headers, the
personalisation gates, and contrast coverage for all six presets x two themes x phases.

## Rows
E8, U5, U7, U9-U13, A-U1; register F105, F106, F107, F108, F109, F111, F112, F113.

## Queue
1. Baseline + tree whole.
2. Preset registry: define Prism, Bloom, Slate fully (every variable in every light/dark block).
3. The theme **modules** (`src/lib/theme/{presets,audience,density,motion,phase,personalisation}.ts`)
   are the integrator's, not this branch's. This branch delivers the **token values** those modules
   read, and the contract that names them. If a value is missing, record the need in this file; the
   integrator implements the reader.
4. Motion tokens + reduced-motion universal; animated-header tokens.
5. Contrast coverage: state, in the contract, the pairs the contrast test must cover (six presets x
   two themes x phases); the test itself is the integrator's.
6. Freeze: record the commit hash of `tokens.css` at the top of CONTRACT.md.
7. Merge to the trunk (the integrator merges DESIGN first, before the build streams).

## Flows (happy + bad)
- Theme switch: happy — every preset renders every screen; bad — an unknown preset id falls back to
  Ledger with a reason, never a blank screen.
- Density toggle: happy — lists/tables/forms re-space; bad — a component that hard-codes spacing is
  caught by the guard.
- Reduced motion: happy — animations run at the chosen level; bad — under `prefers-reduced-motion:
  reduce` the level resolves to `none` and NO animation runs (asserted per animated surface).
- Personalisation gate: happy — a legal combination is offered; bad — an illegal one (Assurance +
  Expressive) is refused with a reason and never applied.
- Contrast: happy — every pair passes; bad — a preset with a failing pair fails the gate.

## Acceptance
- CONTRACT.md frozen with a hash; all six presets fully defined and contrast-clean.
- Every token value present in every preset x theme block (no inherited defaults).
- The no-colour law stated and enforced by a guard.
- A build stream can consume the contract without reading any other stream's files.

## Status
| Row | Was | Now | Call site | Test | Migration | Commit |
|---|---|---|---|---|---|---|
