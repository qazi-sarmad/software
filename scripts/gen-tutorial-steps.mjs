/**
 * Tutorial steps generator (C4).
 *
 * S12 seeded the same three generic lines ("Open SA-01", "Follow the highlighted control", "Confirm
 * the change") for all 85 keys. This derives real, ordered, plain-language steps for every key from
 * the ONE source of truth that describes the real controls: the testids in docs/ACP-UI-CONTRACT.md.
 * Each step names the control in words and records the exact testid the recorder must drive, so the
 * drawer shows the steps, "Copy steps" copies them, and the recorder performs them.
 *
 * A step never targets a state element (`…-loading`, `…-error`, `…-empty`): only controls a person
 * actually operates. A display element becomes a step that says what to read; a control becomes a
 * step that says what to do. The two setup wizards get their real per-step walkthrough, one key per
 * wizard step.
 *
 * Run: node scripts/gen-tutorial-steps.mjs
 * Writes: src/lib/tutorialKeys.json (key, audience, screenId, title, steps[{text,testid}])
 *         supabase/migrations/0081_tutorial_steps.sql
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const keys = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/lib/tutorialKeys.json'), 'utf8'));
const contract = fs.readFileSync(path.join(ROOT, 'docs/ACP-UI-CONTRACT.md'), 'utf8');

/** Testids documented for each screen id, in contract order. */
function testidsByScreen() {
  const map = {};
  for (const block of contract.split(/\n## /)) {
    const header = block.split('\n')[0];
    const ids = header.match(/[A-Z]{2,3}-\d{2}/g) ?? [];
    if (!ids.length) continue;
    const m = block.match(/\*\*Testids[^:]*:\*\*([\s\S]*?)(?=\n- \*\*|\n##|\Z)/);
    if (!m) continue;
    const raw = [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
    for (const id of ids) map[id] = (map[id] ?? []).concat(raw);
  }
  return map;
}
const byScreen = testidsByScreen();

/**
 * A testid a step may target. A `<...>` placeholder is allowed: the recorder resolves it to the
 * first matching element on the screen, which is what a person does too (the first tenant, the
 * first row). A testid with no placeholder is matched exactly.
 */
const usable = (t) => /^[a-z0-9][a-z0-9._<>-]*$/.test(t);
const STATE = /(loading|error|empty|denied|no-right|readonly-notice|readonly|notice|missing|inactive|wrong-principal|not-found|rate-limited|read-result|figure-sealed|placeholder|skeleton)$/;
/** Elements that describe an absence or a state, never an action a person performs. */
const NEGATIVE = /(^|-)(no|not|non|missing|absent|none)(-|$)/;

/** Family prefixes that carry no meaning on their own. */
const SCOPE_PREFIX = /^(org|superadmin|super-admin|oa|sa|wk|ex|admin|tutorial|org-control|platform|people)-/;
const WORDS = {
  cfg: 'configuration', bp: 'Board Pack', ai: 'AI', sa: 'Super Admin', oa: 'Org Admin',
  pk: 'Board Pack', pp: 'PowerPoint', sha: 'SHA-256', id: 'ID', url: 'URL', ok: 'OK',
  cap: 'CAP', sira: 'SIRA', rcm: 'RCM', fsli: 'FSLI', sl: 'SLA', sla: 'SLA', smtp: 'SMTP',
  pptx: 'PPTX', pdf: 'PDF', docx: 'DOCX', xlsx: 'XLSX', csv: 'CSV', json: 'JSON',
  qs: 'QSCorp', tenant: 'tenant', tev: 'tenant', boardpack: 'Board Pack', superadmin: 'platform',
  ai: 'AI', bp: 'Board Pack', step: 'step', cfg: 'configuration', org: 'organisation',
  resend: 'Resend', smtp: 'SMTP', graph: 'Microsoft Graph', oauth: 'OAuth', rcm: 'RCM',
};

/** A readable phrase for a testid: drop the scope prefix, expand words, drop placeholders. */
function humanise(testid, fallback = 'the control') {
  let t = testid;
  // A placeholder segment means "the first one of these"; keep the word it stands for.
  const placeholder = t.match(/<([a-z0-9._-]+)>/i);
  t = t.replace(/<[^>]*>/g, '');
  let words = t.replace(/_/g, '-').split('-').filter(Boolean);
  if (words.length > 1 && SCOPE_PREFIX.test(words.join('-') + '-')) words.shift();
  words = words.map((w) => WORDS[w] ?? w);
  let phrase = words.join(' ').replace(/\s+/g, ' ').trim();
  if (placeholder) {
    const p = humaniseWord(placeholder[1]);
    phrase = phrase ? `${phrase} (the first ${p})` : `the first ${p}`;
  }
  if (!phrase) return fallback;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
const humaniseWord = (w) => (WORDS[w] ?? w).replace(/_/g, ' ');

/** What kind of thing the testid is, which decides the sentence. */
function kindOf(t) {
  if (/<[^>]*>/.test(t)) return 'first';
  if (/-(tab|nav|menu|step|pill)(-|$)/.test(t)) return 'navigate';
  if (/(input|field|name|email|scope|boundary|date|amount|value|key|text|note|reason|comment|title|description|threshold|size|limit|port|host|user|password|token|url)$/.test(t)) return 'input';
  if (/(select|dropdown|filter|search|sort|picker|choose)$/.test(t)) return 'choose';
  if (/(toggle|switch|enabled|disabled|checkbox|flag)$/.test(t)) return 'toggle';
  if (/(list|table|rows?|history|result|results|status|summary|count|time|masked|figure|figures|progress|badge|trail|log|detail|details|panel|card|header|title|label|text|name)$/.test(t)) return 'read';
  if (/(save|submit|generate|issue|verify|send|accept|apply|publish|record|create|add|start|run|invoke|upload|grant|provision|invite|assign|refresh|retry|confirm|approve|resolve|convert|drop|end|schedule|renew|revoke|disable|enable|test|probe|download|copy|preview|export|print|close|open|next|back|skip|continue|remove|edit|link|unlink|activate|deactivate|extend|cancel|reset|clear|import|map|validate|check|finish|complete|launch|sign|save-changes|dismiss|acknowledge|escalate|reassign|withdraw|submit-for-review)$/.test(t)) return 'act';
  return 'read';
}

/** Verbs that really finish a task, preferred for the last step. */
const STRONG = /(save|submit|generate|issue|verify|send|accept|apply|publish|record|create|start|run|invoke|upload|grant|provision|invite|assign|confirm|approve|resolve|convert|schedule|renew|revoke|complete|finish|launch|sign|escalate)$/;

const sentence = (kind, label, screen) => {
  switch (kind) {
    case 'act':
      return `Click ${label} in ${screen}.`;
    case 'navigate':
      return `Open the ${label.replace(/\b(tab|nav|menu|step|pill)\b/gi, '').replace(/\s+/g, ' ').trim()} tab in ${screen}.`;
    case 'input':
      return `Fill in ${label} in ${screen}.`;
    case 'choose':
      return `Choose ${label} in ${screen}.`;
    case 'toggle':
      return `Turn ${label} on or off in ${screen}.`;
    case 'first':
      return `Find the first ${label.replace(/\s*\(the first .*\)$/, '')} in ${screen}.`;
    default:
      return `Read ${label} in ${screen}.`;
  }
};

/** The controls a person actually operates on a screen, in contract order. */
function interactive(def) {
  const own = [...new Set((byScreen[def.screenId] ?? []).filter(usable))];
  return own.filter((t) => !STATE.test(t) && !NEGATIVE.test(t.replace(SCOPE_PREFIX, '')));
}

/**
 * Rank a screen's controls by how relevant they are to THIS key, because several keys share one
 * screen (WK-01..WK-04 share the Dashboard panel; OA-20's section also documents its acceptance
 * route). Positional order would pick a neighbouring key's control.
 */
function rank(def, pool) {
  const keyWords = def.key.split('.').slice(1).join('.').split(/[.-]/).filter(Boolean);
  const scored = pool.map((t) => {
    const rest = t.replace(SCOPE_PREFIX, '');
    let score = 0;
    if (keyWords.some((w) => rest === w)) score += 30;
    if (keyWords.some((w) => rest.startsWith(`${w}-`) || rest.endsWith(`-${w}`))) score += 18;
    if (keyWords.some((w) => rest.includes(w))) score += 10;
    const kind = kindOf(t);
    if (kind === 'act') score += 6;
    if (kind === 'navigate') score += 4;
    if (kind === 'read' && /(list|table|rows|result|summary|status|panel|progress|figure)/.test(rest)) score += 3;
    if (kind === 'first') score -= 2;
    // Negative-state and descriptive-only elements are not steps a person performs.
    if (/-(no|not|missing|label|kind|readonly|hint|badge|header|description)(-|$)/.test(rest)) score -= 10;
    if (/^(tab|nav|menu)-/.test(rest) && !keyWords.includes('tab')) score -= 6;
    // A second tab is a neighbouring key's surface, not this key's.
    if (/-tab-/.test(rest) && !keyWords.some((w) => rest.includes(w))) score -= 8;
    return { t, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.t);
}

/** Ordered steps from a screen's own controls, best-match first. */
function stepsFor(def) {
  const screen = def.screenId;
  const pool = interactive(def);
  const ranked = rank(def, pool);
  const strong = ranked.find((t) => kindOf(t) === 'act' && STRONG.test(t));

  const chosen = [];
  const push = (t) => {
    if (t && !chosen.includes(t)) chosen.push(t);
  };
  const ofKind = (k) => ranked.filter((t) => kindOf(t) === k);
  // Reach the surface, see what is there, do the work, then pick a row.
  push(ofKind('navigate')[0]);
  push(ofKind('read')[0]);
  const act = ofKind('act').find((t) => STRONG.test(t)) ?? ofKind('act')[0];
  push(act);
  push(ofKind('first')[0]);
  for (const t of ranked) {
    if (chosen.length >= 6) break;
    push(t);
  }

  const steps = [{ text: `Open ${screen} (${def.title}).`, testid: null }];
  for (const t of chosen) {
    if (steps.length >= 7) break;
    steps.push({ text: sentence(kindOf(t), humanise(t, def.title), screen), testid: t });
  }
  // A thin screen still gets a usable walkthrough: name what to check, never a filler phrase.
  if (steps.length < 4) {
    steps.push({ text: `Check the values shown on ${screen} and confirm they are correct.`, testid: null });
  }
  if (steps.length < 4) {
    steps.push({ text: `Save the change, then read the confirmation on ${screen}.`, testid: null });
  }
  return steps;
}

const WIZARD_STEP_KEYS = {
  sa: ['sa.readiness', 'sa.email', 'sa.recipients', 'sa.ai', 'sa.hosting', 'sa.rules', 'sa.features', 'sa.tutorials', 'sa.golive'],
  oa: ['org.profile', 'org.features', 'org.roles', 'org.ai', 'org.presentation', 'org.escalation', 'org.hosting', 'org.email', 'org.golive'],
};
const WIZARD_STEP_TITLES = {
  'sa.readiness': 'the platform readiness check', 'sa.email': 'the platform email sender',
  'sa.recipients': 'the platform notification recipients', 'sa.ai': 'the AI model registry and deny-list',
  'sa.hosting': 'the hosting catalogue review', 'sa.rules': 'the platform default rules and templates',
  'sa.features': 'the feature catalogue and plans', 'sa.tutorials': 'the tutorial library check',
  'sa.golive': 'the new-tenant defaults and Go Live',
  'org.profile': 'the organisation profile and branding', 'org.features': 'feature enablement',
  'org.roles': 'roles and permission defaults', 'org.ai': 'the AI settings',
  'org.presentation': 'the presentation and certificate templates',
  'org.escalation': 'the escalation and automation rules', 'org.hosting': 'hosting',
  'org.email': 'email', 'org.golive': 'the health check and Go Live',
};

/** The two setup wizards: one key per real wizard step. */
function wizardSteps(scope, index) {
  const stepKey = WIZARD_STEP_KEYS[scope][index - 1];
  const scopeId = scope === 'sa' ? 'super_admin' : 'org_admin';
  const screen = scope === 'sa' ? 'SA-01' : 'OA-01';
  const label = WIZARD_STEP_TITLES[stepKey];
  return [
    { text: `Open ${screen}, setup step ${index}: ${label}.`, testid: `${scopeId}-wizard` },
    { text: `Select step ${index} (${label}) in the step list.`, testid: `${scopeId}-wizard-step-${stepKey}` },
    { text: `Open the ${label} step.`, testid: `${scopeId}-wizard-show-${stepKey}` },
    { text: `Fill in ${label}.`, testid: `${scopeId}-wizard-content-${stepKey}` },
    { text: 'Click Save this step.', testid: `${scopeId}-wizard-save` },
    { text: 'Click Next to move to the following step.', testid: `${scopeId}-wizard-next` },
  ];
}

/**
 * Screens that are a pure read: they have no control to press, only rows to read. Their steps name
 * what the reader looks at, in order, and never invent a button.
 */
const READ_ONLY_STEPS = {
  'sa.trail': [
    { text: 'Open SA-15 (Platform trail).', testid: 'superadmin-trail' },
    { text: 'Read the trail: each row is one platform action.', testid: 'superadmin-trail' },
    { text: 'Check the actor, the action and the time on every row.', testid: 'superadmin-trail' },
    { text: 'The trail is append-only, so nothing here can be edited or removed.', testid: 'superadmin-trail' },
  ],
};

function stepsFor_(def) {
  if (READ_ONLY_STEPS[def.key]) return READ_ONLY_STEPS[def.key];
  const wiz = /^(sa|oa)\.setup-(wizard|([1-9]))$/.exec(def.key);
  if (wiz) {
    const scope = wiz[1];
    const scopeId = scope === 'sa' ? 'super_admin' : 'org_admin';
    const screen = scope === 'sa' ? 'SA-01' : 'OA-01';
    if (wiz[2] === 'wizard') {
      return [
        { text: `Open ${screen} (${def.title}).`, testid: `${scopeId}-wizard` },
        { text: 'Read the progress bar to see which steps are already done.', testid: `${scopeId}-wizard-progress` },
        { text: `Select the step to work on: the first is ${WIZARD_STEP_TITLES[WIZARD_STEP_KEYS[scope][0]]}.`, testid: `${scopeId}-wizard-step-${WIZARD_STEP_KEYS[scope][0]}` },
        { text: 'Fill in that step and click Save this step.', testid: `${scopeId}-wizard-save` },
        { text: 'Click Next to move to the following step.', testid: `${scopeId}-wizard-next` },
      ];
    }
    return wizardSteps(scope, Number(wiz[2]));
  }
  return stepsFor(def);
}

const enriched = keys.map((def) => ({ ...def, steps: stepsFor_(def) }));

fs.writeFileSync(
  path.join(ROOT, 'src/lib/tutorialKeys.json'),
  JSON.stringify(enriched, null, 2) + '\n',
);

const esc = (s) => s.replace(/'/g, "''");
const values = enriched
  .map((d) => `  ('${esc(d.key)}', '${esc(JSON.stringify(d.steps))}'::jsonb)`)
  .join(',\n');
fs.writeFileSync(
  path.join(ROOT, 'supabase/migrations/0081_tutorial_steps.sql'),
  `-- 0081_tutorial_steps.sql — C4.
--
-- S12 seeded the same three generic lines for all 85 keys. This replaces them with the real ordered
-- steps derived from the testids in docs/ACP-UI-CONTRACT.md, but only for rows the recorder has not
-- generated yet, so a live recording run is never overwritten.

update tutorials t
   set steps = v.steps
  from (values
${values}
  ) as v(key, steps)
 where t.key = v.key
   and t.generated_at is null;
`,
);

const short = enriched.filter((d) => d.steps.length < 4);
const long = enriched.filter((d) => d.steps.length > 8);
const state = enriched.filter((d) => d.steps.some((x) => x.testid && STATE.test(x.testid)));
console.log(`generated steps for ${enriched.length} keys`);
console.log(`  below four steps: ${short.length}; above eight: ${long.length}; targeting a state element: ${state.length}`);
for (const s of [...short, ...long, ...state]) console.log(`  ${s.key} (${s.screenId})`);
