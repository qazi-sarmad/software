import { describe, expect, it } from 'vitest';
import { fontUrl } from './fontBytes';
import { REPORT_FONT_FAMILIES, fontFileStem, resolveWeight } from '../lib/render/fonts';

/**
 * F2/F6: the bundled-font byte loader. The `?url` imports resolve to emitted asset URLs, so this
 * pins that every catalogue family has a URL for every weight it ships — the mapping the report PDF
 * embedding depends on. A family the catalogue offers but the loader does not bundle would silently
 * fall back to the renderer's standard font, so that is a build failure here, not a runtime surprise.
 */
describe('fontBytes — the bundled-face URL map (F2/F6)', () => {
  it('resolves a URL for every weight of every report family', () => {
    const missing: string[] = [];
    for (const f of REPORT_FONT_FAMILIES) {
      for (const w of f.weights) {
        if (!fontUrl(f.family, w)) missing.push(`${f.family} ${w}`);
      }
    }
    expect(missing, `report families the catalogue offers but the loader does not bundle: ${missing.join(', ')}`).toEqual([]);
  });

  it('returns null for a family outside the catalogue', () => {
    expect(fontUrl('Comic Sans MS', 400)).toBeNull();
  });

  it('maps the file stem to the catalogue (the loader and the tests agree)', () => {
    expect(fontFileStem('Inter', 400)).toBe('inter-latin-400-normal');
    expect(resolveWeight('Inter', 500)).toBe(500);
  });
});
