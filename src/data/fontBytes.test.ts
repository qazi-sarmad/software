import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fontUrl } from './fontBytes';
import { REPORT_FONT_FAMILIES, fontFileStem, resolveWeight } from '../lib/render/fonts';

/**
 * WP-F report-font loading (config-effect proof for `fontHeading` / `fontBody`).
 *
 * The defect this closes: a report format's chosen font was validated, shown on the canvas and
 * stored, but the freeze path never loaded its bytes, so the frozen PDF embedded the renderer's
 * standard font. `renderAndStoreReportFiles` now calls `loadReportFonts`, which this module proves
 * returns real bytes for a catalogue family and nothing for a family outside it (so the renderer
 * falls back rather than failing).
 */

const realInter400 = () =>
  new Uint8Array(readFileSync('node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2'));

// The module caches fetched bytes for the session, so each test gets a fresh copy.
beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());

describe('fontUrl (pure)', () => {
  it('returns an emitted asset URL for every catalogue family at a shipped weight', async () => {
    const { fontUrl } = await import('./fontBytes');
    for (const f of REPORT_FONT_FAMILIES) {
      expect(fontUrl(f.family, f.weights[0]), `${f.family} has no URL`).toBeTruthy();
    }
  });

  it('resolves an unshipped weight to the nearest shipped one, and refuses a family outside the catalogue', async () => {
    const { fontUrl } = await import('./fontBytes');
    expect(fontUrl('Inter', 999)).toBe(fontUrl('Inter', 700)); // 700 is nearest to 999
    expect(fontUrl('Comic Sans', 400)).toBeNull();
  });
});

describe('loadFontBytes', () => {
  it('fetches and caches the face bytes, returning null for a family outside the catalogue', async () => {
    const { loadFontBytes } = await import('./fontBytes');
    const bytes = realInter400();
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.buffer }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const first = await loadFontBytes('Inter', 400);
    expect(first).toBeInstanceOf(Uint8Array);
    expect(first!.length).toBe(bytes.length);
    // Second call is served from cache: fetch is not called again.
    await loadFontBytes('Inter', 400);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(await loadFontBytes('Comic Sans', 400)).toBeNull();
  });

  it('returns null rather than throwing when the fetch fails', async () => {
    const { loadFontBytes } = await import('./fontBytes');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as unknown as Response));
    expect(await loadFontBytes('Lora', 400)).toBeNull();
  });
});

describe('loadReportFonts (the freeze path argument)', () => {
  it('returns heading and body bytes for a catalogue pair', async () => {
    const { loadReportFonts } = await import('./fontBytes');
    const bytes = realInter400();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.buffer }) as unknown as Response));
    const fonts = await loadReportFonts({ family: 'Inter', weight: 600 }, { family: 'Source Serif 4', weight: 400 });
    expect(fonts.headingFontBytes).toBeInstanceOf(Uint8Array);
    expect(fonts.bodyFontBytes).toBeInstanceOf(Uint8Array);
  });

  it('returns undefined for both when the faces are unavailable, so the renderer falls back', async () => {
    const { loadReportFonts } = await import('./fontBytes');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as unknown as Response));
    const fonts = await loadReportFonts({ family: 'Inter', weight: 400 }, { family: 'Lora', weight: 400 });
    expect(fonts.headingFontBytes).toBeUndefined();
    expect(fonts.bodyFontBytes).toBeUndefined();
  });
});

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
