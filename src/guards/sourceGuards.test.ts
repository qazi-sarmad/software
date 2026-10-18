import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Production paths = every .ts/.tsx under src except tests, test helpers and the dev-only folder. */
const prodFiles = walk(SRC).filter((f) => {
  const rel = relative(SRC, f).replace(/\\/g, '/');
  return /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !rel.startsWith('test/') && !rel.startsWith('guards/');
});

const offenders = (re: RegExp, files = prodFiles) =>
  files.filter((f) => re.test(readFileSync(f, 'utf-8'))).map((f) => relative(SRC, f));

describe('source guards for production paths', () => {
  it('finds production files to scan', () => {
    expect(prodFiles.length).toBeGreaterThan(40);
  });

  it('has no native blocking dialogs: alert( prompt( confirm(', () => {
    expect(offenders(/(^|[^.\w])(alert|prompt|confirm)\s*\(/m)).toEqual([]);
  });

  it('has no "Simulate Viewpoint", persona or impersonation code', () => {
    expect(offenders(/simulate viewpoint|persona|impersonat/i)).toEqual([]);
  });

  it('never uses the word "viewpoint" anywhere in production paths', () => {
    expect(offenders(/viewpoint/i)).toEqual([]);
  });

  it('has no Math.random', () => {
    expect(offenders(/Math\.random/)).toEqual([]);
  });

  it('has no Reports, Red Thread or ledger scrub-bar features', () => {
    expect(offenders(/ReportsTab|ExecutivePackModal|RedThread|red_thread|LedgerScrubBar|ledgerAsOf/)).toEqual([]);
  });

  it('has no lucide-react, Google GenAI, express or dotenv references', () => {
    expect(offenders(/lucide-react|@google\/genai|from ['"]express['"]|dotenv/)).toEqual([]);
  });

  it('has no hardcoded tenant id anywhere in production code', () => {
    expect(offenders(/provio-corp-tenant/)).toEqual([]);
  });

  it('tenant seed data is imported only by the dev-gated seed loader, the dev tools and the demo-tenant stub', () => {
    const importers = offenders(/data\/(initialData|demoSeed)['"]|\.\/(initialData|demoSeed)['"]/).sort();
    expect(importers).toEqual([
      'App.tsx',
      'data/demoSeed.ts',
    ]);
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf-8');
    expect(app).toMatch(/import\.meta\.env\.DEV\s*\?\s*\(\)\s*=>\s*import\('\.\/data\/demoSeed'\)/);
  });

  it('components do not hold tenant figures: no hardcoded account names in AnalyticsTab', () => {
    const tab = readFileSync(join(SRC, 'components/audit/AnalyticsTab.tsx'), 'utf-8');
    expect(tab).not.toMatch(/\d{4} - [A-Z]/);
  });

  it('has no setCurrentUser: identity cannot be switched in-app', () => {
    expect(offenders(/setCurrentUser/)).toEqual([]);
  });

  it('only the dev tooling and the dev-gated loader may mention /dev/ routes', () => {
    const files = offenders(/\/dev\/(access|palette)/).filter((f) => !f.startsWith('components/dev/'));
    expect(files).toEqual(['App.tsx']);
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf-8');
    // Every use of a dev route string must sit behind import.meta.env.DEV.
    for (const m of app.matchAll(/.*\/dev\/(access|palette).*/g)) {
      expect(m[0]).toMatch(/import\.meta\.env\.DEV/);
    }
  });

  it('TEMP_AUTH is removed: no references anywhere in src', () => {
    expect(offenders(/TEMP_AUTH|tempAuth|TempSignInForm|resolveTempAccount/)).toEqual([]);
  });

  it('never reintroduces a retest workflow (spec §28)', () => {
    // The capability list, the transition action set and the UI must not mention a retest workflow
    // or a retest status. "Retry" (a button that re-runs a failed read) is a different word and is
    // matched only when it appears as retest/re-test/fail_retest.
    expect(offenders(/fail_retest|retestStatus|RetestStatus|Re-?[Tt]est/i)).toEqual([]);
  });

  it('never shows an internal right slug to the user (D14)', () => {
    // Disabled controls must explain themselves in plain language via src/lib/rightLabels.ts; a
    // user-visible string must never spell out perform_work, review_and_approve, etc. Only the
    // contents of a string literal or of JSX text are user-visible, so we inspect those segments
    // and ignore comments, identifiers and object keys such as `right: 'perform_work'`.
    const slug =
      /\b(perform_work|review_and_approve|manage_engagements|approve_plan|manage_users|can_reopen|view_all_scopes|edit_config|manage_roles|manage_team)\b/;
    const rightWord = /\b(right|permission)s?\b/i;
    const visibleSegments = (line: string): string[] => {
      const t = line.trim();
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return [];
      const segments: string[] = [];
      for (const m of line.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) {
        segments.push(m[1] ?? m[2] ?? m[3] ?? '');
      }
      for (const m of line.matchAll(/>([^<>{}]+)</g)) segments.push(m[1]);
      return segments;
    };
    const files = prodFiles.filter((f) => !relative(SRC, f).endsWith('lib/rightLabels.ts'));
    const hits = files
      .filter((f) =>
        readFileSync(f, 'utf-8')
          .split('\n')
          .some((line) => visibleSegments(line).some((s) => slug.test(s) && rightWord.test(s))),
      )
      .map((f) => relative(SRC, f));
    expect(hits).toEqual([]);
  });
});
