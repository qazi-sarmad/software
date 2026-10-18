# Overnight build D1-D23 decisions

Decisions taken where the prompt was unclear, silent, or where the repository disagreed with the
prompt. Each entry names the task, the unclear point, the options, the choice, the reason and how to
reverse it.

## D-D1-xlsx — SheetJS distribution channel

Task D1. Unclear point: the prompt says to install `@sheetjs/xlsx@latest`, but that package does not
exist on the public npm registry (`npm view @sheetjs/xlsx` returns 404). SheetJS stopped publishing
to npm after 0.18.5; the current release is distributed from the vendor's own CDN.
Options: (1) drop XLSX import; (2) keep the vulnerable npm `xlsx@0.18.5`; (3) install the current
SheetJS release from `https://cdn.sheetjs.com`.
Choice: option 3. `xlsx@0.20.3` is installed from the vendor CDN tarball.
Reason: spec §19 requires XLSX import for five sources, so dropping it (option 1) would remove a
specified feature. Option 2 leaves two high advisories open, which is the thing D1 exists to fix.
The CDN tarball is SheetJS's documented distribution and resolves both advisories.
How to reverse: `npm remove xlsx && npm install xlsx@0.18.5`, then restore the advisory note in
`docs/NOT-DONE.md` item 12.

## D-D5-clock — the demo clock is injected, not deleted

Task D5. Unclear point: the prompt gives `getDemoNow` a shape that reads `window.__DEMO_NOW__` only
when `import.meta.env.MODE === 'test'`. Vitest and Playwright both run with `MODE === 'test'`, so the
hook is reachable in both. The prompt also lists `src/lib/orgDate.ts:13-16` for replacement, but that
file is the org-timezone date helper with its own tests that pin `DEMO_TODAY_ISO`.
Choice: `src/lib/demoTime.ts` owns `getDemoNow`/`getDemoTodayISO`. `orgDate.ts` keeps its exported
`DEMO_TODAY_ISO` constant but derives it from `getDemoTodayISO()` so there is one source of truth.
Reason: deleting the constant would break `orgDate.test.ts` and every screen that imports it; deriving
it keeps the public surface stable while removing the hard-coded literal.
How to reverse: restore the literal `'2026-09-30'` in `orgDate.ts` and delete `demoTime.ts`.

## D-PLATFORM-RIGHTS — platform portal is the only reader of user_role

Established in Phase 8 and unchanged. The platform portal is the sole place that may read `user_role`
from the JWT (for example `user_role = 'platform_admin'`). Every org-product RPC and all application
code use only `caller_has_right`/`hasRight`. Platform checks never leak into org RPCs.
