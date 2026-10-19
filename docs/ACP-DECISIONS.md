# ACP decisions

Numbered, one entry per decision. Each entry records: task, point, options, choice, reason, and how
to reverse it. Classes are FIXED (implemented as written), NEVER IMPROVISE (not decided here), and
IMPROVISE-THEN-DOCUMENT (this file).

## D-S0-xlsx — vendor the xlsx tarball (S0.1)

- Task: S0.1.
- Point: F22 requires replacing the vendor CDN dependency `xlsx` with a vendored tarball.
- Options: (a) leave the CDN URL; (b) vendor the tarball at `vendor/xlsx-0.20.3.tgz` as
  `file:vendor/xlsx-0.20.3.tgz`.
- Choice: (b). Downloaded the tarball, verified its sha512 against the integrity pinned in
  `package-lock.json` (`sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==`)
  — exact match — then repointed `package.json` and reinstalled. `npm install` reports 0
  vulnerabilities and the lock records the same integrity.
- Reason: no CDN at build time; the hash is verifiable and unchanged, so the library is identical.
- Reverse: restore the CDN URL in `package.json`, delete `vendor/`, `npm install`.

## D-S0-scandirs — where new directories sit relative to the gates (S0.2)

- Task: S0.2.
- Point: `supabase/functions/` (Deno) and `tools/` (Node) must not enter the Vite bundle or root
  `tsc`, and must not trip check-tokens/check-shrink.
- Choice: root `tsconfig.json` excludes `supabase`, `tools`, `e2e` (it already excluded `docs`).
  `vitest.config.ts` excludes `tools/**`; it already excludes `e2e`. `check-tokens.mjs` scans only
  `src/components`; `check-shrink.mjs` reads only files listed in `docs/baseline-lines.json` — so
  neither new directory is scanned unless explicitly added. Vite only bundles what `index.html`
  reaches, so neither directory can enter the bundle.
- Reason: smallest change that keeps the two new trees out of every gate. Edge Functions and the
  migration runner are deployed and run outside the SPA.
- Reverse: remove the excludes from `tsconfig.json`/`vitest.config.ts`.

## D-S0-json — the no-JSON-editing guard and the three existing JSON.stringify call sites (S0.3)

- Task: S0.3.
- Point: F1's guard test fails if any non-test file under `src/components` parses user-typed text as
  JSON or renders serialised JSON into an editable field.
- Finding: three call sites existed. Two rendered a JSON blob as text
  (`AnalystEnginePanel.tsx` check params, `ReportEditorPanel.tsx` block content) — a JSON view in
  disguise, and one that a later editor screen could have made editable. The third
  (`CapRadialTracker.tsx`) used `JSON.stringify` as a memoisation key, not as display.
- Choice: banned both `JSON.parse(` and `JSON.stringify(` in components, with an empty allow-list.
  Replaced the two display sites with `formatFieldPairs` (renders `key: value` pairs, never JSON);
  replaced the memoisation key with `stableKey` (a deterministic, order-independent key). Both live
  in the new pure module `src/lib/readable.ts` with unit tests.
- Reason: the guard is strongest with no exceptions, and the replacements make the screens more
  readable rather than less. No test was weakened.
- Reverse: allow-list the two files in the guard and restore the `JSON.stringify` calls.

