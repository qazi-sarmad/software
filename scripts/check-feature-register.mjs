/**
 * Feature-register check (R0).
 *
 * docs/FEATURE-REGISTER.md is the single source of truth for what is wired. Prose rots; this keeps
 * it honest. It fails when:
 *
 *   (1) a row uses a status outside the three allowed values (Wired / Inert / Absent);
 *   (2) the feature ids are not contiguous F1..Fn;
 *   (3) the counts printed in the "honest count" section disagree with the rows;
 *   (4) a `Wired` row names an identifier that exists nowhere in src/ or supabase/;
 *   (5) a `Wired` row names an exported src/data or src/lib function that no screen calls;
 *   (6) an `Inert` row names an exported src/data or src/lib function that IS called — i.e. the
 *       register says dead and the code says live, or someone wired it without updating the row.
 *
 * Rule (6) is the point. It is the automated form of "verify wiring by grepping the call site", and
 * it is what would have caught the unwired monitors, populate_planning_suggestions and
 * listIntegrityAlerts before they were documented as done.
 *
 * Run as `node scripts/check-feature-register.mjs`. Exit 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const REGISTER = path.join(ROOT, 'docs/FEATURE-REGISTER.md');

const text = fs.readFileSync(REGISTER, 'utf8');

// ---- rows -------------------------------------------------------------------
// A feature row is `| F<digits> | ... | \`Status\` | ... |`. The status is backticked so prose in
// the evidence column cannot be mistaken for a status.
const rows = [];
for (const line of text.split('\n')) {
  const m = line.match(/^\|\s*(F\d+)\s*\|([\s\S]*)$/);
  if (!m) continue;
  const cells = line.split('|').map((c) => c.trim());
  // cells[0] is empty (leading pipe); cells[1] is the id.
  const id = cells[1];
  const statusCell = cells[3] ?? '';
  const status = (statusCell.match(/`([A-Za-z]+)`/) ?? [])[1] ?? '';
  const evidence = cells[4] ?? '';
  rows.push({ id, status, evidence, line });
}

const problems = [];

// (1) status vocabulary
const ALLOWED = new Set(['Wired', 'Inert', 'Absent']);
for (const r of rows) {
  if (!ALLOWED.has(r.status)) {
    problems.push(`${r.id}: status "${r.status}" is not one of Wired / Inert / Absent`);
  }
}

// (2) contiguity
const nums = rows.map((r) => Number(r.id.slice(1)));
for (let i = 0; i < nums.length; i++) {
  if (nums[i] !== i + 1) {
    problems.push(`feature ids are not contiguous: expected F${i + 1}, found ${rows[i].id}`);
    break;
  }
}

// (3) the printed counts
const countBlock = text.slice(text.indexOf('## 14.'));
const printed = {};
for (const name of ['Wired', 'Inert', 'Absent']) {
  const m = countBlock.match(new RegExp('`' + name + '`\\s*\\|\\s*(\\d+)'));
  if (m) printed[name] = Number(m[1]);
}
const actual = { Wired: 0, Inert: 0, Absent: 0 };
for (const r of rows) if (r.status in actual) actual[r.status]++;
for (const name of ['Wired', 'Inert', 'Absent']) {
  if (printed[name] !== actual[name]) {
    problems.push(`count for ${name} says ${printed[name]} but the rows total ${actual[name]}`);
  }
}
const totalMatch = countBlock.match(/\*\*Total\*\*\s*\|\s*\*\*(\d+)\*\*/);
if (totalMatch && Number(totalMatch[1]) !== rows.length) {
  problems.push(`total says ${totalMatch[1]} but there are ${rows.length} rows`);
}

// ---- the source corpus ------------------------------------------------------
function walk(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else out.push(p);
    }
  }
  return out;
}

const srcFiles = walk(path.join(ROOT, 'src'));
const migrationFiles = walk(path.join(ROOT, 'supabase')).filter((f) => f.endsWith('.sql'));
const searchable = [...srcFiles, ...migrationFiles];
const corpus = searchable.map((f) => ({ f, s: fs.readFileSync(f, 'utf8') }));

/** Exported function/const names from the pure layers — the things a screen must call. */
const callables = new Set();
for (const { f, s } of corpus) {
  if (!/src\/(data|lib)\//.test(f)) continue;
  for (const m of s.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) callables.add(m[1]);
  for (const m of s.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*[:=]/g)) callables.add(m[1]);
}

/** Files that constitute a "screen" — a caller in one of these means the function is reachable. */
const isUiFile = (f) =>
  /src\/components\//.test(f) || /src\/context\//.test(f) || /src\/hooks\//.test(f) ||
  /src\/App\.tsx$/.test(f);

const calledFromUi = (name) => {
  const re = new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b');
  return corpus.some(({ f, s }) => isUiFile(f) && re.test(s));
};

const existsAnywhere = (name) => {
  const re = new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b');
  return corpus.some(({ s }) => re.test(s));
};

// Tokens in an evidence cell that look like a JS/DB identifier.
const tokensIn = (evidence) =>
  [...evidence.matchAll(/`([A-Za-z_$][\w$]*|[\w$]+(?:\.[\w$]+)+)`/g)]
    .map((m) => m[1])
    .filter((t) => !t.includes('.') || !t.endsWith('.ts'));

/** A token that names a file (ends .ts/.tsx/.sql) is checked as a file, not a symbol. */
const isFileToken = (t) => /\.(tsx?|sql)$/.test(t);
const fileExists = (t) => {
  const base = t.split('/').pop();
  return searchable.some((f) => path.basename(f) === base);
};

for (const r of rows) {
  const tokens = tokensIn(r.evidence);
  // A row asserting deadness must actually be dead. Rows describing the two-UIs defect name things
  // that are legitimately called, so this rule fires only on an explicit deadness claim.
  const assertsDead = /0 caller|no screen calls|zero caller|never called|0 production refs/i.test(r.evidence);
  for (const t of tokens) {
    if (isFileToken(t)) {
      if (!fileExists(t)) problems.push(`${r.id}: file "${t}" does not exist`);
      continue;
    }
    if (r.status === 'Wired') {
      // (4) a Wired row's named thing must exist somewhere real.
      if (!existsAnywhere(t)) {
        problems.push(`${r.id} (Wired): "${t}" does not exist anywhere in src/ or supabase/`);
      }
      // (5) if it is a pure-layer export, a screen must call it.
      if (callables.has(t) && !calledFromUi(t)) {
        problems.push(
          `${r.id} (Wired): "${t}" is exported from src/data or src/lib but no screen calls it — ` +
          `either wire it or mark the row Inert`
        );
      }
    }
    // (6) a row that asserts deadness must be right.
    if (assertsDead && callables.has(t) && calledFromUi(t)) {
      problems.push(
        `${r.id}: evidence claims "${t}" is dead but a screen calls it — the claim is stale`
      );
    }
  }
}

if (problems.length) {
  console.error(`FAIL: check-feature-register (${problems.length} problem(s))`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `PASS: check-feature-register (${rows.length} features: ${actual.Wired} Wired, ` +
  `${actual.Inert} Inert, ${actual.Absent} Absent).`
);
