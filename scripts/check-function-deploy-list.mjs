#!/usr/bin/env node
/**
 * C2.1: a `supabase functions deploy <name>` in the docs must name a function that exists.
 *
 * The owner deploys the Edge Functions by hand from a list in the docs. If a name in that list has
 * no directory, the deploy fails on the owner's machine, not in CI. This check moves the failure
 * into CI and into the pre-PR gate.
 *
 * It reads every `supabase functions deploy <name>` occurrence in docs/ and supabase/functions/ and
 * asserts a directory exists for each name. Exit 1 lists the offenders.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const FUNCTIONS_DIR = resolve(ROOT, 'supabase/functions');
const DOCS_DIR = resolve(ROOT, 'docs');

/** Every directory under supabase/functions that is not the shared folder. */
function deployedFunctions() {
  return new Set(
    readdirSync(FUNCTIONS_DIR)
      .filter((name) => !name.startsWith('_') && !name.startsWith('.'))
      .filter((name) => statSync(join(FUNCTIONS_DIR, name)).isDirectory())
  );
}

/** Every file under a directory, recursively. */
function filesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

const DEPLOY = /supabase\s+functions\s+deploy\s+([^\n`"'#]+)/g;

/** A deploy line: the names after `deploy` up to the end of the line, minus flags and punctuation. */
function namesOnLine(text) {
  const out = [];
  for (const m of text.matchAll(DEPLOY)) {
    for (const raw of m[1].split(/\s+/)) {
      const name = raw.replace(/[.,;:)\]]+$/, '').trim();
      // A flag, a placeholder or an instruction word is not a function name.
      if (!name || name.startsWith('-') || name.startsWith('<') || name.startsWith('$')) continue;
      if (/^[a-z][a-z0-9-]*$/.test(name)) out.push(name);
    }
  }
  return out;
}

const existing = deployedFunctions();
const problems = [];
let checked = 0;

for (const file of filesUnder(DOCS_DIR)) {
  if (!file.endsWith('.md')) continue;
  const text = readFileSync(file, 'utf8');
  for (const name of namesOnLine(text)) {
    checked += 1;
    if (!existing.has(name)) {
      problems.push(`${file.replace(ROOT + '/', '')}: deploy names "${name}", which has no supabase/functions/${name} directory`);
    }
  }
}

console.log(`=== scripts/check-function-deploy-list.mjs: ${existing.size} functions exist, ${checked} deploy references checked ===`);

if (problems.length > 0) {
  console.error('\n  FAIL: a deploy list names a function with no directory:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`  PASS: every deployed function named in the docs exists (${existing.size} functions).`);
