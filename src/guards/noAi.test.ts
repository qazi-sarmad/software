import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * AI-REMOVE guard (owner decision D-P0-1, 2026-10-25): there is no AI anywhere in the product.
 *
 * Law L1 now reads: all logic is deterministic, and guidance is deterministic guided intake (rules and
 * structured prompts). This test fails if any AI identifier, right, feature key or vendor name comes
 * back into live code. History is allowed: migrations numbered below 0087 describe what the schema was,
 * and docs that record the decision name the removed things on purpose.
 *
 * Scope: src, supabase/functions, e2e, scripts. The migrations from 0087 onward are scanned too,
 * except 0087 itself, whose job is to name and drop the removed objects.
 */

const ROOT = resolve(process.cwd());
const SCAN_DIRS = ['src', 'supabase/functions', 'e2e', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'test-results', 'playwright-report']);
const SCAN_EXT = /\.(ts|tsx|js|mjs|cjs|json|sql|yml|yaml|sh)$/;

// This file names the forbidden strings, so it must not scan itself.
const SELF = 'src/guards/noAi.test.ts';

// Files that legitimately mention a removed thing in an explanatory comment. Each entry is a deliberate
// decision: widening this list is the act of letting AI wording back in.
const COMMENT_ONLY = new Set([
  'src/lib/rights.ts',
  'src/guards/edgeEntryPoints.test.ts',
  'e2e/global-setup.ts',
  'src/guards/cronJobRegistry.test.ts',
  'src/guards/e2eAssertions.test.ts',
]);

const FORBIDDEN: Array<[string, RegExp]> = [
  ['use_ai_assist (removed right)', /use_ai_assist/],
  ['ai_assist feature key', /\bai_assist\b/],
  ['ai_voice_library feature key', /ai_voice_library/],
  ['ai_board_slides feature key', /ai_board_slides/],
  ['ai-gateway function', /ai[-_]gateway/i],
  ['AiAssist component', /\bAiAssist\b/],
  ['aiGateway module', /\baiGateway\w*/],
  ['aiPrompt module', /\baiPrompt\b/],
  ['aiSsrf module', /\baiSsrf\b/],
  ['aiNumberGuard module', /\baiNumberGuard\b/],
  ['OrgAiPanel component', /\bOrgAiPanel\b/],
  ['SuperAdminAi component', /\bSuperAdminAi\b/],
  ['"Suggest wording" control', /Suggest wording/i],
  ['AI tables', /\b(tenant_ai_models|ai_use_cases|ai_suggestions|ai_calls|ai_endpoint_denylist|org_voice_(profile|terms|samples))\b/],
  ['vendor model SDKs and hosts', /\b(openai|anthropic)\b/i],
  ['language model wording', /language model/i],
];

function walk(dir: string): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    if (SKIP_DIRS.has(n)) return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function isHistoricMigration(rel: string): boolean {
  const m = /^supabase\/migrations\/(\d{4})_/.exec(rel);
  return !!m && Number(m[1]) <= 87;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/--.*$/gm, '');
}

export function findAiHits(rel: string, text: string): string[] {
  const body = COMMENT_ONLY.has(rel) ? stripComments(text) : text;
  const hits: string[] = [];
  for (const [label, re] of FORBIDDEN) {
    if (re.test(body)) hits.push(label);
  }
  return hits;
}

describe('no AI in the product (D-P0-1)', () => {
  it('finds no AI identifier, right, feature key or vendor name in live code', () => {
    const offenders: string[] = [];
    for (const d of SCAN_DIRS) {
      for (const file of walk(join(ROOT, d))) {
        const rel = relative(ROOT, file).split('\\').join('/');
        if (rel === SELF || !SCAN_EXT.test(rel)) continue;
        const hits = findAiHits(rel, readFileSync(file, 'utf8'));
        if (hits.length) offenders.push(`${rel}: ${hits.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('scans migrations numbered after 0087 for AI wording', () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, 'supabase/migrations'))) {
      const rel = relative(ROOT, file).split('\\').join('/');
      if (isHistoricMigration(rel) || !rel.endsWith('.sql')) continue;
      const hits = findAiHits(rel, readFileSync(file, 'utf8'));
      if (hits.length) offenders.push(`${rel}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the detector catches each forbidden form (so the guard cannot go blind)', () => {
    const samples = [
      "const k = 'use_ai_assist'",
      "has_feature(org, 'ai_assist')",
      "import { x } from './aiGatewayHandler'",
      '<AiAssist />',
      '<OrgAiPanel />',
      'button: Suggest wording',
      'select * from tenant_ai_models',
      "import OpenAI from 'openai'",
      'a hosted language model',
    ];
    for (const s of samples) {
      expect(findAiHits('src/x.ts', s).length, s).toBeGreaterThan(0);
    }
    expect(findAiHits('src/x.ts', "const note = 'deterministic guided intake'")).toEqual([]);
  });

  it('allows explanatory comments only in the listed files', () => {
    const commented = '// use_ai_assist was removed by 0087\nconst a = 1;';
    expect(findAiHits('src/lib/rights.ts', commented)).toEqual([]);
    expect(findAiHits('src/lib/other.ts', commented).length).toBeGreaterThan(0);
  });
});
