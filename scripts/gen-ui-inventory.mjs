/**
 * Generate docs/UI-INVENTORY.md — the single source of truth for the parallel UI redesign.
 *
 * Sources (all in-repo, no network):
 *   docs/ACP-UI-CONTRACT.md    per-screen purpose/route/rights/data/testids/states/tutorial key
 *   src/data/*.ts              every data function, RPC and table a screen may reach
 *   src/lib/tutorialKeys.json  every tutorial key
 *   src/**                     every data-testid that exists in the code (for the cross-check)
 *   src/lib/explain/*          the explain catalogue, the IIA standards and their surfaces (E10)
 *   src/lib/drilldownAggregates.ts  every aggregate and the family it drills to (E10)
 *
 * Run as `npx tsx scripts/gen-ui-inventory.mjs`. It is run through `tsx` because E10 makes the
 * inventory a *derived* view of the pure explain and drilldown modules as well as the contract — the
 * same data the app and the gates read, so the inventory cannot claim an explain id, a standard or a
 * drilldown the code does not carry. The document is derived: the contract stays the authored
 * interface; this file is the flat catalogue a designer can read without opening code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EXPLAIN_ENTRIES } from '../src/lib/explain/catalogue.ts';
import { IIA_STANDARDS } from '../src/lib/explain/iia.ts';
import { AGGREGATE_SURFACES } from '../src/lib/drilldownAggregates.ts';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---- contract sections ------------------------------------------------------
const contract = read('docs/ACP-UI-CONTRACT.md');
const rawSections = contract.split(/\n## /).slice(1);

const field = (name, block) => {
  const m = block.match(new RegExp('\\*\\*' + name + '[^*]*:\\*\\*\\s*([\\s\\S]*?)(?=\\n- \\*\\*|\\n##|\\Z)'));
  return m ? m[1].trim() : '';
};

const sections = [];
for (const block of rawSections) {
  const header = block.split('\n')[0].trim();
  const ids = header.match(/[A-Z]{2,3}-\d{2}/g) ?? [];
  if (ids.length === 0) continue;
  // Appendix A marks the purpose with `**Purpose:**`; Appendix B states it as the first paragraph.
  const firstPara = block
    .split('\n')
    .slice(1)
    .find((l) => l.trim() && !l.trim().startsWith('-') && !l.trim().startsWith('|') && !l.trim().startsWith('#'));
  sections.push({
    header,
    ids,
    purpose: (field('Purpose', block) || firstPara || '').replace(/\s+/g, ' ').trim(),
    route: field('Route', block).replace(/\s+/g, ' ').trim(),
    rights: field('Rights', block).replace(/\s+/g, ' ').trim(),
    data: field('Data', block),
    testids: field('Testids', block),
    states: field('States', block).replace(/\s+/g, ' ').trim(),
    tutorial: field('Tutorial key', block).replace(/[`.\s]+$/g, '').trim(),
  });
}

// ---- data modules -----------------------------------------------------------
const modules = {};
for (const f of fs.readdirSync(path.join(ROOT, 'src/data')).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
  const s = read('src/data/' + f);
  const uniq = (a) => [...new Set(a)].sort();
  modules[f] = {
    fns: [...s.matchAll(/export (?:async )?function ([a-zA-Z0-9_]+)/g)].map((m) => m[1]),
    consts: [...s.matchAll(/export const ([a-zA-Z0-9_]+)/g)].map((m) => m[1]),
    rpcs: uniq([...s.matchAll(/rpc\('([a-z_0-9]+)'/g)].map((m) => m[1])),
    tables: uniq([...s.matchAll(/from\('([a-z_0-9]+)'\)/g)].map((m) => m[1])),
    params: (() => {
      const out = {};
      for (const m of s.matchAll(/rpc\(\s*'([a-z_0-9]+)'\s*(?:,\s*\{([^}]*)\})?/g)) {
        out[m[1]] = [...(m[2] ?? '').matchAll(/([a-z_0-9]+)\s*:/g)].map((x) => x[1]);
      }
      return out;
    })(),
  };
}

// ---- tutorial keys ----------------------------------------------------------
const tutorialKeys = JSON.parse(read('src/lib/tutorialKeys.json'));

// ---- testids in the code ----------------------------------------------------
const codeTestids = new Set();
for (const f of walk(path.join(ROOT, 'src'))) {
  if (!/\.(ts|tsx)$/.test(f) || /\.test\./.test(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/data-testid=\{?[`"']([^`"']+)/g)) codeTestids.add(m[1]);
  for (const m of s.matchAll(/testId=\{?[`"']([^`"']+)/g)) codeTestids.add(m[1]);
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

// ---- areas ------------------------------------------------------------------
const AREAS = [
  ['Auth', ['AX-', 'GL-', 'TUT-']],
  ['Super Admin', ['SA-']],
  ['Org Admin', ['OA-']],
  ['Engagement lifecycle', ['WK-']],
  ['External auditor', ['EX-']],
  ['Core workspace', ['DB-', 'WQ-', 'AU-', 'AP-', 'SR-', 'AF-', 'IR-']],
  ['Common chrome', ['CH-']],
];
const areaFor = (ids) => (AREAS.find(([, prefs]) => prefs.some((p) => ids.some((i) => i.startsWith(p)))) ?? ['Other'])[0];

const byArea = new Map();
for (const s of sections) {
  const a = areaFor(s.ids);
  if (!byArea.has(a)) byArea.set(a, []);
  byArea.get(a).push(s);
}

const fnToModule = {};
for (const [mod, d] of Object.entries(modules)) for (const fn of [...d.fns, ...d.consts]) fnToModule[fn] ??= mod;

// ---- E10: explain ids, standards and drilldown targets per screen -----------
// The three maps below are derived from the SAME pure modules the app and the gates read, so the
// inventory cannot name an explain id, a standard or a drilldown the code does not carry.

/** Source files (relative to src/) and their text, for the wiring scan. */
const srcByRel = new Map();
for (const f of walk(path.join(ROOT, 'src'))) {
  if (!/\.(ts|tsx)$/.test(f) || /\.test\./.test(f)) continue;
  srcByRel.set(path.relative(ROOT, f), fs.readFileSync(f, 'utf8'));
}

