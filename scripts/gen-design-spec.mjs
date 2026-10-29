/**
 * Generate docs/DESIGN-SPEC.md — the designer's auto-updating catalogue of every screen, every flow
 * and every design token that exists today.
 *
 *   npm run gen:design        # writes docs/DESIGN-SPEC.md
 *   node scripts/gen-design-spec.mjs <path>   # writes elsewhere (the guard uses a temp file)
 *
 * Sources (all in-repo, no network, no imports beyond node stdlib):
 *   docs/UI-INVENTORY.md       the generated per-screen catalogue (id, purpose, route, rights,
 *                              testids, states, tutorial keys) — this script reads it, not the
 *                              contract, so the two derived views cannot disagree
 *   docs/ACP-UI-CONTRACT.md    the authored route/states, for the connection candidates
 *   src/lib/tutorialKeys.json  every flow: key, audience, screen, title, ordered steps
 *   public/tutorials/          which flows have recorded media, and the media filename
 *   src/styles/tokens.css      every design token per preset and theme
 *
 * The document is DERIVED. Nothing here is hand-authored. The `designSpec` guard regenerates into a
 * temp file and requires it to equal the committed file byte-for-byte, so this document cannot go
 * stale while its sources move.
 *
 * The one thing this file must never do is invent a design decision. Where the design language is
 * unsettled it says so, and lists the decisions the owner still holds. A designer reads this to know
 * what exists; the "Open design decisions" section is what they must not draw yet.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---- screens, from the generated inventory ---------------------------------
const inventory = read('docs/UI-INVENTORY.md');

/** Parse the inventory's `### \`ID\` — title` sections into structured entries. */
function parseInventoryScreens() {
  const screens = [];
  for (const block of inventory.split(/\n### /).slice(1)) {
    const header = block.split('\n')[0].trim();
    const ids = header.match(/[A-Z]{2,3}-\d{2}/g) ?? [];
    if (ids.length === 0) continue;
    const title = header.includes('—') ? header.split('—').slice(1).join('—').trim() : header;
    const field = (name) => {
      const m = block.match(new RegExp('^- \\*\\*' + name + '[^*]*:\\*\\*\\s*(.*)$', 'm'));
      return m ? m[1].trim() : '';
    };
    const testids = [...(field('Testids').matchAll(/`([^`]+)`/g) ?? [])].map((m) => m[1]);
    const tutorial = [...(field('Tutorial key').matchAll(/`([^`]+)`/g) ?? [])].map((m) => m[1]);
    screens.push({
      ids,
      title,
      purpose: field('Purpose'),
      route: field('Route / location'),
      rights: field('Rights required'),
      testids,
      states: field('States'),
      tutorial,
    });
  }
  return screens;
}
const screens = parseInventoryScreens();

// ---- flows, from the tutorial keys -----------------------------------------
const tutorialKeys = JSON.parse(read('src/lib/tutorialKeys.json'));
const mediaDir = path.join(ROOT, 'public/tutorials');
const mediaFiles = new Set(fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : []);
const mediaFor = (key) => {
  const hit = [...mediaFiles].find((f) => f === `${key}.gif` || f === `${key}.webm` || f === `${key}.mp4`);
  return hit ? `public/tutorials/${hit}` : '';
};
const flows = [...tutorialKeys]
  .map((k) => ({
    key: k.key,
    audience: k.audience,
    screenId: k.screenId,
    title: k.title,
    steps: Array.isArray(k.steps) ? k.steps : [],
    media: mediaFor(k.key),
  }))
  .sort((a, b) => a.key.localeCompare(b.key));

// ---- design tokens, from tokens.css ----------------------------------------
/** Split tokens.css into `selector { … }` blocks and count `--name: value;` per block. */
function parseTokens() {
  const css = read('src/styles/tokens.css');
  const blocks = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const body = m[2];
    const tokens = {};
    for (const t of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens[t[1]] = t[2].trim();
    if (Object.keys(tokens).length) blocks.push({ selector, tokens });
  }
  return blocks;
}
const tokenBlocks = parseTokens();
const uniqueTokens = [...new Set(tokenBlocks.flatMap((b) => Object.keys(b.tokens)))].sort();

/** A human label for a tokens.css selector: preset + theme. */
function labelFor(selector) {
  const preset = /\[data-preset="([a-z]+)"\]/.exec(selector)?.[1] ?? (selector.includes(':root') ? 'ledger' : 'shared');
  const theme = /\.dark\b/.test(selector) ? 'dark' : 'light';
  return { preset, theme };
}

// ---- typography, from index.css --------------------------------------------
const indexCss = read('src/index.css');
const fontImports = [...indexCss.matchAll(/@import\s+"@fontsource\/([a-z0-9-]+)\/([a-z0-9-]+)\.css"/g)];
const fontFamilies = [...new Set(fontImports.map((m) => m[1]))].sort();
const bodyFont = /body\s*\{[^}]*font-family:\s*([^;]+);/s.exec(indexCss)?.[1]?.trim() ?? '';
const monoFont = /--font-mono:\s*([^;]+);/.exec(indexCss)?.[1]?.trim() ?? '';

// ---- contract routes, for the connection candidates ------------------------
const contract = read('docs/ACP-UI-CONTRACT.md');
const contractRoutes = new Map();
for (const block of contract.split(/\n## /).slice(1)) {
  const ids = (block.split('\n')[0].match(/[A-Z]{2,3}-\d{2}/g) ?? []);
  const route = /\*\*Route[^*]*:\*\*\s*([^\n]+)/.exec(block)?.[1]?.trim() ?? '';
  for (const id of ids) if (route) contractRoutes.set(id, route);
}

// ---- the design language the owner has NOT settled -------------------------
// These are the DEFERRED rows. They are facts of the ledger, not design opinion: the list is fixed
// here because it is the boundary of this branch, and the designer must see it. If the owner settles
// a row, it moves out of this table in the same commit that builds it.
const DEFERRED = [
  ['E8', 'PencilGuide — pencil-style guided pointers and guidance data', '`src/lib/guidance/` (shared with A\'s U1/U3 — one module, not two)'],
  ['U5', 'Motion that signals a state change only', 'universal `prefers-reduced-motion`'],
  ['U7', 'Density toggle, remembered per user', 'comfortable / compact'],
  ['U9', 'Three themes `prism`, `bloom`, `slate`', 'new preset blocks in `src/styles/tokens.css`'],
  ['U10', 'Four audience profiles', 'which surfaces each profile sees'],
  ['U11', 'Time-of-day phases', 'lighting / tone by hour'],
  ['U12', 'Motion system', 'durations, easing, reduced-motion fallbacks'],
  ['U13', 'Animated headers', 'the header bar transition'],
  ['A-U1', 'Pencil-pointer surface', 'same surface as E8'],
];

// ---- emit ------------------------------------------------------------------
const out = [];
const w = (l = '') => out.push(l);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

w('# Design spec — screens, flows and design tokens');
w();
w('> **Auto-generated — do not edit by hand.** Run `npm run gen:design` to regenerate. The');
w('> `designSpec` guard fails if this file drifts from its sources.');
w();
w('Derived from `docs/UI-INVENTORY.md` (the per-screen catalogue), `docs/ACP-UI-CONTRACT.md`');
w('(authored routes), `src/lib/tutorialKeys.json` (every flow), `public/tutorials/` (recorded media)');
w('and `src/styles/tokens.css` (the design tokens). It is the designer\'s catalogue: what exists');
w('today, what each screen and flow is, and the design-language decisions the owner has **not** yet');
w('settled. Nothing here is invented — where a value is a placeholder or a decision is open, it says');
w('so.');
w();

// Summary
const withMedia = flows.filter((f) => f.media).length;
const presets = [...new Set(tokenBlocks.map((b) => labelFor(b.selector).preset))].filter((p) => p !== 'shared').sort();
w('## Summary');
w();
w(`- **Screens:** ${screens.length} (each with purpose, route, rights, testids and states).`);
w(`- **Flows (tutorial keys):** ${flows.length}; ${withMedia} have recorded media in \`public/tutorials/\`, ${flows.length - withMedia} have none.`);
w(`- **Design presets:** ${presets.map((p) => '`' + p + '`').join(', ')}; **themes:** light, dark — ${presets.length * 2} combinations.`);
w(`- **Design tokens:** ${uniqueTokens.length} unique variables across ${tokenBlocks.length} preset/theme blocks in \`src/styles/tokens.css\`.`);
w(`- **Open design decisions:** ${DEFERRED.length} (the design language below). Do not draw these yet.`);
w();

// Open design decisions
w('## Open design decisions — the design language the owner holds');
w();
w('These rows are **DEFERRED by instruction**. Building on an unsettled design means rebuilding it,');
w('so they are listed here as the boundary, not as work. Everything else on this branch is fair game.');
w();
w('| Row | What it is | Where it would land |');
w('|---|---|---|');
for (const [id, what, where] of DEFERRED) w(`| ${id} | ${what} | ${where} |`);
w();

// Screens
w('## Screens');
w();
w('Every screen the product carries, with the facts a redesign must preserve. The testids are the');
w('stable contract — a Playwright spec and the tutorial recorder bind only to them, so a redesign');
w('keeps every testid.');
w();
for (const s of screens) {
  const idList = s.ids.map((i) => '`' + i + '`').join(', ');
  w(`### ${idList} — ${s.title}`);
  w();
  w(`- **Purpose:** ${s.purpose || 'see docs/ACP-UI-CONTRACT.md'}`);
  w(`- **Route / location:** ${s.route || 'see contract'}`);
  w(`- **Rights required:** ${s.rights || 'any signed-in member'}`);
  w(`- **Testids (${s.testids.length}):** ${s.testids.length ? s.testids.map((t) => '`' + t + '`').join(', ') : '—'}`);
  w(`- **States:** ${s.states || 'loading / empty / error / ready / denied'}`);
  const keys = s.tutorial.length ? s.tutorial : flows.filter((f) => s.ids.includes(f.screenId)).map((f) => f.key);
  w(`- **Flows that touch this screen:** ${keys.length ? keys.map((k) => '`' + k + '`').join(', ') : '— (no flow)'}`);
  const routes = [...new Set(s.ids.map((i) => contractRoutes.get(i)).filter(Boolean))];
  w(`- **Connection candidates (same route):** ${routes.length > 1 ? routes.map((r) => '`' + r + '`').join(' · ') : '— (route is unique to this screen)'}`);
  w();
}

// Flows
w('## Flows');
w();
w('A flow is a recorded tutorial: an ordered walk over one screen\'s testids. It is the closest thing');
w('to a "user journey" the product carries, and it is the designer\'s best description of how a screen');
w('is actually used. Each step names a testid or is a free instruction (a step with no testid is an');
w('instruction the recorder performs without clicking).');
w();
for (const f of flows) {
  w(`### \`${f.key}\` — ${f.title} (${f.screenId})`);
  w();
  w(`- **Audience:** ${f.audience}`);
  w(`- **Media:** ${f.media ? '`' + f.media + '`' : '— (no recorded media yet)'}`);
  w(`- **Steps (${f.steps.length}):**`);
  f.steps.forEach((s, i) => {
    const t = s.testid ? '`' + s.testid + '`' : '_no testid_';
    w(`  ${i + 1}. ${s.text} — ${t}`);
  });
  w();
}

// Tokens
w('## Design tokens');
w();
w('Every token currently defined, per preset and theme, straight from `src/styles/tokens.css`. A');
w('redesign replaces the *values*; the *names* are the interface the components already read, so a');
w('token name stays and only its value changes.');
w();
w(`**${uniqueTokens.length} unique tokens.** Not every token is defined in every block; each table`);
w('below is one block exactly as the stylesheet writes it.');
w();
for (const b of tokenBlocks) {
  const { preset, theme } = labelFor(b.selector);
  const names = Object.keys(b.tokens).sort();
  w(`### Preset \`${preset}\` — ${theme} (${names.length} tokens)`);
  w();
  w('| Token | Value |');
  w('|---|---|');
  for (const n of names) w(`| \`${n}\` | \`${b.tokens[n]}\` |`);
  w();
}

// Typography
w('## Typography');
w();
w('The fonts are **self-hosted** (bundled via `@fontsource`), so the app makes no request to any');
w('external font host — it works offline and inside the tenant boundary. A redesign keeps the');
w('self-hosted constraint: a new typeface ships as a bundle, never a remote link.');
w();
w(`- **Body family:** \`${bodyFont || 'Inter'}\``);
w(`- **Mono family (hashes, ref codes, figures):** \`${monoFont || 'JetBrains Mono'}\``);
w(`- **Bundled families (${fontFamilies.length}):** ${fontFamilies.map((f) => '`' + f + '`').join(', ')}`);
w(`- **Bundled faces (${fontImports.length}):** ${fontImports.map((m) => '`' + m[1] + ' ' + m[2].replace(/latin-/, '') + '`').join(', ')}`);
w();

// Coverage cross-check
w('## Coverage cross-check');
w();
w(`- Screens documented: ${screens.length}.`);
w(`- Flows documented: ${flows.length}; with media: ${withMedia}.`);
w(`- Flows whose screen has no inventory entry: ${flows.filter((f) => !screens.some((s) => s.ids.includes(f.screenId))).length}.`);
w(`- Screens with no flow: ${screens.filter((s) => !flows.some((f) => s.ids.includes(f.screenId))).length}.`);
w(`- Design tokens: ${uniqueTokens.length} unique, ${tokenBlocks.length} preset/theme blocks.`);
w();
w('Regenerate with `npm run gen:design`. The `designSpec` guard holds this file to its sources.');
w();

const outPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'docs/DESIGN-SPEC.md');
fs.writeFileSync(outPath, out.join('\n') + '\n');
console.log(`wrote ${path.relative(ROOT, outPath)}: ${out.length} lines, ${screens.length} screens, ${flows.length} flows, ${uniqueTokens.length} tokens`);
