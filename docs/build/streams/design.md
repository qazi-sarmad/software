# Stream DESIGN — the design language (`feature/systeligon-design-spec`)

Cut from the trunk after the integrator's mount points (OWNERSHIP.md §4). Owns `docs/design/**`,
`src/styles/tokens.css`, `src/lib/theme/**`, `src/context/PersonalisationContext.tsx`, and the
`theme-` / `personalisation-` / `motion-` testid prefixes. No other stream edits these.

## Scope
Fill `docs/design/CONTRACT.md` §2 and FREEZE it: the six presets (add Prism, Bloom, Slate), the four
audience profiles, the density toggle, the day phases, the motion system, the animated headers, the
personalisation gates, and contrast coverage for all six presets x two themes x phases.

## Rows
E8, U5, U7, U9-U13, A-U1; register F105, F106, F107, F108, F109, F111, F112, F113.

## Queue
1. Baseline + tree whole.
2. Preset registry: define Prism, Bloom, Slate fully (every variable in every light/dark block).
3. `src/lib/theme/{presets,audience,density,motion,phase,personalisation}.ts` — all pure, time an
   argument for `phase`.
4. `PersonalisationContext.tsx` — the resolved profile/density/phase/motion for the session.
5. Motion system + reduced-motion universal; animated headers.
6. Contrast test over all six presets x two themes x phases; the no-colour guard (no blue, no orange,
   brass only for money).
7. Freeze: record the commit hash of `src/lib/theme/*` + `tokens.css` at the top of CONTRACT.md.
8. Merge to the trunk (the integrator merges DESIGN first, before the build streams).

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
- Every theme function pure; no clock, no random.
- The reduced-motion rule universal; the no-colour guard passing.
- A build stream can consume the contract without reading any other stream's files.

## Status
| Row | Was | Now | Call site | Test | Migration | Commit |
|---|---|---|---|---|---|---|