const explainIds = new Set(EXPLAIN_ENTRIES.map((e) => e.id));
/** Every explain id a source file references, by literal id or by template-literal family prefix. */
function explainIdsIn(text) {
  const found = new Set();
  for (const m of text.matchAll(/['"`]([a-z]+\.[a-zA-Z0-9_.]+)['"`]/g)) if (explainIds.has(m[1])) found.add(m[1]);
  for (const m of text.matchAll(/`([a-z]+(?:\.[a-zA-Z0-9_]+)*\.)\$\{/g)) {
    for (const id of explainIds) if (id.startsWith(m[1])) found.add(id);
  }
  return found;
}

/** The source files that define any of a screen's contract testids (the screen's real call sites). */
function filesForTestids(tids) {
  const files = new Set();
  for (const [rel, text] of srcByRel) {
    if (tids.some((t) => !t.includes('<') && text.includes(t))) files.add(rel);
  }
  return files;
}

/** Explain ids the screen actually mounts, from the files that define its testids. */
function wiredExplainIds(tids) {
  const found = new Set();
  for (const rel of filesForTestids(tids)) for (const id of explainIdsIn(srcByRel.get(rel))) found.add(id);
  return [...found].sort();
}

/** Standards a screen addresses, from the catalogue's own `implementedBy` (the declared mapping). */
function standardsForScreen(screenId) {
  return IIA_STANDARDS.filter((s) => s.implementedBy.includes(screenId)).map((s) => s.id);
}

/** The aggregates a screen renders that drill to a family (E5/U1, G8). */
function drillTargetsForScreen(screenId) {
  return AGGREGATE_SURFACES.filter((a) => a.screenId === screenId);
}

const out = [];
const w = (line = '') => out.push(line);

w('# UI inventory — the single source of truth for the parallel UI redesign');
w();
w('Generated by `scripts/gen-ui-inventory.mjs` from `docs/ACP-UI-CONTRACT.md`, `src/data/*.ts`,');
w('`src/lib/tutorialKeys.json` and the testids that exist in `src/`. It is a *derived* view: the');
w('contract stays the authored interface; this file is the flat catalogue a designer can read');
w('without opening the code. It covers Appendix A (the Super Admin, Org Admin, Board Pack,');
w('Certificate and External auditor surfaces) and Appendix B (the core audit workspace, auth and');
w('chrome), so every screen a redesign must draw is here. Screens are grouped by area; each entry');
w('gives screenId, purpose, route, rights, data functions, RPCs/tables, every data-testid, states,');
w('tutorial key and connections. The RPC catalogue at the end lists every `platform_*` and');
w('tenant-facing RPC with parameters. Run `node scripts/gen-ui-inventory.mjs` to regenerate; the');
w('`uiInventory` guard fails if this file drifts from the contract.');
w();
w('## How to read a screen entry');
w();
w('| Field | Meaning |');
w('|---|---|');
w('| screenId | The Appendix A id (e.g. `OA-05`). One screen per id. |');
w('| purpose | One sentence: what the screen is for. |');
w('| route / location | Where it is mounted (a tab, the Audit File window, a drawer, a route). |');
w('| rights | The session right(s) required; a caller without them sees the refusal, never the panel. |');
w('| data functions | The exact `src/data/*.ts` exports the screen calls. Components never reach the client. |');
w("| RPCs / tables | The database functions and tables the screen's data modules reach. |");
w('| testids | Every `data-testid` the screen exposes. |');
w('| explain ids | Every explain-catalogue id the screen mounts (a popout that names its rule, method, field, status or standard). An empty list says the screen carries no explain affordance. |');
w('| IIA standards addressed | The verified IIA 2024 numbers the screen addresses, from the standards catalogue. |');
w('| drilldown targets | Every aggregate the screen renders and the record family it drills to (E5/U1). |');
w('| states | loading / empty / error / ready / denied, named exactly. |');
w('| tutorial key | The `tutorialKeys.json` key the screen binds its drawer to. |');
w('| connections | Inbound and outbound navigation to other screens. |');
w();

for (const [area, list] of byArea) {
  w(`## ${area}`);
  w();
  for (const s of list) {
    const ids = s.ids.map((i) => '`' + i + '`').join(', ');
    const title = s.header.includes('—') ? s.header.split('—').slice(1).join('—').trim() : s.header;
    w(`### ${ids} — ${title}`);
    w();
    w(`- **Purpose:** ${s.purpose || 'see docs/ACP-UI-CONTRACT.md'}`);
    w(`- **Route / location:** ${s.route || 'see contract'}`);
    w(`- **Rights required:** ${s.rights || 'any signed-in member'}`);
    const datafns = [...new Set([...s.data.matchAll(/`([a-zA-Z][a-zA-Z0-9_]*)\s*(?:\([^`]*\))?`/g)].map((m) => m[1]))].sort();
    const mods = [...new Set(datafns.map((f) => fnToModule[f]).filter(Boolean))].sort();
    const rpcs = [...new Set(mods.flatMap((m) => modules[m].rpcs))].sort();
    const tables = [...new Set(mods.flatMap((m) => modules[m].tables))].sort();
    w(`- **Data functions (\`src/data/*.ts\`):** ${datafns.map((f) => '`' + f + '`').join(', ') || 'none (pure/UI only)'}`);
    // Emit these lines even when empty: a designer must be able to tell "this screen touches no
    // module" from "the generator dropped the line", so every screen carries the same field set.
    w(`- **Data modules:** ${mods.map((m) => '`src/data/' + m + '`').join(', ') || 'none (pure/UI only)'}`);
    w(`- **RPCs reachable via those modules:** ${rpcs.map((r) => '`' + r + '`').join(', ') || 'none'}`);
    w(`- **Tables reachable via those modules:** ${tables.map((t) => '`' + t + '`').join(', ') || 'none'}`);
    const tids = [...s.testids.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    w(`- **Testids (${tids.length}):** ${tids.map((t) => '`' + t + '`').join(', ') || '—'}`);
    // E10: the explain layer, the IIA standards and the drilldown targets, per screen. These three
    // lines are the redesign's contract with the explain layer: a screen that shows a number must say
    // what it is (explain ids) and where it goes (drilldown), and a screen that does audit work must
    // name the standards it addresses. An empty line is meaningful — it says the screen carries no
    // such surface, which the G7/G8 gates then hold it to.
    const screenIds = s.ids;
    const wiredExplain = [...new Set(screenIds.flatMap((id) => wiredExplainIds(tids)))].sort();
    w(`- **Explain ids (${wiredExplain.length}):** ${wiredExplain.map((e) => '`' + e + '`').join(', ') || '— (no explain affordance)'}`);
    const screenStd = [...new Set(screenIds.flatMap((id) => standardsForScreen(id)))].sort();
    w(`- **IIA standards addressed (${screenStd.length}):** ${screenStd.map((n) => '`' + n + '`').join(', ') || '—'}`);
    const drills = [...new Set(screenIds.flatMap((id) => drillTargetsForScreen(id)))];
    w(`- **Drilldown targets (${drills.length}):** ${drills.length ? drills.map((d) => `\`${d.testId}\` → ${d.drill}`).join(', ') : '— (no aggregate)'}`);
    w(`- **States:** ${s.states || 'loading / empty / error / ready / denied'}`);
    const keys = [...new Set(tutorialKeys.filter((k) => s.ids.includes(k.screenId)).map((k) => k.key))];
    w(`- **Tutorial key:** ${keys.length ? keys.map((k) => '`' + k + '`').join(', ') : '— (no key)'}`);
    w('- **Connections:** inbound via the nav strip / header profile menu; outbound via the screens');
    w('  named in the purpose. The chrome that carries every hop is listed under *Common chrome*.');
    w();
  }
}

// ---- Common chrome ----------------------------------------------------------
w('## Chrome behaviour reference');
w();
w('The chrome is present on every authenticated screen and is the only thing that moves the user');
w('between areas. The chrome screens themselves (CH-01..CH-06) are documented above under *Common');
w('chrome*; this table adds the tab ids and the inspector kinds a redesign must keep. It is not an');
w('Appendix A screen, and the drawer semantics hold (never a modal, `role="complementary"`).');
w();
const chrome = [
  ['Navigation strip', '`nav-strip-track`, `nav-draggable-pill`; one button per tab: Dashboard (`executive`), Work Queue (`pending`), Audit Universe (`universe`), Audit Plan (`plan`), SIRA (`sira`), Audit Files (`audit_file`), Issues (`issues`). Titles are matched by `getByTitle`.'],
  ['Header bar', '`header-search-compact` (command palette), `menu-activity-log`, `menu-import`, `menu-org-control` (requires `edit_config`), `menu-people-admin` (requires `manage_users` or `manage_roles`), `menu-shared-with-me` (any member), `mobile-universe-switcher` (universe scope, phone viewport).'],
  ['Tutorial drawer', '`tutorial-drawer` and its children (see TUT-01). Opened from any screen\'s "Show me how".'],
  ['Inspector window', 'Floating, non-modal. Kinds: `observation`, `comment`, `sira`, `audit_file`, `workbench`, `glassbox_share`, `account_settings`, `comment_history`, `cap_inspector`, `people_admin`, `org_settings`, `entity_approval`, `deployment_gate`, `ethics`, `combined_approval`, `sira_model`, `sira_cycles`, `plan_items`, `import_wizard`, `activity_log`, `org_control`, `shared_with_me`, `finding`.'],
  ['Theme', 'Light / Dark / System buttons in the header. Every screen must render in all three.'],
];
w('| Chrome | Testids and behaviour |');
w('|---|---|');
for (const [n, d] of chrome) w(`| ${n} | ${d} |`);
w();

// ---- Notifications ----------------------------------------------------------
w('## Notifications and cross-universe sharing (the two newest flows)');
w();
w('These are not Appendix A ids; they are the surfaces SCALE-1 added and a redesign must draw.');
w();
w('### Cross-universe view-only sharing (`share-panel`)');
w();
w('- **Granting screen:** the Assurance control plane (`org_control` inspector), tab `sharing`,');
w('  reached from `menu-org-control`. Requires `edit_config`. Testids: `share-panel`,');
w('  `share-panel-loading`, `share-panel-error`, `share-panel-retry`, `share-panel-grant`,');
w('  `share-grant-universe`, `share-grant-grantee`, `share-grant-expiry`, `share-grant-submit`,');
w('  `share-panel-granted`, `share-granted-empty`, `share-row-<id>`, `share-revoke-reason-<id>`,');
w('  `share-revoke-<id>`, `share-panel-result`.');
w('- **Grantee screen:** the "Shared with you" inspector, reached from `menu-shared-with-me` by any');
w('  member (no `edit_config` needed). Same `share-panel` testid in `mode="grantee"`:');
w('  `share-panel-with-me`, `share-with-me-empty`, `share-with-me-<id>`, `share-view-<id>`,');
w('  `share-panel-view`, `share-view-not-live`, `share-view-entities`, `share-view-engagements`.');
w('- **Data:** `src/data/shares.ts` — `listShares`, `listSharesWithMe`, `grantShare`, `revokeShare`,');
w('  `viewSharedUniverse`, `setHeadLevel`.');
w('- **RPCs:** `shares_get`, `shares_with_me`, `share_grant`, `share_revoke`, `shared_universe_view`,');
w('  `admin_set_head_level`. Table: `universe_shares`.');
w('- **Rights:** grant/revoke require a Level-1 or Level-2 Head (or an Org Admin); read requires a');
w('  live share for `auth.uid()` with `jwt_org_id()` equality. Documented in `docs/SCALE-REPORT.md`.');
w();

// ---- RPC catalogue ----------------------------------------------------------
const allRpcs = [...new Set(Object.values(modules).flatMap((d) => d.rpcs))].sort();
w('## RPC catalogue');
w();
w('Every RPC the app calls, with the data module that owns it and the literal argument names the');
w('caller passes. `platform_*` / `admin_*` RPCs are `security definer` and gated by');
w('`is_platform_admin()`; tenant-facing RPCs are gated by `jwt_org_id()` equality and rights.');
w();
w('| RPC | Module | Parameters | Scope |');
w('|---|---|---|---|');
for (const r of allRpcs) {
  let mod = '';
  let params = [];
  for (const [m, d] of Object.entries(modules)) {
    if (d.params[r]) { mod = m; params = d.params[r]; break; }
  }
  const scope = r.startsWith('platform_') || r.startsWith('admin_') ? 'platform' : 'tenant';
  w(`| \`${r}\` | \`src/data/${mod}\` | ${params.length ? params.map((p) => '`' + p + '`').join(', ') : '—'} | ${scope} |`);
}
w();

// ---- coverage cross-check ---------------------------------------------------
const docTestids = new Set([...contract.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((t) => /^[a-z0-9][a-z0-9<>:.-]*$/.test(t) && t.includes('-') && !t.includes('.')));
const missingInCode = [...docTestids].filter((t) => !t.includes('<') && !codeTestids.has(t)).sort();
w('## Coverage cross-check');
w();
w(`- Screens documented: ${sections.length} (contract sections: 48 Appendix A + 44 Appendix B).`);
w(`- Tutorial keys: ${tutorialKeys.length}.`);
w(`- RPCs catalogued: ${allRpcs.length}.`);
w(`- Data modules: ${Object.keys(modules).length}; exported data functions: ${Object.values(modules).reduce((n, d) => n + d.fns.length, 0)}.`);
w(`- Contract testids not found verbatim in \`src/\` (placeholder or dynamic): ${missingInCode.length}.`);
if (missingInCode.length) w(`  - ${missingInCode.slice(0, 40).join(', ')}${missingInCode.length > 40 ? ' …' : ''}`);
w();

fs.writeFileSync(path.join(ROOT, 'docs/UI-INVENTORY.md'), out.join('\n') + '\n');
console.log(`wrote docs/UI-INVENTORY.md: ${out.length} lines, ${sections.length} screens, ${allRpcs.length} RPCs`);
