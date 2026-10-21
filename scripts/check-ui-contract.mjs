/**
 * UI contract check (C5.1).
 *
 * The owner replaces the UI later; docs/ACP-UI-CONTRACT.md is the interface. This script fails when
 *   (1) an Appendix A screen id has no section of its own in the contract, or
 *   (2) a testid listed in the contract does not appear anywhere under src/.
 *
 * Run as `node scripts/check-ui-contract.mjs`. Exit 1 on either failure.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const CONTRACT = path.join(ROOT, 'docs/ACP-UI-CONTRACT.md');

// Appendix A: GL-01, TUT-01, SA-01..15, OA-01..21, WK-01..10, EX-01..04.
const APPENDIX_A = [
  'GL-01', 'TUT-01',
  ...Array.from({ length: 15 }, (_, i) => `SA-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 21 }, (_, i) => `OA-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 10 }, (_, i) => `WK-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 4 }, (_, i) => `EX-${String(i + 1).padStart(2, '0')}`),
];

const text = fs.readFileSync(CONTRACT, 'utf8');

/** Section headers (level-2) and the ids they cover. */
function sections() {
  const out = [];
  for (const block of text.split(/\n## /).slice(1)) {
    const header = block.split('\n')[0].trim();
    const ids = header.match(/[A-Z]{2,3}-\d{2}/g) ?? [];
    out.push({ header, ids });
  }
  return out;
}

/** Testids documented in a section. */
function testidsIn(block) {
  const m = block.match(/\*\*Testids[^:]*:\*\*([\s\S]*?)(?=\n- \*\*|\n##|\Z)/);
  if (!m) return [];
  // Only tokens that look like a testid: lowercase kebab, optional `<...>`/`:...` placeholders.
  // A wizard step key such as `org.profile` is not a testid and is skipped.
  return [...m[1].matchAll(/`([^`]+)`/g)]
    .map((x) => x[1])
    .filter((t) => t.includes('-') && /^[a-z0-9][a-z0-9<>:.-]*$/.test(t) && !/\.[a-z]/.test(t.replace(/<[^>]*>/g, '')));
}

// Every src testid, static or a template literal, as a regex pattern with wildcards.
function srcPatterns() {
  const pats = [];
  const roots = ['src'];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name)) continue;
      const s = fs.readFileSync(p, 'utf8');
      const re = /(?:data-)?test[iI]d[=:]\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{?"([^"]*)"?)/g;
      for (const m of s.matchAll(re)) {
        const raw = m[1] ?? m[2] ?? m[3] ?? m[4];
        if (raw) pats.push(toRegex(raw));
      }
    }
  };
  for (const r of roots) walk(path.join(ROOT, r));
  return pats;
}

/** A testid or contract pattern to an anchored regex: placeholders become `.*`. */
function toRegex(raw) {
  const esc = raw
    .replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '$' || c === '{' || c === '}' ? c : `\\${c}`))
    .replace(/\$\{[^}]*\}/g, '\u0000')
    .replace(/<[^>]*>/g, '\u0000')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '\u0000')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${esc}$`);
}

const pats = srcPatterns();
const present = (testid) => pats.some((re) => re.test(testid));

const problems = [];

const secs = sections();
for (const id of APPENDIX_A) {
  const own = secs.filter((s) => s.ids.includes(id));
  if (!own.length) problems.push(`no contract section covers ${id}`);
}

for (const block of text.split(/\n## /).slice(1)) {
  for (const tid of testidsIn(block)) {
    if (tid.startsWith('/')) continue; // a route, not a testid
    if (!present(tid)) problems.push(`testid "${tid}" is in the contract but not in src/`);
  }
}

if (problems.length) {
  console.error(`FAIL: scripts/check-ui-contract.mjs found ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`PASS: check-ui-contract (${APPENDIX_A.length} Appendix A screens, all contract testids present in src).`);
