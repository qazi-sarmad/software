import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FONT_CATALOGUE } from '../lib/fonts/catalogue';
import { REPORT_FONT_FAMILIES, fontLicenceFor } from '../lib/render/fonts';

/**
 * G10 — font licence (F7; docs/FONT-REPOSITORY.md §4, §5).
 *
 * Rule: no bundled font without licence metadata and a redistributable flag. A font shipped in the
 * bundle whose licence is missing, unreadable, or forbids redistribution is the defect this gate
 * exists to catch — the same class as shipping a dependency with no licence.
 *
 * It also enforces F1 directly: no source file and no HTML template may reference a third-party font
 * host, because a CDN font request leaks the client's IP to a third party and breaks offline.
 */
const ROOT = resolve(process.cwd());
const SRC = join(ROOT, 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('G10 — font licence', () => {
  it('every bundled family carries complete licence metadata', () => {
    const bad = FONT_CATALOGUE.filter(
      (f) =>
        !f.licence.id.trim() ||
        !f.licence.name.trim() ||
        !/^https?:\/\//.test(f.licence.url) ||
        !f.licence.attribution.trim()
    ).map((f) => f.family);
    expect(bad, `bundled fonts with incomplete licence metadata: ${bad.join(', ')}`).toEqual([]);
  });

  it('every bundled family is explicitly redistributable', () => {
    const bad = FONT_CATALOGUE.filter((f) => !f.licence.redistributable).map((f) => f.family);
    expect(bad, `bundled fonts that may not be redistributed: ${bad.join(', ')}`).toEqual([]);
  });

  it('every bundled family ships its licence text alongside the package', () => {
    const missing = FONT_CATALOGUE.filter((f) => !existsSync(join(ROOT, 'node_modules/@fontsource', f.slug, 'LICENSE'))).map(
      (f) => f.family
    );
    expect(missing, `bundled fonts with no licence text on disk: ${missing.join(', ')}`).toEqual([]);
  });

  it('every family the report catalogue offers is licensed to embed', () => {
    const byName = new Map(FONT_CATALOGUE.map((f) => [f.family, f]));
    const bad = REPORT_FONT_FAMILIES.filter((f) => {
      const entry = byName.get(f.family);
      return !entry || !entry.licence.redistributable || !entry.reportEmbeddable;
    }).map((f) => f.family);
    expect(bad, `report fonts with no embeddable licence: ${bad.join(', ')}`).toEqual([]);
  });

  it('no source file requests a third-party font host (F1)', () => {
    const forbidden = /fonts\.(googleapis|gstatic)\.com|use\.typekit|fonts\.bunny\.net|cdn\.jsdelivr\.net\/npm\/@fontsource/;
    const offenders = walk(SRC)
      .filter((f) => /\.(ts|tsx|css|html)$/.test(f))
      .filter((f) => forbidden.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(ROOT + '/', ''));
    expect(offenders, `source files requesting a third-party font host: ${offenders.join(', ')}`).toEqual([]);
  });

  it('index.html loads no external font stylesheet (F1)', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(html).not.toMatch(/<link[^>]+href="https?:\/\/[^"]*fonts/i);
  });

  it('every bundled family is loaded either eagerly by the shell or by the lazy loader (F2)', () => {
    const shell = readFileSync(join(SRC, 'index.css'), 'utf8');
    const loader = readFileSync(join(SRC, 'lib/fonts/loader.ts'), 'utf8');
    for (const f of FONT_CATALOGUE) {
      const eagerly = f.alwaysOn && shell.includes(`@fontsource/${f.slug}/`);
      const lazily = !f.alwaysOn && loader.includes(`@fontsource/${f.slug}/`);
      expect(eagerly || lazily, `${f.family} is bundled but neither eagerly nor lazily loaded`).toBe(true);
    }
  });

  it('the render layer can resolve a licensed, embeddable entry for every report family (F2/F6)', () => {
    // `fontLicenceFor` is the accessor the render layer exposes for a family's licence metadata. If
    // it cannot resolve a family the report picker offers, that family is offered without a licence
    // to embed it — the exact defect F7 forbids. This checks the accessor against the real catalogue.
    for (const f of REPORT_FONT_FAMILIES) {
      const entry = fontLicenceFor(f.family);
      expect(entry, `${f.family} has no licence entry`).toBeTruthy();
      expect(entry!.licence.redistributable, `${f.family} may not be redistributed`).toBe(true);
      expect(entry!.reportEmbeddable, `${f.family} is not marked embeddable`).toBe(true);
    }
    expect(fontLicenceFor('Not A Real Font')).toBeUndefined();
  });
});
