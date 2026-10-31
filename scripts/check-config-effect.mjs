#!/usr/bin/env node
/**
 * G3 — config effect (docs/SCALE-TASKS.md, the six anti-theatre gates).
 *
 * The owner's locked decision is "enforce the settings that currently do nothing; do not remove
 * them". `docs/CONFIG-EFFECT-MATRIX.md` is the proof for that: every configurable field is either
 * ENFORCED (a decision in the product reads it, with a named test) or HIDDEN (offered nowhere).
 *
 * This gate keeps that document honest by checking it against the schema that actually ships, not
 * against its own prose. It reads the real schema (pglite, installed --no-save) and fails when:
 *
 *   A. a matrix row names a reader that is not a real function or view (a claim of enforcement with
 *      no call site — the "stored and echoed" defect the matrix exists to prevent);
 *   B. a matrix row names a proving test file that does not exist (a named test that proves nothing);
 *   C. a configuration column in the final schema has no row in the matrix (a new setting shipped
 *      with no effect proof);
 *   D. a matrix row names a `table.column` that is not a real column (a claim about a field that was
 *      renamed or dropped);
 *   E. an allow-list entry is stale (it no longer suppresses a real failure), so the list cannot
 *      silently accumulate.
 *
 * A reader may also be a TypeScript engine (the pattern engine lives in src/lib/patterns.ts, not in
 * SQL); those are named in READER_ALLOW below with the file that defines them, and the file must
 * exist. Everything else must be a real schema object.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const MATRIX_PATH = path.join(ROOT, 'docs/CONFIG-EFFECT-MATRIX.md');
const ALLOW_PATH = path.join(ROOT, 'scripts/config-effect-allow.json');

/**
 * Readers that are pure TypeScript engines, not SQL. `{ symbol: definingFile }`. The file must
 * exist. Kept small on purpose: a SQL reader is the norm, and a TS reader here means the engine is
 * deliberately in the client layer (the pattern engine is pure and unit-tested).
 */
const READER_ALLOW = {
  clusterFindings: 'src/lib/patterns.ts',
};

/**
 * Columns that exist on every table for plumbing and are not "configuration" a user chooses. They
 * do not need a row in the matrix.
 */
const MECHANICAL = new Set(['org_id', 'id', 'created_at', 'updated_at', 'created_by', 'updated_by']);

/** The configuration tables the matrix is required to cover. Each is a table a user can set. */
const CONFIG_TABLES = [
  'anchoring_settings', 'change_control_settings', 'engagement_gate_settings',
  'entity_approval_settings', 'export_retention_settings', 'invite_cap_settings',
  'org_lifecycle_settings', 'org_settings_extra', 'pattern_settings', 'plan_approval_settings',
  'tenant_settings', 'workflow_settings', 'certificate_config', 'report_templates',
  'notification_templates', 'methodology_scales', 'upload_limits', 'archived_file_role',
];

async function loadSchema() {
  let PGlite;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
  } catch {
    console.error('FAIL: @electric-sql/pglite is not installed. Run: npm i --no-save @electric-sql/pglite');
    process.exit(1);
  }
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const db = new PGlite({ extensions: { pgcrypto } });
  const shim = fs.readFileSync(path.join(ROOT, 'scripts/local-sql-shim.sql'), 'utf8');
  const PROVIDED = new Set(['pgcrypto']);
  await db.exec(shim.replace(/create extension[^;]*;/gi, (m) =>
    PROVIDED.has((m.match(/extension if not exists (\w+)/i) ?? [])[1]) ? m : '-- stripped: ' + m));
  for (const f of fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    try {
      await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    } catch (e) {
      console.error(`FAIL: migration ${f} did not apply: ${e.message}`);
      process.exit(1);
    }
  }
  const fns = await db.query(
    `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`);
  const views = await db.query(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('v', 'm')`);
  const cols = await db.query(
    `select table_name, column_name from information_schema.columns where table_schema = 'public'`);
  await db.close();
  const objects = new Set([...fns.rows, ...views.rows].map((r) => r.name));
  const columns = new Set(cols.rows.map((r) => `${r.table_name}.${r.column_name}`));
  return { objects, columns };
}

/** Parse the matrix's data rows: the 5-cell `| field | effect | reader | status | test |` rows. */
function parseMatrix(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 5) continue;
    if (cells[0] === 'Table.field' || /^-+$/.test(cells[0])) continue;
    if (!/`/.test(cells[0])) continue;
    rows.push({ field: cells[0], reader: cells[2], status: cells[3], test: cells[4], raw: line });
  }
  return rows;
}

/** Every backticked token in a cell. */
const tokensIn = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/** Resolve a proving-test token to a real file. SQL tests live in supabase/tests; TS/TSX under src. */
function testFileExists(token) {
  const name = token.replace(/§.*$/, '').trim();
  if (name.endsWith('.sql')) {
    if (fs.existsSync(path.join(ROOT, 'supabase/tests', name))) return true;
    // Some rows name a migration, e.g. 109_phase3_report_templates.sql, which is also a test file.
    return fs.existsSync(path.join(MIGRATIONS, name));
  }
  if (/\.(ts|tsx)$/.test(name)) {
    if (fs.existsSync(path.join(ROOT, name))) return true;
    // A bare basename (OrgGovernancePanel.test.tsx) resolves anywhere under src.
    const hit = (dir) => fs.readdirSync(dir, { withFileTypes: true }).some((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? hit(p) : e.name === name;
    });
    return hit(path.join(ROOT, 'src'));
  }
  return false;
}

const { objects, columns } = await loadSchema();
const matrix = fs.readFileSync(MATRIX_PATH, 'utf8');
const rows = parseMatrix(matrix);

const allow = fs.existsSync(ALLOW_PATH)
  ? JSON.parse(fs.readFileSync(ALLOW_PATH, 'utf8'))
  : {};
const allowEntries = Object.entries(allow).filter(([k]) => !k.startsWith('_'));

const problems = [];
const usedAllow = new Set();

for (const row of rows) {
  if (/MOVED|HIDDEN|DEFERRED/i.test(row.status)) continue;

  // A. the reader cell must name at least one real object (schema function/view, or a TS engine).
  const readerTokens = tokensIn(row.reader).filter((t) => /^[a-zA-Z_][\w]*$/.test(t));
  const realReader = readerTokens.some((t) => objects.has(t) || (READER_ALLOW[t] && fs.existsSync(path.join(ROOT, READER_ALLOW[t]))));
  if (!realReader) {
    const key = `${row.field}::reader`;
    if (allow[key]) { usedAllow.add(key); }
    else problems.push(`A. ${row.field}: reader "${row.reader}" names no real function or view`);
  }

  // B. every named proving test must exist.
  const testTokens = tokensIn(row.test).filter((t) => /\.(sql|ts|tsx)$/.test(t));
  if (testTokens.length === 0) {
    problems.push(`B. ${row.field}: no proving test named`);
  }
  for (const t of testTokens) {
    if (!testFileExists(t)) {
      const key = `${row.field}::test:${t}`;
      if (allow[key]) usedAllow.add(key);
      else problems.push(`B. ${row.field}: proving test "${t}" does not exist`);
    }
  }

  // D. a `table.column` in the field cell must be a real column.
  for (const m of row.field.matchAll(/`([a-z_]+)\.([a-z_]+)`/g)) {
    const [t, c] = [m[1], m[2]];
    if (CONFIG_TABLES.includes(t) && !columns.has(`${t}.${c}`)) {
      const key = `${row.field}::column`;
      if (allow[key]) usedAllow.add(key);
      else problems.push(`D. ${row.field}: column ${t}.${c} does not exist in the schema`);
    }
  }
}

// C. every config-table column (minus plumbing) must be documented somewhere in the matrix. A row
// may document a single `table.column`, a bare column name, or the whole table (a backticked table
// name in the field cell covers all its columns). Documentation counts wherever it appears in the
// document, including the §6 "hidden / deferred" table, so a deliberately-deferred column is
// recorded rather than silently missing.
const documentedColumns = new Set();
const tableLevelDocs = new Set();
for (const row of rows) {
  for (const t of tokensIn(row.field)) if (CONFIG_TABLES.includes(t)) tableLevelDocs.add(t);
}
for (const m of matrix.matchAll(/`([a-z_]+)\.([a-z_]+)`/g)) documentedColumns.add(`${m[1]}.${m[2]}`);
const bareTokens = new Set([...matrix.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]));
for (const table of CONFIG_TABLES) {
  if (tableLevelDocs.has(table)) continue;
  for (const full of columns) {
    if (!full.startsWith(table + '.')) continue;
    const col = full.slice(table.length + 1);
    if (MECHANICAL.has(col)) continue;
    if (documentedColumns.has(full) || bareTokens.has(col)) continue;
    const key = `${full}::undocumented`;
    if (allow[key]) usedAllow.add(key);
    else problems.push(`C. ${full}: configuration column is not in the matrix`);
  }
}

// E. a stale allow-list entry (it no longer suppresses anything) is itself a failure.
for (const [k] of allowEntries) {
  if (!usedAllow.has(k)) problems.push(`E. allow-list entry "${k}" is stale (it suppresses nothing)`);
}

if (problems.length) {
  console.error(`FAIL: check-config-effect — ${problems.length} problem(s):`);
  for (const p of problems) console.error('  ' + p);
  console.error('\nEvery configurable field must be ENFORCED (a real reader, a test that exists) or HIDDEN.');
  process.exit(1);
}

const enforced = rows.filter((r) => /ENFORCED/i.test(r.status)).length;
console.log(`PASS: check-config-effect — ${rows.length} matrix rows (${enforced} ENFORCED); every reader is a real object, every proving test exists, every config column is documented (${allowEntries.length} allow-listed).`);
